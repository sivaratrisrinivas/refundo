import { expect, test, type Page } from "@playwright/test";

async function persona(page: Page, who: "specialist" | "lead" | "reviewer") {
  const done = page.waitForResponse((r) => r.url().includes("/api/persona") && r.ok());
  await page.getByTestId("persona-switcher").selectOption(who);
  await done;
}

test("gate, queue, the $164.11 Case, evidence, approval, Systems, a refused second approval, Eval and reset", async ({ page }) => {
  // The gate: nothing is reachable without the passcode.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible();
  expect((await page.request.get("/api/mock/orb/ledger")).status()).toBe(401);
  await page.fill('input[name="passcode"]', "wrong");
  await page.click('button[type="submit"]');
  await expect(page.getByText("Wrong passcode.")).toBeVisible();
  await page.fill('input[name="passcode"]', "refundo-demo");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("queue")).toBeVisible();
  await expect(page.getByTestId("synthetic-banner")).toBeVisible();

  // Queue: 40 Tickets, threatened disputes first.
  await expect(page.getByTestId("queue-row")).toHaveCount(40);
  await expect(page.getByTestId("queue-row").first()).toHaveAttribute("data-risk", "high");

  // Start from the seeded state (a Lead may reset).
  await persona(page, "lead");
  await page.goto("/systems");
  await page.getByTestId("reset-demo").click();
  await expect(page.getByRole("status")).toContainText("reset to the seeded state");
  await expect(page.getByTestId("orb-list").getByTestId("outbox-entry")).toHaveCount(1);
  await persona(page, "specialist");

  // The mixed Case.
  await page.goto("/");
  await page.getByRole("link", { name: "Long session, a lot of it failed" }).click();
  await expect(page.getByTestId("case-view")).toBeVisible();
  await expect(page.getByTestId("timeline").locator("li")).toHaveCount(10);
  await expect(page.getByTestId("grievance").first()).toBeVisible();

  // Evidence drawer: exactly the cited fields are highlighted.
  await page.getByTestId("timeline-row-6").click();
  const drawer = page.getByTestId("evidence-drawer");
  await expect(drawer).toContainText("Checkpoint 6");
  expect(await drawer.locator('[data-cited="true"]').count()).toBeGreaterThan(0);
  expect(await drawer.locator('[data-cited="false"]').count()).toBeGreaterThan(0);
  await expect(drawer.locator('[data-field="agentClaimText"]')).toHaveAttribute("data-cited", "true");

  // The banner stays in view while the page scrolls.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const box = await page.getByTestId("synthetic-banner").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(5);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Anything a person must settle gets an Override with a reason.
  for (let guard = 0; guard < 6; guard++) {
    const needs = page.getByTestId("status-banner");
    if ((await needs.getAttribute("data-status")) !== "needs_human") break;
    const row = page.locator('[data-testid^="timeline-row-"]').filter({ has: page.locator('[data-label="unknown"], [data-testid="unresolved-chip"]') }).first();
    await row.click();
    // A person reads the evidence: a failed test with no rollback is a false completion, anything else delivered.
    const failed = (await page.getByTestId("evidence-drawer").locator('[data-field="appTest"]').textContent())?.includes("failed") ?? false;
    await page.getByTestId("override-label").selectOption(failed ? "false_completion" : "delivered");
    await page.getByTestId("override-label-reason").fill("Checked the preview: the work is there and tests passed.");
    await Promise.all([page.waitForResponse((r) => r.url().includes("/override")), page.getByTestId("override-label-submit").click()]);
    await page.waitForTimeout(600);
  }
  await expect(page.getByTestId("status-banner")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("decision-amount")).toHaveText("$71.05");
  await expect(page.getByTestId("lines-total")).toHaveText("$71.05");

  // Approve once.
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("message")).toContainText("Approved");
  await expect(page.getByTestId("status-banner")).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("approve-button")).toBeDisabled();

  // A second Approval is refused by the server, and writes nothing.
  const again = await page.request.post("/api/cases/T-E6/approve");
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("already_approved");

  // The writes landed, once.
  await page.goto("/systems");
  await expect(page.getByTestId("orb-list").getByTestId("outbox-entry")).toHaveCount(2);
  await expect(page.getByTestId("orb-list").getByTestId("outbox-entry").first()).toContainText("$71.05");
  await expect(page.getByTestId("zendesk-list").getByTestId("outbox-entry").first()).toContainText("credit_issued");

  // Roles are enforced on the server: a Reviewer cannot approve.
  await persona(page, "reviewer");
  await page.goto("/cases/T-E2");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
  expect((await page.request.post("/api/cases/T-E2/approve")).status()).toBe(403);

  // Eval: stored figures, tagged simulated.
  await page.goto("/eval");
  await expect(page.getByTestId("eval-disclaimer")).toContainText("simulated, not a real-model measurement");
  await expect(page.getByTestId("metric-labelAgreement")).toBeVisible();

  // Audit shows the chain verified.
  await page.goto("/audit");
  await expect(page.getByTestId("chain-status")).toContainText("Hash chain verified");

  // Reset returns the app to the seeded state.
  await persona(page, "lead");
  await page.goto("/systems");
  await page.getByTestId("reset-demo").click();
  await expect(page.getByRole("status")).toContainText("reset to the seeded state");
  await expect(page.getByTestId("orb-list").getByTestId("outbox-entry")).toHaveCount(1);
});

test("keyboard shortcuts move through the timeline and respect the approve gate", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="passcode"]', "refundo-demo");
  await page.click('button[type="submit"]');
  await page.goto("/cases/T-E13"); // Enterprise: recommendation only
  const first = await page.locator('[aria-current="true"]').getAttribute("data-testid");
  await page.keyboard.press("j");
  await expect(page.locator('[aria-current="true"]')).not.toHaveAttribute("data-testid", first ?? "");
  await page.keyboard.press("k");
  await expect(page.locator('[aria-current="true"]')).toHaveAttribute("data-testid", first ?? "");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
  await page.keyboard.press("a"); // does nothing: the button is disabled
  await expect(page.getByTestId("status-banner")).toHaveAttribute("data-status", "recommend_only");
  // typing in the reply field does not trigger shortcuts
  await page.getByTestId("reply-textarea").click();
  await page.keyboard.type("jka");
  await expect(page.getByTestId("status-banner")).toHaveAttribute("data-status", "recommend_only");
});
