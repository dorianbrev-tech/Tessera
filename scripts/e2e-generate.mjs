// End-to-end walkthrough of generation, chat edits, fidelity, history, publish and export.
// Usage: node scripts/e2e-generate.mjs <outDir> <email> <projectId> [baseUrl]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const [out, email, projectId, base = "http://localhost:3000"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [page error]", e.message));
const shot = async (n) => {
  await page.screenshot({ path: `${out}/${n}.png` });
  console.log("  shot", n);
};
const status = () => page.evaluate(async (id) => (await (await fetch(`/api/projects/${id}`)).json()), projectId);
const waitIdle = async (label, max = 200) => {
  for (let i = 0; i < max; i++) {
    const d = await status();
    if (!d.activeJob) return d;
    await page.waitForTimeout(1500);
  }
  throw new Error("timeout waiting for " + label);
};

await page.goto(base + "/login");
await page.fill("#email", email);
await page.fill("#password", "correct horse battery");
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard");

console.log("generate");
await page.goto(`${base}/p/${projectId}`);
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page.getByRole("button", { name: /enerate website/ }).click();
await page.waitForTimeout(9000);
await shot("10-generating-live");
const afterGen = await waitIdle("generation");
console.log("  files:", afterGen.files.map((f) => f.path).length, "status:", afterGen.project.status);
await page.waitForTimeout(2500);
await shot("11-build-after-generation");

console.log("code editor");
await page.getByRole("button", { name: "styles.css" }).click().catch(() => {});
await page.waitForTimeout(2500);
await shot("12-code-editor");

console.log("mobile preview");
await page.getByRole("button", { name: "Mobile · 390" }).click();
await page.waitForTimeout(3000);
await shot("13-preview-mobile");
await page.getByRole("button", { name: "Desktop · 1440" }).click();

console.log("fidelity view");
await page.getByRole("button", { name: "Fidelity", exact: true }).click();
await page.waitForTimeout(2500);
await shot("14-fidelity");
await page.getByRole("button", { name: "Swipe" }).click();
await page.waitForTimeout(1500);
await shot("15-fidelity-swipe");

console.log("chat edit");
await page.getByRole("button", { name: "Build", exact: true }).click();
await page.getByPlaceholder("Ask for a change…").fill("Make the accent color a little deeper");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
await shot("16-chat-running");
await waitIdle("chat");
await page.waitForTimeout(2500);
await shot("17-chat-done");

console.log("history");
await page.getByRole("button", { name: "History", exact: true }).click();
await page.waitForTimeout(2000);
await shot("18-history");

console.log("publish");
await page.getByRole("banner").getByRole("button", { name: /^Publish/ }).click();
await page.fill("#slug", `maison-${Date.now().toString(36)}`);
await page.getByRole("dialog").getByRole("button", { name: /^Publish( changes)?$/ }).click();
await page.waitForTimeout(2500);
await shot("19-publish");
const published = (await status()).publishedUrl;
console.log("  published:", published);

console.log("export");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download source/ }).click()]);
const zipPath = `${out}/export.zip`;
await download.saveAs(zipPath);
console.log("  export saved", zipPath);

const pub = await ctx.newPage();
await pub.setViewportSize({ width: 1440, height: 900 });
await pub.goto(published);
await pub.waitForTimeout(2000);
await pub.screenshot({ path: `${out}/20-published-site.png` });
console.log("  shot 20-published-site");
writeFileSync(`${out}/result.json`, JSON.stringify({ published, files: afterGen.files.length }, null, 2));
await browser.close();
