import { HttpError, json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { NotFoundError, restoreVersion } from "@/lib/projects";
import { activeJobForProject } from "@/lib/jobs";

export const POST = route<{ id: string; vid: string }>(async (_req, { id, vid }) => {
  await ownedProject(id);
  if (await activeJobForProject(id)) throw new HttpError(409, "Wait for the running job to finish before restoring a version.", "job_running");
  try {
    const v = await restoreVersion(id, vid);
    return json({ version: v ? { id: v.id, number: v.number, label: v.label } : null });
  } catch (e) {
    if (e instanceof NotFoundError) throw new HttpError(404, "Version not found.");
    throw e;
  }
});
