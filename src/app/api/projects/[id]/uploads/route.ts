import sharp from "sharp";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { sha256, storage } from "@/lib/storage";
import { normalizePath, touchProject, writeBinaryFile } from "@/lib/projects";
import type { ReferenceRole } from "@/lib/types";

const MAX_BYTES = 15_000_000;
const ROLES: ReferenceRole[] = ["full", "identity", "colors", "typography", "layout", "navigation", "animations", "photography", "components", "content"];

/**
 * Upload an image. purpose=reference → becomes a screenshot reference;
 * purpose=attachment → returned for use in a chat message;
 * purpose=asset → added to the site's files and media library.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { project } = await ownedProject(id);
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Expected multipart form data.");
  });
  const file = form.get("file");
  const purpose = String(form.get("purpose") ?? "attachment");
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Images must be 15 MB or smaller.");
  const raw = Buffer.from(await file.arrayBuffer());
  let meta;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new HttpError(400, "That file is not a supported image (PNG, JPEG, WebP, GIF, AVIF, SVG).");
  }
  // Normalise to a web-friendly format; very tall screenshots are kept at full height.
  const isSvg = meta.format === "svg";
  const data = isSvg ? raw : await sharp(raw, { limitInputPixels: 268_402_689 }).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  const mime = isSvg ? "image/svg+xml" : "image/jpeg";
  const ext = isSvg ? "svg" : "jpg";

  if (purpose === "asset") {
    const base = (file.name || "image").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 50) || "image";
    const path = normalizePath(`assets/images/${base}.${ext}`);
    const res = await writeBinaryFile(id, path, data, mime);
    const out = await sharp(data).metadata().catch(() => ({ width: undefined, height: undefined }));
    await db.insert(schema.assets).values({ projectId: id, source: "upload", kind: "image", storageKey: "storageKey" in res ? res.storageKey : null, mime, width: out.width, height: out.height, alt: base.replace(/-/g, " "), license: "Uploaded by the project owner", meta: { path } });
    await touchProject(id);
    return json({ path, url: `/${path}` }, { status: 201 });
  }

  const key = `projects/${id}/uploads/${sha256(data).slice(0, 40)}.${ext}`;
  await storage().put(key, data, mime);

  if (purpose === "reference") {
    const roles = String(form.get("roles") ?? "full")
      .split(",")
      .map((r) => r.trim())
      .filter((r): r is ReferenceRole => ROLES.includes(r as ReferenceRole));
    const [{ n }] = await db.select({ n: count() }).from(schema.referenceSites).where(eq(schema.referenceSites.projectId, id));
    if (n >= 8) throw new HttpError(400, "A project can have at most 8 references.");
    const [ref] = await db
      .insert(schema.referenceSites)
      .values({ projectId: project.id, kind: "image", storageKey: key, title: file.name?.slice(0, 120) || "Screenshot", roles: roles.length ? roles : ["full"], notes: String(form.get("notes") ?? "").slice(0, 2000), position: n, status: "pending" })
      .returning();
    return json({ reference: ref }, { status: 201 });
  }
  return json({ storageKey: key, mime, name: file.name || "image" }, { status: 201 });
});
