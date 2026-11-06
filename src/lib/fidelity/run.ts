// Fidelity comparisons between generated pages and their references.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { resolveSitePath } from "@/lib/projects";
import type { FidelityIssue, FidelityMetrics, ReferenceRole, Viewport } from "@/lib/types";
import { compareScreens, type CompareResult } from "./compare";
import { renderProjectPage, PageNotFoundError } from "./render";

/** Roles whose references are compared pixel-for-pixel. */
export const PIXEL_ROLES: ReferenceRole[] = ["full", "layout"];

export interface ComparisonTarget {
  referenceId: string;
  referencePageId: string | null;
  path: string;
  viewport: Viewport;
  referenceShotKey: string;
}

export async function comparisonTargets(projectId: string, opts: { viewports?: Viewport[]; maxPages?: number } = {}): Promise<ComparisonTarget[]> {
  const refs = await db
    .select()
    .from(schema.referenceSites)
    .where(and(eq(schema.referenceSites.projectId, projectId), eq(schema.referenceSites.status, "done")))
    .orderBy(asc(schema.referenceSites.position));
  const pixelRefs = refs.filter((r) => r.roles.some((x) => PIXEL_ROLES.includes(x)));
  const targets: ComparisonTarget[] = [];
  const vps = opts.viewports ?? ["desktop"];
  for (const r of pixelRefs) {
    if (r.kind === "image" && r.storageKey) {
      targets.push({ referenceId: r.id, referencePageId: null, path: "/", viewport: "desktop", referenceShotKey: r.storageKey });
      continue;
    }
    const pages = await db
      .select()
      .from(schema.referencePages)
      .where(eq(schema.referencePages.referenceId, r.id))
      .orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
    for (const p of pages.slice(0, opts.maxPages ?? 8)) {
      for (const vp of vps) {
        const shot = p.screenshots[vp];
        if (shot) targets.push({ referenceId: r.id, referencePageId: p.id, path: p.path, viewport: vp, referenceShotKey: shot.key });
      }
    }
  }
  return targets;
}

export interface PageComparison {
  target: ComparisonTarget;
  reportId?: string;
  metrics?: FidelityMetrics;
  issues: FidelityIssue[];
  composites: CompareResult["composites"];
  generatedKey?: string;
  missing?: boolean;
}

export async function comparePage(projectId: string, target: ComparisonTarget, opts: { jobId?: string | null; iteration?: number } = {}): Promise<PageComparison> {
  const exists = await resolveSitePath(projectId, target.path);
  if (!exists) {
    return {
      target,
      missing: true,
      composites: [],
      issues: [{ kind: "missing-page", severity: "high", message: `The reference page ${target.path} has no generated counterpart (expected a file such as ${target.path === "/" ? "index.html" : target.path.replace(/^\//, "").replace(/\/$/, "") + ".html"}).` }],
    };
  }
  const refShot = await storage().get(target.referenceShotKey);
  if (!refShot) throw new Error("Reference screenshot is missing from storage");
  let refEx = null;
  if (target.referencePageId) {
    const [p] = await db.select().from(schema.referencePages).where(eq(schema.referencePages.id, target.referencePageId));
    refEx = target.viewport === "desktop" ? p?.extraction ?? null : null;
  }
  const refMeta = await sharp(refShot).metadata();
  // Uploaded screenshots may have any width: normalise to the viewport width.
  const viewportWidth = target.viewport === "desktop" ? 1440 : target.viewport === "tablet" ? 834 : 390;
  const normalizedRef = refMeta.width && refMeta.width !== viewportWidth ? await sharp(refShot).resize({ width: viewportWidth }).jpeg({ quality: 85 }).toBuffer() : refShot;

  let render;
  try {
    render = await renderProjectPage(projectId, target.path, target.viewport);
  } catch (e) {
    if (e instanceof PageNotFoundError) return { target, missing: true, composites: [], issues: [{ kind: "missing-page", severity: "high", message: e.message }] };
    throw e;
  }
  const result = await compareScreens({
    referenceShot: normalizedRef,
    generatedShot: render.screenshot,
    referenceEx: refEx,
    generatedEx: target.viewport === "desktop" ? render.extraction : null,
    viewportWidth,
    consoleErrors: render.consoleErrors,
  });
  for (const m of render.missingFiles.slice(0, 5)) result.issues.unshift({ kind: "missing-image", severity: "high", message: `The page requests ${m}, which does not exist in the project (404).` });

  const stamp = Date.now();
  const base = `projects/${projectId}/fidelity/${stamp}-${target.viewport}-${target.path.replace(/[^a-z0-9]+/gi, "_") || "home"}`;
  const generatedKey = `${base}-generated.jpg`;
  const diffKey = `${base}-diff.png`;
  await storage().put(generatedKey, render.screenshot, "image/jpeg");
  await storage().put(diffKey, result.diffPng, "image/png");
  const [report] = await db
    .insert(schema.fidelityReports)
    .values({
      projectId,
      jobId: opts.jobId ?? null,
      referenceId: target.referenceId,
      referencePageId: target.referencePageId,
      path: target.path,
      viewport: target.viewport,
      iteration: opts.iteration ?? 0,
      score: result.metrics.overall,
      metrics: result.metrics,
      issues: result.issues,
      images: { reference: target.referenceShotKey, generated: generatedKey, diff: diffKey },
    })
    .returning({ id: schema.fidelityReports.id });
  return { target, reportId: report.id, metrics: result.metrics, issues: result.issues, composites: result.composites, generatedKey };
}

export async function latestReports(projectId: string, limit = 40) {
  return db.select().from(schema.fidelityReports).where(eq(schema.fidelityReports.projectId, projectId)).orderBy(desc(schema.fidelityReports.createdAt)).limit(limit);
}

export async function reportsForJob(projectId: string, jobIds: string[]) {
  if (!jobIds.length) return [];
  return db
    .select()
    .from(schema.fidelityReports)
    .where(and(eq(schema.fidelityReports.projectId, projectId), inArray(schema.fidelityReports.jobId, jobIds)))
    .orderBy(asc(schema.fidelityReports.createdAt));
}
