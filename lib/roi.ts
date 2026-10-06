/**
 * ROI calculator. Every input is blank until the customer fills it in; there are
 * no defaults, because the numbers belong to the company, not to this project.
 */
export interface RoiInputs {
  /** Failed-work Credit Tickets handled per month. */
  ticketsPerMonth?: number | null;
  /** Average specialist minutes per Ticket today. */
  manualMinutes?: number | null;
  /** Average specialist minutes per Ticket with a pre-decided Case to review and approve. */
  assistedMinutes?: number | null;
  /** Loaded cost of a specialist hour, in dollars. */
  loadedHourlyCost?: number | null;
  /** Share of Tickets Refundo can pre-decide, 0 to 1 (not Enterprise, with a Session attached). */
  shareHandled?: number | null;
  /** Optional: chargebacks avoided per month by answering faster. */
  chargebacksAvoidedPerMonth?: number | null;
  /** Optional: cost of one chargeback (the amount, fees and handling). */
  costPerChargeback?: number | null;
  /** Optional: monthly cost of running the tool. */
  monthlyToolCost?: number | null;
}

export interface RoiResult {
  complete: boolean;
  missing: string[];
  hoursSavedPerMonth?: number;
  laborSavedPerMonth?: number;
  chargebackSavedPerMonth?: number;
  netPerMonth?: number;
}

const REQUIRED: [keyof RoiInputs, string][] = [
  ["ticketsPerMonth", "failed-work Credit Tickets per month"],
  ["manualMinutes", "minutes per Ticket today"],
  ["assistedMinutes", "minutes per Ticket with Refundo"],
  ["loadedHourlyCost", "loaded cost of a specialist hour"],
  ["shareHandled", "share of Tickets Refundo can pre-decide"],
];

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * hours saved = tickets x share x (manual minutes - assisted minutes) / 60
 * labor saved = hours saved x hourly cost
 * net = labor saved + chargebacks avoided x cost per chargeback - tool cost
 */
export function roi(i: RoiInputs): RoiResult {
  const missing = REQUIRED.filter(([k]) => !has(i[k])).map(([, label]) => label);
  if (missing.length > 0) return { complete: false, missing };
  const share = Math.min(1, Math.max(0, i.shareHandled!));
  const perTicket = Math.max(0, i.manualMinutes! - i.assistedMinutes!);
  const hours = (i.ticketsPerMonth! * share * perTicket) / 60;
  const labor = hours * i.loadedHourlyCost!;
  const cb = has(i.chargebacksAvoidedPerMonth) && has(i.costPerChargeback) ? i.chargebacksAvoidedPerMonth * i.costPerChargeback : 0;
  const tool = has(i.monthlyToolCost) ? i.monthlyToolCost : 0;
  return {
    complete: true, missing: [], hoursSavedPerMonth: round2(hours), laborSavedPerMonth: round2(labor),
    chargebackSavedPerMonth: round2(cb), netPerMonth: round2(labor + cb - tool),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
