import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { resolveSitePath, snapshotVersion, touchProject } from "@/lib/projects";
import { slugify } from "@/lib/export";
import { env } from "@/lib/env";

type P = { id: string };

const Body = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 lowercase letters, digits and dashes").optional(),
  indexable: z.boolean().default(false),
});

const RESERVED = new Set(["api", "admin", "app", "www", "preview", "static", "assets", "login", "signup", "tessera"]);

export const POST = route<P>(async (req, { id }) => {
  const { project } = await ownedProject(id);
  const body = await parseJson(req, Body);
  if (!(await resolveSitePath(id, "/"))) throw new HttpError(400, "Add a home page (index.html) before publishing.");
  const slug = body.slug ?? project.publishedSlug ?? `${slugify(project.name)}-${id.slice(0, 6)}`;
  if (RESERVED.has(slug)) throw new HttpError(400, "That address is reserved.");
  const [taken] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.publishedSlug, slug), ne(schema.projects.id, id)));
  if (taken) throw new HttpError(409, "That address is already in use.");
  const version = await snapshotVersion(id, "Published", "manual", null, { force: true });
  await touchProject(id, { publishedSlug: slug, publishedVersionId: version!.id, publishedAt: new Date(), publishIndexable: body.indexable });
  return json({ url: `${env.publicSitesOrigin || env.appUrl}/s/${slug}/`, slug, versionNumber: version!.number });
});

export const DELETE = route<P>(async (_req, { id }) => {
  await ownedProject(id);
  await touchProject(id, { publishedSlug: null, publishedVersionId: null, publishedAt: null });
  return json({ ok: true });
});
