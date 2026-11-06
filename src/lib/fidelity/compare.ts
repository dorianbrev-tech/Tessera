// Visual fidelity engine: compares a generated page against its reference using
// pixel, structural and semantic measurements, and explains the differences.
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import type { FidelityIssue, FidelityMetrics, PageExtraction, SectionInfo, TypeStyle } from "@/lib/types";
import { dominantColors, paletteSimilarity, deltaE, rgbOf } from "@/lib/image-utils";

const AW = 360; // analysis width in px (screens are compared at 1/4 scale for desktop)

type Raster = { data: Buffer; width: number; height: number };

async function raster(buf: Buffer, width = AW): Promise<Raster> {
  const { data, info } = await sharp(buf).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function gray(r: Raster, rows: number) {
  const out = new Float32Array(r.width * rows);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = 0.299 * r.data[j] + 0.587 * r.data[j + 1] + 0.114 * r.data[j + 2];
  return out;
}

function blockSsim(a: Float32Array, b: Float32Array, w: number, h: number, bs = 8) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let total = 0, n = 0;
  for (let y = 0; y + bs <= h; y += bs) {
    for (let x = 0; x + bs <= w; x += bs) {
      let ma = 0, mb = 0;
      for (let yy = 0; yy < bs; yy++) for (let xx = 0; xx < bs; xx++) { const i = (y + yy) * w + x + xx; ma += a[i]; mb += b[i]; }
      ma /= bs * bs; mb /= bs * bs;
      let va = 0, vb = 0, cov = 0;
      for (let yy = 0; yy < bs; yy++) for (let xx = 0; xx < bs; xx++) { const i = (y + yy) * w + x + xx; const da = a[i] - ma, db = b[i] - mb; va += da * da; vb += db * db; cov += da * db; }
      va /= bs * bs - 1; vb /= bs * bs - 1; cov /= bs * bs - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? Math.max(0, total / n) : 0;
}

function rowProfiles(r: Raster) {
  const lum = new Float32Array(r.height), edge = new Float32Array(r.height);
  for (let y = 0; y < r.height; y++) {
    let s = 0, e = 0, prev = -1;
    for (let x = 0; x < r.width; x++) {
      const j = (y * r.width + x) * 4;
      const v = 0.299 * r.data[j] + 0.587 * r.data[j + 1] + 0.114 * r.data[j + 2];
      s += v;
      if (prev >= 0) e += Math.abs(v - prev);
      prev = v;
    }
    lum[y] = s / r.width;
    edge[y] = e / r.width;
  }
  return { lum, edge };
}

function resample(arr: Float32Array, bins: number) {
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const a = Math.floor((i / bins) * arr.length), b = Math.max(a + 1, Math.floor(((i + 1) / bins) * arr.length));
    let s = 0;
    for (let k = a; k < b; k++) s += arr[k];
    out[i] = s / (b - a);
  }
  return out;
}

function corr(a: Float32Array, b: Float32Array) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  if (da === 0 || db === 0) return da === db ? 1 : 0;
  return num / Math.sqrt(da * db);
}

// ---------------------------------------------------------------------------------------
// Semantic comparisons
// ---------------------------------------------------------------------------------------
const fam = (ff: string) => ff.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
const isSerif = (ff: string) => /serif|garamond|georgia|times|didot|bodoni|caslon|playfair|cormorant|libre baskerville/i.test(ff) && !/sans/i.test(fam(ff));

function roleStyle(ex: PageExtraction, roles: string[]): TypeStyle | undefined {
  for (const r of roles) {
    const s = ex.typography.filter((t) => t.role === r).sort((a, b) => (b.chars ?? b.count) - (a.chars ?? a.count))[0];
    if (s) return s;
  }
  return undefined;
}

function compareTypography(ref: PageExtraction, gen: PageExtraction, issues: FidelityIssue[]) {
  const roles: [string, string[]][] = [["Display (h1)", ["h1", "h2"]], ["Headings (h2)", ["h2", "h3"]], ["Body", ["body"]], ["Navigation", ["nav"]], ["Buttons", ["button"]]];
  let score = 0, n = 0;
  for (const [label, rs] of roles) {
    const r = roleStyle(ref, rs), g = roleStyle(gen, rs);
    if (!r) continue;
    n++;
    if (!g) {
      issues.push({ kind: "typography", severity: label === "Body" || label.startsWith("Display") ? "high" : "medium", message: `${label}: no matching text style found in the generated page (reference: ${fam(r.fontFamily)} ${r.fontSize}px).` });
      continue;
    }
    const famScore = fam(r.fontFamily) === fam(g.fontFamily) ? 1 : isSerif(r.fontFamily) === isSerif(g.fontFamily) ? 0.5 : 0;
    const sizeScore = Math.min(r.fontSize, g.fontSize) / Math.max(r.fontSize, g.fontSize);
    const transScore = r.textTransform === g.textTransform ? 1 : 0;
    const ls = (v: string) => (v === "normal" ? 0 : parseFloat(v) || 0);
    const lsScore = Math.max(0, 1 - Math.abs(ls(r.letterSpacing) - ls(g.letterSpacing)) / 4);
    score += famScore * 0.4 + sizeScore * 0.35 + transScore * 0.15 + lsScore * 0.1;
    if (famScore < 1) issues.push({ kind: "typography", severity: famScore === 0 ? "high" : "medium", message: `${label} font is “${fam(g.fontFamily)}” but the reference uses “${fam(r.fontFamily)}”.` });
    if (sizeScore < 0.85) issues.push({ kind: "typography", severity: sizeScore < 0.65 ? "high" : "medium", message: `${label} size is ${g.fontSize}px; reference is ${r.fontSize}px (line-height ${r.lineHeight}, weight ${r.fontWeight}).` });
    if (!transScore) issues.push({ kind: "typography", severity: "low", message: `${label} text-transform is “${g.textTransform}”; reference uses “${r.textTransform}”.` });
    if (lsScore < 0.75) issues.push({ kind: "typography", severity: "low", message: `${label} letter-spacing is ${g.letterSpacing}; reference uses ${r.letterSpacing}.` });
  }
  return n ? score / n : 1;
}

function lcsAlign(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matchedA = new Set<number>();
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { matchedA.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { length: dp[0][0], matchedA };
}

const kindGroup = (k: string) => (["gallery", "grid"].includes(k) ? "grid" : ["text", "cta"].includes(k) ? "text" : k === "unknown" ? "text" : k);

function compareSections(ref: SectionInfo[], gen: SectionInfo[], issues: FidelityIssue[]) {
  const a = ref.map((s) => kindGroup(s.kind)), b = gen.map((s) => kindGroup(s.kind));
  if (!a.length) return 1;
  const { length, matchedA } = lcsAlign(a, b);
  const seqScore = length / Math.max(a.length, b.length);
  ref.forEach((s, i) => {
    if (!matchedA.has(i) && s.kind !== "unknown") {
      issues.push({
        kind: "missing-section",
        severity: ["hero", "header", "footer"].includes(s.kind) ? "high" : "medium",
        message: `Reference section ${i + 1} (${s.kind}${s.columns > 1 ? `, ${s.columns} columns` : ""}${s.headings[0] ? `, “${s.headings[0].slice(0, 60)}”` : ""}, ${s.height}px tall at y=${s.top}) has no counterpart in the generated page.`,
        region: { top: s.top, height: s.height },
      });
    }
  });
  if (b.length > a.length + 2) issues.push({ kind: "extra-section", severity: "low", message: `Generated page has ${b.length} sections; the reference has ${a.length}.` });
  // Column agreement for matched-by-index grids.
  let colScore = 0, colN = 0;
  ref.forEach((s, i) => {
    const g = gen[i];
    if (!g || s.columns < 2) return;
    colN++;
    colScore += Math.min(s.columns, g.columns) / Math.max(s.columns, g.columns);
    if (g.columns !== s.columns && kindGroup(g.kind) === kindGroup(s.kind)) {
      issues.push({ kind: "layout", severity: "medium", message: `Section ${i + 1} (${s.kind}) uses ${g.columns} columns; the reference uses ${s.columns}.`, region: { top: s.top, height: s.height } });
    }
  });
  return seqScore * 0.75 + (colN ? colScore / colN : 1) * 0.25;
}

function compareMedia(ref: PageExtraction, gen: PageExtraction, issues: FidelityIssue[]) {
  const ri = ref.images.filter((i) => i.renderedWidth >= 60).length, gi = gen.images.filter((i) => i.renderedWidth >= 60).length;
  const rv = ref.videos.length, gv = gen.videos.length;
  const imgScore = ri === 0 && gi === 0 ? 1 : Math.min(ri, gi) / Math.max(ri, gi, 1);
  const vidScore = rv === 0 ? 1 : Math.min(rv, gv) / rv;
  if (gi < ri * 0.75) issues.push({ kind: "missing-image", severity: gi < ri * 0.4 ? "high" : "medium", message: `The generated page shows ${gi} images; the reference shows ${ri}.` });
  if (gv < rv) issues.push({ kind: "missing-image", severity: "medium", message: `The reference uses ${rv} video(s) (${ref.videos.filter((v) => v.isBackground).length} as background); the generated page has ${gv}.` });
  const brokenish = gen.images.filter((i) => i.naturalWidth === 0 && i.kind === "img").length;
  if (brokenish) issues.push({ kind: "missing-image", severity: "high", message: `${brokenish} image(s) failed to load in the generated page.` });
  return imgScore * 0.8 + vidScore * 0.2;
}

function compareNavigation(ref: PageExtraction, gen: PageExtraction, issues: FidelityIssue[]) {
  const r = ref.navigation.header, g = gen.navigation.header;
  if (r.position !== g.position && (r.position === "fixed" || r.position === "sticky")) {
    issues.push({ kind: "navigation", severity: "medium", message: `Header is “${g.position || "static"}”; the reference header is ${r.position} (${r.height}px tall).` });
  }
  if (Math.abs(r.height - g.height) > 16 && r.height > 0) issues.push({ kind: "spacing", severity: "low", message: `Header height is ${g.height}px; reference is ${r.height}px.` });
  const rl = r.links.length, gl = g.links.length;
  if (rl && Math.abs(rl - gl) > 2) issues.push({ kind: "navigation", severity: "medium", message: `Header has ${gl} links; reference has ${rl} (${r.links.slice(0, 8).map((l) => l.text).join(", ")}).` });
}

// ---------------------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------------------
export interface CompareInput {
  referenceShot: Buffer;
  generatedShot: Buffer;
  referenceEx?: PageExtraction | null;
  generatedEx?: PageExtraction | null;
  viewportWidth: number;
  consoleErrors?: string[];
}

export interface CompareResult {
  metrics: FidelityMetrics;
  issues: FidelityIssue[];
  diffPng: Buffer;
  /** Side-by-side composites (reference | generated) for the worst regions, JPEG. */
  composites: { label: string; data: Buffer; top: number; height: number }[];
}

export async function compareScreens(input: CompareInput): Promise<CompareResult> {
  const scale = AW / input.viewportWidth;
  const ref = await raster(input.referenceShot);
  const gen = await raster(input.generatedShot);
  const H = Math.min(ref.height, gen.height);
  const refCrop = ref.data.subarray(0, AW * H * 4);
  const genCrop = gen.data.subarray(0, AW * H * 4);
  const diff = Buffer.alloc(AW * H * 4);
  const mismatched = pixelmatch(refCrop, genCrop, diff, AW, H, { threshold: 0.16, includeAA: false, alpha: 0.25, diffColor: [255, 0, 64], aaColor: [255, 200, 0] });
  const pixel = 1 - mismatched / (AW * H);
  const structural = blockSsim(gray(ref, H), gray(gen, H), AW, H);
  const pr = rowProfiles(ref), pg = rowProfiles(gen);
  const bins = 160;
  const layout = Math.max(0, (0.5 * (corr(resample(pr.lum, bins), resample(pg.lum, bins)) + 1)) * 0.5 + (0.5 * (corr(resample(pr.edge, bins), resample(pg.edge, bins)) + 1)) * 0.5);

  // Per-band mismatch (bands of 100 reference px).
  const band = Math.max(4, Math.round(100 * scale));
  const rows: FidelityMetrics["rows"] = [];
  for (let y = 0; y < H; y += band) {
    let c = 0;
    const h = Math.min(band, H - y);
    for (let yy = y; yy < y + h; yy++) for (let x = 0; x < AW; x++) { const j = (yy * AW + x) * 4; if (diff[j] === 255 && diff[j + 1] === 0) c++; }
    rows.push({ top: Math.round(y / scale), height: Math.round(h / scale), diff: +(c / (h * AW)).toFixed(3) });
  }

  const refPalette = input.referenceEx?.screenshotPalette?.length ? input.referenceEx.screenshotPalette : await dominantColors(input.referenceShot, 10);
  const genPalette = input.generatedEx?.screenshotPalette?.length ? input.generatedEx.screenshotPalette : await dominantColors(input.generatedShot, 10);
  const color = paletteSimilarity(refPalette, genPalette);

  const issues: FidelityIssue[] = [];
  const refHeight = input.referenceEx?.documentHeight ?? Math.round(ref.height / scale);
  const genHeight = input.generatedEx?.documentHeight ?? Math.round(gen.height / scale);
  const heightRatio = genHeight / Math.max(1, refHeight);

  let typography = 1, sections = 1, media = 1;
  const semantic = Boolean(input.referenceEx && input.generatedEx);
  if (input.referenceEx && input.generatedEx) {
    typography = compareTypography(input.referenceEx, input.generatedEx, issues);
    sections = compareSections(input.referenceEx.sections, input.generatedEx.sections, issues);
    media = compareMedia(input.referenceEx, input.generatedEx, issues);
    compareNavigation(input.referenceEx, input.generatedEx, issues);
  }

  // Palette gaps: important reference colors that are absent.
  for (const c of refPalette.filter((p) => p.weight >= 0.04).slice(0, 5)) {
    const best = Math.min(...genPalette.map((g) => deltaE(rgbOf(c.hex), rgbOf(g.hex))));
    if (best > 12) issues.push({ kind: "color", severity: c.weight > 0.2 ? "high" : "medium", message: `Reference color ${c.hex} (${Math.round(c.weight * 100)}% of the page) is missing; closest generated color is ΔE ${best.toFixed(0)} away.` });
  }
  if (heightRatio < 0.85 || heightRatio > 1.18) {
    issues.push({ kind: "height", severity: Math.abs(1 - heightRatio) > 0.35 ? "high" : "medium", message: `Generated page is ${genHeight}px tall vs ${refHeight}px for the reference (${Math.round((heightRatio - 1) * 100)}%). Check section heights and vertical spacing.` });
  }
  // Worst bands, merged into regions.
  const worst = rows.filter((r) => r.diff > 0.35).sort((a, b) => b.diff - a.diff).slice(0, 6).sort((a, b) => a.top - b.top);
  const regions: { top: number; height: number; diff: number }[] = [];
  for (const r of worst) {
    const last = regions[regions.length - 1];
    if (last && r.top <= last.top + last.height + 100) {
      last.height = r.top + r.height - last.top;
      last.diff = Math.max(last.diff, r.diff);
    } else regions.push({ ...r });
  }
  const refSections = input.referenceEx?.sections ?? [];
  for (const reg of regions.slice(0, 4)) {
    const sec = refSections.find((s) => reg.top >= s.top && reg.top < s.top + s.height);
    issues.push({
      kind: "layout",
      severity: reg.diff > 0.6 ? "high" : "medium",
      message: `Visual mismatch of ${Math.round(reg.diff * 100)}% between y=${reg.top} and y=${reg.top + reg.height}${sec ? ` (reference section ${sec.index + 1}: ${sec.kind}${sec.headings[0] ? ` “${sec.headings[0].slice(0, 50)}”` : ""})` : ""}.`,
      region: { top: reg.top, height: reg.height },
    });
  }
  for (const e of (input.consoleErrors ?? []).slice(0, 5)) issues.push({ kind: "runtime-error", severity: "high", message: `Console error: ${e}` });

  // Weighted score; semantic metrics only when both extractions exist.
  const parts: [number, number][] = semantic
    ? [[pixel, 0.12], [structural, 0.18], [layout, 0.15], [color, 0.15], [typography, 0.16], [sections, 0.14], [media, 0.1]]
    : [[pixel, 0.25], [structural, 0.3], [layout, 0.25], [color, 0.2]];
  const raw = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  const heightPenalty = Math.min(0.3, Math.abs(1 - heightRatio) * 0.5);
  // Convex mapping keeps near-identical pages near 100 while making real gaps visible.
  const overall = Math.round(Math.pow(raw * (1 - heightPenalty), 1.6) * 1000) / 10;

  const sevRank = { high: 0, medium: 1, low: 2 } as const;
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  const diffPng = await sharp(diff, { raw: { width: AW, height: H, channels: 4 } }).png().toBuffer();
  const composites = await buildComposites(input.referenceShot, input.generatedShot, regions);

  return {
    metrics: {
      overall,
      pixel: +pixel.toFixed(3),
      structural: +structural.toFixed(3),
      layout: +layout.toFixed(3),
      color: +color.toFixed(3),
      typography: +typography.toFixed(3),
      sections: +sections.toFixed(3),
      media: +media.toFixed(3),
      heightRatio: +heightRatio.toFixed(3),
      referenceHeight: refHeight,
      generatedHeight: genHeight,
      rows,
    },
    issues: issues.slice(0, 30),
    diffPng,
    composites,
  };
}

async function sideBySide(a: Buffer, b: Buffer, top: number, height: number, half = 620) {
  const crop = async (buf: Buffer) => {
    const m = await sharp(buf).metadata();
    const t = Math.min(Math.max(0, top), Math.max(0, (m.height ?? 1) - 1));
    const h = Math.max(1, Math.min(height, (m.height ?? 1) - t));
    return sharp(buf).extract({ left: 0, top: t, width: m.width!, height: h }).resize({ width: half }).toBuffer();
  };
  const [ra, rb] = await Promise.all([crop(a), crop(b)]);
  const [ma, mb] = await Promise.all([sharp(ra).metadata(), sharp(rb).metadata()]);
  const H = Math.max(ma.height ?? 1, mb.height ?? 1);
  return sharp({ create: { width: half * 2 + 12, height: H, channels: 3, background: "#ff2d55" } })
    .composite([{ input: ra, left: 0, top: 0 }, { input: rb, left: half + 12, top: 0 }])
    .jpeg({ quality: 72 })
    .toBuffer();
}

async function buildComposites(refShot: Buffer, genShot: Buffer, regions: { top: number; height: number }[]) {
  const out: CompareResult["composites"] = [];
  out.push({ label: "Top of page — reference (left) vs generated (right)", data: await sideBySide(refShot, genShot, 0, 1800), top: 0, height: 1800 });
  for (const r of regions.slice(0, 2)) {
    const top = Math.max(0, r.top - 200);
    const height = Math.max(800, Math.min(1600, r.height + 400));
    if (top < 1700) continue; // already covered by the overview
    out.push({ label: `Region y=${top}–${top + height} — reference (left) vs generated (right)`, data: await sideBySide(refShot, genShot, top, height), top, height });
  }
  return out;
}
