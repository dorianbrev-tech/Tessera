// TEST ONLY — a scripted stand-in for the Claude Messages API (streaming SSE), used to
// exercise Tessera's agent loop end to end without an API key. It is never used by the
// product; point ANTHROPIC_BASE_URL at it explicitly for tests.
//
// It replays a fixed session: inspect the design system → import reference images →
// write the site (deliberately omitting one section) → render + compare → fix → compare.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.MOCK_PORT ?? 4200);
const fx = path.resolve(new URL("../fixtures/maison", import.meta.url).pathname);
const read = (p) => readFileSync(path.join(fx, p), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function siteHtml(p) {
  return read(p)
    .replace('href="/assets/css/site.css"', 'href="/assets/css/styles.css"')
    .replace('src="/assets/js/site.js"', 'src="/assets/js/main.js"')
    .replaceAll("/assets/img/", "/assets/images/")
    .replace('action="/newsletter"', 'action="/__tessera/forms/newsletter"')
    .replace(/<div class="cookie-banner">[\s\S]*?<\/div>/, "");
}

function lastToolResultText(body) {
  const last = body.messages[body.messages.length - 1];
  if (!last || !Array.isArray(last.content)) return "";
  return last.content
    .filter((b) => b.type === "tool_result")
    .map((b) => (typeof b.content === "string" ? b.content : (b.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n")))
    .join("\n");
}

let toolSeq = 0;
const tool = (name, input) => ({ kind: "tool", id: `toolu_mock_${++toolSeq}`, name, input });
const text = (t) => ({ kind: "text", text: t });
const thinking = (t) => ({ kind: "thinking", text: t });

function generationStep(step, body) {
  switch (step) {
    case 0:
      return [text("I'll start from the measured design system and the reference home page."), tool("get_design_system", {}), tool("get_reference_page", { path: "/" })];
    case 1:
      return [thinking("Canvas #f6f1ea, ink #1b1714; Maison Serif display at 112px/106.4px with -2.24px tracking; fixed 76px header; reveals translateY(48px)→0."), tool("view_reference", { path: "/", viewport: "desktop" }), tool("list_assets", { kind: "any" })];
    case 2: {
      const lines = lastToolResultText(body).split("\n").filter((l) => /^[0-9a-f-]{36}\t/.test(l));
      const imports = lines
        .map((l) => {
          const cols = l.split("\t");
          const url = cols[cols.length - 1];
          const name = url.split("/").pop();
          return tool("import_asset", { asset_id: cols[0], path: url.includes("/fonts/") ? `assets/fonts/${name}` : `assets/images/${name}` });
        })
        .slice(0, 24);
      return [text(`Importing ${imports.length} reference images and font files so the site is self-contained.`), ...imports];
    }
    case 3:
      return [tool("write_file", { path: "assets/css/styles.css", content: read("assets/css/site.css").replaceAll("/assets/fonts/", "/assets/fonts/") }), tool("write_file", { path: "assets/js/main.js", content: read("assets/js/site.js") })];
    case 4:
      return [
        thinking("Writing the home page first; the marquee band can come in the next pass."),
        tool("write_file", { path: "index.html", content: siteHtml("index.html").replace(/<section class="marquee">[\s\S]*?<\/section>/, "") }),
        tool("write_file", { path: "about.html", content: siteHtml("about.html") }),
        tool("write_file", { path: "journal.html", content: siteHtml("journal.html") }),
      ];
    case 5:
      return [text("Pages are written. Checking the result in a real browser and against the reference."), tool("render_preview", { path: "/", viewport: "mobile" }), tool("compare_to_reference", { path: "/", viewport: "desktop" })];
    case 6: {
      const marquee = read("index.html").match(/<section class="marquee">[\s\S]*?<\/section>/)[0];
      return [
        thinking("The comparison flags the missing marquee band between the product grid and the campaign."),
        tool("edit_file", { path: "index.html", old_string: '<section class="campaign">', new_string: `${marquee}\n<section class="campaign">` }),
        tool("compare_to_reference", { path: "/", viewport: "desktop" }),
      ];
    }
    default:
      return [text("I rebuilt **Maison Verre** with its home, about and journal pages, reusing the measured palette (`#f6f1ea` / `#1b1714`), the serif display scale and the scroll reveals. A comparison pass caught a missing marquee band, which is now restored; the home page matches the reference closely at desktop.")];
  }
}

function chatStep(step) {
  switch (step) {
    case 0:
      return [tool("read_file", { path: "assets/css/styles.css", start_line: 5, end_line: 9 })];
    case 1:
      return [tool("edit_file", { path: "assets/css/styles.css", old_string: "--clay: #9a6b4f;", new_string: "--clay: #7b4a35;" }), tool("render_preview", { path: "/", viewport: "desktop" })];
    default:
      return [text("Deepened the accent (`--clay`) to `#7b4a35`, which carries through the solid button hover states.")];
  }
}

function summarize(body, headers) {
  const tools = (body.tools ?? []).map((t) => `${t.name}${t.eager_input_streaming ? "*" : ""}`);
  return {
    model: body.model,
    betas: headers["anthropic-beta"],
    max_tokens: body.max_tokens,
    stream: body.stream,
    thinking: body.thinking,
    output_config: body.output_config,
    fallbacks: body.fallbacks,
    cache_control: body.cache_control,
    system_cached: Array.isArray(body.system) && !!body.system[0]?.cache_control,
    context_management: body.context_management?.edits?.map((e) => e.type),
    tools: tools.length,
    eager_tools: tools.filter((t) => t.endsWith("*")).length,
    messages: body.messages.length,
  };
}

async function stream(res, blocks, stop) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "req_mock" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send("message_start", { message: { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } } });
  let outTokens = 0;
  for (const [index, b] of blocks.entries()) {
    if (b.kind === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      for (const chunk of b.text.match(/.{1,24}/gs)) {
        send("content_block_delta", { index, delta: { type: "text_delta", text: chunk } });
        await sleep(15);
      }
    } else if (b.kind === "thinking") {
      send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      send("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.text } });
      send("content_block_delta", { index, delta: { type: "signature_delta", signature: "mock-signature" } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      for (let i = 0; i < json.length; i += 400) {
        send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 400) } });
        if (i % 4000 === 0) await sleep(5);
      }
    }
    send("content_block_stop", { index });
    outTokens += 200;
  }
  send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outTokens } });
  send("message_stop", {});
  res.end();
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw);
      if (!body.stream) {
        // Structured-output request (design synthesis): answer with schema-shaped JSON.
        console.log("[mock] synthesis", JSON.stringify({ model: body.model, betas: req.headers["anthropic-beta"], format: body.output_config?.format?.type, effort: body.output_config?.effort, fallbacks: body.fallbacks, images: body.messages[0].content.filter((b) => b.type === "image").length }));
        const hexes = [...new Set((JSON.stringify(body.messages).match(/#[0-9a-f]{6}/g) ?? []))].slice(0, 6);
        const design = {
          summary: "Quiet-luxury editorial fashion house: warm paper canvas, near-black ink, an oversized high-contrast serif for display set against small tracked uppercase sans labels, full-bleed photography and slow, eased reveals.",
          personality: ["editorial", "quiet luxury", "warm minimal", "slow motion"],
          colors: hexes.map((h, i) => ({ name: ["Paper", "Stone", "Ink", "Muted", "White", "Clay"][i] ?? `Color ${i + 1}`, hex: h, role: i === 0 ? "page background" : i === 2 ? "text and inverse surfaces" : "supporting" })),
          typography: [
            { family: "Maison Serif", role: "display / headings", weights: ["400"], source: "self-hosted from the reference", fallback: "Cormorant Garamond, serif", notes: "Italic used for emphasis in headlines" },
            { family: "Maison Sans", role: "body / UI", weights: ["400"], source: "self-hosted from the reference", fallback: "Inter, sans-serif", notes: "Uppercase labels tracked 0.16–0.24em" },
          ],
          typeScale: [{ token: "display", size: "112px", lineHeight: "0.95", weight: "400", letterSpacing: "-0.02em", transform: "none" }, { token: "body", size: "15px", lineHeight: "1.6", weight: "400", letterSpacing: "0.01em", transform: "none" }],
          spacing: { containerMaxWidth: "1320px", sectionPaddingY: "140px", gutter: "24px", notes: "40px page gutters, 20px on mobile" },
          radii: ["0px"],
          shadows: [],
          components: [{ name: "Outline button", description: "1px currentColor border, 16px 34px padding, 11px uppercase, 0.2em tracking; fills ink on hover over 350ms" }],
          layoutPatterns: ["Full-height hero with bottom-aligned headline", "Centered statement", "50/50 image–text split", "4-column product grid", "Marquee band", "Parallax campaign", "Scroll-snap journal rail"],
          motion: [{ name: "Scroll reveal", description: "opacity 0→1, translateY(48px)→0 over 1s", implementation: "IntersectionObserver adds .is-visible; CSS transition cubic-bezier(.2,.7,.2,1)" }],
          imagery: { style: "Warm, desaturated editorial photography", treatment: "object-fit cover, gradient scrim on hero", aspectRatios: ["3:4", "16:9", "4:5"] },
          navigation: { desktop: "Fixed transparent header that turns solid after the hero; centred wordmark", mobile: "Hamburger opening a full-screen dark menu", items: ["Women", "Men", "Collections", "Journal", "Maison"] },
          pages: [{ path: "/", title: "Home", purpose: "Brand and collection entry", sections: ["hero", "intro", "split", "product grid", "marquee", "campaign", "journal rail", "newsletter"] }, { path: "/about", title: "The Maison", purpose: "Brand story", sections: ["page hero", "split", "contact"] }, { path: "/journal", title: "Journal", purpose: "Editorial", sections: ["page hero", "3-column story grid"] }],
          responsive: ["Display type 112px → 52px on mobile", "Product grid 4 → 2 columns"],
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "msg_mock_synth", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(design) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 24000, output_tokens: 1800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
        return;
      }
      const first = body.messages[0];
      const firstText = (Array.isArray(first.content) ? first.content : [{ type: "text", text: first.content }]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const step = body.messages.filter((m) => m.role === "assistant").length;
      const isChat = firstText.includes("# Request from the user");
      console.log(`[mock] ${isChat ? "chat" : "generate"} step ${step}`, JSON.stringify(summarize(body, req.headers)));
      const blocks = isChat ? chatStep(step) : generationStep(step, body);
      const stop = blocks.some((b) => b.kind === "tool") ? "tool_use" : "end_turn";
      await stream(res, blocks, stop);
    });
  })
  .listen(port, () => console.log(`mock Claude API on http://127.0.0.1:${port}`));
