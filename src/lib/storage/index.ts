// Object storage abstraction: local filesystem (default) or any S3-compatible service
// (AWS S3, Cloudflare R2, MinIO, Backblaze B2...). Used for screenshots, uploads,
// binary project files (images, fonts, video) and fidelity diff images.
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

function assertKey(key: string) {
  if (!key || key.length > 512 || key.includes("..") || key.startsWith("/") || /[\\\0]/.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Storage key escapes root");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    assertKey(prefix);
    const full = path.resolve(this.root, prefix);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) return;
    await fs.rm(full, { recursive: true, force: true });
  }
}

class S3Storage implements StorageDriver {
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client>;
  constructor() {
    this.clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: env.s3.region,
          endpoint: env.s3.endpoint,
          forcePathStyle: env.s3.forcePathStyle,
          credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
        }),
    );
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(
      new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }
  async get(key: string) {
    assertKey(key);
    const { GetObjectCommand, NoSuchKey } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }
  async delete(key: string) {
    assertKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
  }
  async deletePrefix(prefix: string) {
    assertKey(prefix);
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: env.s3.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket: env.s3.bucket, Delete: { Objects: keys } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}

const g = globalThis as unknown as { __tesseraStorage?: StorageDriver };

export function storage(): StorageDriver {
  if (!g.__tesseraStorage) {
    if (env.storageDriver === "s3") {
      if (!env.s3.bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
      g.__tesseraStorage = new S3Storage();
    } else {
      g.__tesseraStorage = new LocalStorage(path.resolve(/* turbopackIgnore: true */ process.cwd(), env.storageLocalDir));
    }
  }
  return g.__tesseraStorage;
}

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Content-addressed key for binary project files, so versions can share blobs. */
export function blobKey(projectId: string, data: Buffer, ext: string) {
  return `projects/${projectId}/blobs/${sha256(data).slice(0, 40)}.${ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin"}`;
}
