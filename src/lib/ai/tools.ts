// Tools the site-building agent can call. Every input is validated with zod before it
// runs (eager input streaming means the API does not validate for us), and every path
// is normalised to stay inside the project.
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import sharp, { type OverlayOptions } from "sharp";
import { db, schema } from "@/lib/db";
import { storage, sha256 } from "@/lib/storage";
import { extFromMime, mimeFromPath } from "@/lib/mime";
import { deleteFile, listFiles, normalizePath, readFileRow, writeBinaryFile, writeTextFile } from "@/lib/projects";
import { sliceForVision } from "@/lib/image-utils";
import { safeFetch } from "@/lib/analysis/net";
import { renderProjectPage, PageNotFoundError } from "@/lib/fidelity/render";
import { comparisonTargets, comparePage } from "@/lib/fidelity/run";
import { generateImage, ProviderNotConfiguredError, registerStockDownload, searchStock, type AspectRatio } from "@/lib/media/providers";
import type { JobContext } from "@/lib/job-context";
import type { ProjectSettings, Viewport } from "@/lib/types";

type ToolResultContent = Anthropic.Beta.BetaToolResultBlockParam["content"];

export interface ToolState {
  projectId: string;
  jobId: string;
  ctx: JobContext;
  settings: ProjectSettings;
  compareRounds: Map<string, number>;
  changedFiles: Set<string>;
  fidelity: { path: string; viewport: string; score: number; reportId?: string }[];
}

export class ToolError extends Error {}

const viewportEnum = z.enum(["desktop", "tablet", "mobile"]);

const schemas = {
  list_files: z.object({}),
  read_file: z.object({ path: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  write_file: z.object({ path: z.string().min(1), content: z.string() }),
  edit_file: z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional() }),
  delete_file: z.object({ path: z.string().min(1) }),
  get_design_system: z.object({}),
  get_reference_page: z.object({ reference_id: z.string().optional(), path: z.string().min(1) }),
  view_reference: z.object({
    reference_id: z.string().optional(),
    path: z.string().default("/"),
    viewport: z.union([viewportEnum, z.literal("mobile_menu")]).default("desktop"),
    section_index: z.number().int().min(0).optional(),
    y: z.number().int().min(0).optional(),
  }),
  list_assets: z.object({ query: z.string().optional(), kind: z.enum(["image", "video", "background", "font", "any"]).optional(), page: z.string().optional() }),
  import_asset: z.object({ asset_id: z.string(), path: z.string().min(1) }),
  search_stock_photos: z.object({ query: z.string().min(2), orientation: z.enum(["landscape", "portrait", "squarish", "any"]).optional() }),
  generate_image: z.object({ prompt: z.string().min(10), aspect_ratio: z.enum(["1:1", "3:2", "2:3", "4:5", "16:9", "9:16", "21:9"]), path: z.string().min(1) }),
  render_preview: z.object({ path: z.string().default("/"), viewport: viewportEnum.default("desktop"), y: z.number().int().min(0).optional() }),
  compare_to_reference: z.object({ path: z.string().default("/"), viewport: viewportEnum.default("desktop") }),
} as const;

export type ToolName = keyof typeof schemas;

const def = (name: ToolName, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: { type: "object", properties, required },
  eager_input_streaming: true,
});

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  def("list_files", "List every file in the project with its size.", {}),
  def("read_file", "Read a text file from the project. Optionally a 1-based inclusive line range for large files.", {
    path: { type: "string", description: "Project-relative path, e.g. index.html or assets/css/styles.css" },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
  }, ["path"]),
  def("write_file", "Create or overwrite a text file (HTML, CSS, JS, JSON, SVG...) with complete contents.", {
    path: { type: "string", description: "Project-relative path" },
    content: { type: "string", description: "The full file contents" },
  }, ["path", "content"]),
  def("edit_file", "Replace an exact, unique substring of a file. Include enough surrounding context in old_string to make it unique, or set replace_all.", {
    path: { type: "string" },
    old_string: { type: "string" },
    new_string: { type: "string" },
    replace_all: { type: "boolean" },
  }, ["path", "old_string", "new_string"]),
  def("delete_file", "Delete a file from the project.", { path: { type: "string" } }, ["path"]),
  def("get_design_system", "Return the full synthesised design system plus the user's brief and reference roles.", {}),
  def("get_reference_page", "Return the measured data of one captured reference page: section geometry, backgrounds, headings and excerpts, typography styles, buttons, navigation, images (with asset ids), motion and responsive behaviour.", {
    reference_id: { type: "string", description: "Optional when the project has a single URL reference" },
    path: { type: "string", description: "URL path of the captured page, e.g. / or /about" },
  }, ["path"]),
  def("view_reference", "Look at a reference screenshot. Give section_index for a crop of one section, or y (px from the top) to view the page from that point; otherwise the top of the page is shown.", {
    reference_id: { type: "string" },
    path: { type: "string" },
    viewport: { type: "string", enum: ["desktop", "tablet", "mobile", "mobile_menu"] },
    section_index: { type: "integer" },
    y: { type: "integer" },
  }, ["path"]),
  def("list_assets", "List media in the project library: images, videos and self-hosted font files found on the references (with their page/section and rendered size), plus stock and generated images.", {
    query: { type: "string", description: "Filter by alt text, font family or URL" },
    kind: { type: "string", enum: ["image", "video", "background", "font", "any"] },
    page: { type: "string", description: "Only assets found on this reference page path" },
  }),
  def("import_asset", "Copy a media-library asset (image or font file) into the project, e.g. assets/images/hero.jpg or assets/fonts/display.woff2, so the site is self-contained. Returns the root-relative URL to use.", {
    asset_id: { type: "string" },
    path: { type: "string", description: "Destination path inside the project, with extension" },
  }, ["asset_id", "path"]),
  def("search_stock_photos", "Search licensed stock photography (Unsplash/Pexels). Results are added to the media library; use import_asset to place one.", {
    query: { type: "string" },
    orientation: { type: "string", enum: ["landscape", "portrait", "squarish", "any"] },
  }, ["query"]),
  def("generate_image", "Generate an original image with AI and save it into the project at path. Write a detailed art-directed prompt (subject, composition, lighting, lens, palette, mood).", {
    prompt: { type: "string" },
    aspect_ratio: { type: "string", enum: ["1:1", "3:2", "2:3", "4:5", "16:9", "9:16", "21:9"] },
    path: { type: "string", description: "Destination, e.g. assets/images/hero.jpg" },
  }, ["prompt", "aspect_ratio", "path"]),
  def("render_preview", "Render a page of the project in a real browser and return screenshots, console errors and missing files. Use it to check your work.", {
    path: { type: "string", description: "URL path, e.g. / or /about" },
    viewport: { type: "string", enum: ["desktop", "tablet", "mobile"] },
    y: { type: "integer", description: "Start the screenshots at this vertical offset (px)" },
  }),
  def("compare_to_reference", "Compare a generated page with its reference (same URL path) and return a fidelity score, specific issues and side-by-side images (reference left, generated right).", {
    path: { type: "string" },
    viewport: { type: "string", enum: ["desktop", "tablet", "mobile"] },
  }),
];

const img = (data: Buffer): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } });
const text = (t: string): Anthropic.Beta.BetaTextBlockParam => ({ type: "text", text: t });

async function resolveReference(projectId: string, referenceId?: string) {
  const refs = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId)).orderBy(asc(schema.referenceSites.position));
  if (referenceId) {
    const r = refs.find((x) => x.id === referenceId);
    if (!r) throw new ToolError(`Unknown reference_id ${referenceId}. Known: ${refs.map((x) => x.id).join(", ")}`);
    return r;
  }
  const urlRefs = refs.filter((r) => r.kind === "url" && r.status === "done");
  if (urlRefs.length === 1) return urlRefs[0];
  if (!urlRefs.length) {
    const imgRef = refs.find((r) => r.kind === "image");
    if (imgRef) return imgRef;
    throw new ToolError("This project has no analysed references.");
  }
  throw new ToolError(`Several references exist; pass reference_id (${urlRefs.map((r) => `${r.id} = ${r.url}`).join("; ")}).`);
}

async function findPage(referenceId: string, path: string) {
  const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.referenceId, referenceId));
  const norm = (p: string) => (p.replace(/\/+$/, "") || "/").toLowerCase();
  const page = pages.find((p) => norm(p.path) === norm(path));
  if (!page) throw new ToolError(`No captured page at ${path}. Captured: ${pages.map((p) => p.path).join(", ")}`);
  return page;
}

const targetKey = (path: string, viewport: string) => `${path}@${viewport}`;

export async function executeTool(name: string, rawInput: unknown, state: ToolState): Promise<{ content: ToolResultContent; summary: string; isError?: boolean }> {
  const schema_ = schemas[name as ToolName];
  if (!schema_) return { content: `Unknown tool ${name}`, summary: `unknown tool ${name}`, isError: true };
  const parsed = schema_.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(rawInput).slice(0, 2000), error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }),
      summary: `invalid input for ${name}`,
      isError: true,
    };
  }
  const input = parsed.data as Record<string, unknown>;
  const { projectId } = state;

  try {
    switch (name as ToolName) {
      case "list_files": {
        const files = await listFiles(projectId);
        return { content: files.length ? files.map((f) => `${f.path}\t${f.size} B${f.binary ? " (binary)" : ""}`).join("\n") : "(no files yet)", summary: `${files.length} files` };
      }
      case "read_file": {
        const { path, start_line, end_line } = input as z.infer<typeof schemas.read_file>;
        const row = await readFileRow(projectId, path);
        if (!row) throw new ToolError(`File not found: ${path}`);
        if (row.content === null) return { content: `${row.path} is a binary file (${row.mime}, ${row.size} bytes).`, summary: `read ${row.path}` };
        let content = row.content;
        if (start_line || end_line) {
          const lines = content.split("\n");
          content = lines.slice((start_line ?? 1) - 1, end_line ?? lines.length).join("\n");
        }
        if (content.length > 120_000) content = content.slice(0, 120_000) + `\n… [truncated: file has ${row.content.length} characters; read a line range]`;
        return { content, summary: `read ${row.path}` };
      }
      case "write_file": {
        const { path, content } = input as z.infer<typeof schemas.write_file>;
        const res = await writeTextFile(projectId, path, content);
        state.changedFiles.add(res.path);
        await state.ctx.emit("file", { action: "write", path: res.path, size: res.size });
        return { content: `Wrote ${res.path} (${res.size} bytes, ${content.split("\n").length} lines).`, summary: `wrote ${res.path}` };
      }
      case "edit_file": {
        const { path, old_string, new_string, replace_all } = input as z.infer<typeof schemas.edit_file>;
        const row = await readFileRow(projectId, path);
        if (!row || row.content === null) throw new ToolError(`Text file not found: ${path}`);
        const count = row.content.split(old_string).length - 1;
        if (count === 0) throw new ToolError(`old_string was not found in ${row.path}. Read the file again and copy the exact text.`);
        if (count > 1 && !replace_all) throw new ToolError(`old_string occurs ${count} times in ${row.path}; add surrounding context or set replace_all.`);
        const next = replace_all ? row.content.split(old_string).join(new_string) : row.content.replace(old_string, () => new_string);
        await writeTextFile(projectId, row.path, next, row.mime);
        state.changedFiles.add(row.path);
        await state.ctx.emit("file", { action: "edit", path: row.path });
        return { content: `Edited ${row.path} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? "s" : ""}).`, summary: `edited ${row.path}` };
      }
      case "delete_file": {
        const { path } = input as z.infer<typeof schemas.delete_file>;
        const ok = await deleteFile(projectId, path);
        if (!ok) throw new ToolError(`File not found: ${path}`);
        state.changedFiles.add(normalizePath(path));
        await state.ctx.emit("file", { action: "delete", path: normalizePath(path) });
        return { content: `Deleted ${path}.`, summary: `deleted ${path}` };
      }
      case "get_design_system": {
        const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
        const refs = await db.select({ id: schema.referenceSites.id, url: schema.referenceSites.url, kind: schema.referenceSites.kind, roles: schema.referenceSites.roles, notes: schema.referenceSites.notes, design: schema.referenceSites.design }).from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId));
        return {
          content: JSON.stringify({ brief: p.brief, design: p.design, references: refs.map((r) => ({ id: r.id, url: r.url, kind: r.kind, roles: r.roles, notes: r.notes, measuredDesign: r.design })) }).slice(0, 150_000),
          summary: "read design system",
        };
      }
      case "get_reference_page": {
        const { reference_id, path } = input as z.infer<typeof schemas.get_reference_page>;
        const ref = await resolveReference(projectId, reference_id);
        if (ref.kind !== "url") throw new ToolError("This reference is an uploaded screenshot; use view_reference to look at it.");
        const page = await findPage(ref.id, path);
        const ex = page.extraction!;
        const assets = await db.select({ id: schema.assets.id, url: schema.assets.url }).from(schema.assets).where(eq(schema.assets.referenceId, ref.id));
        const assetId = new Map(assets.map((a) => [a.url, a.id]));
        const data = {
          url: page.url,
          title: ex.title,
          description: ex.description,
          documentHeight: ex.documentHeight,
          sections: page.sections.map(({ cropKey, ...s }) => ({ ...s, hasCrop: Boolean(cropKey) })),
          typography: ex.typography.slice(0, 24),
          fonts: ex.fonts,
          colors: ex.colors,
          screenshotPalette: ex.screenshotPalette,
          gradients: ex.gradients,
          spacing: ex.spacing,
          radii: ex.radii,
          shadows: ex.shadows,
          borders: ex.borders,
          buttons: ex.buttons,
          navigation: ex.navigation,
          images: ex.images.slice(0, 60).map((i) => ({ asset_id: assetId.get(i.src) ?? null, src: i.src.slice(0, 200), alt: i.alt, section: i.section, rendered: `${i.renderedWidth}x${i.renderedHeight}`, top: i.top, objectFit: i.objectFit, objectPosition: i.objectPosition, kind: i.kind })),
          videos: ex.videos.map((v) => ({ ...v, asset_id: assetId.get(v.src) ?? null })),
          headings: ex.headings,
          paragraphs: ex.paragraphs.slice(0, 16),
          forms: ex.forms,
          animations: ex.animations,
          responsive: ex.responsive,
          tech: ex.tech,
          meta: ex.meta,
        };
        return { content: JSON.stringify(data).slice(0, 120_000), summary: `read reference ${page.path}` };
      }
      case "view_reference": {
        const { reference_id, path, viewport, section_index, y } = input as z.infer<typeof schemas.view_reference>;
        const ref = await resolveReference(projectId, reference_id);
        if (ref.kind === "image") {
          const buf = await storage().get(ref.storageKey!);
          if (!buf) throw new ToolError("Uploaded image missing");
          const slices = await sliceForVision(buf, { width: 1000, maxSlices: 3, startY: y ?? 0 });
          return { content: [text(`Uploaded reference screenshot${ref.notes ? ` — notes: ${ref.notes}` : ""}`), ...slices.map((s) => img(s.data))], summary: "viewed screenshot reference" };
        }
        const page = await findPage(ref.id, path);
        if (section_index !== undefined) {
          const s = page.sections.find((x) => x.index === section_index);
          if (!s?.cropKey) throw new ToolError(`No crop for section ${section_index}. Sections with crops: ${page.sections.filter((x) => x.cropKey).map((x) => x.index).join(", ")}`);
          const buf = await storage().get(s.cropKey);
          if (!buf) throw new ToolError("Section crop missing from storage");
          const slices = await sliceForVision(buf, { width: 1200, sliceHeight: 1500, maxSlices: 2 });
          return { content: [text(`${page.path} section ${s.index} (${s.kind}, ${s.height}px tall at y=${s.top}, bg ${s.background})`), ...slices.map((x) => img(x.data))], summary: `viewed ${page.path} section ${s.index}` };
        }
        const shot = viewport === "mobile_menu" ? page.screenshots.mobileMenu : page.screenshots[viewport];
        if (!shot) throw new ToolError(`No ${viewport} screenshot for ${page.path}. Available: ${Object.keys(page.screenshots).join(", ")}`);
        const buf = await storage().get(shot.key);
        if (!buf) throw new ToolError("Screenshot missing from storage");
        const isMobile = viewport === "mobile" || viewport === "mobile_menu";
        const slices = await sliceForVision(buf, { width: isMobile ? 390 : 1000, sliceHeight: isMobile ? 1100 : 1300, maxSlices: 3, startY: y ?? 0 });
        const coverEnd = slices.length ? slices[slices.length - 1].top + slices[slices.length - 1].height : 0;
        return {
          content: [text(`${page.path} at ${viewport} (${shot.width}×${shot.height}px). Showing y=${y ?? 0}–${coverEnd}${coverEnd < shot.height ? `; pass y=${coverEnd} to continue` : ""}.`), ...slices.map((s) => img(s.data))],
          summary: `viewed reference ${page.path} (${viewport})`,
        };
      }
      case "list_assets": {
        const { query, kind, page } = input as z.infer<typeof schemas.list_assets>;
        const conds = [eq(schema.assets.projectId, projectId)];
        if (kind && kind !== "any") conds.push(eq(schema.assets.kind, kind));
        if (query) conds.push(or(ilike(schema.assets.alt, `%${query}%`), ilike(schema.assets.url, `%${query}%`))!);
        let rows = await db.select().from(schema.assets).where(and(...conds)).limit(150);
        if (page) rows = rows.filter((r) => (r.meta as { page?: string }).page === page);
        if (!rows.length) return { content: "No matching assets.", summary: "no assets" };
        const lines = rows.slice(0, 80).map((r) => {
          const m = r.meta as Record<string, unknown>;
          return `${r.id}\t${r.source}/${r.kind}\t${r.width ?? "?"}x${r.height ?? "?"}\t${r.storageKey ? "downloaded" : "remote"}\t${m.page ? `page ${m.page} section ${m.section}` : ""}\t${r.alt ? `alt “${r.alt.slice(0, 80)}”` : ""}\t${(r.url ?? "").slice(0, 120)}`;
        });
        return { content: `id\tsource/kind\tsize\tstate\twhere\talt\turl\n${lines.join("\n")}`, summary: `${rows.length} assets` };
      }
      case "import_asset": {
        const { asset_id, path } = input as z.infer<typeof schemas.import_asset>;
        const [a] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, asset_id), eq(schema.assets.projectId, projectId)));
        if (!a) throw new ToolError(`Unknown asset ${asset_id}`);
        if (a.source === "reference" && !state.settings.reuseMedia) throw new ToolError("Reusing reference media is disabled for this project. Use search_stock_photos or generate_image instead.");
        if (a.kind === "video") {
          throw new ToolError(`Videos are not copied into projects. Reference the video by URL in a <video> element (${a.url}) only if the user has the rights to it, or use a poster image.`);
        }
        let data = a.storageKey ? await storage().get(a.storageKey) : null;
        let mime = a.mime ?? "image/jpeg";
        if (!data && a.url) {
          const res = await safeFetch(a.url, { maxBytes: 10_000_000, timeoutMs: 20_000 });
          if (res.status !== 200) throw new ToolError(`Could not download asset (HTTP ${res.status})`);
          data = res.body;
          mime = (res.headers.get("content-type") ?? mime).split(";")[0];
          const key = `projects/${projectId}/assets/${sha256(data).slice(0, 40)}.${extFromMime(mime)}`;
          await storage().put(key, data, mime);
          await db.update(schema.assets).set({ storageKey: key, mime }).where(eq(schema.assets.id, a.id));
        }
        if (!data) throw new ToolError("Asset has no data");
        let dest = normalizePath(path);
        if (a.kind === "font") {
          // Keep the original font format; never transcode.
          const ext = (new URL(a.url ?? "http://x/f.woff2").pathname.split(".").pop() ?? "woff2").toLowerCase();
          if (!/\.(woff2?|ttf|otf)$/i.test(dest)) dest = dest.replace(/\.[a-z0-9]{2,5}$/i, "") + "." + (["woff2", "woff", "ttf", "otf"].includes(ext) ? ext : "woff2");
          await writeBinaryFile(projectId, dest, data, mimeFromPath(dest));
          state.changedFiles.add(dest);
          await state.ctx.emit("file", { action: "write", path: dest });
          const m = a.meta as { family?: string; weight?: string; style?: string };
          return { content: `Imported font to ${dest}. Declare it with @font-face { font-family: "${m.family ?? "Font"}"; src: url("/${dest}") format("${dest.endsWith(".woff2") ? "woff2" : dest.endsWith(".woff") ? "woff" : dest.endsWith(".otf") ? "opentype" : "truetype"}"); font-weight: ${m.weight ?? 400}; font-style: ${m.style ?? "normal"}; font-display: swap; }.`, summary: `imported ${dest}` };
        }
        if (!/\.[a-z0-9]{2,5}$/i.test(dest)) dest += "." + extFromMime(mime);
        // Very large originals are resized for the web (keeps exports and previews fast).
        if (/^image\/(jpeg|png|webp)$/.test(mime) && data.length > 900_000) {
          data = await sharp(data).resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          mime = "image/jpeg";
          dest = dest.replace(/\.(png|webp)$/i, ".jpg");
        }
        await writeBinaryFile(projectId, dest, data, mime);
        state.changedFiles.add(dest);
        await state.ctx.emit("file", { action: "write", path: dest });
        if (a.source === "stock") await registerStockDownload((a.meta as { downloadTrigger?: string }).downloadTrigger);
        return { content: `Imported to ${dest}. Use src="/${dest}"${a.alt ? ` (original alt: “${a.alt}”)` : ""}.${a.license ? ` License: ${a.license}.` : ""}`, summary: `imported ${dest}` };
      }
      case "search_stock_photos": {
        const { query, orientation } = input as z.infer<typeof schemas.search_stock_photos>;
        const results = await searchStock(query, orientation ?? "any", 8);
        if (!results.length) return { content: `No stock results for “${query}”.`, summary: "no stock results" };
        const inserted = await db
          .insert(schema.assets)
          .values(results.map((r) => ({ projectId, source: "stock" as const, kind: "image" as const, url: r.url, width: r.width, height: r.height, alt: r.alt, license: `${r.license} — photo by ${r.author}`, meta: { provider: r.provider, providerId: r.id, author: r.author, authorUrl: r.authorUrl, thumb: r.thumb, downloadTrigger: r.downloadTrigger, query } })))
          .returning({ id: schema.assets.id });
        // Contact sheet so the model can choose visually.
        const thumbs = await Promise.all(
          results.map(async (r) => {
            try {
              const res = await fetch(r.thumb, { signal: AbortSignal.timeout(15_000) });
              return await sharp(Buffer.from(await res.arrayBuffer())).resize(300, 300, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
            } catch {
              return null;
            }
          }),
        );
        const tiles = thumbs.map((t, i) => (t ? { input: t, left: (i % 4) * 306, top: Math.floor(i / 4) * 306 } : null)).filter(Boolean) as OverlayOptions[];
        const sheet = tiles.length
          ? await sharp({ create: { width: 4 * 306, height: Math.ceil(results.length / 4) * 306, channels: 3, background: "#111" } }).composite(tiles).jpeg({ quality: 70 }).toBuffer()
          : null;
        const list = results.map((r, i) => `${i + 1}. asset_id ${inserted[i].id} — ${r.width}x${r.height} — “${r.alt.slice(0, 100)}” by ${r.author} (${r.provider})`).join("\n");
        return { content: sheet ? [text(`Results (contact sheet in the same order, left to right, top to bottom):\n${list}`), img(sheet)] : list, summary: `${results.length} stock photos for “${query}”` };
      }
      case "generate_image": {
        const { prompt, aspect_ratio, path } = input as z.infer<typeof schemas.generate_image>;
        await state.ctx.log(`Generating image: ${prompt.slice(0, 80)}…`);
        const out = await generateImage(prompt, aspect_ratio as AspectRatio);
        let data = out.data;
        let dest = normalizePath(path);
        data = await sharp(data).jpeg({ quality: 84 }).toBuffer();
        dest = dest.replace(/\.(png|webp)$/i, ".jpg");
        if (!/\.jpe?g$/i.test(dest)) dest += ".jpg";
        await writeBinaryFile(projectId, dest, data, "image/jpeg");
        const meta = await sharp(data).metadata();
        await db.insert(schema.assets).values({ projectId, source: "generated", kind: "image", storageKey: null, url: null, mime: "image/jpeg", width: meta.width, height: meta.height, alt: prompt.slice(0, 200), license: `Generated with ${out.provider} (${out.model})`, meta: { prompt, path: dest } });
        state.changedFiles.add(dest);
        await state.ctx.emit("file", { action: "write", path: dest });
        const preview = await sharp(data).resize({ width: 640 }).jpeg({ quality: 70 }).toBuffer();
        return { content: [text(`Generated ${meta.width}×${meta.height} image at ${dest}. Use src="/${dest}".`), img(preview)], summary: `generated ${dest}` };
      }
      case "render_preview": {
        const { path, viewport, y } = input as z.infer<typeof schemas.render_preview>;
        const urlPath = path.startsWith("/") ? path : "/" + path;
        const r = await renderProjectPage(projectId, urlPath, viewport as Viewport);
        const isMobile = viewport === "mobile";
        const slices = await sliceForVision(r.screenshot, { width: isMobile ? 390 : viewport === "tablet" ? 600 : 900, sliceHeight: isMobile ? 1100 : 1350, maxSlices: 3, startY: y ?? 0 });
        const key = `projects/${projectId}/renders/${Date.now()}-${viewport}.jpg`;
        await storage().put(key, r.screenshot, "image/jpeg");
        await state.ctx.emit("screenshot", { key, label: `Preview ${urlPath} · ${viewport}` });
        const end = slices.length ? slices[slices.length - 1].top + slices[slices.length - 1].height : 0;
        const notes = [
          `Rendered ${urlPath} at ${viewport}: page height ${r.extraction.documentHeight}px; showing y=${y ?? 0}–${end}${end < r.shotHeight ? ` (pass y=${end} to see more)` : ""}.`,
          `Sections: ${r.extraction.sections.map((s) => `${s.kind}${s.columns > 1 ? `(${s.columns}col)` : ""} ${s.height}px`).join(" → ")}`,
          r.consoleErrors.length ? `Console errors:\n- ${r.consoleErrors.join("\n- ")}` : "No console errors.",
          r.missingFiles.length ? `Missing files (404): ${r.missingFiles.join(", ")}` : "",
          r.failedRequests.length ? `Failed external requests: ${r.failedRequests.slice(0, 6).join("; ")}` : "",
          r.horizontalOverflow ? `Horizontal overflow: the page is ${r.scrollWidth}px wide at a ${r.extraction.width}px viewport — something is too wide.` : "",
        ].filter(Boolean);
        return { content: [text(notes.join("\n")), ...slices.map((s) => img(s.data))], summary: `rendered ${urlPath} (${viewport})` };
      }
      case "compare_to_reference": {
        const { path, viewport } = input as z.infer<typeof schemas.compare_to_reference>;
        const urlPath = path.startsWith("/") ? path : "/" + path;
        const norm = (p: string) => (p.replace(/\/+$/, "") || "/").toLowerCase();
        const targets = (await comparisonTargets(projectId, { viewports: [viewport as Viewport], maxPages: 20 })).filter((t) => norm(t.path) === norm(urlPath) || (t.referencePageId === null && urlPath === "/"));
        if (!targets.length) throw new ToolError(`No reference with a recreation role has a ${viewport} capture of ${urlPath}.`);
        const key = targetKey(urlPath, viewport);
        const rounds = (state.compareRounds.get(key) ?? 0) + 1;
        const budget = Math.max(1, state.settings.fidelityIterations + 1);
        if (rounds > budget) {
          return { content: `Comparison budget for ${key} is used up (${budget} rounds). Finish the remaining improvements by eye with render_preview.`, summary: `budget used for ${key}` };
        }
        state.compareRounds.set(key, rounds);
        const result = await comparePage(projectId, targets[0], { jobId: state.jobId, iteration: rounds });
        if (result.missing || !result.metrics) {
          return { content: result.issues.map((i) => i.message).join("\n"), summary: `missing page ${urlPath}`, isError: false };
        }
        state.fidelity.push({ path: urlPath, viewport, score: result.metrics.overall, reportId: result.reportId });
        await state.ctx.emit("fidelity", { reportId: result.reportId, path: urlPath, viewport, score: result.metrics.overall, round: rounds });
        const m = result.metrics;
        const target = state.settings.fidelityTarget;
        const summary = [
          `Fidelity ${urlPath} @ ${viewport} — round ${rounds}/${budget}: ${m.overall}/100 (target ${target}).`,
          `Breakdown: pixel ${m.pixel}, structure ${m.structural}, layout ${m.layout}, color ${m.color}, typography ${m.typography}, sections ${m.sections}, media ${m.media}; height ${m.generatedHeight}px vs ${m.referenceHeight}px.`,
          result.issues.length ? `Issues (most severe first):\n${result.issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}` : "No specific issues detected.",
          m.overall >= target ? "Target met for this page." : "",
        ].filter(Boolean).join("\n");
        const images = result.composites.flatMap((c) => [text(c.label), img(c.data)]);
        return { content: [text(summary), ...images], summary: `${urlPath}@${viewport}: ${m.overall}/100` };
      }
    }
  } catch (e) {
    if (e instanceof ToolError || e instanceof ProviderNotConfiguredError || e instanceof PageNotFoundError) {
      return { content: e.message, summary: e.message.slice(0, 120), isError: true };
    }
    return { content: `Tool failed: ${(e as Error).message}`, summary: `${name} failed`, isError: true };
  }
  return { content: "Unhandled tool", summary: "unhandled", isError: true };
}
