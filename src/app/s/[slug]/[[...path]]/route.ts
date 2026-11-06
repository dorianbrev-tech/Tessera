import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { resolveSitePath } from "@/lib/projects";
import { env } from "@/lib/env";
import { notFoundPage, rewriteCss, rewriteHtml, sandboxHeaders } from "@/lib/site-serve";
import { handleFormSubmission } from "@/lib/forms";
import type { VersionFile } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path?: string[] }> };

// Published versions are immutable, so their file maps can be cached in memory.
const cache = new Map<string, { at: number; files: Map<string, VersionFile> }>();

async function site(slug: string) {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const [p] = await db
    .select({ id: schema.projects.id, versionId: schema.projects.publishedVersionId, indexable: schema.projects.publishIndexable })
    .from(schema.projects)
    .where(eq(schema.projects.publishedSlug, slug));
  if (!p?.versionId) return null;
  let entry = cache.get(p.versionId);
  if (!entry || Date.now() - entry.at > 10 * 60_000) {
    const [v] = await db.select({ files: schema.projectVersions.files }).from(schema.projectVersions).where(eq(schema.projectVersions.id, p.versionId));
    if (!v) return null;
    entry = { at: Date.now(), files: new Map(v.files.map((f) => [f.path, f])) };
    cache.set(p.versionId, entry);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return { projectId: p.id, files: entry.files, indexable: p.indexable };
}

async function serve(req: Request, ctx: Ctx, head = false) {
  const { slug, path = [] } = await ctx.params;
  const s = await site(slug);
  if (!s) return new Response("Site not found", { status: 404, headers: { "content-type": "text/plain" } });
  const prefix = `/s/${slug}`;
  const urlPath = "/" + path.map(decodeURIComponent).join("/");
  const resolved = await resolveSitePath(s.projectId, urlPath, async (p) => s.files.has(p));
  const robots: Record<string, string> = s.indexable ? {} : { "X-Robots-Tag": "noindex, nofollow" };
  // On a dedicated sites origin the sandbox is not needed (no platform cookies there).
  const sandbox = !env.publicSitesOrigin;
  if (!resolved) {
    return new Response(head ? null : rewriteHtml(notFoundPage(urlPath, [...s.files.keys()].filter((f) => f.endsWith(".html")), prefix), prefix), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", ...robots, ...(sandbox ? sandboxHeaders(true) : {}) },
    });
  }
  const f = s.files.get(resolved)!;
  const data = f.content !== null && f.content !== undefined ? Buffer.from(f.content, "utf8") : f.storageKey ? await storage().get(f.storageKey) : null;
  if (!data) return new Response("Not found", { status: 404 });
  const isHtml = f.mime.startsWith("text/html");
  const isCss = f.mime.startsWith("text/css");
  let body: BodyInit = new Uint8Array(data) as Uint8Array<ArrayBuffer>;
  if (isHtml) body = rewriteHtml(data.toString("utf8"), prefix, { noindex: !s.indexable });
  else if (isCss) body = rewriteCss(data.toString("utf8"), prefix);
  return new Response(head ? null : body, {
    headers: {
      "content-type": f.mime,
      "cache-control": isHtml ? "public, max-age=60" : "public, max-age=3600",
      ...robots,
      ...(sandbox ? sandboxHeaders(isHtml) : { "X-Content-Type-Options": "nosniff" }),
    },
  });
}

export const GET = (req: Request, ctx: Ctx) => serve(req, ctx);
export const HEAD = (req: Request, ctx: Ctx) => serve(req, ctx, true);

export async function POST(req: Request, ctx: Ctx) {
  const { slug, path = [] } = await ctx.params;
  const s = await site(slug);
  if (!s) return new Response("Not found", { status: 404 });
  if (path[0] === "__tessera" && path[1] === "forms" && path[2]) {
    return handleFormSubmission(req, s.projectId, decodeURIComponent(path[2]), req.headers.get("referer"));
  }
  return new Response("Method not allowed", { status: 405 });
}
