import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, parseJson, route } from "@/lib/http";
import { ownedProject, startJob } from "@/lib/api";

type P = { id: string };

export const GET = route<P>(async (_req, { id }) => {
  await ownedProject(id);
  const reports = await db.select().from(schema.fidelityReports).where(eq(schema.fidelityReports.projectId, id)).orderBy(desc(schema.fidelityReports.createdAt)).limit(60);
  return json({ reports });
});

const Body = z.object({ autoFix: z.boolean().default(false), viewports: z.array(z.enum(["desktop", "tablet", "mobile"])).min(1).default(["desktop", "mobile"]) });

export const POST = route<P>(async (req, { id }) => {
  const { user } = await ownedProject(id);
  const body = await parseJson(req, Body);
  const job = await startJob(id, user.id, "fidelity", body);
  return json({ job }, { status: 202 });
});
