// Turns measured extraction data into a design system. Two layers:
//  1. heuristicDesign(): deterministic, computed from what the crawler measured.
//  2. synthesizeProjectDesign(): Claude reads the measurements + screenshots of every
//     reference (with the role the user assigned it) and writes one coherent design system.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { anthropic, SYNTHESIS_BETAS, describeRefusal } from "@/lib/ai/client";
import { sliceForVision, deltaE, rgbOf } from "@/lib/image-utils";
import sharp from "sharp";
import type { DesignSystem, PageExtraction, ReferenceRole, SectionInfo, TypeStyle } from "@/lib/types";
import { REFERENCE_ROLES } from "@/lib/types";

type PageInput = { path: string; title: string; extraction: PageExtraction; sections: SectionInfo[] };

const RATIOS: [string, number][] = [
  ["1:1", 1], ["4:5", 0.8], ["3:4", 0.75], ["2:3", 0.667], ["9:16", 0.5625], ["5:4", 1.25], ["4:3", 1.333], ["3:2", 1.5], ["16:9", 1.778], ["21:9", 2.333],
];
const nearestRatio = (r: number) => RATIOS.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];

function luminance(hex: string) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function familyName(ff: string) {
  return ff.split(",")[0].replace(/["']/g, "").trim();
}
function genericOf(ff: string) {
  const parts = ff.split(",").map((s) => s.trim().replace(/["']/g, ""));
  const generic = parts.find((p) => ["serif", "sans-serif", "monospace", "cursive", "system-ui"].includes(p));
  return generic ?? (/serif|garamond|georgia|times|didot|bodoni|caslon/i.test(ff) && !/sans/i.test(ff) ? "serif" : "sans-serif");
}

function pickStyle(typo: TypeStyle[], role: string) {
  return typo.filter((t) => t.role === role).sort((a, b) => (b.chars ?? b.count) - (a.chars ?? a.count))[0];
}

export function heuristicDesign(pages: PageInput[]): DesignSystem {
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  const ex = home.extraction;

  // Colors -----------------------------------------------------------------
  const colors: DesignSystem["colors"] = [];
  const seen = new Set<string>();
  const add = (hex: string, name: string, role: string) => {
    if (!hex || seen.has(hex)) return;
    seen.add(hex);
    colors.push({ name, hex, role });
  };
  // DOM coverage is an approximation (nested layers overlap); re-rank with the pixel-true
  // screenshot palette when available.
  const shotPalette = ex.screenshotPalette ?? [];
  const pixelWeight = (hex: string) =>
    shotPalette.filter((p) => deltaE(rgbOf(p.hex), rgbOf(hex)) < 10).reduce((s, p) => s + p.weight, 0);
  const bgs = ex.colors.background
    .filter((c) => c.weight >= 0.01)
    .map((c) => ({ ...c, rank: shotPalette.length ? pixelWeight(c.hex) * 0.7 + c.weight * 0.3 : c.weight }))
    .sort((x, y) => y.rank - x.rank);
  bgs.slice(0, 5).forEach((c, i) =>
    add(c.hex, i === 0 ? "Page background" : luminance(c.hex) < 0.25 ? "Inverse surface" : `Surface ${i}`, `background (${(c.weight * 100).toFixed(0)}% of surface)`),
  );
  ex.colors.text.slice(0, 3).forEach((c, i) => add(c.hex, ["Text primary", "Text secondary", "Text tertiary"][i], `text (${(c.weight * 100).toFixed(0)}% of characters)`));
  ex.colors.accent.slice(0, 2).forEach((c, i) => add(c.hex, i ? "Accent 2" : "Accent", "interactive accent"));
  ex.colors.border.slice(0, 1).forEach((c) => add(c.hex, "Border", "dividers and outlines"));

  // Typography --------------------------------------------------------------
  const typo = ex.typography;
  const displayStyle = pickStyle(typo, "h1") ?? pickStyle(typo, "h2");
  const bodyStyle = pickStyle(typo, "body") ?? typo[typo.length - 1];
  const families = new Map<string, { roles: Set<string>; weights: Set<string>; ff: string }>();
  for (const t of typo) {
    const f = familyName(t.fontFamily);
    const e = families.get(f) ?? { roles: new Set(), weights: new Set(), ff: t.fontFamily };
    e.roles.add(t.role);
    e.weights.add(t.fontWeight);
    families.set(f, e);
  }
  const faceProvider = (fam: string) => ex.fonts.faces.find((f) => f.family.toLowerCase() === fam.toLowerCase())?.provider;
  const typography: DesignSystem["typography"] = [...families.entries()]
    .sort((a, b) => (ex.fonts.families.find((x) => x.family === b[0])?.count ?? 0) - (ex.fonts.families.find((x) => x.family === a[0])?.count ?? 0))
    .slice(0, 4)
    .map(([family, v]) => {
      const isDisplay = displayStyle && familyName(displayStyle.fontFamily) === family;
      const isBody = bodyStyle && familyName(bodyStyle.fontFamily) === family;
      const provider = faceProvider(family);
      return {
        family,
        role: isDisplay && isBody ? "display + body" : isDisplay ? "display / headings" : isBody ? "body / UI" : [...v.roles].slice(0, 3).join(", "),
        weights: [...v.weights].sort(),
        source: provider === "google" ? "Google Fonts" : provider === "adobe" ? "Adobe Fonts (licensed)" : provider === "self-hosted" ? "self-hosted webfont" : provider ? "webfont" : "system / unknown",
        fallback: genericOf(v.ff),
        notes: `Used for: ${[...v.roles].join(", ")}`,
      };
    });
  const scaleRoles: [string, string][] = [["h1", "display"], ["h2", "heading-1"], ["h3", "heading-2"], ["h4", "heading-3"], ["body", "body"], ["nav", "nav-label"], ["button", "button"], ["caption", "caption"], ["link", "link"], ["footer", "footer"]];
  const typeScale = scaleRoles
    .map(([role, token]) => {
      const s = pickStyle(typo, role);
      return s ? { token, size: `${s.fontSize}px`, lineHeight: s.lineHeight, weight: s.fontWeight, letterSpacing: s.letterSpacing, transform: s.textTransform, family: familyName(s.fontFamily) } : null;
    })
    .filter(Boolean)
    .map((s) => ({ token: s!.token, size: s!.size, lineHeight: s!.lineHeight, weight: s!.weight, letterSpacing: s!.letterSpacing, transform: s!.transform === "none" ? `none · ${s!.family}` : `${s!.transform} · ${s!.family}` }));

  // Spacing & surfaces -----------------------------------------------------------
  const container = ex.spacing.containerWidths[0]?.value;
  const spacing = {
    containerMaxWidth: container ? `${container}px` : `${ex.width}px (full width)`,
    sectionPaddingY: ex.spacing.sectionPaddings.find((p) => !p.value.startsWith("0px / 0px"))?.value ?? "0px",
    gutter: ex.spacing.gaps[0]?.value ?? "—",
    notes: `Common gaps: ${ex.spacing.gaps.slice(0, 4).map((g) => g.value).join(", ") || "none"}; section paddings: ${ex.spacing.sectionPaddings.slice(0, 4).map((p) => p.value).join(", ")}`,
  };
  const radii = ex.radii.slice(0, 4).map((r) => `${r.value} (${r.count}×)`);
  const shadows = ex.shadows.slice(0, 3).map((s) => `${s.value} (${s.count}×)`);

  // Components ----------------------------------------------------------------
  const components: DesignSystem["components"] = [];
  const h = ex.navigation.header;
  if (h.links.length || h.height) {
    components.push({
      name: "Header",
      description: `${h.position || "static"} header, ${h.height}px tall, background ${h.background}; ${h.links.length} links (${h.links.slice(0, 7).map((l) => l.text).filter(Boolean).join(", ")})${h.logo ? `; logo ${h.logo.src ? "image/svg" : "wordmark"} “${h.logo.text}”` : ""}.`,
    });
  }
  ex.buttons.slice(0, 3).forEach((b, i) =>
    components.push({
      name: i === 0 ? "Primary button" : `Button variant ${i + 1}`,
      description: `“${b.text}” — background ${b.background}, text ${b.color}, border ${b.border}, radius ${b.radius}, padding ${b.padding}, ${b.fontSize} weight ${b.fontWeight}${b.textTransform !== "none" ? `, ${b.textTransform}` : ""}, letter-spacing ${b.letterSpacing} (${b.count}×).`,
    }),
  );
  const gridSection = ex.sections.find((s) => s.kind === "grid" && s.imageCount >= 3);
  if (gridSection) {
    const imgs = ex.images.filter((i) => i.section === gridSection.index);
    const ratio = imgs.length ? nearestRatio(imgs.reduce((s, i) => s + i.aspectRatio, 0) / imgs.length) : "?";
    components.push({ name: "Card grid", description: `${gridSection.columns}-column grid of image cards (images ≈ ${ratio}, ${imgs[0]?.objectFit ?? "cover"}) with caption row.` });
  }
  if (ex.forms.length) {
    components.push({ name: "Form", description: ex.forms.map((f) => `${f.method.toUpperCase()} form with ${f.fields.map((x) => x.label || x.type).join(", ")}`).join("; ") });
  }
  const f = ex.navigation.footer;
  if (f.links.length) components.push({ name: "Footer", description: `${f.columns} link columns, ${f.links.length} links.` });

  // Motion -----------------------------------------------------------------------
  const a = ex.animations;
  const motion: DesignSystem["motion"] = [];
  for (const r of a.scrollReveals.slice(0, 4)) {
    motion.push({
      name: "Scroll reveal",
      description: `${r.count}× ${r.selector}: opacity ${r.from.opacity} → ${r.to.opacity}${r.from.transform !== r.to.transform ? `, ${r.from.transform} → ${r.to.transform}` : ""}`,
      implementation: "IntersectionObserver adds a visible class; CSS transition on opacity/transform",
    });
  }
  for (const t of a.transitions.slice(0, 3)) {
    motion.push({ name: "Transition", description: `${t.property} over ${t.duration} (${t.timing}) on ${t.count} elements, e.g. ${t.selector}`, implementation: "CSS transition" });
  }
  for (const hv of a.hoverEffects.slice(0, 5)) {
    motion.push({
      name: `Hover · ${hv.selector}`,
      description: Object.entries(hv.changes).slice(0, 4).map(([k, [x, y]]) => `${k}: ${x} → ${y}`).join("; "),
      implementation: "CSS :hover with transition",
    });
  }
  for (const s of a.sticky.slice(0, 2)) motion.push({ name: "Sticky element", description: `${s.selector} is ${s.position} (top ${s.top}, ${s.height}px)`, implementation: `position: ${s.position}` });
  for (const p of a.parallax.slice(0, 3)) motion.push({ name: "Parallax", description: `${p.selector} moves at ${p.ratio}× scroll speed`, implementation: "transform translate3d driven by scroll (requestAnimationFrame)" });
  if (a.marquees) motion.push({ name: "Marquee", description: `${a.marquees} infinitely scrolling text band(s)`, implementation: "CSS keyframes translateX(-50%) on a duplicated track" });
  for (const c of a.carousels.slice(0, 2)) motion.push({ name: "Carousel", description: `${c.selector} with ${c.slides} slides${c.library ? ` (${c.library})` : ""}`, implementation: c.library ?? "scroll-snap horizontal rail" });
  if (a.smoothScroll) motion.push({ name: "Smooth scrolling", description: a.libraries.find((l) => /lenis|locomotive/i.test(l)) ?? "scroll-behavior: smooth", implementation: "CSS scroll-behavior or Lenis" });
  if (a.scrollSnap) motion.push({ name: "Scroll snap", description: "scroll-snap is used on at least one container", implementation: "scroll-snap-type" });
  if (a.libraries.length) motion.push({ name: "Libraries", description: a.libraries.join(", "), implementation: "detected at runtime" });

  // Imagery -------------------------------------------------------------------
  const imgs = ex.images.filter((i) => i.kind !== "svg" && i.renderedWidth > 80);
  const hist = new Map<string, number>();
  imgs.forEach((i) => hist.set(nearestRatio(i.aspectRatio), (hist.get(nearestRatio(i.aspectRatio)) ?? 0) + 1));
  const ratios = [...hist.entries()].sort((x, y) => y[1] - x[1]).map(([r, n]) => `${r} (${n})`);
  const fullBleed = imgs.filter((i) => i.renderedWidth >= ex.width * 0.95).length;
  const bgVideos = ex.videos.filter((v) => v.isBackground).length;
  const imagery = {
    style: `${imgs.length} images on the home page; ${fullBleed} full-bleed; ${bgVideos} background video(s).`,
    treatment: `object-fit ${[...new Set(imgs.map((i) => i.objectFit))].slice(0, 3).join("/") || "n/a"}${ex.gradients.length ? `; gradient overlays (${ex.gradients[0].value.slice(0, 80)}…)` : ""}`,
    aspectRatios: ratios.slice(0, 6),
  };

  // Navigation & pages -----------------------------------------------------------
  const mobile = ex.responsive?.mobile;
  const navigation = {
    desktop: `${h.position === "fixed" || h.position === "sticky" ? h.position + " " : ""}top bar with ${h.links.length} links${h.logo ? ", logo linking home" : ""}`,
    mobile: mobile ? (mobile.hamburger ? "Links collapse into a hamburger-triggered menu" : `${mobile.headerLinksVisible} header links remain visible`) : "not measured",
    items: h.links.map((l) => l.text).filter(Boolean).slice(0, 12),
  };
  const purposeOf = (p: string) =>
    p === "/" ? "Home" : /about|story|maison|company|who/i.test(p) ? "About / brand story" : /journal|blog|news|stories|press/i.test(p) ? "Editorial / journal" : /product|item|p\//i.test(p) ? "Product detail" : /collection|shop|category|catalog/i.test(p) ? "Collection / listing" : /contact/i.test(p) ? "Contact" : "Content page";
  const pageList = pages.map((p) => ({
    path: p.path,
    title: p.title,
    purpose: purposeOf(p.path),
    sections: p.sections.map((s) => `${s.kind}${s.columns > 1 ? ` (${s.columns} cols)` : ""}${s.headings[0] ? `: “${s.headings[0].slice(0, 50)}”` : ""}`),
  }));

  // Responsive ---------------------------------------------------------------------
  const responsive: string[] = [];
  const dH1 = pickStyle(typo, "h1");
  const mH1 = mobile?.typography.find((t) => t.role === "h1");
  if (dH1 && mH1) responsive.push(`H1 scales from ${dH1.fontSize}px (desktop) to ${mH1.fontSize}px (mobile)`);
  if (mobile) {
    if (mobile.hamburger && !ex.navigation.hamburger) responsive.push("Navigation collapses into a hamburger menu on mobile");
    ex.sections.forEach((s, i) => {
      const m = mobile.sections[i];
      if (m && s.columns > 1 && m.columns < s.columns) responsive.push(`${s.kind} section ${i + 1}: ${s.columns} columns → ${m.columns} on mobile`);
    });
    responsive.push(`Mobile page is ${(mobile.documentHeight / Math.max(1, ex.documentHeight)).toFixed(1)}× the desktop height`);
  }
  const tablet = ex.responsive?.tablet;
  if (tablet) {
    ex.sections.forEach((s, i) => {
      const t = tablet.sections[i];
      if (t && s.columns > 2 && t.columns < s.columns) responsive.push(`${s.kind} section ${i + 1}: ${s.columns} columns → ${t.columns} on tablet`);
    });
  }

  // Personality --------------------------------------------------------------------
  const personality = new Set<string>();
  const displayFam = displayStyle ? displayStyle.fontFamily : "";
  if (genericOf(displayFam) === "serif") personality.add("editorial serif display");
  if (typo.some((t) => t.textTransform === "uppercase" && parseFloat(t.letterSpacing) > 1)) personality.add("tracked uppercase labels");
  if (displayStyle && displayStyle.fontSize >= 80) personality.add("oversized headlines");
  if (parseInt(spacing.sectionPaddingY) >= 100) personality.add("generous whitespace");
  if (bgs[0] && luminance(bgs[0].hex) < 0.2) personality.add("dark, dramatic");
  else if (bgs[0] && luminance(bgs[0].hex) > 0.85 && bgs[0].hex !== "#ffffff") personality.add("warm off-white canvas");
  if (fullBleed >= 2) personality.add("full-bleed photography");
  if (a.scrollReveals.length) personality.add("scroll-choreographed");
  if (!ex.radii.length || ex.radii.every((r) => r.value === "0px")) personality.add("square, architectural corners");

  const summary = [
    `**${ex.title || home.path}** — measured from ${pages.length} page(s).`,
    `Palette led by ${colors.slice(0, 3).map((c) => `\`${c.hex}\``).join(", ")}.`,
    typography.length ? `Typography: ${typography.map((t) => `${t.family} (${t.role})`).join(" with ")}.` : "",
    `Home page sections: ${ex.sections.map((s) => s.kind).join(" → ")}.`,
    motion.length ? `Motion: ${[...new Set(motion.map((m) => m.name.split(" ·")[0]))].join(", ")}.` : "No significant motion detected.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    source: "heuristic",
    summary,
    personality: [...personality].slice(0, 6),
    colors,
    typography,
    typeScale,
    spacing,
    radii,
    shadows,
    components,
    layoutPatterns: ex.sections.map((s) => `${s.kind}${s.fullBleed ? " (full-bleed)" : ""}${s.columns > 1 ? `, ${s.columns} columns` : ""}, ${s.height}px tall, bg ${s.background}`),
    motion,
    imagery,
    navigation,
    pages: pageList,
    responsive,
  };
}

// ---------------------------------------------------------------------------------------
// Merging without AI: role-weighted selection between references.
// ---------------------------------------------------------------------------------------
type RefDesign = { roles: ReferenceRole[]; design: DesignSystem; label: string };

export function mergeDesigns(refs: RefDesign[]): DesignSystem {
  const pick = (roles: ReferenceRole[]) => refs.find((r) => r.roles.some((x) => roles.includes(x)))?.design ?? refs[0].design;
  const colors = pick(["colors", "identity", "full"]);
  const type = pick(["typography", "identity", "full"]);
  const layout = pick(["layout", "full"]);
  const nav = pick(["navigation", "full"]);
  const motion = pick(["animations", "full"]);
  const media = pick(["photography", "identity", "full"]);
  const comps = pick(["components", "full", "identity"]);
  return {
    source: "heuristic",
    summary:
      refs.length > 1
        ? refs.map((r) => `**${r.label.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}** → ${r.roles.join(", ")}`).join(" · ") + ". " + colors.summary
        : colors.summary,
    personality: [...new Set(refs.flatMap((r) => r.design.personality))].slice(0, 6),
    colors: colors.colors,
    typography: type.typography,
    typeScale: type.typeScale,
    spacing: layout.spacing,
    radii: comps.radii,
    shadows: comps.shadows,
    components: comps.components,
    layoutPatterns: layout.layoutPatterns,
    motion: motion.motion,
    imagery: media.imagery,
    navigation: nav.navigation,
    pages: nav.pages,
    responsive: layout.responsive,
  };
}

// ---------------------------------------------------------------------------------------
// Claude synthesis
// ---------------------------------------------------------------------------------------
const DesignSchema = z.object({
  summary: z.string().describe("Markdown design brief, 120-250 words: what makes the target design distinctive and how the references combine."),
  personality: z.array(z.string()).describe("3-6 short art-direction keywords"),
  colors: z.array(z.object({ name: z.string(), hex: z.string().describe("#rrggbb"), role: z.string() })),
  typography: z.array(
    z.object({
      family: z.string().describe("Exact family measured on the reference"),
      role: z.string(),
      weights: z.array(z.string()),
      source: z.string().describe("Where to load it: Google Fonts, self-hosted from the reference, or licensed"),
      fallback: z.string().describe("Closest freely available alternative (Google Fonts) + CSS generic fallback"),
      notes: z.string(),
    }),
  ),
  typeScale: z.array(z.object({ token: z.string(), size: z.string(), lineHeight: z.string(), weight: z.string(), letterSpacing: z.string(), transform: z.string() })),
  spacing: z.object({ containerMaxWidth: z.string(), sectionPaddingY: z.string(), gutter: z.string(), notes: z.string() }),
  radii: z.array(z.string()),
  shadows: z.array(z.string()),
  components: z.array(z.object({ name: z.string(), description: z.string().describe("Precise enough to implement: sizes, colors, states") })),
  layoutPatterns: z.array(z.string()),
  motion: z.array(z.object({ name: z.string(), description: z.string(), implementation: z.string().describe("How to build it in vanilla CSS/JS") })),
  imagery: z.object({ style: z.string(), treatment: z.string(), aspectRatios: z.array(z.string()) }),
  navigation: z.object({ desktop: z.string(), mobile: z.string(), items: z.array(z.string()) }),
  pages: z
    .array(z.object({ path: z.string().describe("URL path of the page to build, e.g. / or /about"), title: z.string(), purpose: z.string(), sections: z.array(z.string()) }))
    .describe("The page map of the site to generate"),
  responsive: z.array(z.string()),
});

function condenseExtraction(ex: PageExtraction) {
  return {
    title: ex.title,
    description: ex.description,
    documentHeight: ex.documentHeight,
    colors: { background: ex.colors.background.slice(0, 6), text: ex.colors.text.slice(0, 4), accent: ex.colors.accent.slice(0, 3), border: ex.colors.border.slice(0, 2) },
    gradients: ex.gradients.slice(0, 3),
    typography: ex.typography.slice(0, 18).map(({ sample, ...t }) => ({ ...t, sample: sample.slice(0, 40) })),
    fonts: { families: ex.fonts.families, faces: ex.fonts.faces.slice(0, 12), stylesheets: ex.fonts.stylesheets.filter((s) => /font/i.test(s)).slice(0, 5) },
    spacing: ex.spacing,
    radii: ex.radii.slice(0, 5),
    shadows: ex.shadows.slice(0, 3),
    buttons: ex.buttons.slice(0, 5),
    navigation: {
      header: { ...ex.navigation.header, links: ex.navigation.header.links.slice(0, 14).map((l) => l.text) },
      footerColumns: ex.navigation.footer.columns,
      footerLinks: ex.navigation.footer.links.slice(0, 20).map((l) => l.text),
      hamburger: ex.navigation.hamburger,
    },
    sections: ex.sections.map(({ cropKey, selector, ...s }) => {
      void cropKey; void selector;
      return s;
    }),
    images: ex.images.slice(0, 24).map((i) => ({ alt: i.alt, w: i.renderedWidth, h: i.renderedHeight, fit: i.objectFit, section: i.section })),
    videos: ex.videos.slice(0, 4),
    animations: { ...ex.animations, transitions: ex.animations.transitions.slice(0, 6), cssAnimations: ex.animations.cssAnimations.slice(0, 8) },
    tech: ex.tech,
    responsive: ex.responsive,
  };
}

async function imageBlock(key: string, opts: { width?: number; maxSlices?: number } = {}): Promise<Anthropic.Beta.BetaImageBlockParam[]> {
  const buf = await storage().get(key);
  if (!buf) return [];
  const slices = await sliceForVision(buf, { width: opts.width ?? 1000, maxSlices: opts.maxSlices ?? 2 });
  return slices.map((s) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: s.data.toString("base64") } }));
}

const roleText = (roles: ReferenceRole[]) => roles.map((r) => REFERENCE_ROLES.find((x) => x.id === r)?.label ?? r).join(", ");

export async function synthesizeProjectDesign(projectId: string, log: (m: string) => Promise<void>): Promise<DesignSystem> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const refs = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId)).orderBy(asc(schema.referenceSites.position));
  const usable = refs.filter((r) => r.status === "done");

  // Deterministic designs per URL reference.
  const refDesigns: RefDesign[] = [];
  for (const r of usable) {
    if (r.kind !== "url") continue;
    const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.referenceId, r.id)).orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
    const inputs = pages.filter((p) => p.extraction).map((p) => ({ path: p.path, title: p.title ?? "", extraction: p.extraction!, sections: p.sections }));
    if (!inputs.length) continue;
    const d = heuristicDesign(inputs);
    await db.update(schema.referenceSites).set({ design: d }).where(eq(schema.referenceSites.id, r.id));
    refDesigns.push({ roles: r.roles, design: d, label: r.url ?? "reference" });
  }

  if (!env.anthropicConfigured) {
    await log("Claude is not configured — using the measured design system without AI synthesis.");
    if (refDesigns.length) return mergeDesigns(refDesigns);
    return emptyDesign(project.brief);
  }

  // Build a multimodal brief for Claude.
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  content.push({
    type: "text",
    text: `# Project\nName: ${project.name}\nMode: ${project.mode}\nUser brief: ${project.brief || "(none)"}\n\nYou will receive ${usable.length} reference(s). Each one has a role assigned by the user that says which aspects of it the new website should take.`,
  });
  let refIndex = 0;
  for (const r of usable) {
    refIndex++;
    if (r.kind === "image") {
      content.push({ type: "text", text: `\n## Reference ${refIndex}: uploaded screenshot — roles: ${roleText(r.roles)}${r.notes ? `\nUser notes: ${r.notes}` : ""}\nMeasured palette: ${JSON.stringify(r.analysis?.palette ?? [])}` });
      if (r.storageKey) {
        const buf = await storage().get(r.storageKey);
        if (buf) {
          const img = await sharp(buf).resize({ width: 1400, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
          content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } });
        }
      }
      continue;
    }
    const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.referenceId, r.id)).orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
    const home = pages.find((p) => p.path === "/") ?? pages[0];
    content.push({
      type: "text",
      text: `\n## Reference ${refIndex}: ${r.url} — roles: ${roleText(r.roles)}${r.notes ? `\nUser notes: ${r.notes}` : ""}\nPages captured: ${pages.map((p) => p.path).join(", ")}\n\n### Measured data for ${home.path} (desktop 1440px)\n\`\`\`json\n${JSON.stringify(condenseExtraction(home.extraction!)).slice(0, 60_000)}\n\`\`\`\n### Other pages (sections)\n${pages
        .filter((p) => p.id !== home.id)
        .map((p) => `- ${p.path} “${p.title}”: ${p.sections.map((s) => `${s.kind}${s.columns > 1 ? `(${s.columns}col)` : ""}${s.headings[0] ? ` “${s.headings[0].slice(0, 40)}”` : ""}`).join(" → ")}`)
        .join("\n")}\n\nScreenshots follow: desktop home (top of page), then mobile.`,
    });
    if (home.screenshots.desktop) content.push(...(await imageBlock(home.screenshots.desktop.key, { width: 1000, maxSlices: 3 })));
    if (home.screenshots.mobile) content.push(...(await imageBlock(home.screenshots.mobile.key, { width: 390, maxSlices: 2 })));
    if (home.screenshots.mobileMenu) content.push({ type: "text", text: "Mobile menu (opened):" }, ...(await imageBlock(home.screenshots.mobileMenu.key, { width: 390, maxSlices: 1 })));
    for (const p of pages.filter((p) => p.id !== home.id).slice(0, 2)) {
      if (p.screenshots.desktop) content.push({ type: "text", text: `Desktop ${p.path}:` }, ...(await imageBlock(p.screenshots.desktop.key, { width: 800, maxSlices: 1 })));
    }
  }
  content.push({
    type: "text",
    text: `\n# Task\nWrite the design system for the website Tessera will now build. Follow the roles strictly: take each aspect only from the references assigned to it (a "Full recreation" reference supplies every aspect). Keep measured values exact — hex colors, px sizes, line-heights, letter-spacing, durations and easings come from the measurements above, not from guesses. When a measured font is commercial or not loadable, keep its name in "family", and give the closest Google Fonts alternative in "fallback". The page map must list every page to build${usable.some((r) => r.roles.includes("full")) ? ", mirroring the reference's URL paths" : ""}; describe each page's sections in order. Motion entries must say how to implement them in vanilla CSS/JS.`,
  });

  await log("Claude is synthesising the design system from measurements and screenshots…");
  const client = anthropic();
  const res = await client.beta.messages.parse({
    model: env.claudeModel,
    max_tokens: 32000,
    betas: [...SYNTHESIS_BETAS],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(DesignSchema) },
    system:
      "You are the design lead of a website studio: a senior creative director and design-systems engineer. You read measured CSS data and screenshots of reference websites and distil them into a precise, implementable design system. You never invent values that contradict the measurements.",
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error(describeRefusal(res.stop_details));
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("Claude returned a design system that did not match the schema.");
  await log(`Design system synthesised (${res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0)} input / ${res.usage.output_tokens} output tokens).`);
  return { source: "ai", ...parsed };
}

export function emptyDesign(brief: string): DesignSystem {
  return {
    source: "heuristic",
    summary: brief ? `No references analysed. Design will follow the brief: ${brief}` : "No references analysed yet.",
    personality: [],
    colors: [],
    typography: [],
    typeScale: [],
    spacing: { containerMaxWidth: "", sectionPaddingY: "", gutter: "", notes: "" },
    radii: [],
    shadows: [],
    components: [],
    layoutPatterns: [],
    motion: [],
    imagery: { style: "", treatment: "", aspectRatios: [] },
    navigation: { desktop: "", mobile: "", items: [] },
    pages: [],
    responsive: [],
  };
}
