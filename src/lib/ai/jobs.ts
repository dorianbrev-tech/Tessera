// Job handlers that drive the agent: full generation, chat edits and fidelity passes.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { listFiles, mergeSettings, snapshotVersion, touchProject } from "@/lib/projects";
import { comparisonTargets, comparePage } from "@/lib/fidelity/run";
import { renderThumbnail } from "@/lib/fidelity/thumbnail";
import { closeBrowser } from "@/lib/browser";
import type { JobContext } from "@/lib/job-context";
import { runAgent, type AgentResult } from "./agent";
import { buildProjectContext, fixTask, generateTask } from "./prompts";
import { AiNotConfiguredError } from "./client";

async function finish(ctx: JobContext, result: AgentResult, label: string) {
  const version = result.changedFiles.length ? await snapshotVersion(ctx.job.projectId, label, "ai", ctx.job.id) : null;
  const [msg] = await db
    .insert(schema.messages)
    .values({
      projectId: ctx.job.projectId,
      role: "assistant",
      content: result.summary,
      jobId: ctx.job.id,
      meta: {
        activity: result.activity.slice(-80),
        changedFiles: result.changedFiles,
        versionId: version?.id ?? null,
        versionNumber: version?.number ?? null,
        fidelity: result.fidelity,
        usage: result.usage,
        turns: result.turns,
        stoppedEarly: result.stoppedEarly ?? null,
      },
    })
    .returning({ id: schema.messages.id });
  if (result.changedFiles.length) {
    await ctx.progress(0.97, "Updating thumbnail");
    await renderThumbnail(ctx.job.projectId).catch(() => {});
  }
  await touchProject(ctx.job.projectId, { status: "ready" });
  return { messageId: msg.id, versionId: version?.id ?? null, changedFiles: result.changedFiles.length, fidelity: result.fidelity, usage: result.usage };
}

export async function runGenerateJob(ctx: JobContext) {
  if (!env.anthropicConfigured) throw new AiNotConfiguredError();
  const projectId = ctx.job.projectId;
  const existing = await listFiles(projectId);
  if (existing.length) await snapshotVersion(projectId, "Before regeneration", "autosave", ctx.job.id);
  await touchProject(projectId, { status: "generating" });
  const { project, recreation } = await buildProjectContext(projectId);
  await ctx.progress(0.03, "Planning the site");
  try {
    const result = await runAgent({
      ctx,
      task: generateTask({ recreation, design: project.design, extra: (ctx.job.input.instructions as string) || undefined }),
      effort: env.effortGenerate,
    });
    return await finish(ctx, result, "AI · Generated website");
  } finally {
    await closeBrowser();
  }
}

export async function runChatJob(ctx: JobContext) {
  if (!env.anthropicConfigured) throw new AiNotConfiguredError();
  const input = ctx.job.input as { text: string; attachments?: { storageKey: string; mime: string; name: string }[]; runtimeErrors?: string[]; currentPath?: string };
  await touchProject(ctx.job.projectId, { status: "generating" });
  const parts = [
    "# Request from the user",
    input.text,
    input.currentPath ? `\n(The user is currently looking at ${input.currentPath} in the preview.)` : "",
    input.runtimeErrors?.length ? `\nErrors reported by the live preview:\n- ${input.runtimeErrors.slice(0, 10).join("\n- ")}` : "",
    "\nMake the change, verify it with render_preview, then reply with a brief summary.",
  ];
  try {
    const result = await runAgent({ ctx, task: parts.filter(Boolean).join("\n"), effort: env.effortChat, attachments: input.attachments });
    return await finish(ctx, result, `AI · ${input.text.replace(/\s+/g, " ").slice(0, 80)}`);
  } catch (e) {
    await touchProject(ctx.job.projectId, { status: "ready" });
    throw e;
  } finally {
    await closeBrowser();
  }
}

/** Measure fidelity for every recreated page; optionally let the agent fix the gaps. */
export async function runFidelityJob(ctx: JobContext) {
  const projectId = ctx.job.projectId;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const settings = mergeSettings(project.settings);
  const viewports = ((ctx.job.input.viewports as string[] | undefined) ?? ["desktop", "mobile"]) as ("desktop" | "tablet" | "mobile")[];
  const autoFix = Boolean(ctx.job.input.autoFix);
  try {
    const targets = await comparisonTargets(projectId, { viewports, maxPages: 8 });
    if (!targets.length) throw new Error("No reference has a Full recreation or Layout role, so there is nothing to compare against. Assign one of those roles to a reference first.");
    const lines: string[] = [];
    const missing: string[] = [];
    const scores: { path: string; viewport: string; score: number; reportId?: string }[] = [];
    for (const [i, t] of targets.entries()) {
      if (await ctx.isCancelled()) break;
      await ctx.progress(0.05 + (i / targets.length) * (autoFix ? 0.3 : 0.9), `Comparing ${t.path} (${t.viewport})`);
      const r = await comparePage(projectId, t, { jobId: ctx.job.id, iteration: 0 });
      if (r.missing || !r.metrics) {
        lines.push(`${t.path} @ ${t.viewport}: missing — ${r.issues[0]?.message ?? ""}`);
        if (!missing.includes(t.path)) missing.push(t.path);
        await ctx.log(`${t.path} (${t.viewport}): page missing`, "warn");
        continue;
      }
      scores.push({ path: t.path, viewport: t.viewport, score: r.metrics.overall, reportId: r.reportId });
      await ctx.emit("fidelity", { reportId: r.reportId, path: t.path, viewport: t.viewport, score: r.metrics.overall, round: 0 });
      await ctx.log(`${t.path} (${t.viewport}): ${r.metrics.overall}/100`);
      lines.push(`${t.path} @ ${t.viewport}: ${r.metrics.overall}/100\n${r.issues.slice(0, 8).map((x) => `  - [${x.severity}] ${x.message}`).join("\n")}`);
    }
    const below = scores.filter((s) => s.score < settings.fidelityTarget);
    const avg = scores.length ? Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10 : 0;

    if (autoFix && env.anthropicConfigured && (below.length || missing.length)) {
      await touchProject(projectId, { status: "generating" });
      const result = await runAgent({ ctx, task: fixTask(lines.join("\n")), effort: env.effortGenerate });
      return { average: avg, scores, ...(await finish(ctx, result, "AI · Fidelity improvements")) };
    }
    const parts = [
      scores.length
        ? `Fidelity check: average ${avg}/100 across ${scores.length} comparison${scores.length > 1 ? "s" : ""} (target ${settings.fidelityTarget}).`
        : "Fidelity check: no generated pages matched the reference pages yet.",
      below.length ? `${below.length} below target: ${below.map((b) => `${b.path} @ ${b.viewport} (${b.score})`).join(", ")}.` : scores.length ? "Every compared page meets the target." : "",
      missing.length ? `${missing.length} reference page${missing.length > 1 ? "s have" : " has"} no generated counterpart yet: ${missing.map((m) => "`" + m + "`").join(", ")}.` : "",
    ];
    const content = parts.filter(Boolean).join(" ");
    await db.insert(schema.messages).values({ projectId, role: "assistant", content, jobId: ctx.job.id, meta: { fidelity: scores, kind: "fidelity", missing } });
    return { average: avg, scores, missing };
  } finally {
    await closeBrowser();
  }
}
