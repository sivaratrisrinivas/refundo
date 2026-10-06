import { rngFrom, pick } from "@/lib/models/rng";
import { errorSignature } from "@/lib/pipeline/normalize";
import { DEMO_NOW_ISO } from "@/lib/clock";
import { BUG_SIGNATURES, INCIDENTS } from "./entities";
import { claimText, requestText, ticketText } from "./placeholder-text";
import type {
  CheckpointPlan, Dataset, DatasetAccount, DatasetCheckpoint, DatasetSession, DatasetTicket,
  Plant, TextOverrides, TicketStance,
} from "./types";

/**
 * Deterministic dataset generator. Graded sessions are built from the plants in
 * eval/expected.json (written and committed first); fillers come from seeded
 * random combinations of the four dimensions. The Failure pattern is stored on
 * the Session for the generator and eval only.
 */

export interface ExpectedFile {
  sessions: {
    caseId: string; sessionId: string; ticketId: string; failurePattern: string; ticketStance: TicketStance;
    accountSituation: string; evidenceClarity: string;
    account: { plan: "core" | "pro" | "enterprise"; creditsGranted30dCents: number; priorDisputes: number; tenureDays: number };
    ticket: { disputeThreatened: boolean; ageHours: number };
    priorCredit: { amountCents: number; approvedOn: string } | null;
    checkpoints: { seq: number; mode: "free" | "power" | "max"; costCents: number; plant: Plant }[];
  }[];
}

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse(DEMO_NOW_ISO);

const TOPICS = [
  "dark mode toggle", "user profile", "invoice export", "search filters", "settings panel", "onboarding checklist",
  "notification bell", "team invite", "pricing table", "comment threads", "file uploader", "activity feed",
  "keyboard shortcuts", "usage chart", "avatar cropper", "language picker",
];
const ERROR_GROUPS: Record<string, (i: number) => string> = {
  X: (i) => `TypeError: Cannot read properties of undefined (reading 'map') at /home/runner/app/src/components/List.tsx:${20 + i}:${7 + i}`,
  Y: (i) => `Error: connect ECONNREFUSED 127.0.0.1:5432 at TCPConnectWrap.afterConnect (node:net:16${i}0:16) addr 0x7f3a${i}b2c`,
  L: (i) => `ReferenceError: reportData is not defined at /home/runner/app/src/pages/report.tsx:${40 + i}:${3 + i}`,
  I1: (i) => `Upstream model request failed with 503 service unavailable (request ${i}a1f2c3d-0000-4000-8000-00000000000${i})`,
  I2: (i) => `Agent tool call timed out after 120s waiting on the build queue (attempt ${i + 2})`,
  Z1: (i) => `SyntaxError: Unexpected token '<' in /home/runner/app/src/api/handler.ts:${12 + i}:${1 + i}`,
  Z2: (i) => `Module not found: Can't resolve './components/Chart' in '/home/runner/app/src/views' line ${8 + i}`,
  Z3: (i) => `Unhandled promise rejection: fetch failed at /home/runner/app/src/lib/api.ts:${30 + i}:${9 + i}`,
};
const UNRELATED_FILES = ["package.json", "src/lib/utils.ts", "src/styles/global.css", "tsconfig.json", "src/config/env.ts"];

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function firstKeyword(topic: string) { return topic.split(/\s+/).find((w) => w.length >= 4) ?? topic; }

interface SessionPlan {
  id: string; ticketId: string; accountId: string; pattern: string; stance: TicketStance; graded: boolean;
  dispute: boolean; ageHours: number; cps: CheckpointPlan[]; startIso?: string; spacingMin?: number;
}

function buildCheckpoints(plan: SessionPlan, rng: () => number, overrides: TextOverrides): DatasetCheckpoint[] {
  const spacing = plan.spacingMin ?? 18;
  const ticketAt = NOW - plan.ageHours * 60 * MIN;
  const lastTs = ticketAt - 90 * MIN;
  const start = plan.startIso ? Date.parse(plan.startIso) : lastTs - (plan.cps.length - 1) * spacing * MIN;
  const groupCount: Record<string, number> = {};
  const topicPool = [...TOPICS];

  return plan.cps.map((c, i) => {
    const seq = i + 1;
    const p = c.plant;
    const id = `${plan.id}-c${seq}`;
    const ts = start + i * spacing * MIN;
    const fixing = Boolean(p.errorGroup) || p.claim === "contradicted_by_test";
    const picked = topicPool[Math.floor(rng() * topicPool.length)]!;
    const topic = p.claimTopic ?? (p.request ? p.request.replace(/^(?:make|tweak|change)\s+(?:the\s+)?/, "") : picked);
    const kind = p.claim ?? "verified";

    // Files
    let files: string[];
    if (p.planMode || kind === "plan" || p.noEvidence) files = [];
    else if (p.files !== undefined) {
      // A contradicted claim must have no matching file, so its files live elsewhere.
      const dir = kind === "contradicted_by_test" ? "misc" : slug(firstKeyword(topic));
      files = Array.from({ length: p.files }, (_, k) => `src/components/${dir}/${dir}-part-${k + 1}.tsx`);
      if (kind === "verified" && p.files > 0 && !files.some((f) => f.includes(slug(firstKeyword(topic))))) {
        files[0] = `src/features/${slug(topic)}.tsx`;
      }
    } else if (kind === "verified") {
      files = [`src/features/${slug(topic)}.tsx`, pick(rng, UNRELATED_FILES)];
    } else {
      files = [pick(rng, UNRELATED_FILES), "src/lib/helpers.ts"];
    }

    // Tests
    const testKind = p.test ?? "pass";
    const failedSteps = testKind === "fail" ? [p.failedStep ?? "primary user flow works"] : [];
    const appTest = { ran: testKind !== "not_run", passed: testKind === "not_run" ? null : testKind === "pass", failedSteps };

    // Errors
    let errorText: string | null = null;
    if (p.errorGroup) {
      groupCount[p.errorGroup] = (groupCount[p.errorGroup] ?? 0) + 1;
      errorText = ERROR_GROUPS[p.errorGroup]!(groupCount[p.errorGroup]!);
    }
    if (p.bugSignature === "bug-task-merge-duplication") {
      errorText = `Post-merge check failed: duplicated file content detected in src/pages/Home.tsx after the task merge`;
    }

    // Rollbacks
    let rolledBackAt: string | null = null;
    if (p.rollbackAfterMin !== undefined) rolledBackAt = iso(ts + p.rollbackAfterMin * MIN);
    if (p.userRollbackAfterMin !== undefined) rolledBackAt = iso(ts + p.userRollbackAfterMin * MIN);

    const mode = c.mode;
    const text = overrides.checkpoints?.[id];
    const claim = kind === "plan" || p.planMode ? claimText("plan", topic, false) : claimText(kind, topic, fixing);
    return {
      id, sessionId: plan.id, seq, ts: iso(ts), mode,
      model: mode === "free" ? "agent-lite" : mode === "max" ? "agent-large-max" : "agent-large",
      reasoningEffort: mode === "max" ? "high" : mode === "free" ? "low" : "medium",
      costCents: c.costCents,
      requestText: text?.requestText ?? requestText(topic, fixing, p.request),
      agentClaimText: text?.agentClaimText ?? (p.noEvidence ? "" : claim),
      filesChanged: files,
      linesAdded: files.length === 0 ? 0 : Math.round(8 + rng() * 40 * Math.min(files.length, 6)),
      linesRemoved: files.length === 0 ? 0 : Math.round(rng() * 12 * Math.min(files.length, 6)),
      appTest, rolledBackAt, errorText, errorSignature: errorSignature(errorText),
      orbBlockId: `blk_${plan.id.toLowerCase().replace(/[^a-z0-9]/g, "")}_${seq}`,
      planMode: Boolean(p.planMode),
    };
  });
}

// --- Filler plans ------------------------------------------------------------

function cost(rng: () => number, lo: number, hi: number) { return Math.round(lo + rng() * (hi - lo)); }
const D = (c: number, plant: Plant = {}): CheckpointPlan => ({ mode: "power", costCents: c, plant: { claim: "verified", test: "pass", ...plant } });

function fillerCheckpoints(pattern: string, clarity: string, rng: () => number): CheckpointPlan[] {
  const n = 9 + Math.floor(rng() * 5);
  const cps: CheckpointPlan[] = Array.from({ length: n }, () => D(cost(rng, 60, 1200)));
  const at = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  switch (pattern) {
    case "loop": {
      const g = pick(rng, ["Z1", "Z2", "Z3"]);
      const len = 3 + Math.floor(rng() * 4);
      const s = at(1, n - len - 1);
      for (let i = 0; i < len; i++) cps[s + i] = D(cost(rng, 300, 900), { errorGroup: g, test: "not_run" });
      break;
    }
    case "false_completion": {
      const k = 1 + Math.floor(rng() * 2);
      for (let j = 0; j < k; j++) {
        const t = pick(rng, ["checkout", "report", "settings save", "notifications"]);
        cps[at(1, n - 2)] = { mode: "power", costCents: cost(rng, 600, 2400), plant: { claim: "contradicted_by_test", test: "fail", claimTopic: t, failedStep: `${t} works end to end` } };
      }
      break;
    }
    case "reverted_after_fail": {
      const j = at(1, n - 2);
      cps[j] = { mode: "power", costCents: cost(rng, 700, 2200), plant: { claim: "verified", test: "fail", failedStep: "main page renders", rollbackAfterMin: 5 + Math.floor(rng() * 21) } };
      break;
    }
    case "scope_overrun": {
      cps[at(1, n - 2)] = { mode: "power", costCents: cost(rng, 1500, 2800), plant: { claim: "verified", test: "pass", files: 40 + Math.floor(rng() * 21), requestClass: "style", request: "change the primary button color" } };
      break;
    }
    case "incident_overlap": {
      const inc = INCIDENTS[0]!; // filler sessions are placed inside this window
      const j = at(1, n - 3);
      cps[j] = { mode: "power", costCents: cost(rng, 500, 1500), plant: { claim: "verified", test: "not_run", errorGroup: "I1", incident: inc.id } };
      cps[j + 1] = { mode: "power", costCents: cost(rng, 500, 1500), plant: { claim: "verified", test: "not_run", errorGroup: "I2", incident: inc.id } };
      break;
    }
    case "known_bug":
      cps[at(1, n - 2)] = { mode: "power", costCents: cost(rng, 900, 2000), plant: { claim: "verified", test: "not_run", bugSignature: "bug-task-merge-duplication" } };
      break;
    case "user_choice_rollback":
      cps[at(1, n - 2)] = { mode: "power", costCents: cost(rng, 700, 1800), plant: { claim: "verified", test: "pass", userRollbackAfterMin: 40 + Math.floor(rng() * 120) } };
      break;
    case "mixed":
      for (let i = 0; i < n; i++) cps[i] = D(cost(rng, 1200, 2400));
      cps[3] = { mode: "power", costCents: cost(rng, 1500, 2400), plant: { claim: "contradicted_by_test", test: "fail", claimTopic: "csv export", failedStep: "export report to csv" } };
      cps[6] = { mode: "power", costCents: cost(rng, 1500, 2400), plant: { claim: "verified", test: "fail", failedStep: "invoice totals match", rollbackAfterMin: 12 } };
      break;
    default:
      break;
  }
  if (clarity === "borderline") {
    const j = cps.findIndex((c) => c.plant.claim === "verified" && c.plant.test === "pass" && !c.plant.files);
    if (j >= 0) cps[j] = { ...cps[j]!, plant: { ...cps[j]!.plant, claim: "unverifiable" } };
  }
  if (clarity === "ambiguous") {
    const j = cps.findIndex((c) => c.plant.claim === "verified" && c.plant.test === "pass" && !c.plant.files);
    if (j >= 0) cps[j] = { ...cps[j]!, plant: { ...cps[j]!.plant, test: "fail", failedStep: "unrelated smoke check" } };
  }
  if (clarity === "missing") {
    const j = cps.findIndex((c) => c.plant.claim === "verified" && c.plant.test === "pass" && !c.plant.files);
    if (j >= 0) cps[j] = { mode: "power", costCents: cps[j]!.costCents, plant: { noEvidence: true, claim: "none", test: "not_run" } };
  }
  return cps;
}

// --- Accounts ---------------------------------------------------------------

const FIRST = ["Priya", "Marcus", "Elena", "Tomasz", "Aisha", "Daniel", "Mei", "Oluwaseun", "Sofia", "Kenji", "Hannah", "Rafael", "Ingrid", "Samir", "Lucia", "Viktor", "Nadia", "Ben", "Chloe", "Arjun", "Mateo", "Yara", "Felix", "Zoe", "Hugo", "Leila", "Owen", "Sana", "Pavel", "Imani"];
const LAST = ["Raman", "Okafor", "Lindqvist", "Nowak", "Haddad", "Mercer", "Tanaka", "Adeyemi", "Rossi", "Sato", "Becker", "Alvarez", "Holm", "Qureshi", "Moreno", "Petrov", "Karimi", "Walsh", "Dubois", "Nair", "Silva", "Farah", "Weiss", "Chen", "Costa", "Rahimi", "Doyle", "Iqbal", "Novak", "Mwangi"];

const FILLER_ACCOUNTS: { situation: string; plan: "core" | "pro" | "enterprise"; granted: number; disputes: number }[] = [
  { situation: "core_fresh", plan: "core", granted: 0, disputes: 0 },
  { situation: "core_fresh", plan: "core", granted: 0, disputes: 0 },
  { situation: "core_fresh", plan: "core", granted: 0, disputes: 0 },
  { situation: "core_near_cap", plan: "core", granted: 3500, disputes: 0 },
  { situation: "core_near_cap", plan: "core", granted: 4200, disputes: 0 },
  { situation: "pro_with_headroom", plan: "pro", granted: 0, disputes: 0 },
  { situation: "pro_with_headroom", plan: "pro", granted: 0, disputes: 0 },
  { situation: "pro_with_headroom", plan: "pro", granted: 0, disputes: 0 },
  { situation: "pro_dispute_history", plan: "pro", granted: 0, disputes: 3 },
  { situation: "enterprise", plan: "enterprise", granted: 0, disputes: 0 },
];

// 20 fillers: (pattern, stance, clarity). Five Tickets in total threaten a chargeback
// (E17 plus four here) and three carry an injection attempt (E14 plus two here).
const FILLERS: { pattern: string; stance: TicketStance; clarity: string }[] = [
  { pattern: "clean_delivered", stance: "calm", clarity: "clear" },
  { pattern: "clean_delivered", stance: "frustrated", clarity: "clear" },
  { pattern: "clean_delivered", stance: "vague", clarity: "clear" },
  { pattern: "clean_delivered", stance: "chargeback_threat", clarity: "clear" },
  { pattern: "clean_delivered", stance: "calm", clarity: "borderline" },
  { pattern: "clean_delivered", stance: "about_the_wrong_thing", clarity: "clear" },
  { pattern: "clean_delivered", stance: "frustrated", clarity: "ambiguous" },
  { pattern: "clean_delivered", stance: "injection_attempt", clarity: "clear" },
  { pattern: "loop", stance: "frustrated", clarity: "clear" },
  { pattern: "loop", stance: "chargeback_threat", clarity: "clear" },
  { pattern: "loop", stance: "calm", clarity: "borderline" },
  { pattern: "false_completion", stance: "frustrated", clarity: "clear" },
  { pattern: "false_completion", stance: "chargeback_threat", clarity: "borderline" },
  { pattern: "reverted_after_fail", stance: "calm", clarity: "clear" },
  { pattern: "reverted_after_fail", stance: "vague", clarity: "ambiguous" },
  { pattern: "scope_overrun", stance: "frustrated", clarity: "clear" },
  { pattern: "incident_overlap", stance: "calm", clarity: "clear" },
  { pattern: "incident_overlap", stance: "injection_attempt", clarity: "borderline" },
  { pattern: "known_bug", stance: "chargeback_threat", clarity: "clear" },
  { pattern: "mixed", stance: "vague", clarity: "ambiguous" },
];

function usd(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export function generateDataset(expected: ExpectedFile, overrides: TextOverrides = {}): Dataset {
  const accounts: DatasetAccount[] = [];
  const sessions: DatasetSession[] = [];
  const checkpoints: DatasetCheckpoint[] = [];
  const tickets: DatasetTicket[] = [];
  const priorDecisions: Dataset["priorDecisions"] = [];
  const person = (n: number) => `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`;
  const orb = (n: number) => `cus_${(900000 + n * 137).toString(36)}`;
  let acctN = 0;

  const addTicketAndSession = (plan: SessionPlan, acctId: string, rngCp: () => number) => {
    const cps = buildCheckpoints(plan, rngCp, overrides);
    const total = cps.reduce((a, c) => a + c.costCents, 0);
    sessions.push({
      id: plan.id, accountId: acctId, startedAt: cps[0]!.ts, totalCostCents: total,
      failurePattern: plan.pattern, graded: plan.graded,
    });
    checkpoints.push(...cps);
    const text = overrides.tickets?.[plan.ticketId] ?? ticketText(plan.stance, plan.id, usd(total));
    const rngT = rngFrom("refundo-dataset", "ticket", plan.ticketId);
    tickets.push({
      id: plan.ticketId, accountId: acctId, sessionId: plan.id, subject: text.subject, body: text.body,
      tags: ["billing", "agent_usage"],
      piId: `pi_${Math.floor(rngT() * 0xffffffff).toString(16).padStart(8, "0")}${Math.floor(rngT() * 0xffffff).toString(16).padStart(6, "0")}`,
      disputeThreatened: plan.dispute, createdAt: iso(NOW - plan.ageHours * 60 * MIN), status: "open",
    });
  };

  // Graded sessions
  for (const s of expected.sessions) {
    const rng = rngFrom("refundo-dataset", "graded", s.sessionId);
    const a = s.account;
    const acct: DatasetAccount = {
      id: `A-${s.caseId}`, name: person(acctN), plan: a.plan, tenureDays: a.tenureDays,
      creditsGranted30dCents: a.creditsGranted30dCents, priorDisputes: a.priorDisputes,
      orbCustomerId: orb(acctN), situation: s.accountSituation,
    };
    acctN++;
    accounts.push(acct);
    const isE7 = s.caseId === "E7";
    addTicketAndSession(
      {
        id: s.sessionId, ticketId: s.ticketId, accountId: acct.id, pattern: s.failurePattern, stance: s.ticketStance, graded: true,
        dispute: s.ticket.disputeThreatened, ageHours: s.ticket.ageHours,
        cps: s.checkpoints.map((c) => ({ mode: c.mode, costCents: c.costCents, plant: c.plant })),
        startIso: isE7 ? "2026-09-17T14:05:00Z" : undefined, spacingMin: isE7 ? 15 : 18,
      },
      acct.id, rng,
    );
    if (s.priorCredit) {
      priorDecisions.push({
        id: `D-${s.caseId}-prior`, ticketId: `T-${s.caseId}-prior`, sessionId: s.sessionId,
        amountCents: s.priorCredit.amountCents, approvedOn: s.priorCredit.approvedOn, approver: "specialist",
      });
    }
  }

  // Filler accounts (10) and sessions (20)
  const fillerAcctIds: string[] = [];
  const accRng = rngFrom("refundo-dataset", "filler-accounts");
  FILLER_ACCOUNTS.forEach((f, i) => {
    const acct: DatasetAccount = {
      id: `A-F${String(i + 1).padStart(2, "0")}`, name: person(acctN), plan: f.plan,
      tenureDays: 5 + Math.floor(accRng() * 895), creditsGranted30dCents: f.granted, priorDisputes: f.disputes,
      orbCustomerId: orb(acctN), situation: f.situation,
    };
    acctN++;
    accounts.push(acct);
    fillerAcctIds.push(acct.id);
  });

  FILLERS.forEach((f, i) => {
    const num = String(i + 1).padStart(2, "0");
    const rng = rngFrom("refundo-dataset", "filler", num);
    addTicketAndSession(
      {
        id: `S-F${num}`, ticketId: `T-F${num}`, accountId: fillerAcctIds[i % fillerAcctIds.length]!, pattern: f.pattern,
        stance: f.stance, graded: false, dispute: f.stance === "chargeback_threat", ageHours: 4 + Math.floor(rng() * 200),
        cps: fillerCheckpoints(f.pattern, f.clarity, rng),
        startIso: f.pattern === "incident_overlap" ? "2026-09-17T14:20:00Z" : undefined,
        spacingMin: f.pattern === "incident_overlap" ? 12 : 18,
      },
      fillerAcctIds[i % fillerAcctIds.length]!, rng,
    );
  });

  return {
    accounts, sessions, checkpoints, tickets,
    incidents: INCIDENTS, bugSignatures: BUG_SIGNATURES, priorDecisions,
  };
}
