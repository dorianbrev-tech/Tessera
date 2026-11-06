// Runs the real analysis engine against a URL (default: the local fixture site) and
// prints what it measured. Usage: npm run test:analysis -- http://localhost:4100
import { eq } from "drizzle-orm";
import { db, pool, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { analyzeReferenceUrl } from "@/lib/analysis/crawler";
import { heuristicDesign } from "@/lib/analysis/synthesize";
import { closeBrowser } from "@/lib/browser";
import { DEFAULT_SETTINGS } from "@/lib/types";

const url = process.argv[2] ?? "http://localhost:4100/";
const email = "analysis-test@tessera.local";

let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) [user] = await db.insert(schema.users).values({ email, name: "Analysis test", passwordHash: await hashPassword("not-used-123") }).returning();
const [project] = await db
  .insert(schema.projects)
  .values({ userId: user.id, name: "Analysis test " + new Date().toISOString(), mode: "recreate", settings: { ...DEFAULT_SETTINGS, maxPages: 5 } })
  .returning();
const [ref] = await db.insert(schema.referenceSites).values({ projectId: project.id, kind: "url", url, roles: ["full"] }).returning();

const t0 = Date.now();
const analysis = await analyzeReferenceUrl({
  projectId: project.id,
  referenceId: ref.id,
  url,
  maxPages: 5,
  viewports: ["desktop", "tablet", "mobile"],
  hooks: {
    log: async (m) => console.log("  ·", m),
    progress: async (f, s) => { if (s) console.log(`[${Math.round(f * 100)}%] ${s}`); },
    screenshot: async () => {},
    cancelled: async () => false,
  },
});
console.log(`\nAnalysed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("pages:", analysis.pages.map((p) => `${p.path} (${p.status})`).join(", "));
console.log("skipped:", analysis.skipped.map((s) => `${new URL(s.url).pathname}: ${s.reason}`).join(" | ") || "none");
console.log("nav:", analysis.navigation.map((n) => n.text).join(", "));

const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.referenceId, ref.id));
const home = pages.find((p) => p.path === "/") ?? pages[0];
const ex = home.extraction!;
console.log("\n--- Home extraction ---");
console.log("bg colors:", ex.colors.background.slice(0, 5).map((c) => `${c.hex} ${(c.weight * 100).toFixed(1)}%`).join(", "));
console.log("text colors:", ex.colors.text.slice(0, 4).map((c) => c.hex).join(", "));
console.log("fonts:", ex.fonts.families.map((f) => `${f.family} [${f.roles.join("/")}]`).join(", "));
console.log("faces:", ex.fonts.faces.map((f) => `${f.family} ${f.weight} ${f.style} (${f.provider})`).join(", "));
console.log("type:", ex.typography.slice(0, 6).map((t) => `${t.role} ${t.fontSize}px/${t.lineHeight} ${t.textTransform} ls=${t.letterSpacing}`).join(" | "));
console.log("sections:", ex.sections.map((s) => `${s.kind}(${s.columns}col,${s.height}px)`).join(" → "));
console.log("buttons:", ex.buttons.slice(0, 3).map((b) => `${b.text}: bg ${b.background} border ${b.border} pad ${b.padding}`).join(" | "));
console.log("images:", ex.images.length, "videos:", ex.videos.length, "header:", ex.navigation.header.position, ex.navigation.header.height + "px", "hamburger(desktop):", ex.navigation.hamburger);
console.log("reveals:", JSON.stringify(ex.animations.scrollReveals.slice(0, 3)));
console.log("parallax:", JSON.stringify(ex.animations.parallax));
console.log("hover:", JSON.stringify(ex.animations.hoverEffects.slice(0, 3)));
console.log("sticky:", JSON.stringify(ex.animations.sticky), "marquees:", ex.animations.marquees, "keyframes:", ex.animations.keyframes, "smooth:", ex.animations.smoothScroll, "snap:", ex.animations.scrollSnap);
console.log("responsive:", JSON.stringify(ex.responsive?.mobile?.sections?.slice(0, 6)), "mobile hamburger:", ex.responsive?.mobile?.hamburger);
console.log("screenshots:", Object.keys(home.screenshots).join(", "), "section crops:", home.sections.filter((s) => s.cropKey).length);

const design = heuristicDesign(
  pages.map((p) => ({ path: p.path, title: p.title ?? "", extraction: p.extraction!, sections: p.sections })),
);
console.log("\n--- Heuristic design system ---");
console.log(JSON.stringify(design, null, 1).slice(0, 3500));

await closeBrowser();
await pool.end();
