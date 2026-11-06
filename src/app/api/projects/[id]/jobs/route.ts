import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { recentJobs } from "@/lib/jobs";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await ownedProject(id);
  return json({ jobs: await recentJobs(id) });
});
