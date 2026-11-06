// End-to-end UI walkthrough: signs up, creates a recreation project for the local fixture
// site, waits for the real analysis job, and screenshots each workspace view.
// Usage: node scripts/e2e-ui.mjs <outDir> [baseUrl] [fixtureUrl]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "./e2e-shots";
const base = process.argv[3] ?? "http://localhost:3000";
const fixture = process.argv[4] ?? "http://localhost:4100/";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [page error]", e.message));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("  shot", name);
};

console.log("landing");
await page.goto(base + "/");
await shot("01-landing");

console.log("signup");
await page.goto(base + "/signup");
const email = `e2e+${Date.now()}@tessera.local`;
await page.fill("#name", "Ada Lovelace");
await page.fill("#email", email);
await page.fill("#password", "correct horse battery");
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard");
await page.waitForTimeout(800);
await shot("02-dashboard-empty");

console.log("new project");
await page.goto(base + "/new");
await page.fill("#url", fixture);
await page.getByText("Analysis & generation options").click();
await page.locator('input[type="checkbox"]').check();
// Review the analysis before generating (tests the manual "Generate" path).
const autoGen = page.getByRole("switch").first();
if ((await autoGen.getAttribute("aria-checked")) === "true") await autoGen.click();
await shot("03-new-project");
await page.getByRole("button", { name: /Analyse & recreate/ }).click();
await page.waitForURL("**/p/**");
const projectId = page.url().split("/p/")[1];
console.log("  project", projectId);
await page.waitForTimeout(6000);
await shot("04-workspace-analysing");

console.log("waiting for analysis");
for (let i = 0; i < 120; i++) {
  const st = await page.evaluate(async (id) => (await (await fetch(`/api/projects/${id}`)).json()).project.status, projectId);
  if (st === "analyzed" || st === "error" || st === "ready") {
    console.log("  status", st);
    break;
  }
  await page.waitForTimeout(3000);
}
await page.reload();
await page.waitForTimeout(2500);
await shot("05-workspace-after-analysis");

console.log("analysis view");
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page.waitForTimeout(2500);
await shot("06-analysis-design-system");
await page.getByRole("button", { name: "/", exact: true }).first().click();
await page.waitForTimeout(2500);
await shot("07-analysis-page");
await page.getByRole("button", { name: "Mobile", exact: true }).click().catch(() => {});
await page.waitForTimeout(1500);
await shot("08-analysis-page-mobile");

console.log("settings");
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.waitForTimeout(1500);
await shot("09-settings");

console.log(JSON.stringify({ projectId, email }));
await browser.close();
