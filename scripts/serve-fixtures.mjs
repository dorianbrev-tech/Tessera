// Static server for the local test site, with pretty URLs (/about -> about.html).
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../fixtures/maison", import.meta.url).pathname);
const port = Number(process.env.FIXTURE_PORT ?? 4100);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".txt": "text/plain", ".woff2": "font/woff2" };

async function resolve(p) {
  const clean = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "");
  const candidates = clean.endsWith("/") ? [clean + "index.html"] : [clean, clean + ".html", clean + "/index.html"];
  for (const c of candidates) {
    const full = path.join(root, c);
    if (!full.startsWith(root)) continue;
    try {
      if ((await stat(full)).isFile()) return full;
    } catch {}
  }
  return null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const file = await resolve(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<h1>Not found</h1>");
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  })
  .listen(port, () => console.log(`fixtures on http://localhost:${port}`));
