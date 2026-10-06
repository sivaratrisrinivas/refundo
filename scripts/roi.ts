import { roi, type RoiInputs } from "@/lib/roi";

// Usage: bun run roi -- --tickets 400 --manual 30 --assisted 6 --rate 45 --share 0.7 [--chargebacks 3 --chargeback-cost 120 --tool-cost 500]
const args = process.argv.slice(2);
const num = (name: string) => { const i = args.indexOf(`--${name}`); const v = i >= 0 ? Number(args[i + 1]) : NaN; return Number.isFinite(v) ? v : null; };
const inputs: RoiInputs = {
  ticketsPerMonth: num("tickets"), manualMinutes: num("manual"), assistedMinutes: num("assisted"), loadedHourlyCost: num("rate"),
  shareHandled: num("share"), chargebacksAvoidedPerMonth: num("chargebacks"), costPerChargeback: num("chargeback-cost"), monthlyToolCost: num("tool-cost"),
};
const r = roi(inputs);
if (!r.complete) {
  console.log("The inputs are blank on purpose: they are the company's numbers. Still needed:");
  for (const m of r.missing) console.log(`  - ${m}`);
  console.log("\nExample: bun run roi -- --tickets 400 --manual 30 --assisted 6 --rate 45 --share 0.7   (illustrative values, not data)");
  process.exit(0);
}
console.log(`hours saved per month:   ${r.hoursSavedPerMonth}`);
console.log(`labor saved per month:   $${r.laborSavedPerMonth}`);
console.log(`chargebacks avoided:     $${r.chargebackSavedPerMonth}`);
console.log(`net per month:           $${r.netPerMonth}`);
