// The website analysis engine: visits a reference site with Playwright, discovers its
// pages, and captures measured design data + screenshots at desktop, tablet and mobile.
import type { BrowserContext, Page } from "playwright-core";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { newViewportContext, browserScript } from "@/lib/browser";
import { cropRegion, dominantColors } from "@/lib/image-utils";
import { assertPublicUrl } from "./net";
import { fetchRobots, type Robots } from "./robots";
import type { AnimationInfo, PageExtraction, ScreenshotSet, SectionInfo, SiteAnalysis, Viewport } from "@/lib/types";

const MAX_SCREENSHOT_HEIGHT = 15000;
const RESPONSIVE_PAGES = { tablet: 2, mobile: 3 } as const;

export interface AnalyzeHooks {
  log: (message: string, data?: Record<string, unknown>) => Promise<void>;
  progress: (fraction: number, stage?: string) => Promise<void>;
  screenshot: (data: { key: string; label: string }) => Promise<void>;
  cancelled: () => Promise<boolean>;
}

export class BlockedError extends Error {}
export class CancelledError extends Error {}

type CaptureResult = {
  status: number;
  finalUrl: string;
  title: string;
  extraction: PageExtraction;
  screenshot: Buffer;
  shotHeight: number;
  truncated: boolean;
  menuShot?: Buffer;
  hiddenOverlays: string[];
};

const SKIP_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|account|my-account|cart|basket|checkout|logout|log-out|admin|wp-admin|wp-login|password|auth|oauth|wishlist|search)(\/|$|\?)/i;
const SKIP_EXT = /\.(pdf|zip|rar|7z|dmg|exe|jpg|jpeg|png|gif|webp|svg|mp4|mov|mp3|xml|json|txt|csv|docx?|xlsx?|pptx?)$/i;

function pageKey(u: URL) {
  return (u.origin + u.pathname.replace(/\/+$/, "")).toLowerCase() || u.origin;
}

function templateKey(u: URL) {
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length <= 1) return u.pathname.toLowerCase();
  return `${segs[0].toLowerCase()}/*${segs.length}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------------------
// Matrix → readable transform (for reporting scroll reveals and hovers)
// --------------------------------------------------------------------------------------
export function describeTransform(t: string): string {
  if (!t || t === "none") return "none";
  const m = t.match(/^matrix\(([^)]+)\)$/);
  if (!m) return t.slice(0, 80);
  const [a, b, , d, e, f] = m[1].split(",").map((x) => parseFloat(x));
  const parts: string[] = [];
  const sx = Math.sqrt(a * a + b * b);
  if (Math.abs(e) > 0.5) parts.push(`translateX(${Math.round(e)}px)`);
  if (Math.abs(f) > 0.5) parts.push(`translateY(${Math.round(f)}px)`);
  if (Math.abs(sx - 1) > 0.01 || Math.abs(d - 1) > 0.01) parts.push(`scale(${sx.toFixed(2)})`);
  const rot = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  if (rot) parts.push(`rotate(${rot}deg)`);
  return parts.join(" ") || "none";
}

// --------------------------------------------------------------------------------------
// Page capture
// --------------------------------------------------------------------------------------
export async function settle(page: Page) {
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 7_000 }).catch(() => {});
  await page.evaluate("document.fonts && document.fonts.ready.then(() => true)").catch(() => {});
}

async function waitForImages(page: Page) {
  await page
    .evaluate(
      `Promise.all(Array.from(document.images).filter(i => !i.complete).slice(0, 80).map(i => new Promise(r => { i.addEventListener('load', r, {once:true}); i.addEventListener('error', r, {once:true}); setTimeout(r, 4000); })))`,
    )
    .catch(() => {});
}

type MotionState = { id: number; sel?: string; opacity: string; transform: string; visibility: string; cls: string; absTop?: number };

async function scrollThrough(page: Page, sampleParallax: boolean) {
  const vh = page.viewportSize()?.height ?? 900;
  const samples = new Map<number, [number, number][]>();
  let height = Number(await page.evaluate("window.__tessera.scrollHeight()"));
  const maxY = Math.min(height, 30000);
  for (let y = 0; y <= maxY; y += Math.round(vh * 0.7)) {
    await page.evaluate(`window.scrollTo(0, ${y})`);
    await sleep(140);
    if (sampleParallax) {
      const s = (await page.evaluate("window.__tessera.sampleVisible()")) as { y: number; res: [number, number][] };
      for (const [id, absTop] of s.res) {
        const arr = samples.get(id) ?? [];
        arr.push([s.y, absTop]);
        samples.set(id, arr);
      }
    }
    height = Number(await page.evaluate("window.__tessera.scrollHeight()"));
  }
  await sleep(400);
  await page.evaluate("window.scrollTo(0, 0)");
  await sleep(500);
  return samples;
}

function computeReveals(before: MotionState[], after: MotionState[]): AnimationInfo["scrollReveals"] {
  const afterMap = new Map(after.map((a) => [a.id, a]));
  const groups = new Map<string, AnimationInfo["scrollReveals"][number]>();
  for (const b of before) {
    const a = afterMap.get(b.id);
    if (!a) continue;
    const ob = parseFloat(b.opacity), oa = parseFloat(a.opacity);
    const opacityChanged = oa - ob > 0.3;
    const transformChanged = b.transform !== a.transform && describeTransform(b.transform) !== describeTransform(a.transform);
    const classAdded = a.cls.length > b.cls.length && /(is-|in-view|inview|visible|active|animate|aos-animate|revealed|shown|appear)/.test(a.cls.replace(b.cls, ""));
    if (!opacityChanged && !transformChanged && !classAdded) continue;
    const from = { opacity: b.opacity, transform: describeTransform(b.transform) };
    const to = { opacity: a.opacity, transform: describeTransform(a.transform) };
    const key = `${b.sel}|${from.opacity}|${from.transform}|${to.opacity}|${to.transform}`;
    const g = groups.get(key) ?? { selector: b.sel ?? "", count: 0, from, to };
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => y.count - x.count).slice(0, 15);
}

function computeParallax(samples: Map<number, [number, number][]>, before: MotionState[]): { items: AnimationInfo["parallax"]; ids: number[] } {
  const sel = new Map(before.map((b) => [b.id, b.sel ?? ""]));
  const found = new Map<string, { ratio: number; n: number }>();
  const ids: number[] = [];
  for (const [id, arr] of samples) {
    if (arr.length < 3) continue;
    const slopes: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      const dy = arr[i][0] - arr[i - 1][0];
      if (dy > 0) slopes.push((arr[i][1] - arr[i - 1][1]) / dy);
    }
    if (slopes.length < 2) continue;
    const mean = slopes.reduce((s, v) => s + v, 0) / slopes.length;
    const variance = slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / slopes.length;
    if (Math.abs(mean) >= 0.06 && Math.abs(mean) <= 0.9 && variance < 0.02) {
      const s = sel.get(id) ?? "";
      ids.push(id);
      const e = found.get(s) ?? { ratio: 0, n: 0 };
      e.ratio += mean;
      e.n++;
      found.set(s, e);
    }
  }
  return { items: [...found.entries()].slice(0, 10).map(([selector, v]) => ({ selector, ratio: +(v.ratio / v.n).toFixed(2) })), ids };
}

async function probeHovers(page: Page): Promise<AnimationInfo["hoverEffects"]> {
  const targets = (await page.evaluate("window.__tessera.tagHoverTargets()")) as { id: number; kind: string; sel: string; text: string }[];
  const effects: AnimationInfo["hoverEffects"] = [];
  for (const t of targets) {
    try {
      const before = (await page.evaluate(`window.__tessera.readHover(${t.id})`)) as Record<string, string> | null;
      if (!before) continue;
      await page.hover(`[data-tessera-hover="${t.id}"]`, { timeout: 2500, force: true });
      await sleep(450);
      const after = (await page.evaluate(`window.__tessera.readHover(${t.id})`)) as Record<string, string> | null;
      await page.mouse.move(2, 2);
      await sleep(150);
      if (!after) continue;
      const changes: Record<string, [string, string]> = {};
      for (const k of Object.keys(after)) {
        if (before[k] !== after[k]) {
          changes[k] = k.includes("transform") ? [describeTransform(before[k]), describeTransform(after[k])] : [before[k], after[k]];
        }
      }
      if (Object.keys(changes).length) effects.push({ selector: `${t.kind}: ${t.sel}`, text: t.text, changes });
    } catch {
      /* element detached or covered — skip */
    }
  }
  return effects;
}

/**
 * Shared capture procedure for an already-loaded page (with probes installed). Used for both
 * reference sites and generated previews, so fidelity comparisons are like-for-like.
 */
export async function captureLoaded(
  page: Page,
  viewport: Viewport,
  opts: { probeMotion: boolean; probeHover: boolean; probeMenu: boolean },
): Promise<Omit<CaptureResult, "status" | "finalUrl" | "title">> {
  const hiddenOverlays = (await page.evaluate("window.__tessera.dismissOverlays()")) as string[];

  let before: MotionState[] = [];
  if (opts.probeMotion) before = (await page.evaluate("window.__tessera.tagMotion()")) as MotionState[];
  const samples = await scrollThrough(page, opts.probeMotion);
  let after: MotionState[] = [];
  let freezeIds: number[] = [];
  if (opts.probeMotion) after = (await page.evaluate("window.__tessera.readMotion()")) as MotionState[];
  hiddenOverlays.push(...((await page.evaluate("window.__tessera.dismissOverlays()")) as string[]));
  await waitForImages(page);

  // Content that was hidden until scrolled into view is forced visible so the
  // full-page screenshot shows it (reveal animations often re-hide off-screen content).
  const revealIds = opts.probeMotion ? before.filter((b) => parseFloat(b.opacity) < 0.3).map((b) => b.id) : [];

  const raw = (await page.evaluate(browserScript("extract"))) as Omit<PageExtraction, "url" | "viewport">;
  const extraction: PageExtraction = { ...raw, url: page.url(), viewport };
  if (opts.probeMotion) {
    extraction.animations.scrollReveals = computeReveals(before, after);
    const parallax = computeParallax(samples, before);
    extraction.animations.parallax = parallax.items;
    freezeIds = parallax.ids;
  }
  if (opts.probeHover) extraction.animations.hoverEffects = await probeHovers(page);

  // Full-page captures render fixed elements relative to the current scroll position:
  // return to the top (hover probing scrolls) and hide closed off-canvas drawers.
  await page.evaluate("window.scrollTo(0, 0)");
  await page.mouse.move(2, 2).catch(() => {});
  await sleep(450);
  // Representative state for the capture, enforced by an !important stylesheet so the
  // site's own scroll handlers cannot undo it:
  //  - content hidden until scrolled into view is shown (reveal animations often re-hide it);
  //  - scroll-linked (parallax) transforms, frozen at their scroll-0 offset, are reset.
  await page.evaluate(`(() => {
    const mark = (ids, attr) => ids.forEach(id => { const el = document.querySelector('[data-tessera-mid="' + id + '"]'); if (el) el.setAttribute(attr, ''); });
    mark(${JSON.stringify(revealIds)}, 'data-tessera-reveal');
    mark(${JSON.stringify(freezeIds)}, 'data-tessera-freeze');
    const st = document.createElement('style');
    st.textContent = '[data-tessera-reveal]{opacity:1!important;transform:none!important;visibility:visible!important;transition:none!important}[data-tessera-freeze]{transform:none!important;transition:none!important}';
    document.head.appendChild(st);
  })()`);
  await page.evaluate(`(() => {
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 1 || r.top >= innerHeight - 1 || r.right <= 1 || r.left >= innerWidth - 1) { el.style.setProperty('visibility', 'hidden', 'important'); el.setAttribute('data-tessera-hidden-fixed', ''); }
    }
  })()`);
  const docH = Number(await page.evaluate("window.__tessera.scrollHeight()"));
  const truncated = docH > MAX_SCREENSHOT_HEIGHT;
  const width = page.viewportSize()!.width;
  const screenshot = await page.screenshot({
    fullPage: true,
    type: "jpeg",
    quality: 82,
    animations: "allow",
    ...(truncated ? { clip: { x: 0, y: 0, width, height: MAX_SCREENSHOT_HEIGHT } } : {}),
    timeout: 60_000,
  });
  const shotHeight = Math.min(docH, MAX_SCREENSHOT_HEIGHT);
  extraction.screenshotPalette = await dominantColors(screenshot, 10).catch(() => []);

  let menuShot: Buffer | undefined;
  if (opts.probeMenu && extraction.navigation.hamburger) {
    try {
      await page.evaluate("window.scrollTo(0,0); document.querySelectorAll('[data-tessera-hidden-fixed]').forEach(el => el.style.removeProperty('visibility'))");
      await page.click("[data-tessera-menu]", { timeout: 3000, force: true });
      await sleep(800);
      menuShot = await page.screenshot({ type: "jpeg", quality: 80 });
    } catch {
      /* menu could not be opened */
    }
  }
  return { extraction, screenshot, shotHeight, truncated, menuShot, hiddenOverlays };
}

async function capturePage(
  ctx: BrowserContext,
  url: string,
  viewport: Viewport,
  opts: { probeMotion: boolean; probeHover: boolean; probeMenu: boolean },
): Promise<CaptureResult> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  try {
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      status = res?.status() ?? 0;
    } catch (e) {
      throw new Error(`Could not load ${url}: ${(e as Error).message.split("\n")[0]}`);
    }
    await settle(page);
    await page.evaluate(browserScript("probes"));
    const challenge = (await page.evaluate("window.__tessera.challenge()")) as string | null;
    if (challenge || status === 401 || status === 403 || status === 407 || status === 429) {
      throw new BlockedError(
        `The site refused automated access (${status ? "HTTP " + status : "bot protection"}${challenge ? `: “${challenge.slice(0, 60)}”` : ""}). Tessera does not bypass access controls — try a page you own, or upload screenshots instead.`,
      );
    }
    if (status >= 400) throw new Error(`HTTP ${status} for ${url}`);
    const cap = await captureLoaded(page, viewport, opts);
    return { status, finalUrl: page.url(), title: cap.extraction.title, ...cap };
  } finally {
    await page.close().catch(() => {});
  }
}

// --------------------------------------------------------------------------------------
// Link discovery
// --------------------------------------------------------------------------------------
function discoverLinks(ex: PageExtraction, origin: string, startLocale: string | null) {
  const out: { url: string; priority: number }[] = [];
  const push = (href: string, priority: number) => {
    try {
      const u = new URL(href);
      if (u.origin !== origin || SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname + "/")) return;
      const loc = u.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/i)?.[1]?.toLowerCase() ?? null;
      if (startLocale && loc && loc !== startLocale) return; // skip other language editions
      u.hash = "";
      u.search = "";
      out.push({ url: u.toString(), priority });
    } catch {
      /* ignore */
    }
  };
  ex.navigation.header.links.forEach((l) => l.internal && push(l.href, 0));
  ex.navigation.footer.links.forEach((l) => l.internal && push(l.href, 2));
  ex.internalLinks.forEach((l) => push(l.href, 3));
  return out;
}

// --------------------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------------------
export async function analyzeReferenceUrl(params: {
  projectId: string;
  referenceId: string;
  url: string;
  maxPages: number;
  viewports: Viewport[];
  hooks: AnalyzeHooks;
}): Promise<SiteAnalysis> {
  const { projectId, referenceId, hooks } = params;
  const t0 = Date.now();
  const start = await assertPublicUrl(params.url);
  const origin = start.origin;
  const maxPages = Math.max(1, Math.min(params.maxPages, env.maxPagesCap));

  await hooks.progress(0.02, "Checking robots.txt");
  let robots: Robots = { checked: false, sitemaps: [], isAllowed: () => true };
  if (env.respectRobots) {
    robots = await fetchRobots(origin, env.crawlerUserAgentToken);
    await hooks.log(robots.checked ? `robots.txt read for ${start.host}` : `No robots.txt reachable for ${start.host}; proceeding`);
  }
  const analysis: SiteAnalysis = {
    origin,
    startUrl: start.toString(),
    robots: { checked: robots.checked, allowed: robots.isAllowed(start.toString()), sitemaps: robots.sitemaps, crawlDelay: robots.crawlDelay },
    pages: [],
    skipped: [],
    discovered: 0,
    navigation: [],
    tech: [],
    durationMs: 0,
  };
  if (!analysis.robots.allowed) {
    analysis.blocked = { reason: `robots.txt on ${start.host} disallows automated access to ${start.pathname}.` };
    throw new BlockedError(analysis.blocked.reason);
  }
  const delay = Math.min(Math.max((robots.crawlDelay ?? 0) * 1000, 400), 10_000);

  // Remove results of any previous analysis of this reference.
  await db.delete(schema.referencePages).where(eq(schema.referencePages.referenceId, referenceId));
  await storage().deletePrefix(`projects/${projectId}/refs/${referenceId}/`).catch(() => {});

  const desktop = await newViewportContext("desktop");
  const visited = new Set<string>();
  const templates = new Map<string, number>();
  const queue: { url: string; depth: number; priority: number }[] = [{ url: start.toString(), depth: 0, priority: -1 }];
  const startLocale = start.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/i)?.[1]?.toLowerCase() ?? null;
  const captured: { id: string; url: string; path: string; sections: SectionInfo[] }[] = [];
  let homeExtraction: PageExtraction | null = null;

  try {
    while (queue.length && captured.length < maxPages) {
      if (await hooks.cancelled()) throw new CancelledError("Cancelled");
      queue.sort((a, b) => a.depth - b.depth || a.priority - b.priority);
      const item = queue.shift()!;
      const u = new URL(item.url);
      const key = pageKey(u);
      if (visited.has(key)) continue;
      visited.add(key);
      const tk = templateKey(u);
      if ((templates.get(tk) ?? 0) >= 2) {
        analysis.skipped.push({ url: item.url, reason: "Same page template already captured" });
        continue;
      }
      if (!robots.isAllowed(item.url)) {
        analysis.skipped.push({ url: item.url, reason: "Disallowed by robots.txt" });
        continue;
      }
      if (captured.length > 0) await sleep(delay);

      const n = captured.length + 1;
      await hooks.progress(0.05 + (captured.length / maxPages) * 0.6, `Capturing page ${n}/${maxPages} (desktop)`);
      await hooks.log(`Visiting ${item.url}`);
      let res: CaptureResult;
      try {
        res = await capturePage(desktop, item.url, "desktop", { probeMotion: true, probeHover: captured.length < 3, probeMenu: false });
      } catch (e) {
        if (e instanceof BlockedError && captured.length === 0) {
          analysis.blocked = { reason: e.message };
          throw e;
        }
        analysis.pages.push({ url: item.url, path: u.pathname, title: "", depth: item.depth, status: "error", error: (e as Error).message });
        await hooks.log(`Skipped ${item.url}: ${(e as Error).message}`, { level: "warn" });
        continue;
      }
      // Off-site redirects are not analysed as part of this site.
      if (new URL(res.finalUrl).origin !== origin && captured.length > 0) {
        analysis.skipped.push({ url: item.url, reason: `Redirected off-site to ${res.finalUrl}` });
        continue;
      }
      templates.set(tk, (templates.get(tk) ?? 0) + 1);
      const path = new URL(res.finalUrl).pathname || "/";
      const [row] = await db
        .insert(schema.referencePages)
        .values({ referenceId, projectId, url: res.finalUrl, path, title: res.title, depth: item.depth, extraction: res.extraction, screenshots: {}, sections: [] })
        .returning({ id: schema.referencePages.id });
      const base = `projects/${projectId}/refs/${referenceId}/${row.id}`;
      const shotKey = `${base}/desktop.jpg`;
      await storage().put(shotKey, res.screenshot, "image/jpeg");
      const shots: ScreenshotSet = { desktop: { key: shotKey, width: 1440, height: res.shotHeight, truncated: res.truncated } };

      // Section crops for the agent and the analysis viewer.
      const sections: SectionInfo[] = [];
      for (const s of res.extraction.sections.slice(0, 24)) {
        if (s.height < 40 || s.top >= res.shotHeight) {
          sections.push(s);
          continue;
        }
        const crop = await cropRegion(res.screenshot, s.top, Math.min(s.height, 2600));
        const cropKey = `${base}/section-${s.index}.jpg`;
        await storage().put(cropKey, crop, "image/jpeg");
        sections.push({ ...s, cropKey });
      }
      await db.update(schema.referencePages).set({ screenshots: shots, sections }).where(eq(schema.referencePages.id, row.id));
      await hooks.screenshot({ key: shotKey, label: `${path} · desktop` });
      await hooks.log(
        `Captured ${path}: ${res.extraction.sections.length} sections, ${res.extraction.images.length} images, ${res.extraction.fonts.families.length} font families${res.hiddenOverlays.length ? `, hid ${res.hiddenOverlays.length} overlay(s)` : ""}`,
      );
      captured.push({ id: row.id, url: res.finalUrl, path, sections });
      analysis.pages.push({ url: res.finalUrl, path, title: res.title, depth: item.depth, status: "done" });
      if (!homeExtraction) {
        homeExtraction = res.extraction;
        analysis.navigation = res.extraction.navigation.header.links
          .filter((l) => l.internal)
          .map((l) => ({ text: l.text, href: l.href, path: new URL(l.href).pathname }));
        analysis.tech = [...res.extraction.tech.framework, ...res.extraction.tech.libraries];
      }
      if (item.depth < 2) {
        const links = discoverLinks(res.extraction, origin, startLocale);
        analysis.discovered += links.length;
        for (const l of links) if (!visited.has(pageKey(new URL(l.url)))) queue.push({ url: l.url, depth: item.depth + 1, priority: l.priority });
      }
    }
  } finally {
    await desktop.close().catch(() => {});
  }

  // Responsive capture of the most important pages.
  for (const vp of ["tablet", "mobile"] as const) {
    if (!params.viewports.includes(vp)) continue;
    const ctx = await newViewportContext(vp);
    try {
      const targets = captured.slice(0, RESPONSIVE_PAGES[vp]);
      for (let i = 0; i < targets.length; i++) {
        if (await hooks.cancelled()) throw new CancelledError("Cancelled");
        const t = targets[i];
        await hooks.progress(0.68 + (vp === "tablet" ? 0 : 0.12) + (i / targets.length) * 0.12, `Capturing ${t.path} (${vp})`);
        try {
          const res = await capturePage(ctx, t.url, vp, { probeMotion: true, probeHover: false, probeMenu: vp === "mobile" && i === 0 });
          const base = `projects/${projectId}/refs/${referenceId}/${t.id}`;
          const key = `${base}/${vp}.jpg`;
          await storage().put(key, res.screenshot, "image/jpeg");
          const [page] = await db.select().from(schema.referencePages).where(eq(schema.referencePages.id, t.id));
          const shots: ScreenshotSet = { ...page.screenshots, [vp]: { key, width: res.extraction.width, height: res.shotHeight, truncated: res.truncated } };
          if (res.menuShot) {
            const mk = `${base}/mobile-menu.jpg`;
            await storage().put(mk, res.menuShot, "image/jpeg");
            shots.mobileMenu = { key: mk, width: res.extraction.width, height: 844 };
          }
          const extraction = page.extraction ? { ...page.extraction } : null;
          // Keep a compact responsive summary alongside the desktop extraction.
          const responsive = { ...(extraction?.responsive ?? {}) };
          responsive[vp] = {
            documentHeight: res.extraction.documentHeight,
            hamburger: res.extraction.navigation.hamburger,
            headerLinksVisible: res.extraction.navigation.header.links.length,
            sections: res.extraction.sections.map((s) => ({ kind: s.kind, columns: s.columns, height: s.height })),
            typography: res.extraction.typography.filter((t) => /^h[1-3]$|body/.test(t.role)).slice(0, 8).map((t) => ({ role: t.role, fontSize: t.fontSize, lineHeight: t.lineHeight })),
          };
          await db
            .update(schema.referencePages)
            .set({ screenshots: shots, extraction: extraction ? { ...extraction, responsive } : null })
            .where(eq(schema.referencePages.id, t.id));
          await hooks.screenshot({ key, label: `${t.path} · ${vp}` });
          await hooks.log(`Captured ${t.path} at ${vp} (${res.extraction.width}px)${res.menuShot ? " including the open mobile menu" : ""}`);
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          await hooks.log(`Could not capture ${t.path} at ${vp}: ${(e as Error).message}`, { level: "warn" });
        }
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  analysis.durationMs = Date.now() - t0;
  if (!captured.length) throw new Error("No pages could be captured from this site.");
  return analysis;
}
