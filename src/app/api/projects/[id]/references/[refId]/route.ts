import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { storage } from "@/lib/storage";

type P = { id: string; refId: string };

const Patch = z.object({
  roles: z.array(z.enum(["full", "identity", "colors", "typography", "layout", "navigation", "animations", "photography", "components", "content"])).min(1).optional(),
  notes: z.string().max(2000).optional(),
});

export const PATCH = route<P>(async (req, { id, refId }) => {
  await ownedProject(id);
  const body = await parseJson(req, Patch);
  const [ref] = await db
    .update(schema.referenceSites)
    .set(body)
    .where(and(eq(schema.referenceSites.id, refId), eq(schema.referenceSites.projectId, id)))
    .returning();
  if (!ref) throw new HttpError(404, "Reference not found.");
  return json({ reference: ref });
});

export const DELETE = route<P>(async (_req, { id, refId }) => {
  await ownedProject(id);
  const [ref] = await db
    .delete(schema.referenceSites)
    .where(and(eq(schema.referenceSites.id, refId), eq(schema.referenceSites.projectId, id)))
    .returning();
  if (!ref) throw new HttpError(404, "Reference not found.");
  await db.delete(schema.assets).where(eq(schema.assets.referenceId, refId));
  await storage().deletePrefix(`projects/${id}/refs/${refId}/`).catch(() => {});
  return json({ ok: true });
});
