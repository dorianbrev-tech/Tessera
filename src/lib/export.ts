// Source export: a self-contained static site in a ZIP, ready for any static host.
import JSZip from "jszip";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import type { VersionFile } from "@/lib/types";

export async function buildExportZip(projectId: string, files: VersionFile[], projectName: string) {
  const zip = new JSZip();
  const formEndpoint = `${env.appUrl}/api/forms/${projectId}`;
  for (const f of files) {
    if (f.content !== null && f.content !== undefined) {
      let content = f.content;
      // Keep forms working once the site is hosted elsewhere.
      if (f.path.endsWith(".html")) content = content.replace(/(\saction\s*=\s*["'])\/__tessera\/forms\//gi, `$1${formEndpoint}/`);
      zip.file(f.path, content);
    } else if (f.storageKey) {
      const data = await storage().get(f.storageKey);
      if (data) zip.file(f.path, data);
    }
  }
  const pages = files.filter((f) => f.path.endsWith(".html")).map((f) => f.path);
  zip.file(
    "README.md",
    `# ${projectName}\n\nStatic website exported from Tessera on ${new Date().toISOString().slice(0, 10)}.\n\n## Run locally\n\nInternal links are root-relative (\`/about\`, \`/assets/...\`), so serve the folder from a web server rather than opening files directly:\n\n\`\`\`bash\nnpx serve .\n\`\`\`\n\n## Deploy\n\nUpload the folder to any static host (Netlify, Vercel, Cloudflare Pages, S3 + CloudFront, GitHub Pages). \`vercel.json\` enables clean URLs on Vercel; Netlify and Cloudflare Pages serve \`about.html\` at \`/about\` automatically.\n\n## Forms\n\nForms post to ${formEndpoint}/<form-name>; submissions appear in the Tessera project.\n\n## Pages\n\n${pages.map((p) => `- ${p}`).join("\n")}\n`,
  );
  if (!files.some((f) => f.path === "vercel.json")) zip.file("vercel.json", JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function currentFiles(projectId: string): Promise<VersionFile[]> {
  const rows = await db.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId)).orderBy(asc(schema.projectFiles.path));
  return rows.map((r) => ({ path: r.path, content: r.content, storageKey: r.storageKey, mime: r.mime, size: r.size }));
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";
}
