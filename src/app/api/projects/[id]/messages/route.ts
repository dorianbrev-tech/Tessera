import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject, startJob } from "@/lib/api";
import { env } from "@/lib/env";

type P = { id: string };

export const GET = route<P>(async (_req, { id }) => {
  await ownedProject(id);
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.projectId, id)).orderBy(asc(schema.messages.createdAt)).limit(300);
  return json({ messages: rows });
});

const Body = z.object({
  text: z.string().trim().min(1).max(8000),
  attachments: z.array(z.object({ storageKey: z.string(), mime: z.string(), name: z.string().max(200) })).max(6).default([]),
  runtimeErrors: z.array(z.string().max(500)).max(20).default([]),
  currentPath: z.string().max(300).optional(),
});

export const POST = route<P>(async (req, { id }) => {
  const { user } = await ownedProject(id);
  if (!env.anthropicConfigured) throw new HttpError(503, "Claude is not configured on this server. Set ANTHROPIC_API_KEY to enable AI edits.", "ai_not_configured");
  const body = await parseJson(req, Body);
  for (const a of body.attachments) {
    if (!a.storageKey.startsWith(`projects/${id}/uploads/`)) throw new HttpError(400, "Invalid attachment.");
  }
  const job = await startJob(id, user.id, "chat", body);
  const [message] = await db
    .insert(schema.messages)
    .values({ projectId: id, role: "user", content: body.text, attachments: body.attachments, jobId: job.id })
    .returning();
  return json({ message, job }, { status: 202 });
});
