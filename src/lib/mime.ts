const MAP: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  jsx: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

export function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MAP[ext] ?? "application/octet-stream";
}

export function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "image/jpeg") return "jpg";
  const found = Object.entries(MAP).find(([, v]) => v.split(";")[0] === m);
  return found?.[0] ?? "bin";
}

export function isTextMime(mime: string): boolean {
  return /^text\/|json|xml|javascript|svg|manifest/.test(mime);
}
