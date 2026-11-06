import { z } from "zod";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { deleteProject, listFiles, mergeSettings, touchProject } from "@/lib/projects";
import { activeJobForProject } from "@/lib/jobs";
import { createPreviewToken } from "@/lib/tokens";
import { capabilities, env } from "@/lib/env";
import { SettingsSchema } from "@/lib/validation";

type P = { id: string };

export const GET = route<P>(async (_req, { id }) => {
  const { user, project } = await ownedProject(id);
  const [refs, files, job, versions, fidelity] = await Promise.all([
    db
      .select({
        id: schema.referenceSites.id,
        kind: schema.referenceSites.kind,
        url: schema.referenceSites.url,
        storageKey: schema.referenceSites.storageKey,
        title: schema.referenceSites.title,
        roles: schema.referenceSites.roles,
        notes: schema.referenceSites.notes,
        status: schema.referenceSites.status,
        error: schema.referenceSites.error,
        analyzedAt: schema.referenceSites.analyzedAt,
        position: schema.referenceSites.position,
      })
      .from(schema.referenceSites)
      .where(eq(schema.referenceSites.projectId, id))
      .orderBy(asc(schema.referenceSites.position)),
    listFiles(id),
    activeJobForProject(id),
    db.select({ n: count() }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, id)),
    db
      .select({ path: schema.fidelityReports.path, viewport: schema.fidelityReports.viewport, score: schema.fidelityReports.score, createdAt: schema.fidelityReports.createdAt, id: schema.fidelityReports.id })
      .from(schema.fidelityReports)
      .where(eq(schema.fidelityReports.projectId, id))
      .orderBy(desc(schema.fidelityReports.createdAt))
      .limit(40),
  ]);
  const latest = new Map<string, (typeof fidelity)[number]>();
  for (const f of fidelity) if (!latest.has(`${f.path}@${f.viewport}`)) latest.set(`${f.path}@${f.viewport}`, f);
  const token = createPreviewToken(id, user.id);
  const publishedUrl = project.publishedSlug ? `${env.publicSitesOrigin || env.appUrl}/s/${project.publishedSlug}/` : null;
  return json({
    project: { ...project, settings: mergeSettings(project.settings) },
    references: refs,
    files,
    activeJob: job,
    versionCount: versions[0]?.n ?? 0,
    fidelity: [...latest.values()],
    previewBase: `/preview/${token}`,
    publishedUrl,
    capabilities: capabilities(),
  });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brief: z.string().max(8000).optional(),
  settings: SettingsSchema.optional(),
  design: z.any().optional(),
});

export const PATCH = route<P>(async (req, { id }) => {
  const { project } = await ownedProject(id);
  const body = await parseJson(req, Patch);
  const patch: Partial<typeof schema.projects.$inferInsert> = {};
  if (body.name) patch.name = body.name;
  if (body.brief !== undefined) patch.brief = body.brief;
  if (body.settings) patch.settings = { ...mergeSettings(project.settings), ...body.settings };
  await touchProject(id, patch);
  const [updated] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id)));
  return json({ project: { ...updated, settings: mergeSettings(updated.settings) } });
});

export const DELETE = route<P>(async (_req, { id }) => {
  const { user } = await ownedProject(id);
  await deleteProject(user.id, id);
  return json({ ok: true });
});
