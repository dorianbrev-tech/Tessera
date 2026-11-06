import { z } from "zod";
import { json, parseJson, route } from "@/lib/http";
import { ownedProject, startJob } from "@/lib/api";

const Body = z.object({ referenceIds: z.array(z.string()).optional(), skipGenerate: z.boolean().optional() });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const { user } = await ownedProject(id);
  const body = await parseJson(req, Body).catch(() => ({}) as z.infer<typeof Body>);
  const job = await startJob(id, user.id, "analyze", body);
  return json({ job }, { status: 202 });
});
