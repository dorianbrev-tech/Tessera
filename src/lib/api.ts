import "server-only";
import { HttpError, requireUser } from "@/lib/http";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import { enqueueJob, JobConflictError, type JobType } from "@/lib/jobs";

/** Resolve the signed-in user and a project they own (404 otherwise). */
export async function ownedProject(projectId: string) {
  const user = await requireUser();
  try {
    const project = await getOwnedProject(user.id, projectId);
    return { user, project };
  } catch (e) {
    if (e instanceof NotFoundError) throw new HttpError(404, "Project not found.");
    throw e;
  }
}

export async function startJob(projectId: string, userId: string, type: JobType, input: Record<string, unknown> = {}) {
  try {
    return await enqueueJob({ projectId, userId, type, input });
  } catch (e) {
    if (e instanceof JobConflictError) throw new HttpError(409, e.message, "job_running");
    throw e;
  }
}

export function badRequest(message: string) {
  return new HttpError(400, message);
}
