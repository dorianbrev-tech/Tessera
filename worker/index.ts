// Tessera job worker. Runs analysis, generation, chat edits and fidelity checks
// outside the web process so long jobs survive page reloads and closed tabs.
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { claimNextJob, emit, enqueueJob, failStaleJobs, heartbeat, isCancelled, updateJob } from "@/lib/jobs";
import type { Job } from "@/lib/db/schema";
import type { JobContext } from "@/lib/job-context";
import { JobCancelled } from "@/lib/job-context";
import { runAnalyzeJob } from "@/lib/analysis/run";
import { runChatJob, runFidelityJob, runGenerateJob } from "@/lib/ai/jobs";
import { mergeSettings, touchProject } from "@/lib/projects";
import { closeBrowser } from "@/lib/browser";
import Anthropic from "@anthropic-ai/sdk";

const WORKER_ID = `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
const concurrency = Math.max(1, env.workerConcurrency);
let running = 0;
let stopping = false;
let wake: (() => void) | null = null;

const handlers: Record<Job["type"], (ctx: JobContext) => Promise<Record<string, unknown>>> = {
  analyze: runAnalyzeJob,
  generate: runGenerateJob,
  chat: runChatJob,
  fidelity: runFidelityJob,
};

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Claude rejected the API key (401). Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The API key is not allowed to use this model (403). Check CLAUDE_MODEL and your Anthropic plan.";
  if (e instanceof Anthropic.RateLimitError) return "Claude rate limit reached. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

async function runJob(job: Job) {
  const started = Date.now();
  let lastProgressWrite = 0;
  const ctx: JobContext = {
    job,
    emit: (type, data = {}) => emit(job.id, type, data),
    log: async (message, level = "info") => {
      console.log(`[${job.type} ${job.id.slice(0, 8)}] ${message}`);
      await emit(job.id, "log", { message, level });
    },
    progress: async (fraction, stage) => {
      const now = Date.now();
      if (stage) await emit(job.id, "stage", { stage, progress: fraction });
      if (stage || now - lastProgressWrite > 1500) {
        lastProgressWrite = now;
        await updateJob(job.id, { progress: Math.max(0, Math.min(1, fraction)), ...(stage ? { stage } : {}) });
      }
    },
    isCancelled: () => isCancelled(job.id),
  };
  const hb = setInterval(() => heartbeat(job.id).catch(() => {}), 20_000);
  try {
    await emit(job.id, "stage", { stage: "Started", progress: 0 });
    const result = await handlers[job.type](ctx);
    await updateJob(job.id, { status: "succeeded", result, progress: 1, finishedAt: new Date(), stage: "Done" });
    // Enqueue any follow-up job before announcing completion, so clients that reload
    // on "done" already see the next job as active.
    await chainNext(job).catch((e) => console.error("chain failed", e));
    await emit(job.id, "done", { status: "succeeded", result });
    console.log(`[${job.type} ${job.id.slice(0, 8)}] succeeded in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (e) {
    const cancelled = e instanceof JobCancelled || (await isCancelled(job.id));
    const message = cancelled ? "Cancelled" : friendlyError(e);
    if (!cancelled) console.error(`[${job.type} ${job.id.slice(0, 8)}] failed:`, e);
    await updateJob(job.id, { status: cancelled ? "cancelled" : "failed", error: message, finishedAt: new Date() });
    await emit(job.id, cancelled ? "done" : "error", { status: cancelled ? "cancelled" : "failed", message });
    if (!cancelled) await emit(job.id, "done", { status: "failed", message });
    const [p] = await db.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, job.projectId));
    if (p && (p.status === "analyzing" || p.status === "generating")) {
      await touchProject(job.projectId, { status: job.type === "analyze" ? (cancelled ? "draft" : "error") : "ready" });
    }
    if (!cancelled && (job.type === "chat" || job.type === "generate")) {
      await db.insert(schema.messages).values({ projectId: job.projectId, role: "assistant", content: `I couldn't finish this: ${message}`, jobId: job.id, meta: { error: true } });
    }
    await closeBrowser();
  } finally {
    clearInterval(hb);
  }
}

/** After analysis, start generation automatically when the project asks for it. */
async function chainNext(job: Job) {
  if (job.type !== "analyze") return;
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, job.projectId));
  if (!p) return;
  const settings = mergeSettings(p.settings);
  if (settings.autoGenerate && env.anthropicConfigured && !job.input.skipGenerate) {
    const next = await enqueueJob({ projectId: p.id, userId: job.userId, type: "generate", input: { chainedFrom: job.id } });
    await emit(job.id, "log", { message: "Starting generation…", level: "info", nextJobId: next.id });
    await emit(job.id, "stage", { stage: "Generation queued", nextJobId: next.id });
  }
}

async function loop() {
  while (!stopping) {
    while (running < concurrency && !stopping) {
      const job = await claimNextJob(WORKER_ID).catch((e) => {
        console.error("claim failed", e);
        return null;
      });
      if (!job) break;
      running++;
      console.log(`→ ${job.type} job ${job.id} (project ${job.projectId})`);
      runJob(job).finally(() => {
        running--;
        wake?.();
      });
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, 3000);
    });
    wake = null;
  }
}

async function listen() {
  // LISTEN/NOTIFY wakes the worker immediately when a job is enqueued.
  const client = new pg.Client({ connectionString: env.databaseUrl });
  client.on("error", () => setTimeout(listen, 5000));
  try {
    await client.connect();
    await client.query("LISTEN tessera_jobs");
    client.on("notification", () => wake?.());
  } catch (e) {
    console.warn("LISTEN unavailable, polling only:", (e as Error).message);
  }
}

async function main() {
  console.log(`Tessera worker ${WORKER_ID} · concurrency ${concurrency} · AI ${env.anthropicConfigured ? `on (${env.claudeModel})` : "off (ANTHROPIC_API_KEY not set)"}`);
  const stale = await failStaleJobs();
  if (stale.length) console.log(`Marked ${stale.length} stale job(s) as failed`);
  setInterval(() => failStaleJobs().catch(() => {}), 60_000).unref();
  await listen();
  await loop();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: waiting for ${running} running job(s)…`);
  const deadline = Date.now() + 25_000;
  while (running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  await closeBrowser();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
