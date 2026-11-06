import { HttpError, requireUser, route } from "@/lib/http";
import { eventsSince, getJob } from "@/lib/jobs";
import { getOwnedProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of a job's persisted event log. Resumable with
 * Last-Event-ID / ?after=, so a refreshed page picks up exactly where it left off.
 */
export const GET = route<{ jobId: string }>(async (req, { jobId }) => {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new HttpError(404, "Job not found.");
  const job = await getJob(jobId);
  if (!job) throw new HttpError(404, "Job not found.");
  await getOwnedProject(user.id, job.projectId).catch(() => {
    throw new HttpError(404, "Job not found.");
  });
  const url = new URL(req.url);
  let after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
      const send = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };
      send("retry: 2000\n\n");
      let lastBeat = Date.now();
      while (!closed) {
        const events = await eventsSince(jobId, after, 300).catch(() => []);
        for (const e of events) {
          after = e.id;
          send(`id: ${e.id}\ndata: ${JSON.stringify({ id: e.id, type: e.type, data: e.data, at: e.createdAt })}\n\n`);
        }
        if (events.length === 0) {
          const j = await getJob(jobId);
          if (!j || ["succeeded", "failed", "cancelled"].includes(j.status)) {
            send(`event: end\ndata: ${JSON.stringify({ status: j?.status ?? "unknown" })}\n\n`);
            close();
            break;
          }
          if (Date.now() - lastBeat > 15_000) {
            send(": keep-alive\n\n");
            lastBeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
});
