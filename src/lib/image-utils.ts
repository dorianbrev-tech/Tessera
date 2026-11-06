import sharp from "sharp";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const hexOf = ({ r, g, b }: Rgb) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export function rgbOf(hex: string): Rgb {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function toLab({ r, g, b }: Rgb) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIE76 ΔE between two colors (0 = identical, ~2.3 = just noticeable, 100 = opposite). */
export function deltaE(a: Rgb, b: Rgb) {
  const A = toLab(a), B = toLab(b);
  return Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
}

/** Dominant colors via coarse quantisation of a downscaled image. Weights sum to 1. */
export async function dominantColors(input: Buffer, n = 8): Promise<{ hex: string; weight: number }[]> {
  const { data, info } = await sharp(input).resize(96, 96, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { r: number; g: number; b: number; c: number }>();
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, c: 0 };
    e.r += r; e.g += g; e.b += b; e.c++;
    buckets.set(key, e);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.c - a.c);
  const out: { rgb: Rgb; weight: number }[] = [];
  for (const e of sorted) {
    const rgb = { r: e.r / e.c, g: e.g / e.c, b: e.b / e.c };
    const near = out.find((o) => deltaE(o.rgb, rgb) < 8);
    if (near) near.weight += e.c / total;
    else if (out.length < n * 2) out.push({ rgb, weight: e.c / total });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map((o) => ({ hex: hexOf(o.rgb), weight: +o.weight.toFixed(4) }));
}

/** Palette similarity 0..1: weighted nearest-color match in both directions. */
export function paletteSimilarity(a: { hex: string; weight: number }[], b: { hex: string; weight: number }[]) {
  if (!a.length || !b.length) return 0;
  const side = (x: typeof a, y: typeof b) => {
    let score = 0, wsum = 0;
    for (const c of x) {
      const best = Math.min(...y.map((d) => deltaE(rgbOf(c.hex), rgbOf(d.hex))));
      score += c.weight * Math.max(0, 1 - best / 40);
      wsum += c.weight;
    }
    return wsum ? score / wsum : 0;
  };
  return (side(a, b) + side(b, a)) / 2;
}

/** Split a tall screenshot into slices that fit Claude's vision limits, as JPEG. */
export async function sliceForVision(input: Buffer, opts: { width?: number; sliceHeight?: number; maxSlices?: number; startY?: number } = {}) {
  const width = opts.width ?? 1000;
  const meta = await sharp(input).metadata();
  const scale = width / (meta.width ?? width);
  const sliceSrcH = Math.round((opts.sliceHeight ?? 1300) / scale);
  const out: { data: Buffer; top: number; height: number }[] = [];
  const H = meta.height ?? 0;
  for (let top = opts.startY ?? 0, i = 0; top < H && i < (opts.maxSlices ?? 3); top += sliceSrcH, i++) {
    const h = Math.min(sliceSrcH, H - top);
    if (h < 40) break;
    const data = await sharp(input)
      .extract({ left: 0, top, width: meta.width!, height: h })
      .resize({ width })
      .jpeg({ quality: 72 })
      .toBuffer();
    out.push({ data, top, height: h });
  }
  return out;
}

export async function cropRegion(input: Buffer, top: number, height: number, outWidth = 1200, quality = 76) {
  const meta = await sharp(input).metadata();
  const H = meta.height ?? 0;
  const t = Math.max(0, Math.min(Math.round(top), H - 1));
  const h = Math.max(1, Math.min(Math.round(height), H - t));
  return sharp(input).extract({ left: 0, top: t, width: meta.width!, height: h }).resize({ width: Math.min(outWidth, meta.width!) }).jpeg({ quality }).toBuffer();
}
