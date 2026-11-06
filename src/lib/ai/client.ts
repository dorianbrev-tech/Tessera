// Server-side Claude client. The API key is only ever read here (worker / API routes);
// it is never sent to the browser.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "Claude is not configured. Set ANTHROPIC_API_KEY in the server environment (see README → Credentials) to enable AI analysis, generation and editing.",
    );
  }
}

const g = globalThis as unknown as { __tesseraAnthropic?: Anthropic };

export function anthropic(): Anthropic {
  if (!env.anthropicConfigured) throw new AiNotConfiguredError();
  if (!g.__tesseraAnthropic) {
    g.__tesseraAnthropic = new Anthropic({ maxRetries: 3, timeout: 15 * 60_000 });
  }
  return g.__tesseraAnthropic;
}

/** Beta features used by the agent loop. */
export const AGENT_BETAS = [
  "server-side-fallback-2026-07-01", // fallbacks: "default" — classifier false positives don't kill a job
  "thinking-display-updates-2026-08-18", // progress-update summaries between tool calls
  "context-management-2025-06-27", // clear old tool results (screenshots) in long sessions
] as const;

export const SYNTHESIS_BETAS = ["server-side-fallback-2026-07-01"] as const;

export function describeRefusal(stopDetails: { category?: string | null; explanation?: string | null } | null | undefined) {
  const cat = stopDetails?.category ? ` (${stopDetails.category})` : "";
  return `Claude declined to continue this request${cat}.${stopDetails?.explanation ? " " + stopDetails.explanation : ""}`;
}
