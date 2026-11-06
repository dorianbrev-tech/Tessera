import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, parseJson, requireUser, route } from "@/lib/http";
import { startJob } from "@/lib/api";
import { assertPublicUrl, UnsafeUrlError } from "@/lib/analysis/net";
import { env } from "@/lib/env";
import { DEFAULT_SETTINGS, type ReferenceRole } from "@/lib/types";
import { SettingsSchema, roleEnum } from "@/lib/validation";

const Body = z.object({
  name: z.string().trim().max(120).optional(),
  mode: z.enum(["recreate", "combine", "prompt", "screenshots"]),
  brief: z.string().max(8000).default(""),
  references: z
    .array(z.object({ url: z.string().min(3).max(2000), roles: z.array(roleEnum).min(1), notes: z.string().max(2000).default("") }))
    .max(8)
    .default([]),
  settings: SettingsSchema.default({}),
  start: z.boolean().default(true),
});

export const GET = route(async () => {
  const user = await requireUser();
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      mode: schema.projects.mode,
      status: schema.projects.status,
      thumbnailKey: schema.projects.thumbnailKey,
      publishedSlug: schema.projects.publishedSlug,
      updatedAt: schema.projects.updatedAt,
      createdAt: schema.projects.createdAt,
      // Correlated subqueries must reference the outer table explicitly ("projects"."id").
      fileCount: sql<number>`(select count(*)::int from project_files f where f.project_id = "projects"."id")`,
      refs: sql<string[]>`coalesce((select array_agg(coalesce(r.url, 'screenshot') order by r.position) from reference_sites r where r.project_id = "projects"."id"), '{}')`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id))
    .orderBy(desc(schema.projects.updatedAt));
  return json({ projects: rows });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, Body);
  const settings = { ...DEFAULT_SETTINGS, ...body.settings };
  const refs: { url: string; roles: ReferenceRole[]; notes: string }[] = [];
  for (const r of body.references) {
    try {
      refs.push({ url: (await assertPublicUrl(r.url)).toString(), roles: r.roles, notes: r.notes });
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(400, e.message);
      throw e;
    }
  }
  const recreating = body.mode === "recreate" || refs.some((r) => r.roles.includes("full"));
  if (recreating && refs.length && !settings.rightsConfirmed) {
    throw new HttpError(400, "Please confirm you own the reference site or have permission to recreate it.", "rights_required");
  }
  if (body.mode === "prompt" && !body.brief.trim()) throw new HttpError(400, "Describe the website you want to create.");

  const name =
    body.name?.trim() ||
    (refs[0] ? new URL(refs[0].url).hostname.replace(/^www\./, "") : body.brief.split(/[.\n]/)[0].slice(0, 60)) ||
    "Untitled project";
  const [project] = await db
    .insert(schema.projects)
    .values({ userId: user.id, name, mode: body.mode, brief: body.brief, settings, status: "draft" })
    .returning();
  if (refs.length) {
    await db.insert(schema.referenceSites).values(refs.map((r, i) => ({ projectId: project.id, kind: "url" as const, url: r.url, roles: r.roles, notes: r.notes, position: i })));
  }
  if (body.brief.trim()) {
    await db.insert(schema.messages).values({ projectId: project.id, role: "user", content: body.brief.trim(), meta: { kind: "brief" } });
  }

  let job = null;
  let warning: string | null = null;
  // Screenshot projects start after their uploads arrive (the client calls /analyze).
  if (body.start && body.mode !== "screenshots") {
    if (refs.length) job = await startJob(project.id, user.id, "analyze");
    else if (env.anthropicConfigured) job = await startJob(project.id, user.id, "generate");
    else warning = "Claude is not configured on this server, so generation cannot start. Set ANTHROPIC_API_KEY and reload.";
  }
  return json({ project, job, warning }, { status: 201 });
});
