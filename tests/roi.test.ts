import { describe, expect, test } from "bun:test";
import { roi } from "@/lib/roi";

describe("ROI calculator", () => {
  test("blank inputs give no result and name what is missing", () => {
    const r = roi({});
    expect(r.complete).toBe(false);
    expect(r.missing).toHaveLength(5);
    expect(r.netPerMonth).toBeUndefined();
    expect(roi({ ticketsPerMonth: null, manualMinutes: undefined }).complete).toBe(false);
  });

  test("a partly filled form says what is still missing", () => {
    const r = roi({ ticketsPerMonth: 100, manualMinutes: 30 });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["minutes per Ticket with Refundo", "loaded cost of a specialist hour", "share of Tickets Refundo can pre-decide"]);
  });

  test("filled inputs give hours, labor and net", () => {
    const r = roi({ ticketsPerMonth: 400, manualMinutes: 30, assistedMinutes: 6, loadedHourlyCost: 45, shareHandled: 0.5 });
    expect(r).toMatchObject({ complete: true, hoursSavedPerMonth: 80, laborSavedPerMonth: 3600, chargebackSavedPerMonth: 0, netPerMonth: 3600 });
  });

  test("chargebacks and tool cost adjust the net", () => {
    const r = roi({ ticketsPerMonth: 400, manualMinutes: 30, assistedMinutes: 6, loadedHourlyCost: 45, shareHandled: 0.5, chargebacksAvoidedPerMonth: 2, costPerChargeback: 100, monthlyToolCost: 300 });
    expect(r.netPerMonth).toBe(3600 + 200 - 300);
  });

  test("assisted time above manual time saves nothing, and the share is clamped", () => {
    expect(roi({ ticketsPerMonth: 10, manualMinutes: 5, assistedMinutes: 9, loadedHourlyCost: 60, shareHandled: 2 }).hoursSavedPerMonth).toBe(0);
    expect(roi({ ticketsPerMonth: 60, manualMinutes: 60, assistedMinutes: 0, loadedHourlyCost: 10, shareHandled: 5 }).hoursSavedPerMonth).toBe(60);
  });
});
