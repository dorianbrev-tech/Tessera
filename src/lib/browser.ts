// Shared headless Chromium for the worker (analysis + fidelity rendering).
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { VIEWPORTS, type Viewport } from "@/lib/types";
import { isAllowedHost } from "@/lib/analysis/net";

const g = globalThis as unknown as { __tesseraBrowser?: Promise<Browser> };

export function getBrowser(): Promise<Browser> {
  if (!g.__tesseraBrowser) {
    g.__tesseraBrowser = chromium
      .launch({
        executablePath: env.chromiumPath,
        args: ["--disable-dev-shm-usage", "--hide-scrollbars", "--font-render-hinting=none", "--disable-blink-features=AutomationControlled"],
      })
      .then((b) => {
        b.on("disconnected", () => {
          g.__tesseraBrowser = undefined;
        });
        return b;
      })
      .catch((e) => {
        g.__tesseraBrowser = undefined;
        throw e;
      });
  }
  return g.__tesseraBrowser;
}

export async function closeBrowser() {
  const b = await g.__tesseraBrowser?.catch(() => null);
  g.__tesseraBrowser = undefined;
  await b?.close().catch(() => {});
}

function userAgentFor(viewport: Viewport, version: string): string {
  if (env.crawlerUserAgent) return env.crawlerUserAgent;
  const major = version.split(".")[0];
  const bot = ` ${env.crawlerUserAgentToken}/1.0 (+${env.appUrl}/bot)`;
  if (viewport === "mobile")
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36${bot}`;
  if (viewport === "tablet")
    return `Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${bot}`;
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${bot}`;
}

/** A context emulating one of the analysis viewports, with SSRF filtering in production. */
export async function newViewportContext(viewport: Viewport, extra: BrowserContextOptions = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  const vp = VIEWPORTS[viewport];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    userAgent: userAgentFor(viewport, browser.version()),
    locale: "en-US",
    serviceWorkers: "block",
    reducedMotion: "no-preference",
    acceptDownloads: false,
    ...extra,
  });
  if (!env.allowPrivateHosts) {
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
      if (!(url.protocol === "http:" || url.protocol === "https:") || !(await isAllowedHost(url.hostname))) return route.abort("blockedbyclient");
      return route.continue();
    });
  }
  return ctx;
}

const scriptCache = new Map<string, string>();
/** Browser-side scripts are plain .js files injected as strings (immune to bundler transforms). */
export function browserScript(name: "extract" | "probes"): string {
  let s = scriptCache.get(name);
  if (!s) {
    s = readFileSync(path.join(process.cwd(), "src/lib/analysis/scripts", `${name}.js`), "utf8");
    scriptCache.set(name, s);
  }
  return s;
}
