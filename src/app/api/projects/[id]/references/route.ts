import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { assertPublicUrl, UnsafeUrlError } from "@/lib/analysis/net";
import { mergeSettings } from "@/lib/projects";

const Body = z.object({
  url: z.string().min(3).max(2000),
  roles: z.array(z.enum(["full", "identity", "colors", "typography", "layout", "navigation", "animations", "photography", "components", "content"])).min(1),
  notes: z.string().max(2000).default(""),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const { project } = await ownedProject(id);
  const body = await parseJson(req, Body);
  let url: string;
  try {
    url = (await assertPublicUrl(body.url)).toString();
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new HttpError(400, e.message);
    throw e;
  }
  if (body.roles.includes("full") && !mergeSettings(project.settings).rightsConfirmed) {
    throw new HttpError(400, "Confirm in project settings that you own or have permission to recreate this site.", "rights_required");
  }
  const [{ n }] = await db.select({ n: count() }).from(schema.referenceSites).where(eq(schema.referenceSites.projectId, id));
  if (n >= 8) throw new HttpError(400, "A project can have at most 8 references.");
  const [ref] = await db.insert(schema.referenceSites).values({ projectId: id, kind: "url", url, roles: body.roles, notes: body.notes, position: n }).returning();
  return json({ reference: ref }, { status: 201 });
});
