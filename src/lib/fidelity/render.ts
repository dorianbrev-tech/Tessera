// Renders a generated project page in headless Chromium. Project files are served
// straight from the database through request interception on a private origin, so
// rendering needs no running web server and sees exactly what is stored.
import { newViewportContext, browserScript } from "@/lib/browser";
import { captureLoaded, settle } from "@/lib/analysis/crawler";
import { resolveSitePath, readFileBytes } from "@/lib/projects";
import type { PageExtraction, Viewport } from "@/lib/types";

export const SITE_ORIGIN = "http://site.tessera.local";

export class PageNotFoundError extends Error {}

export interface RenderResult {
  screenshot: Buffer;
  shotHeight: number;
  extraction: PageExtraction;
  consoleErrors: string[];
  missingFiles: string[];
  failedRequests: string[];
  horizontalOverflow: boolean;
  scrollWidth: number;
}

export async function renderProjectPage(projectId: string, urlPath: string, viewport: Viewport): Promise<RenderResult> {
  const ctx = await newViewportContext(viewport);
  const missingFiles: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  try {
    await ctx.route(`${SITE_ORIGIN}/**`, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (req.method() !== "GET" && req.method() !== "HEAD") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      const resolved = await resolveSitePath(projectId, u.pathname);
      const file = resolved ? await readFileBytes(projectId, resolved) : null;
      if (!file) {
        missingFiles.push(u.pathname);
        return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
      }
      return route.fulfill({ status: 200, contentType: file.mime, body: file.data });
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => consoleErrors.length < 20 && consoleErrors.push(`${e.name}: ${e.message}`.slice(0, 300)));
    page.on("requestfailed", (r) => {
      if (!r.url().startsWith(SITE_ORIGIN) && failedRequests.length < 20) failedRequests.push(`${r.url().slice(0, 160)} (${r.failure()?.errorText ?? "failed"})`);
    });
    const path = urlPath.startsWith("/") ? urlPath : "/" + urlPath;
    const res = await page.goto(SITE_ORIGIN + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!res || res.status() === 404) throw new PageNotFoundError(`No page exists at ${path} in this project.`);
    await settle(page);
    await page.evaluate(browserScript("probes"));
    const scrollWidth = Number(await page.evaluate("document.documentElement.scrollWidth"));
    const cap = await captureLoaded(page, viewport, { probeMotion: true, probeHover: false, probeMenu: false });
    return {
      screenshot: cap.screenshot,
      shotHeight: cap.shotHeight,
      extraction: cap.extraction,
      consoleErrors,
      missingFiles: [...new Set(missingFiles)].filter((p) => p !== "/favicon.ico"),
      failedRequests,
      horizontalOverflow: scrollWidth > (page.viewportSize()?.width ?? 0) + 1,
      scrollWidth,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}
