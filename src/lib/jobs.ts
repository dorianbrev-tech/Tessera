// Durable job queue on PostgreSQL (FOR UPDATE SKIP LOCKED) with an append-only event log
// that the UI tails over Server-Sent Events. Jobs survive browser refreshes and keep
// running when the tab is closed.
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, pool, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import type { JobEventType } from "@/lib/types";

export type JobType = Job["type"];

export class JobConflictError extends Error {}

export async function activeJobForProject(projectId: string) {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), inArray(schema.jobs.status, ["queued", "running"])))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return job ?? null;
}

export async function enqueueJob(params: {
  projectId: string;
  userId: string;
  type: JobType;
  input?: Record<string, unknown>;
}) {
  // One active job per project: generation, edits and analysis all mutate the same files.
  const active = await activeJobForProject(params.projectId);
  if (active) throw new JobConflictError(`A ${active.type} job is already running for this project.`);
  const [job] = await db
    .insert(schema.jobs)
    .values({ projectId: params.projectId, userId: params.userId, type: params.type, input: params.input ?? {} })
    .returning();
  await pool.query("select pg_notify('tessera_jobs', $1)", [job.id]).catch(() => {});
  return job;
}

export async function emit(jobId: string, type: JobEventType, data: Record<string, unknown> = {}) {
  await db.insert(schema.jobEvents).values({ jobId, type, data });
}

export async function eventsSince(jobId: string, afterId: number, limit = 500) {
  return db
    .select()
    .from(schema.jobEvents)
    .where(and(eq(schema.jobEvents.jobId, jobId), gt(schema.jobEvents.id, afterId)))
    .orderBy(asc(schema.jobEvents.id))
    .limit(limit);
}

export async function getJob(jobId: string) {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function requestCancel(jobId: string) {
  await db
    .update(schema.jobs)
    .set({ cancelRequested: true })
    .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "running"])));
  // A queued job can be cancelled immediately.
  await db
    .update(schema.jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "queued")));
}

export async function isCancelled(jobId: string) {
  const [row] = await db
    .select({ c: schema.jobs.cancelRequested })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  return Boolean(row?.c);
}

export async function updateJob(jobId: string, patch: Partial<typeof schema.jobs.$inferInsert>) {
  await db.update(schema.jobs).set(patch).where(eq(schema.jobs.id, jobId));
}

/** Atomically claim the next queued job for this worker. */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  const res = await pool.query(
    `update jobs set status = 'running', locked_by = $1, started_at = now(), heartbeat_at = now()
       where id = (select id from jobs where status = 'queued' order by created_at for update skip locked limit 1)
     returning id`,
    [workerId],
  );
  if (!res.rows[0]) return null;
  return getJob(res.rows[0].id as string);
}

export async function heartbeat(jobId: string) {
  await db.update(schema.jobs).set({ heartbeatAt: new Date() }).where(eq(schema.jobs.id, jobId));
}

/** Jobs whose worker died (no heartbeat for 3 minutes) are failed so projects don't stay locked. */
export async function failStaleJobs() {
  const stale = await db
    .update(schema.jobs)
    .set({ status: "failed", error: "The worker processing this job stopped unexpectedly.", finishedAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.heartbeatAt, new Date(Date.now() - 180_000))))
    .returning({ id: schema.jobs.id, projectId: schema.jobs.projectId });
  for (const j of stale) await emit(j.id, "error", { message: "Worker stopped unexpectedly; job marked as failed." });
  return stale;
}

export async function recentJobs(projectId: string, limit = 20) {
  return db
    .select({
      id: schema.jobs.id,
      type: schema.jobs.type,
      status: schema.jobs.status,
      stage: schema.jobs.stage,
      progress: schema.jobs.progress,
      error: schema.jobs.error,
      createdAt: schema.jobs.createdAt,
      finishedAt: schema.jobs.finishedAt,
      result: schema.jobs.result,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.projectId, projectId))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit);
}

export const sqlNow = sql`now()`;
