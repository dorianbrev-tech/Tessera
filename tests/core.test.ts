import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseRobots } from "@/lib/analysis/robots";
import { normalizePath, resolveSitePath } from "@/lib/projects";
import { rewriteCss, rewriteHtml } from "@/lib/site-serve";
import { sanitizeFormData } from "@/lib/forms";
import { describeTransform } from "@/lib/analysis/crawler";
import { compareScreens } from "@/lib/fidelity/compare";
import { deltaE, rgbOf, paletteSimilarity } from "@/lib/image-utils";
import { createPreviewToken, verifyPreviewToken } from "@/lib/tokens";

test("robots.txt: agent groups, longest match and wildcards", () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/press\nDisallow: /*.pdf$\n\nUser-agent: TesseraBot\nDisallow: /no-bots\n`;
  const star = parseRobots(txt, "SomeOtherBot");
  assert.equal(star.isAllowed("https://x.com/"), true);
  assert.equal(star.isAllowed("https://x.com/private/a"), false);
  assert.equal(star.isAllowed("https://x.com/private/press"), true, "longer Allow wins");
  assert.equal(star.isAllowed("https://x.com/file.pdf"), false);
  assert.equal(star.isAllowed("https://x.com/file.pdf?x=1"), true, "$ anchors the end");
  const ours = parseRobots(txt, "TesseraBot");
  assert.equal(ours.isAllowed("https://x.com/no-bots"), false);
  assert.equal(ours.isAllowed("https://x.com/private/a"), true, "a specific group replaces the * group");
});

test("project paths cannot escape the project", () => {
  assert.equal(normalizePath("/assets//css/./styles.css"), "assets/css/styles.css");
  assert.throws(() => normalizePath("../etc/passwd"));
  assert.throws(() => normalizePath("assets/../../x"));
  assert.throws(() => normalizePath(""));
});

test("site paths resolve pretty URLs", async () => {
  const files = new Set(["index.html", "about.html", "journal/index.html", "assets/css/styles.css"]);
  const lookup = async (p: string) => files.has(p);
  assert.equal(await resolveSitePath("x", "/", lookup), "index.html");
  assert.equal(await resolveSitePath("x", "/about", lookup), "about.html");
  assert.equal(await resolveSitePath("x", "/journal/", lookup), "journal/index.html");
  assert.equal(await resolveSitePath("x", "/journal", lookup), "journal/index.html");
  assert.equal(await resolveSitePath("x", "/assets/css/styles.css", lookup), "assets/css/styles.css");
  assert.equal(await resolveSitePath("x", "/missing", lookup), null);
});

test("root-relative URLs are rewritten under a prefix, external ones are not", () => {
  const html = `<head></head><a href="/about">a</a><img src="/img/a.jpg" srcset="/img/a.jpg 1x, /img/b.jpg 2x"><a href="//cdn.x/y">c</a><a href="https://x.com/">d</a><div style="background:url('/bg.jpg')"></div><style>.h{background:url(/h.jpg)}</style>`;
  const out = rewriteHtml(html, "/s/site", { noindex: true });
  assert.match(out, /href="\/s\/site\/about"/);
  assert.match(out, /src="\/s\/site\/img\/a.jpg"/);
  assert.match(out, /srcset="\/s\/site\/img\/a.jpg 1x, \/s\/site\/img\/b.jpg 2x"/);
  assert.match(out, /href="\/\/cdn.x\/y"/);
  assert.match(out, /href="https:\/\/x.com\/"/);
  assert.match(out, /url\('\/s\/site\/bg.jpg'\)/);
  assert.match(out, /url\(\/s\/site\/h.jpg\)/);
  assert.match(out, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(rewriteCss(`@import "/a.css"; .x{src:url("/f.woff2")}`, "/p"), `@import "/p/a.css"; .x{src:url("/p/f.woff2")}`);
});

test("form submissions drop credential and payment fields", () => {
  const r = sanitizeFormData({ email: "a@b.co", password: "x", card_number: "4111", cvc: "123", message: "hi", _next: "/thanks", _hp: "" });
  assert.deepEqual(r.data, { email: "a@b.co", message: "hi" });
  assert.deepEqual(r.stripped.sort(), ["card_number", "cvc", "password"]);
  assert.equal(r.next, "/thanks");
});

test("preview tokens are signed and tamper-evident", () => {
  const t = createPreviewToken("p1", "u1", 60);
  assert.deepEqual({ ...verifyPreviewToken(t), e: 0 }, { p: "p1", u: "u1", e: 0 });
  const [payload, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ p: "p2", u: "u1", e: 9e9 })).toString("base64url");
  assert.equal(verifyPreviewToken(`${forged}.${sig}`), null);
  assert.equal(verifyPreviewToken(`${payload}.AAAA`), null);
  assert.equal(verifyPreviewToken(createPreviewToken("p1", "u1", -10)), null, "expired");
});

test("matrix transforms are described in readable terms", () => {
  assert.equal(describeTransform("matrix(1, 0, 0, 1, 0, 48)"), "translateY(48px)");
  assert.equal(describeTransform("none"), "none");
  assert.equal(describeTransform("matrix(1.05, 0, 0, 1.05, 0, 0)"), "scale(1.05)");
});

test("color math", () => {
  assert.ok(deltaE(rgbOf("#ffffff"), rgbOf("#ffffff")) < 0.001);
  assert.ok(deltaE(rgbOf("#000000"), rgbOf("#ffffff")) > 90);
  assert.ok(paletteSimilarity([{ hex: "#f6f1ea", weight: 1 }], [{ hex: "#f6f1ea", weight: 1 }]) > 0.99);
  assert.ok(paletteSimilarity([{ hex: "#f6f1ea", weight: 1 }], [{ hex: "#102040", weight: 1 }]) < 0.2);
});

test("fidelity: identical screens score ~100, different ones much lower", async () => {
  const page = (bg: string, block: string) =>
    sharp({ create: { width: 1440, height: 2400, channels: 3, background: bg } })
      .composite([{ input: { create: { width: 1200, height: 600, channels: 3, background: block } }, left: 120, top: 300 }])
      .jpeg()
      .toBuffer();
  const a = await page("#f6f1ea", "#1b1714");
  const same = await compareScreens({ referenceShot: a, generatedShot: a, viewportWidth: 1440 });
  assert.ok(same.metrics.overall > 99, `identical scored ${same.metrics.overall}`);
  assert.equal(same.issues.filter((i) => i.severity === "high").length, 0);
  const b = await page("#ffffff", "#2050c0");
  const diff = await compareScreens({ referenceShot: a, generatedShot: b, viewportWidth: 1440 });
  assert.ok(diff.metrics.overall < same.metrics.overall - 15, `different scored ${diff.metrics.overall}`);
  assert.ok(diff.issues.some((i) => i.kind === "color"), "palette gap reported");
});
