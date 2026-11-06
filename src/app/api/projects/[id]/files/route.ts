import { z } from "zod";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { deleteFile, listFiles, readFileRow, renameFile, snapshotVersion, touchProject, writeTextFile } from "@/lib/projects";
import { activeJobForProject } from "@/lib/jobs";

type P = { id: string };

async function assertNoAgentRunning(projectId: string) {
  const job = await activeJobForProject(projectId);
  if (job && (job.type === "generate" || job.type === "chat")) {
    throw new HttpError(409, "The AI is editing this project right now. Wait for it to finish or cancel it before editing files.", "job_running");
  }
}

export const GET = route<P>(async (req, { id }) => {
  await ownedProject(id);
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return json({ files: await listFiles(id) });
  const row = await readFileRow(id, path).catch(() => null);
  if (!row) throw new HttpError(404, "File not found.");
  return json({ path: row.path, mime: row.mime, size: row.size, content: row.content, binary: row.content === null, updatedAt: row.updatedAt });
});

const Put = z.object({ path: z.string().min(1).max(240), content: z.string().max(2_000_000), snapshot: z.boolean().optional() });

export const PUT = route<P>(async (req, { id }) => {
  await ownedProject(id);
  await assertNoAgentRunning(id);
  const body = await parseJson(req, Put);
  try {
    const res = await writeTextFile(id, body.path, body.content);
    await touchProject(id);
    if (body.snapshot) await snapshotVersion(id, `Manual edit · ${res.path}`, "manual");
    return json(res);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

const Rename = z.object({ from: z.string().min(1), to: z.string().min(1) });

export const PATCH = route<P>(async (req, { id }) => {
  await ownedProject(id);
  await assertNoAgentRunning(id);
  const body = await parseJson(req, Rename);
  try {
    await renameFile(id, body.from, body.to);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  await touchProject(id);
  return json({ ok: true });
});

export const DELETE = route<P>(async (req, { id }) => {
  await ownedProject(id);
  await assertNoAgentRunning(id);
  const path = new URL(req.url).searchParams.get("path");
  if (!path) throw new HttpError(400, "path is required");
  const ok = await deleteFile(id, path).catch((e) => {
    throw new HttpError(400, (e as Error).message);
  });
  if (!ok) throw new HttpError(404, "File not found.");
  await touchProject(id);
  return json({ ok: true });
});
