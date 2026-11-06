// The site-building agent: a streaming tool-use loop on the Claude API.
//
// - Adaptive thinking with "updates" display: short progress notes between tool calls are
//   streamed to the UI while the reasoning itself stays hidden.
// - Server-side fallbacks ("default") so a classifier false positive does not end a job.
// - Context editing clears old tool results (screenshots are heavy) in long sessions.
// - The history is append-only (assistant content is passed back unchanged), which keeps
//   thinking blocks valid and the prompt cache warm.
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { anthropic, AGENT_BETAS, describeRefusal } from "./client";
import { SYSTEM_PROMPT, buildProjectContext } from "./prompts";
import { TOOL_DEFINITIONS, executeTool, type ToolState } from "./tools";
import type { JobContext } from "@/lib/job-context";
import { JobCancelled } from "@/lib/job-context";
import sharp from "sharp";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentResult {
  summary: string;
  changedFiles: string[];
  fidelity: ToolState["fidelity"];
  activity: { tool: string; summary: string; error?: boolean }[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turns: number;
  stoppedEarly?: string;
}

function inputSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const p = typeof i.path === "string" ? i.path : "";
  switch (name) {
    case "write_file":
    case "edit_file":
    case "read_file":
    case "delete_file":
      return p;
    case "render_preview":
    case "compare_to_reference":
      return `${p || "/"} · ${i.viewport ?? "desktop"}`;
    case "view_reference":
      return `${p || "/"} · ${i.section_index !== undefined ? `section ${i.section_index}` : i.viewport ?? "desktop"}`;
    case "get_reference_page":
      return p;
    case "search_stock_photos":
      return String(i.query ?? "");
    case "generate_image":
      return p;
    case "import_asset":
      return p;
    default:
      return "";
  }
}

export async function runAgent(opts: {
  ctx: JobContext;
  task: string;
  effort: Effort;
  attachments?: { storageKey: string; mime: string; name: string }[];
  maxTurns?: number;
}): Promise<AgentResult> {
  const { ctx } = opts;
  const projectId = ctx.job.projectId;
  const client = anthropic();
  const context = await buildProjectContext(projectId);

  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: context.text }];
  for (const a of opts.attachments ?? []) {
    const buf = await storage().get(a.storageKey);
    if (!buf || !a.mime.startsWith("image/")) continue;
    const jpg = await sharp(buf).resize({ width: 1400, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    userContent.push({ type: "text", text: `Attached image: ${a.name}` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
  }
  userContent.push({ type: "text", text: opts.task });

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userContent }];
  const state: ToolState = {
    projectId,
    jobId: ctx.job.id,
    ctx,
    settings: context.settings,
    compareRounds: new Map(),
    changedFiles: new Set(),
    fidelity: [],
  };
  const activity: AgentResult["activity"] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const texts: string[] = [];
  let finalText = "";
  let jsonRetries = 0;
  const maxTurns = opts.maxTurns ?? env.maxAgentTurns;
  let turn = 0;
  let stoppedEarly: string | undefined;

  for (; turn < maxTurns; turn++) {
    if (await ctx.isCancelled()) throw new JobCancelled();
    const stream = client.beta.messages.stream({
      model: env.claudeModel,
      max_tokens: 64000,
      betas: [...AGENT_BETAS],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: opts.effort },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOL_DEFINITIONS,
      messages,
      cache_control: { type: "ephemeral" },
      context_management: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: 140_000 },
            keep: { type: "tool_uses", value: 10 },
            clear_at_least: { type: "input_tokens", value: 30_000 },
            exclude_tools: ["get_design_system"],
          },
        ],
      },
    });

    // Stream text and progress notes to the UI in small batches.
    let textBuf = "";
    let lastFlush = Date.now();
    const flush = async (force = false) => {
      if (textBuf && (force || Date.now() - lastFlush > 450)) {
        const chunk = textBuf;
        textBuf = "";
        lastFlush = Date.now();
        await ctx.emit("text", { delta: chunk });
      }
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          await flush(true);
          await ctx.emit("tool", { phase: "pending", id: ev.content_block.id, name: ev.content_block.name });
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") {
            textBuf += ev.delta.text;
            await flush();
          } else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) {
            await ctx.emit("thinking", { text: ev.delta.thinking });
          }
        } else if (ev.type === "content_block_stop") {
          await flush(true);
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Eager input streaming: a tool input that is not parseable JSON rejects the stream.
      // Re-issue that turn (bounded); API errors (auth, rate limits, overload) propagate.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      await ctx.log("A tool call arrived malformed; retrying the turn.", "warn");
      continue;
    }
    await flush(true);

    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

    if (message.stop_reason === "refusal") {
      throw new Error(describeRefusal(message.stop_details));
    }

    const turnText = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (turnText) texts.push(turnText);
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) {
      finalText = turnText;
      break;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (message.stop_reason === "max_tokens") {
        // A truncated tool input can still look valid — never execute it.
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: "Your output hit the token limit before this call was complete, so it was not executed. Split the work: write smaller files or use several edit_file calls.",
        });
        continue;
      }
      if (await ctx.isCancelled()) throw new JobCancelled();
      const detail = inputSummary(tu.name, tu.input);
      await ctx.emit("tool", { phase: "start", id: tu.id, name: tu.name, detail });
      const started = Date.now();
      const r = await executeTool(tu.name, tu.input, state);
      activity.push({ tool: tu.name, summary: r.summary, ...(r.isError ? { error: true } : {}) });
      await ctx.emit("tool", { phase: "end", id: tu.id, name: tu.name, detail, summary: r.summary, error: Boolean(r.isError), ms: Date.now() - started });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    await ctx.progress(Math.min(0.95, 0.05 + (turn / maxTurns) * 0.9), `Working · step ${turn + 1}`);
  }

  if (turn >= maxTurns) {
    stoppedEarly = `Stopped after ${maxTurns} steps (AGENT_MAX_TURNS).`;
    await ctx.log(stoppedEarly, "warn");
  }
  const summary = finalText || texts[texts.length - 1] || (stoppedEarly ?? "Done.");
  return { summary, changedFiles: [...state.changedFiles], fidelity: state.fidelity, activity, usage, turns: turn + 1, stoppedEarly };
}
