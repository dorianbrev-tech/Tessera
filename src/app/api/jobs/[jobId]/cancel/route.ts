import { HttpError, json, requireUser, route } from "@/lib/http";
import { getJob, requestCancel } from "@/lib/jobs";
import { getOwnedProject } from "@/lib/projects";

export const POST = route<{ jobId: string }>(async (_req, { jobId }) => {
  const user = await requireUser();
  const job = /^[0-9a-f-]{36}$/i.test(jobId) ? await getJob(jobId) : null;
  if (!job) throw new HttpError(404, "Job not found.");
  await getOwnedProject(user.id, job.projectId).catch(() => {
    throw new HttpError(404, "Job not found.");
  });
  await requestCancel(jobId);
  return json({ ok: true });
});
