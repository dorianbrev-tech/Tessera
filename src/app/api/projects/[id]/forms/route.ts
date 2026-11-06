import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await ownedProject(id);
  const submissions = await db.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.projectId, id)).orderBy(desc(schema.formSubmissions.createdAt)).limit(200);
  return json({ submissions });
});
