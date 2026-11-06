import { z } from "zod";
import { json, parseJson, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { listVersions, snapshotVersion } from "@/lib/projects";

type P = { id: string };

export const GET = route<P>(async (_req, { id }) => {
  await ownedProject(id);
  return json({ versions: await listVersions(id) });
});

const Body = z.object({ label: z.string().trim().min(1).max(200).default("Manual checkpoint") });

export const POST = route<P>(async (req, { id }) => {
  await ownedProject(id);
  const body = await parseJson(req, Body);
  const v = await snapshotVersion(id, body.label, "manual", null, { force: true });
  return json({ version: v ? { id: v.id, number: v.number, label: v.label, createdAt: v.createdAt } : null }, { status: 201 });
});
