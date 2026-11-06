import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { newViewportContext } from "@/lib/browser";
import { readFileBytes, resolveSitePath } from "@/lib/projects";
import { SITE_ORIGIN } from "./render";

/** Above-the-fold screenshot of the home page, used on the dashboard. */
export async function renderThumbnail(projectId: string) {
  if (!(await resolveSitePath(projectId, "/"))) return null;
  const ctx = await newViewportContext("desktop");
  try {
    await ctx.route(`${SITE_ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url());
      const p = await resolveSitePath(projectId, u.pathname);
      const f = p ? await readFileBytes(projectId, p) : null;
      if (!f) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: f.mime, body: f.data });
    });
    const page = await ctx.newPage();
    await page.goto(SITE_ORIGIN + "/", { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const shot = await page.screenshot({ type: "jpeg", quality: 80 });
    const thumb = await sharp(shot).resize({ width: 800 }).jpeg({ quality: 78 }).toBuffer();
    const key = `projects/${projectId}/thumbnail-${Date.now()}.jpg`;
    await storage().put(key, thumb, "image/jpeg");
    const [prev] = await db.select({ k: schema.projects.thumbnailKey }).from(schema.projects).where(eq(schema.projects.id, projectId));
    await db.update(schema.projects).set({ thumbnailKey: key }).where(eq(schema.projects.id, projectId));
    if (prev?.k && prev.k !== key && prev.k.startsWith(`projects/${projectId}/thumbnail-`)) await storage().delete(prev.k).catch(() => {});
    return key;
  } finally {
    await ctx.close().catch(() => {});
  }
}
