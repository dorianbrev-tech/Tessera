// Copies Monaco's prebuilt AMD bundle into public/ so the code editor is served from
// Tessera's own origin (no CDN dependency, works behind strict CSPs and firewalls).
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const src = path.join(root, "node_modules/monaco-editor/min/vs");
const dest = path.join(root, "public/monaco/vs");
if (!existsSync(src)) {
  console.warn("monaco-editor not installed; skipping copy");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("monaco copied to public/monaco/vs");
