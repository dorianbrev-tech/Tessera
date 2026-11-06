// External media providers. Each is optional and activated by its API key:
//   UNSPLASH_ACCESS_KEY / PEXELS_API_KEY  → licensed stock photography search
//   OPENAI_API_KEY or REPLICATE_API_TOKEN → AI image generation
import { env } from "@/lib/env";

export interface StockResult {
  provider: "unsplash" | "pexels";
  id: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  author: string;
  authorUrl: string;
  license: string;
  downloadTrigger?: string;
}

export class ProviderNotConfiguredError extends Error {}

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function searchStock(query: string, orientation: "landscape" | "portrait" | "squarish" | "any" = "any", count = 8): Promise<StockResult[]> {
  if (env.unsplashKey) {
    const u = new URL("https://api.unsplash.com/search/photos");
    u.searchParams.set("query", query);
    u.searchParams.set("per_page", String(Math.min(count, 20)));
    u.searchParams.set("content_filter", "high");
    if (orientation !== "any") u.searchParams.set("orientation", orientation);
    const data = await getJson(u.toString(), { Authorization: `Client-ID ${env.unsplashKey}`, "Accept-Version": "v1" });
    type U = { id: string; width: number; height: number; alt_description: string | null; description: string | null; urls: { regular: string; small: string; raw: string }; user: { name: string; links: { html: string } }; links: { download_location: string } };
    return (data.results as U[]).map((r) => ({
      provider: "unsplash",
      id: r.id,
      url: `${r.urls.raw}&w=2400&q=82&fm=jpg&fit=max`,
      thumb: r.urls.small,
      width: r.width,
      height: r.height,
      alt: r.alt_description ?? r.description ?? query,
      author: r.user.name,
      authorUrl: r.user.links.html,
      license: "Unsplash License (free to use, attribution appreciated)",
      downloadTrigger: r.links.download_location,
    }));
  }
  if (env.pexelsKey) {
    const u = new URL("https://api.pexels.com/v1/search");
    u.searchParams.set("query", query);
    u.searchParams.set("per_page", String(Math.min(count, 20)));
    if (orientation !== "any") u.searchParams.set("orientation", orientation === "squarish" ? "square" : orientation);
    const data = await getJson(u.toString(), { Authorization: env.pexelsKey });
    type P = { id: number; width: number; height: number; alt: string; photographer: string; photographer_url: string; src: { large2x: string; medium: string; original: string } };
    return (data.photos as P[]).map((p) => ({
      provider: "pexels",
      id: String(p.id),
      url: p.src.large2x,
      thumb: p.src.medium,
      width: p.width,
      height: p.height,
      alt: p.alt || query,
      author: p.photographer,
      authorUrl: p.photographer_url,
      license: "Pexels License (free to use)",
    }));
  }
  throw new ProviderNotConfiguredError("No stock photo provider configured (set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY).");
}

/** Unsplash API guidelines require pinging the download endpoint when a photo is used. */
export async function registerStockDownload(trigger?: string) {
  if (!trigger || !env.unsplashKey) return;
  await fetch(trigger, { headers: { Authorization: `Client-ID ${env.unsplashKey}` } }).catch(() => {});
}

export type AspectRatio = "1:1" | "3:2" | "2:3" | "4:5" | "16:9" | "9:16" | "21:9";

export async function generateImage(prompt: string, aspect: AspectRatio): Promise<{ data: Buffer; mime: string; provider: string; model: string }> {
  const provider = env.imageGenProvider;
  if (provider === "openai") {
    const size = ["16:9", "21:9", "3:2"].includes(aspect) ? "1536x1024" : ["9:16", "2:3", "4:5"].includes(aspect) ? "1024x1536" : "1024x1024";
    const model = process.env.IMAGE_GEN_MODEL || "gpt-image-1";
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size, n: 1, quality: process.env.IMAGE_GEN_QUALITY || "high" }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`OpenAI images responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
    const item = json.data[0];
    const data = item.b64_json ? Buffer.from(item.b64_json, "base64") : Buffer.from(await (await fetch(item.url!)).arrayBuffer());
    return { data, mime: "image/png", provider: "openai", model };
  }
  if (provider === "replicate") {
    const model = process.env.IMAGE_GEN_MODEL || "black-forest-labs/flux-1.1-pro";
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.replicateToken}`, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input: { prompt, aspect_ratio: aspect, output_format: "jpg", output_quality: 90 } }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Replicate responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    let pred = (await res.json()) as { status: string; output?: string | string[]; urls?: { get: string }; error?: string };
    const deadline = Date.now() + 170_000;
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      pred = await getJson(pred.urls!.get, { Authorization: `Bearer ${env.replicateToken}` });
    }
    if (pred.status !== "succeeded" || !pred.output) throw new Error(`Image generation failed: ${pred.error ?? pred.status}`);
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    const data = Buffer.from(await (await fetch(url)).arrayBuffer());
    return { data, mime: "image/jpeg", provider: "replicate", model };
  }
  throw new ProviderNotConfiguredError("No image generation provider configured (set OPENAI_API_KEY or REPLICATE_API_TOKEN).");
}
