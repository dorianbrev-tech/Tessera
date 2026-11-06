// "analyze" job: analyse every reference of a project, build the media library and
// synthesise the design system the generator will follow.
import { and, asc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { storage, sha256 } from "@/lib/storage";
import { extFromMime, mimeFromPath } from "@/lib/mime";
import { mergeSettings, touchProject } from "@/lib/projects";
import { dominantColors } from "@/lib/image-utils";
import type { JobContext } from "@/lib/job-context";
import { JobCancelled } from "@/lib/job-context";
import { analyzeReferenceUrl, BlockedError, CancelledError } from "./crawler";
import { safeFetch } from "./net";
import { synthesizeProjectDesign } from "./synthesize";
import { closeBrowser } from "@/lib/browser";

const MAX_DOWNLOADED_ASSETS = 60;

export async function runAnalyzeJob(ctx: JobContext) {
  const projectId = ctx.job.projectId;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const settings = mergeSettings(project.settings);
  const onlyIds = (ctx.job.input.referenceIds as string[] | undefined) ?? null;
  let refs = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId)).orderBy(asc(schema.referenceSites.position));
  if (onlyIds?.length) refs = refs.filter((r) => onlyIds.includes(r.id));
  if (!refs.length) throw new Error("This project has no references to analyse. Add a URL or a screenshot first.");

  await touchProject(projectId, { status: "analyzing" });
  const share = 0.85 / refs.length;
  let analysed = 0;

  for (const [i, ref] of refs.entries()) {
    if (await ctx.isCancelled()) throw new JobCancelled();
    const base = 0.02 + i * share;
    await db.update(schema.referenceSites).set({ status: "analyzing", error: null }).where(eq(schema.referenceSites.id, ref.id));
    try {
      if (ref.kind === "image") {
        await ctx.progress(base, `Reading screenshot reference ${i + 1}/${refs.length}`);
        const buf = ref.storageKey ? await storage().get(ref.storageKey) : null;
        if (!buf) throw new Error("Uploaded image is missing from storage");
        const meta = await sharp(buf).metadata();
        const palette = await dominantColors(buf, 10);
        await db
          .update(schema.referenceSites)
          .set({
            status: "done",
            analyzedAt: new Date(),
            analysis: {
              origin: "upload",
              startUrl: "",
              robots: { checked: false, allowed: true, sitemaps: [] },
              pages: [],
              skipped: [],
              discovered: 0,
              navigation: [],
              tech: [],
              durationMs: 0,
              image: { width: meta.width ?? 0, height: meta.height ?? 0 },
              palette,
            },
          })
          .where(eq(schema.referenceSites.id, ref.id));
        await ctx.log(`Screenshot reference: ${meta.width}×${meta.height}, palette ${palette.slice(0, 5).map((p) => p.hex).join(" ")}`);
        analysed++;
        continue;
      }

      await ctx.log(`Analysing ${ref.url} (roles: ${ref.roles.join(", ")})`);
      const analysis = await analyzeReferenceUrl({
        projectId,
        referenceId: ref.id,
        url: ref.url!,
        maxPages: settings.maxPages,
        viewports: settings.viewports,
        hooks: {
          log: (m, d) => ctx.log(m, (d?.level as "warn") ?? "info"),
          progress: (f, stage) => ctx.progress(base + f * share * 0.9, stage),
          screenshot: (d) => ctx.emit("screenshot", d),
          cancelled: () => ctx.isCancelled(),
        },
      });
      const home = analysis.pages.find((p) => p.status === "done");
      await db
        .update(schema.referenceSites)
        .set({ status: "done", analysis, analyzedAt: new Date(), title: home?.title || ref.title })
        .where(eq(schema.referenceSites.id, ref.id));
      await collectReferenceMedia(ctx, projectId, ref.id, settings.reuseMedia);
      analysed++;
      await ctx.log(`Finished ${ref.url}: ${analysis.pages.filter((p) => p.status === "done").length} pages in ${(analysis.durationMs / 1000).toFixed(0)}s`);
    } catch (e) {
      if (e instanceof CancelledError || e instanceof JobCancelled) throw new JobCancelled();
      const blocked = e instanceof BlockedError;
      await db
        .update(schema.referenceSites)
        .set({ status: blocked ? "blocked" : "error", error: (e as Error).message })
        .where(eq(schema.referenceSites.id, ref.id));
      await ctx.log(`${ref.url ?? "Reference"}: ${(e as Error).message}`, blocked ? "warn" : "error");
    }
  }
  await closeBrowser();

  if (!analysed) {
    await touchProject(projectId, { status: "error" });
    throw new Error("None of the references could be analysed. See the log for details.");
  }

  await ctx.progress(0.9, "Synthesising the design system");
  const design = await synthesizeProjectDesign(projectId, (m) => ctx.log(m));
  await touchProject(projectId, { design, status: "analyzed" });
  const done = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId));
  const pageCount = (await referencePagesFor(projectId)).length;
  const problems = done.filter((r) => r.status === "error" || r.status === "blocked");
  await db.insert(schema.messages).values({
    projectId,
    role: "assistant",
    jobId: ctx.job.id,
    content: [
      `Analysis complete: ${pageCount} page${pageCount === 1 ? "" : "s"} captured from ${analysed} reference${analysed === 1 ? "" : "s"}.`,
      design.personality.length ? `The design reads as ${design.personality.slice(0, 4).join(", ")}.` : "",
      `Palette: ${design.colors.slice(0, 5).map((c) => "`" + c.hex + "`").join(" ")}. Typography: ${design.typography.slice(0, 2).map((t) => t.family).join(" + ") || "—"}.`,
      problems.length ? `\n${problems.map((r) => `**${r.url ?? "Screenshot"}**: ${r.error}`).join("\n")}` : "",
      "Open **Analysis** to review the measured design system.",
    ].filter(Boolean).join(" "),
    meta: { kind: "analysis", design: design.source },
  });
  await ctx.progress(1, "Design analysis ready");
  return { analysed, design: { source: design.source, pages: design.pages.length, colors: design.colors.length } };
}

/** Record reference images/videos in the media library and download images for reuse. */
async function collectReferenceMedia(ctx: JobContext, projectId: string, referenceId: string, download: boolean) {
  await db.delete(schema.assets).where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.referenceId, referenceId)));
  const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.referenceId, referenceId));
  const seen = new Set<string>();
  const rows: (typeof schema.assets.$inferInsert)[] = [];
  for (const p of pages) {
    const ex = p.extraction;
    if (!ex) continue;
    for (const img of ex.images) {
      if (!img.src || img.src.startsWith("data:") || seen.has(img.src)) continue;
      seen.add(img.src);
      rows.push({
        projectId,
        referenceId,
        source: "reference",
        kind: img.kind === "background" ? "background" : "image",
        url: img.src,
        width: img.naturalWidth || img.renderedWidth,
        height: img.naturalHeight || img.renderedHeight,
        alt: img.alt,
        license: "Belongs to the reference website — reuse only with permission",
        meta: { page: p.path, section: img.section, renderedWidth: img.renderedWidth, renderedHeight: img.renderedHeight, objectFit: img.objectFit, objectPosition: img.objectPosition, aspectRatio: img.aspectRatio },
      });
    }
    for (const v of ex.videos) {
      if (!v.src || seen.has(v.src)) continue;
      seen.add(v.src);
      rows.push({
        projectId,
        referenceId,
        source: "reference",
        kind: "video",
        url: v.src,
        width: v.renderedWidth,
        height: v.renderedHeight,
        alt: "",
        license: "Belongs to the reference website — reuse only with permission",
        meta: { page: p.path, section: v.section, poster: v.poster, background: v.isBackground, autoplay: v.autoplay, loop: v.loop, muted: v.muted, provider: v.provider },
      });
    }
  }
  for (const p of pages) {
    for (const f of p.extraction?.fonts.faces ?? []) {
      // Google Fonts are linked from their CSS API instead of being copied.
      if (!f.src || f.provider === "google" || seen.has(f.src)) continue;
      seen.add(f.src);
      rows.push({
        projectId,
        referenceId,
        source: "reference",
        kind: "font",
        url: f.src,
        alt: `${f.family} ${f.weight} ${f.style}`,
        license: "Font files are licensed per website — reuse only if your font license covers the new site",
        meta: { page: p.path, family: f.family, weight: f.weight, style: f.style, provider: f.provider },
      });
    }
  }
  if (!rows.length) return;
  const inserted = await db.insert(schema.assets).values(rows).returning({ id: schema.assets.id, url: schema.assets.url, kind: schema.assets.kind });
  const count = (k: string) => inserted.filter((r) => r.kind === k).length;
  await ctx.log(`Media library: ${count("image") + count("background")} images, ${count("video")} videos, ${count("font")} font files found`);
  if (!download) return;

  // Download images and font files so generated sites can be self-contained (no hotlinking).
  let ok = 0;
  for (const a of inserted.filter((r) => r.kind !== "video").slice(0, MAX_DOWNLOADED_ASSETS)) {
    if (await ctx.isCancelled()) return;
    try {
      const isFont = a.kind === "font";
      const res = await safeFetch(a.url!, { maxBytes: 8_000_000, timeoutMs: 15_000, headers: { accept: isFont ? "font/woff2,font/*;q=0.9,*/*;q=0.5" : "image/avif,image/webp,image/*;q=0.8" } });
      let type = (res.headers.get("content-type") ?? "").split(";")[0];
      if (isFont && !type.startsWith("font/")) type = mimeFromPath(new URL(a.url!).pathname);
      if (res.status !== 200 || !(isFont ? /^font\/|woff|truetype|opentype/.test(type) : type.startsWith("image/"))) continue;
      const key = `projects/${projectId}/assets/${sha256(res.body).slice(0, 40)}.${extFromMime(type)}`;
      await storage().put(key, res.body, type);
      let width: number | undefined, height: number | undefined;
      if (!isFont) {
        try {
          const m = await sharp(res.body).metadata();
          width = m.width;
          height = m.height;
        } catch {
          /* svg or unsupported */
        }
      }
      await db.update(schema.assets).set({ storageKey: key, mime: type, ...(width ? { width, height } : {}) }).where(eq(schema.assets.id, a.id));
      ok++;
    } catch {
      /* unreachable asset: keep the URL only */
    }
  }
  await ctx.log(`Downloaded ${ok} reference media files into the project library`);
}

export async function referencePagesFor(projectId: string, refIds?: string[]) {
  const where = refIds?.length
    ? and(eq(schema.referencePages.projectId, projectId), inArray(schema.referencePages.referenceId, refIds))
    : eq(schema.referencePages.projectId, projectId);
  return db.select().from(schema.referencePages).where(where).orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
}
