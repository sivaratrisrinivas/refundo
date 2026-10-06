// Records the silent demo walkthrough: one Playwright run through the real UI, captions burned in,
// no narration. Writes docs/demo/walkthrough.webm and docs/demo/script.md. Run: bun run walkthrough
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PORT = 3201;
const BASE = `http://localhost:${PORT}`;
const chrome = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "docs/demo";
const TMP = "test-results/walkthrough-video";
const MAX_SECONDS = 175;

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
if (!A || !B) throw new Error("run `bun run eval -- --model A` and `--model B` first: the walkthrough shows stored figures");

rmSync("data/walkthrough.db", { force: true });
rmSync("data/walkthrough.db-wal", { force: true });
rmSync("data/walkthrough.db-shm", { force: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn("bun", ["--bun", "next", "start", "-p", String(PORT)], { env: { ...process.env, REFUNDO_DB: "data/walkthrough.db" }, stdio: "ignore" });
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
await step("Invite-only demo. Everything here is synthetic, and the banner says so on every page.", 6);
await step("Enter the passcode. This is demo-grade sign-in; the server still checks the role on every action.", 6, async () => {
  await page.fill('input[name="passcode"]', "refundo-demo");
  await page.click('button[type="submit"]');
  await page.getByTestId("queue").waitFor();
});
await step("The Queue is sorted by chargeback risk, then age. Tickets that threaten a dispute sit on top.", 8);
await step("Open the $164.11 mixed Session. The Ticket text keeps the extracted grievances highlighted.", 8, async () => {
  await page.getByRole("link", { name: "Long session, a lot of it failed" }).click();
  await page.getByTestId("case-view").waitFor();
});
await step("Checkpoints 4 and 5 repeat one error: a loop, decided by a rule. Checkpoints 2 and 3 are the first two repeats and are not credited.", 10, async () => {
  await page.getByTestId("timeline-row-4").click();
});
await step("Checkpoint 6 claimed the CSV export was fixed while its test failed. The evidence drawer highlights only the fields the Label cites.", 12, async () => {
  await page.getByTestId("timeline-row-6").click();
  await page.getByTestId("evidence-drawer").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
});
await step("Only code sets the amount, from a written policy: Credit lines for each Checkpoint, summing to the total, inside the Pro Cap.", 9, async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.getByTestId("credit-lines").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
});
// A model may be unsure of a Checkpoint. Then a person decides, with a reason. Settling one can shift the
// model's draws on the rest (its input changed), so keep going until nothing is flagged.
const unsure = page.locator('[data-testid^="timeline-row-"]').filter({ has: page.locator('[data-label="unknown"], [data-testid="unresolved-chip"]') });
let first = true;
while ((await unsure.count()) > 0) {
  const settle = async () => {
    await unsure.first().click();
    // A person reads the evidence: a failed test with no rollback is a false completion, anything else delivered.
    const failed = ((await page.getByTestId("evidence-drawer").locator('[data-field="appTest"]').textContent()) ?? "").includes("failed");
    await page.getByTestId("override-label").selectOption(failed ? "false_completion" : "delivered");
    await page.getByTestId("override-label-reason").fill(failed ? "The test for this claim failed, so the claim is not true." : "Checked the preview: the work is there and tests passed.");
    await Promise.all([page.waitForResponse((r) => r.url().includes("/override")), page.getByTestId("override-label-submit").click()]);
    await page.waitForTimeout(900);
  };
  if (first) { first = false; await step("The Simulated model was not confident about a Checkpoint, so it became Unknown. A person settles it, and must give a reason.", 11, settle); }
  else await step("Settling it changed the model's other answers a little: another Checkpoint is flagged. The person settles that one too.", 9, settle);
}
await step("Approve once. One transaction writes the Orb credit at zero cost basis, the itemized reply and the audit row.", 8, async () => {
  await page.getByTestId("approve-button").click();
  await page.getByTestId("message").filter({ hasText: "Approved" }).waitFor();
});
await step("The Systems page shows the writes landing in the mock Orb, Zendesk and Linear.", 9, async () => {
  await page.getByRole("link", { name: "Systems" }).click();
  await page.getByTestId("orb-list").waitFor();
});
let refused = "";
await step("Approving the same Session again is refused by the server. Nothing is written twice.", 8, async () => {
  const r = await page.evaluate(async () => { const x = await fetch("/api/cases/T-E6/approve", { method: "POST" }); return `${x.status} ${(await x.json()).code}`; });
  refused = r;
  await page.evaluate((t) => { window.name = t; }, `Approving the same Session again is refused by the server: ${r}. Nothing is written twice.`);
});
await step("The audit log is for Lead and Reviewer, so switch Persona. It is append-only and hash-chained: any edit would break the chain.", 8, async () => {
  await personaTo("lead");
  await page.getByRole("link", { name: "Audit" }).click();
  await page.getByTestId("chain-status").waitFor();
});
await step(`Eval, all simulated: label agreement ${pct(A.metrics.labelAgreement.value)} on model A and ${pct(B.metrics.labelAgreement.value)} on model B, read from stored reports. The guardrails, not the models, are what is measured.`, 13, async () => {
  await page.getByRole("link", { name: "Eval" }).click();
  await page.getByTestId("metrics-table").waitFor();
});
await step("A Lead can reset the demo: the app returns to the exact seeded state, ready to run again.", 8, async () => {
  await page.getByRole("link", { name: "Systems" }).click();
  await page.getByTestId("reset-demo").click();
  await page.getByRole("status").filter({ hasText: "reset" }).waitFor();
});
await page.evaluate(() => { window.name = ""; });
await page.waitForTimeout(500);

const seconds = (Date.now() - t0) / 1000;
const video = page.video();
await context.close();
await browser.close();
stop();
const tmpPath = await video.path();
renameSync(tmpPath, join(OUT, "walkthrough.webm"));
rmSync(TMP, { recursive: true, force: true });

if (seconds >= MAX_SECONDS) { console.error(`walkthrough is ${seconds.toFixed(0)}s, over the ${MAX_SECONDS}s limit`); process.exit(1); }
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const script = [
  "# Demo walkthrough: captioned script",
  "",
  "Silent recording (`walkthrough.webm`, about " + fmt(seconds) + ") of one Playwright run through the real UI. There is no narration and no human-recorded portion. The captions below are burned into the video. The banner \"All data is synthetic\" is visible throughout.",
  "",
  "Regenerate with `bun run walkthrough` after `bun run e2e`'s build. Every metric shown comes from the stored eval reports (`eval/reports/`).",
  "",
  "| Time | What is on screen and what the caption says |",
  "| --- | --- |",
  ...steps.map((s) => `| ${fmt(s.at)} | ${s.caption.replace(/\|/g, "/")} |`),
  "",
  `Second Approval attempt, as recorded: \`${refused}\`.`,
  "",
].join("\n");
writeFileSync(join(OUT, "script.md"), script);
console.log(`walkthrough: ${seconds.toFixed(0)}s, ${steps.length} steps -> ${OUT}/walkthrough.webm`);
