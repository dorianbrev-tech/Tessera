// Validates the fidelity engine: (1) an exact copy of the reference must score near 100,
// (2) a degraded copy must score lower and produce specific issues.
import { desc, eq } from "drizzle-orm";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, pool, schema } from "@/lib/db";
import { writeBinaryFile, writeTextFile } from "@/lib/projects";
import { comparisonTargets, comparePage } from "@/lib/fidelity/run";
import { closeBrowser } from "@/lib/browser";
import { isTextMime } from "@/lib/mime";
import { mimeFromPath } from "@/lib/mime";

const fixtureRoot = path.resolve("fixtures/maison");
const [project] = await db
  .select()
  .from(schema.projects)
  .where(eq(schema.projects.mode, "recreate"))
  .orderBy(desc(schema.projects.createdAt))
  .limit(1);
console.log("project", project.id, project.name);
await db.update(schema.referenceSites).set({ status: "done" }).where(eq(schema.referenceSites.projectId, project.id));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
async function importFixture(mutate?: (p: string, s: string) => string | null) {
  await db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, project.id));
  for (const full of walk(fixtureRoot)) {
    const rel = path.relative(fixtureRoot, full);
    const mime = mimeFromPath(rel);
    if (isTextMime(mime)) {
      let text = readFileSync(full, "utf8");
      if (mutate) {
        const m = mutate(rel, text);
        if (m === null) continue;
        text = m;
      }
      await writeTextFile(project.id, rel, text);
    } else await writeBinaryFile(project.id, rel, readFileSync(full));
  }
}

const targets = (await comparisonTargets(project.id, { viewports: ["desktop", "mobile"] })).filter((t) => t.path === "/");
console.log("targets:", targets.map((t) => `${t.path}@${t.viewport}`).join(", "));

await importFixture();
for (const t of targets) {
  const r = await comparePage(project.id, t);
  console.log(`\n[exact copy] ${t.path}@${t.viewport}: overall ${r.metrics?.overall}`, JSON.stringify({ ...r.metrics, rows: undefined }));
  console.log("  issues:", r.issues.slice(0, 5).map((i) => `${i.severity}: ${i.message}`));
}

await importFixture((rel, s) => {
  if (rel === "assets/css/site.css")
    return s
      .replace("--paper: #f6f1ea", "--paper: #ffffff")
      .replace('--serif: "Maison Serif", Georgia, serif', "--serif: Arial, sans-serif")
      .replace(".hero h1 { font-family: var(--serif); font-weight: 400; font-size: 112px", ".hero h1 { font-family: var(--serif); font-weight: 400; font-size: 64px")
      .replace("grid-template-columns: repeat(4, 1fr)", "grid-template-columns: repeat(3, 1fr)");
  if (rel === "index.html") return s.replace(/<section class="marquee">[\s\S]*?<\/section>/, "").replace(/<section class="campaign">[\s\S]*?<\/section>/, "");
  return s;
});
const desk = targets.find((t) => t.viewport === "desktop")!;
const r = await comparePage(project.id, desk);
console.log(`\n[degraded] overall ${r.metrics?.overall}`, JSON.stringify({ ...r.metrics, rows: undefined }));
for (const i of r.issues) console.log(`  - ${i.severity} ${i.kind}: ${i.message}`);
r.composites.forEach((c, k) => writeFileSync(`/tmp/claude-0/-home-user/2c72a310-6ca1-579f-aadb-e40a72a8f283/scratchpad/composite-${k}.jpg`, c.data));
console.log("composites:", r.composites.map((c) => c.label));
await closeBrowser();
await pool.end();
