import { z } from "zod";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { ownedProject, startJob } from "@/lib/api";
import { env } from "@/lib/env";

const Body = z.object({ instructions: z.string().max(4000).optional() });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const { user } = await ownedProject(id);
  if (!env.anthropicConfigured) throw new HttpError(503, "Claude is not configured on this server. Set ANTHROPIC_API_KEY to enable generation.", "ai_not_configured");
  const body = await parseJson(req, Body).catch(() => ({}) as z.infer<typeof Body>);
  const job = await startJob(id, user.id, "generate", body);
  return json({ job }, { status: 202 });
});
