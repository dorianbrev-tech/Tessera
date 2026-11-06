// Project, file and version management. Shared by API routes and the worker.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage, blobKey, sha256 } from "@/lib/storage";
import { mimeFromPath, isTextMime, extFromMime } from "@/lib/mime";
import type { VersionFile, ProjectSettings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

export class NotFoundError extends Error {}

export const MAX_TEXT_FILE_BYTES = 2_000_000;
export const MAX_FILES_PER_PROJECT = 400;

/** Normalise a project-relative path: no leading slash, no traversal, sane characters. */
export function normalizePath(input: string): string {
  let p = input.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  p = p.split("?")[0].split("#")[0];
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") throw new Error(`Invalid path "${input}": traversal is not allowed`);
    parts.push(seg);
  }
  const out = parts.join("/");
  if (!out) throw new Error("Path must not be empty");
  if (out.length > 240) throw new Error("Path is too long");
  if (!/^[\w\-./@ ()+,~%]+$/.test(out)) throw new Error(`Path "${input}" contains unsupported characters`);
  return out;
}

export async function getProject(projectId: string) {
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!p) throw new NotFoundError("Project not found");
  return p;
}

export async function getOwnedProject(userId: string, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new NotFoundError("Project not found");
  const [p] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  if (!p) throw new NotFoundError("Project not found");
  return p;
}

export async function touchProject(projectId: string, patch: Partial<typeof schema.projects.$inferInsert> = {}) {
  await db
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
}

export function mergeSettings(s?: Partial<ProjectSettings> | null): ProjectSettings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function listFiles(projectId: string) {
  return db
    .select({
      path: schema.projectFiles.path,
      mime: schema.projectFiles.mime,
      size: schema.projectFiles.size,
      binary: sql<boolean>`${schema.projectFiles.storageKey} is not null`,
      updatedAt: schema.projectFiles.updatedAt,
    })
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .orderBy(asc(schema.projectFiles.path));
}

export async function readFileRow(projectId: string, path: string) {
  const [row] = await db
    .select()
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, normalizePath(path))))
    .limit(1);
  return row ?? null;
}

export async function readTextFile(projectId: string, path: string): Promise<string | null> {
  const row = await readFileRow(projectId, path);
  if (!row) return null;
  if (row.content !== null) return row.content;
  return null;
}

/** Read any file as bytes (text from the DB, binary from storage). */
export async function readFileBytes(projectId: string, path: string): Promise<{ data: Buffer; mime: string } | null> {
  const row = await readFileRow(projectId, path);
  if (!row) return null;
  if (row.content !== null) return { data: Buffer.from(row.content, "utf8"), mime: row.mime };
  if (row.storageKey) {
    const data = await storage().get(row.storageKey);
    return data ? { data, mime: row.mime } : null;
  }
  return null;
}

async function assertCapacity(projectId: string, path: string) {
  const existing = await readFileRow(projectId, path);
  if (existing) return;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId));
  if (count >= MAX_FILES_PER_PROJECT) throw new Error(`Projects are limited to ${MAX_FILES_PER_PROJECT} files`);
}

export async function writeTextFile(projectId: string, rawPath: string, content: string, mime?: string) {
  const path = normalizePath(rawPath);
  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_TEXT_FILE_BYTES) throw new Error(`File too large (${size} bytes, max ${MAX_TEXT_FILE_BYTES})`);
  await assertCapacity(projectId, path);
  const m = mime ?? mimeFromPath(path);
  await db
    .insert(schema.projectFiles)
    .values({ projectId, path, content, storageKey: null, mime: m, size })
    .onConflictDoUpdate({
      target: [schema.projectFiles.projectId, schema.projectFiles.path],
      set: { content, storageKey: null, mime: m, size, updatedAt: new Date() },
    });
  return { path, size };
}

export async function writeBinaryFile(projectId: string, rawPath: string, data: Buffer, mime?: string) {
  const path = normalizePath(rawPath);
  const m = mime ?? mimeFromPath(path);
  if (isTextMime(m) && !m.includes("svg")) return writeTextFile(projectId, path, data.toString("utf8"), m);
  await assertCapacity(projectId, path);
  const key = blobKey(projectId, data, path.split(".").pop() || extFromMime(m));
  await storage().put(key, data, m);
  await db
    .insert(schema.projectFiles)
    .values({ projectId, path, content: null, storageKey: key, mime: m, size: data.length })
    .onConflictDoUpdate({
      target: [schema.projectFiles.projectId, schema.projectFiles.path],
      set: { content: null, storageKey: key, mime: m, size: data.length, updatedAt: new Date() },
    });
  return { path, size: data.length, storageKey: key };
}

export async function deleteFile(projectId: string, rawPath: string) {
  const path = normalizePath(rawPath);
  const res = await db
    .delete(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
    .returning({ path: schema.projectFiles.path });
  return res.length > 0;
}

export async function renameFile(projectId: string, from: string, to: string) {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  if (await readFileRow(projectId, dst)) throw new Error(`A file already exists at ${dst}`);
  await db
    .update(schema.projectFiles)
    .set({ path: dst, mime: mimeFromPath(dst), updatedAt: new Date() })
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, src)));
}

/** Resolve a URL path ("/", "/about", "/shop/") to a project file path. */
export async function resolveSitePath(
  projectId: string,
  urlPath: string,
  lookup?: (p: string) => Promise<boolean>,
): Promise<string | null> {
  let p = decodeURIComponent(urlPath || "/").replace(/^\/+/, "");
  const candidates: string[] = [];
  if (!p || p.endsWith("/")) candidates.push(`${p}index.html`);
  else {
    candidates.push(p);
    if (!/\.[a-z0-9]{1,6}$/i.test(p)) candidates.push(`${p}.html`, `${p}/index.html`);
  }
  for (const c of candidates) {
    try {
      const n = normalizePath(c);
      const exists = lookup ? await lookup(n) : Boolean(await readFileRow(projectId, n));
      if (exists) return n;
    } catch {
      /* invalid candidate */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

async function currentFilesForSnapshot(projectId: string): Promise<VersionFile[]> {
  const rows = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .orderBy(asc(schema.projectFiles.path));
  return rows.map((r) => ({ path: r.path, content: r.content, storageKey: r.storageKey, mime: r.mime, size: r.size }));
}

const fingerprint = (files: VersionFile[]) =>
  sha256(JSON.stringify(files.map((f) => [f.path, f.content ?? f.storageKey])));

/** Snapshot the current files as a new version (skipped when nothing changed since the last one). */
export async function snapshotVersion(
  projectId: string,
  label: string,
  source: "ai" | "manual" | "restore" | "duplicate" | "autosave",
  jobId?: string | null,
  opts: { force?: boolean } = {},
) {
  const files = await currentFilesForSnapshot(projectId);
  const [last] = await db
    .select()
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, projectId))
    .orderBy(desc(schema.projectVersions.number))
    .limit(1);
  if (!opts.force && last && fingerprint(last.files) === fingerprint(files)) return last;
  if (!files.length && !opts.force) return last ?? null;
  const [created] = await db
    .insert(schema.projectVersions)
    .values({
      projectId,
      number: (last?.number ?? 0) + 1,
      label: label.slice(0, 200),
      source,
      jobId: jobId ?? null,
      files,
      fileCount: files.length,
    })
    .returning();
  return created;
}

export async function listVersions(projectId: string) {
  return db
    .select({
      id: schema.projectVersions.id,
      number: schema.projectVersions.number,
      label: schema.projectVersions.label,
      source: schema.projectVersions.source,
      fileCount: schema.projectVersions.fileCount,
      createdAt: schema.projectVersions.createdAt,
      jobId: schema.projectVersions.jobId,
    })
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, projectId))
    .orderBy(desc(schema.projectVersions.number));
}

export async function getVersion(projectId: string, versionId: string) {
  const [v] = await db
    .select()
    .from(schema.projectVersions)
    .where(and(eq(schema.projectVersions.projectId, projectId), eq(schema.projectVersions.id, versionId)))
    .limit(1);
  if (!v) throw new NotFoundError("Version not found");
  return v;
}

export async function restoreVersion(projectId: string, versionId: string) {
  const v = await getVersion(projectId, versionId);
  // Keep the current state recoverable before overwriting it.
  await snapshotVersion(projectId, "Before restoring v" + v.number, "autosave");
  await db.transaction(async (tx) => {
    await tx.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId));
    if (v.files.length) {
      await tx.insert(schema.projectFiles).values(
        v.files.map((f) => ({
          projectId,
          path: f.path,
          content: f.content ?? null,
          storageKey: f.storageKey ?? null,
          mime: f.mime,
          size: f.size,
        })),
      );
    }
  });
  await touchProject(projectId);
  return snapshotVersion(projectId, `Restored v${v.number} — ${v.label}`, "restore", null, { force: true });
}

// ---------------------------------------------------------------------------
// Duplicate & delete
// ---------------------------------------------------------------------------

export async function duplicateProject(userId: string, projectId: string) {
  const src = await getOwnedProject(userId, projectId);
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(schema.projects)
      .values({
        userId,
        name: `${src.name} (copy)`.slice(0, 120),
        mode: src.mode,
        status: src.status === "generating" || src.status === "analyzing" ? "ready" : src.status,
        brief: src.brief,
        settings: src.settings,
        design: src.design,
        thumbnailKey: src.thumbnailKey,
      })
      .returning();
    const files = await tx.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId));
    if (files.length) {
      await tx.insert(schema.projectFiles).values(
        files.map((f) => ({ projectId: copy.id, path: f.path, content: f.content, storageKey: f.storageKey, mime: f.mime, size: f.size })),
      );
    }
    // References and their analysed pages are copied so the duplicate can keep iterating against them.
    const refs = await tx.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, projectId));
    const refMap = new Map<string, string>();
    for (const r of refs) {
      const { id, createdAt, projectId: _p, ...rest } = r;
      void createdAt; void _p;
      const [nr] = await tx.insert(schema.referenceSites).values({ ...rest, projectId: copy.id }).returning({ id: schema.referenceSites.id });
      refMap.set(id, nr.id);
    }
    if (refs.length) {
      const pages = await tx
        .select()
        .from(schema.referencePages)
        .where(inArray(schema.referencePages.referenceId, refs.map((r) => r.id)));
      if (pages.length) {
        await tx.insert(schema.referencePages).values(
          pages.map(({ id, createdAt, ...p }) => {
            void id; void createdAt;
            return { ...p, projectId: copy.id, referenceId: refMap.get(p.referenceId)! };
          }),
        );
      }
    }
    const assetRows = await tx.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
    if (assetRows.length) {
      await tx.insert(schema.assets).values(
        assetRows.map(({ id, createdAt, ...a }) => {
          void id; void createdAt;
          return { ...a, projectId: copy.id, referenceId: a.referenceId ? refMap.get(a.referenceId) ?? null : null };
        }),
      );
    }
    const snapshot: VersionFile[] = files.map((f) => ({ path: f.path, content: f.content, storageKey: f.storageKey, mime: f.mime, size: f.size }));
    await tx.insert(schema.projectVersions).values({
      projectId: copy.id,
      number: 1,
      label: `Duplicated from “${src.name}”`,
      source: "duplicate",
      files: snapshot,
      fileCount: snapshot.length,
    });
    return copy;
  });
}

export async function deleteProject(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  // Blobs are content-addressed per project; duplicates reference the source's keys,
  // so blobs are only removed when no other project still points to them.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.projectFiles)
    .where(sql`${schema.projectFiles.storageKey} like ${"projects/" + projectId + "/%"}`);
  const [{ refs }] = await db
    .select({ refs: sql<number>`count(*)::int` })
    .from(schema.referencePages)
    .where(sql`${schema.referencePages.screenshots}::text like ${"%projects/" + projectId + "/%"}`);
  if (count === 0 && refs === 0) await storage().deletePrefix(`projects/${projectId}/`).catch(() => {});
}
