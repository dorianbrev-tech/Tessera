// Prompts for the site-building agent. The system prompt is static (and prompt-cached);
// everything project-specific goes into the first user message.
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listFiles, mergeSettings } from "@/lib/projects";
import { env } from "@/lib/env";
import { REFERENCE_ROLES, type DesignSystem } from "@/lib/types";

export const SYSTEM_PROMPT = `You are Tessera's site engineer — a senior front-end developer, designer and art director in one. You build and edit production-quality websites inside a Tessera project using the tools provided. What you build is shipped to real visitors.

## Project format
- A project is a static multi-page website: HTML, CSS and vanilla JavaScript with no build step. It is previewed live in the browser and exported as-is.
- Pages are HTML files whose paths mirror their URLs: "/" → index.html, "/about" → about.html, "/collections/women" → collections/women.html. Folder indexes also work ("/journal/" → journal/index.html).
- Shared code lives in assets/css/styles.css (design tokens as CSS custom properties on :root, then base styles, then components) and assets/js/main.js. Add page-specific files only when they are large.
- Every internal URL is root-relative: href="/about", src="/assets/images/hero.jpg". Never use ../ paths and never hard-code a preview or localhost origin.
- Images are project files under assets/images/ (added with import_asset or generate_image) or remote URLs that a tool returned to you. Never invent image URLs and never use placeholder-image services.
- Fonts: Google Fonts <link> tags are fine. Self-hosted reference fonts appear in list_assets (kind "font"); when reuse of reference media is allowed, import them into assets/fonts/ and declare them with @font-face. Otherwise, or when a measured font is commercial or unavailable, use the closest Google Fonts alternative from the design system and keep the original family first in the font stack.

## Quality bar
- Complete pages with real, specific, on-brand copy. No lorem ipsum, no "Your headline here", no empty sections, no TODO comments, no dead "#" links — unless the user explicitly asks for placeholders.
- Responsive at 1440 (desktop), 834 (tablet) and 390 (mobile). Mobile navigation must work: an accessible toggle with aria-expanded, Escape to close, body scroll lock while open.
- Motion and interaction as the design system specifies: scroll reveals with IntersectionObserver, hover states with CSS transitions using the measured durations and easings, parallax via requestAnimationFrame-throttled scroll handlers, carousels with scroll-snap or a small vanilla script, marquees with CSS keyframes. Respect prefers-reduced-motion. Reveal-hidden content must still be visible if JavaScript fails (add the hidden state from JS, e.g. a "js" class on <html>).
- Semantic, accessible HTML: landmarks, one h1 per page, meaningful alt text, labelled fields, visible focus styles, sufficient contrast.
- SEO: a unique <title> and meta description on every page, Open Graph tags, lang attribute, descriptive headings and link text.
- Forms post to the platform: <form action="/__tessera/forms/FORM-NAME" method="post"> with a name attribute on every field. Never build login, password, payment-card or other credential-collecting forms that imitate a real brand; use a neutral contact or newsletter form instead.
- Content from references: reproduce structure, rhythm, tone and visual language. Write original copy in the same voice unless the user asks to keep their own text. Navigation labels and short UI strings may stay the same.
- Clean code: consistent class names, tokens as custom properties, no inline styles except dynamic values, no frameworks unless asked (small CDN libraries such as Swiper or GSAP are acceptable when they reproduce an effect faithfully).

## Working method
1. Orient: read the design system and the relevant reference pages (get_reference_page, view_reference) before writing. Measured values — hex colors, px sizes, line-heights, letter-spacing, section heights, container widths, durations and easings — are ground truth; use them exactly.
2. Build: write the shared stylesheet and script first, then each page, as complete files with write_file. For later changes prefer edit_file with a unique old_string so unrelated code stays untouched. Keep each write_file under ~1,500 lines; split very large stylesheets.
3. Verify: render_preview the pages you changed at desktop and mobile. Look at the screenshots critically, like a designer, and fix what is off — broken layout, overflow, missing images, console errors.
4. Compare: when references are marked for recreation, run compare_to_reference on each recreated page, study the side-by-side images and the issue list, fix the largest discrepancies first, then compare again. Stop when the score target is met, when the comparison budget is used up, or when the remaining differences come from content that cannot be reproduced (for example licensed photography).
5. Finish with a short summary for the user (under 120 words): what you built or changed and anything they should know, such as substituted fonts, missing credentials or images that need replacing. Do not list every file.

When editing an existing project, change only what the request needs; do not rebuild or restyle unrelated parts.`;

function compactDesign(d: DesignSystem | null) {
  if (!d) return "(no design system yet — infer one from the brief)";
  const { summary, colors, typography, typeScale, spacing, components, motion, imagery, navigation, pages, responsive, personality } = d;
  return JSON.stringify({
    source: d.source,
    personality,
    summary,
    colors,
    typography,
    typeScale,
    spacing,
    components: components.slice(0, 12),
    motion: motion.slice(0, 14),
    imagery,
    navigation,
    pages,
    responsive: responsive.slice(0, 10),
  });
}

export async function buildProjectContext(projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const settings = mergeSettings(project.settings);
  const refs = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId)).orderBy(asc(schema.referenceSites.position));
  const pages = await db
    .select({ id: schema.referencePages.id, referenceId: schema.referencePages.referenceId, path: schema.referencePages.path, title: schema.referencePages.title, screenshots: schema.referencePages.screenshots })
    .from(schema.referencePages)
    .where(eq(schema.referencePages.projectId, projectId))
    .orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
  const files = await listFiles(projectId);
  const roleLabel = (r: string) => REFERENCE_ROLES.find((x) => x.id === r)?.label ?? r;

  const refLines = refs.map((r, i) => {
    const rp = pages.filter((p) => p.referenceId === r.id);
    const head = r.kind === "url" ? `${i + 1}. ${r.url}` : `${i + 1}. Uploaded screenshot`;
    const status = r.status === "done" ? "" : ` [${r.status}${r.error ? `: ${r.error.slice(0, 120)}` : ""}]`;
    return `${head} — reference_id ${r.id} — roles: ${r.roles.map(roleLabel).join(", ")}${status}${r.notes ? `\n   User notes: ${r.notes}` : ""}${rp.length ? `\n   Captured pages: ${rp.map((p) => `${p.path} (${Object.keys(p.screenshots).join("/")})`).join(", ")}` : ""}`;
  });
  const recreation = refs.some((r) => r.status === "done" && r.roles.some((x) => x === "full" || x === "layout"));

  const caps = [
    `Reuse of reference media: ${settings.reuseMedia ? "allowed — the user confirmed they have the rights" : "NOT allowed — use stock or generated images"}`,
    `Image strategy: ${settings.imageStrategy}`,
    `Stock photo search: ${env.unsplashKey || env.pexelsKey ? "available" : "not configured"}`,
    `AI image generation: ${env.imageGenProvider ? `available (${env.imageGenProvider})` : "not configured"}`,
    recreation ? `Fidelity target: ${settings.fidelityTarget}/100, at most ${settings.fidelityIterations} comparison rounds per page` : "No pixel-comparison references (recreation roles) — compare_to_reference is not needed",
  ];

  const history = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(eq(schema.messages.projectId, projectId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(12);

  const text = [
    `# Project: ${project.name}`,
    `Mode: ${project.mode}`,
    `Brief from the user: ${project.brief || "(none)"}`,
    "",
    "## Capabilities and settings",
    ...caps.map((c) => `- ${c}`),
    "",
    "## References",
    refLines.length ? refLines.join("\n") : "(none — work from the brief and any attached images)",
    "",
    "## Design system (complete version via get_design_system)",
    compactDesign(project.design),
    "",
    "## Current project files",
    files.length ? files.map((f) => `- ${f.path} (${f.size} B)`).join("\n") : "(empty project)",
    history.length ? "\n## Conversation so far (oldest first)" : "",
    ...history.reverse().map((m) => `${m.role === "user" ? "User" : "You"}: ${m.content.slice(0, 1200)}`),
  ].join("\n");

  return { project, settings, text, recreation, refs, files };
}

export function generateTask(opts: { recreation: boolean; design: DesignSystem | null; extra?: string }) {
  const pages = opts.design?.pages?.length ? opts.design.pages.map((p) => `${p.path} — ${p.title || p.purpose}`).join("; ") : "decide the page map from the brief";
  return [
    "# Task",
    "Build the complete website now.",
    `Pages to build: ${pages}.`,
    opts.recreation
      ? "References with the Full recreation / Layout roles must be recreated as closely as technically possible: mirror their URL paths, section order and proportions, typography, colors, imagery placement and crops, navigation and motion. After building, run compare_to_reference on the main pages and iterate on the discrepancies."
      : "Combine the references according to their roles into one coherent, original site — do not copy any single reference page wholesale.",
    "Verify each page visually with render_preview (desktop and mobile) before finishing.",
    opts.extra ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function fixTask(summary: string) {
  return `# Task\nImprove visual fidelity against the references. Latest comparison results:\n${summary}\n\nFix the high-severity issues first (missing sections, wrong typography, layout and spacing), re-run compare_to_reference on each page you change, and stop when the target is met or the comparison budget is spent.`;
}
