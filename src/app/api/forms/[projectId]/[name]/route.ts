import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleFormSubmission } from "@/lib/forms";

/** Public endpoint used by exported sites hosted elsewhere. */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return new Response("Not found", { status: 404 });
  const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p) return new Response("Not found", { status: 404 });
  return handleFormSubmission(req, projectId, name, req.headers.get("referer"));
}
