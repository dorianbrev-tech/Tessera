import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await ownedProject(id);
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, id)).orderBy(desc(schema.assets.createdAt)).limit(300);
  return json({ assets });
});
