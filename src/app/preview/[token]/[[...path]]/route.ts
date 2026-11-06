import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyPreviewToken } from "@/lib/tokens";
import { listFiles, readFileBytes, resolveSitePath } from "@/lib/projects";
import { notFoundPage, previewBridge, rewriteCss, rewriteHtml, sandboxHeaders } from "@/lib/site-serve";
import { handleFormSubmission } from "@/lib/forms";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; path?: string[] }> };

async function authorize(token: string) {
  const claims = verifyPreviewToken(token);
  if (!claims) return null;
  const [p] = await db.select({ id: schema.projects.id, userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, claims.p));
  if (!p || p.userId !== claims.u) return null;
  return p.id;
}

async function serve(req: Request, ctx: Ctx, head = false) {
  const { token, path = [] } = await ctx.params;
  const projectId = await authorize(token);
  if (!projectId) return new Response("This preview link has expired. Reopen the project to get a fresh one.", { status: 403 });
  const prefix = `/preview/${token}`;
  const urlPath = "/" + path.map(decodeURIComponent).join("/") + (new URL(req.url).pathname.endsWith("/") && path.length ? "/" : "");
  const resolved = await resolveSitePath(projectId, urlPath);
  if (!resolved) {
    const pages = (await listFiles(projectId)).filter((f) => f.path.endsWith(".html")).map((f) => f.path);
    return new Response(head ? null : rewriteHtml(notFoundPage(urlPath, pages, prefix), prefix, { inject: previewBridge(prefix) }), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...sandboxHeaders(true) },
    });
  }
  const file = await readFileBytes(projectId, resolved);
  if (!file) return new Response("Not found", { status: 404 });
  const isHtml = file.mime.startsWith("text/html");
  const isCss = file.mime.startsWith("text/css");
  let body: BodyInit = new Uint8Array(file.data) as Uint8Array<ArrayBuffer>;
  if (isHtml) body = rewriteHtml(file.data.toString("utf8"), prefix, { inject: previewBridge(prefix), noindex: true });
  else if (isCss) body = rewriteCss(file.data.toString("utf8"), prefix);
  return new Response(head ? null : body, {
    status: 200,
    headers: {
      "content-type": file.mime,
      "cache-control": isHtml || isCss || file.mime.includes("javascript") ? "no-store" : "private, max-age=300",
      ...sandboxHeaders(isHtml),
    },
  });
}

export const GET = (req: Request, ctx: Ctx) => serve(req, ctx);
export const HEAD = (req: Request, ctx: Ctx) => serve(req, ctx, true);

export async function POST(req: Request, ctx: Ctx) {
  const { token, path = [] } = await ctx.params;
  const projectId = await authorize(token);
  if (!projectId) return new Response("Forbidden", { status: 403 });
  if (path[0] === "__tessera" && path[1] === "forms" && path[2]) {
    return handleFormSubmission(req, projectId, decodeURIComponent(path[2]), "preview");
  }
  return new Response("Static preview: only forms posting to /__tessera/forms/<name> are handled.", { status: 405 });
}
