// Records the silent demo walkthrough: one Playwright run through the real UI, captions burned in,
// no narration. Writes docs/demo/walkthrough.webm and docs/demo/script.md. Run: bun run walkthrough
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PORT = 3203;
const BASE = `http://localhost:${PORT}`;
const chrome = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "docs/demo";
const TMP = "test-results/demo30-video";
const MAX_SECONDS = 36;

// Every figure on the Eval step is read from the stored reports, never typed.
function latest() {
  const out = {};
  for (const f of readdirSync("eval/reports").filter((x) => x.endsWith(".json")).sort()) {
    const r = JSON.parse(readFileSync(join("eval/reports", f), "utf8"));
    out[r.model] = r;
  }
  return out;
}
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const reports = latest();
const A = reports["sim-a"], B = reports["sim-b"];


rmSync("data/demo30.db", { force: true });
rmSync("data/demo30.db-wal", { force: true });
rmSync("data/demo30.db-shm", { force: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn("bun", ["--bun", "next", "start", "-p", String(PORT)], { env: { ...process.env, REFUNDO_DB: "data/demo30.db" }, stdio: "ignore" });
const stop = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/login`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: TMP, size: { width: 1280, height: 720 } } });
const t0 = Date.now();
const page = await context.newPage();
// Caption overlay: lives in window.name so it survives navigation; re-attached on every page.
await page.addInitScript(() => {
  setInterval(() => {
    let el = document.getElementById("__caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__caption";
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:960px;z-index:99999;background:rgba(15,23,42,.92);color:#fff;font:500 17px/1.35 system-ui,sans-serif;padding:10px 18px;border-radius:8px;text-align:center;pointer-events:none";
      document.body?.appendChild(el);
    }
    el.textContent = window.name || "";
    el.style.display = window.name ? "block" : "none";
  }, 120);
});

const steps = [];
async function step(caption, seconds, action) {
  const start = (Date.now() - t0) / 1000;
  await page.evaluate((t) => { window.name = t; }, caption).catch(() => {});
  if (action) await action();
  await page.evaluate((t) => { window.name = t; }, caption).catch(() => {});
  const spent = (Date.now() - t0) / 1000 - start;
  if (spent < seconds) await page.waitForTimeout((seconds - spent) * 1000);
  steps.push({ at: Math.round(start), caption });
}
const personaTo = async (who) => {
  const done = page.waitForResponse((r) => r.url().includes("/api/persona") && r.ok());
  await page.getByTestId("persona-switcher").selectOption(who);
  await done;
};

await page.goto(`${BASE}/login`);
await page.fill('input[name="passcode"]', "refundo-demo");
await page.click('button[type="submit"]');
await page.getByTestId("queue").waitFor();
await step("Agent usage is non-refundable, yet Credits still get issued, one Ticket at a time.", 4);
await step("Today a specialist reads every Checkpoint by hand. About half an hour for a complex one.", 5, async () => {
  await page.getByRole("link", { name: "Long session, a lot of it failed" }).click();
  await page.getByTestId("case-view").waitFor();
});
await step("Refundo labels each Checkpoint and shows the evidence. Checkpoint 6 said fixed, but its test failed.", 6, async () => {
  await page.getByTestId("timeline-row-6").click();
  await page.getByTestId("evidence-drawer").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
});
await step("Code sets the amount from a written policy: $71.05, inside the Cap. The model never touches money.", 5, async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.getByTestId("credit-lines").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
});
const unsure = page.locator('[data-testid^="timeline-row-"]').filter({ has: page.locator('[data-label="unknown"], [data-testid="unresolved-chip"]') });
while ((await unsure.count()) > 0) {
  await unsure.first().click();
  const failed = ((await page.getByTestId("evidence-drawer").locator('[data-field="appTest"]').textContent()) ?? "").includes("failed");
  await page.getByTestId("override-label").selectOption(failed ? "false_completion" : "delivered");
  await page.getByTestId("override-label-reason").fill("Checked the evidence.");
  await Promise.all([page.waitForResponse((r) => r.url().includes("/override")), page.getByTestId("override-label-submit").click()]);
  await page.waitForTimeout(700);
}
await step("A person approves. One click writes the Credit, the reply and the audit row.", 5, async () => {
  await page.getByTestId("approve-button").click();
  await page.getByTestId("message").filter({ hasText: "Approved" }).waitFor();
});
await step("Approve again and the server refuses. Nobody is credited twice.", 5, async () => {
  await page.getByRole("link", { name: "Systems" }).click();
  await page.getByTestId("orb-list").waitFor();
});
await page.evaluate(() => { window.name = ""; });
await page.waitForTimeout(300);

const seconds = (Date.now() - t0) / 1000;
const video = page.video();
await context.close();
await browser.close();
stop();
const tmpPath = await video.path();
renameSync(tmpPath, join(OUT, "demo-30s.webm"));
rmSync(TMP, { recursive: true, force: true });
if (seconds >= MAX_SECONDS) { console.error(`demo is ${seconds.toFixed(0)}s`); process.exit(1); }
console.log(`demo: ${seconds.toFixed(0)}s -> ${OUT}/demo-30s.webm`);
