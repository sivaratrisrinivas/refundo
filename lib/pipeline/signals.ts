import { minutesBetween } from "@/lib/clock";
import type { Policy, RequestClass } from "@/lib/policy/policy";
import { isScopeOverrun, loopIsCredited, revertWithinWindow, scopeRatio } from "@/lib/policy/rules";
import { LABEL_PRECEDENCE, type Checkpoint, type CheckpointLabel, type Label } from "@/lib/policy/types";
import type { CaseBugSignature, CaseIncident } from "./types";

/** Stage 3: deterministic signals. They settle what rules can; the rest pass on unresolved. */

export interface SignalResult {
  checkpointId: string;
  /** The rule Label, when a rule settled this Checkpoint. */
  label: CheckpointLabel | null;
  /** Free-mode Checkpoints are visible but excluded from labeling and Credit. */
  excluded: boolean;
  /** Matches that lost on precedence, kept as secondary evidence. */
  alsoMatched: Label[];
  /** Plain-language flags handed to the model step ("scope_ratio:19", "repeat 1 of 3"). */
  flags: string[];
  /** Annotation like "repeat 1 of 3" for a loop's first two repeats. */
  note?: string;
}

const CLASS_KEYWORDS: [RequestClass, RegExp][] = [
  ["refactor", /refactor|restructure|migrate|clean ?up/i],
  ["style", /colou?r|style|theme|font|spacing|visible|button|footer|header/i],
  ["fix", /\bfix|bug|broken|crash|error|repair/i],
  ["feature", /\badd|build|create|implement|set up|need|start|put together|draft/i],
];

export function requestClass(requestText: string): RequestClass {
  return CLASS_KEYWORDS.find(([, re]) => re.test(requestText))?.[0] ?? "feature";
}

function errored(c: Checkpoint): boolean {
  return c.errorText !== null || c.appTest.passed === false;
}

/** Runs of 3+ consecutive Checkpoints with one error signature. Returns a map id -> 1-based position and run length. */
export function loopRuns(cps: Checkpoint[]): Map<string, { position: number; length: number }> {
  const out = new Map<string, { position: number; length: number }>();
  let i = 0;
  while (i < cps.length) {
    const sig = cps[i]!.errorSignature;
    let j = i;
    while (sig && j + 1 < cps.length && cps[j + 1]!.errorSignature === sig && cps[j + 1]!.seq === cps[j]!.seq + 1) j++;
    const len = j - i + 1;
    if (sig && len >= 3) for (let k = i; k <= j; k++) out.set(cps[k]!.id, { position: k - i + 1, length: len });
    i = j + 1;
  }
  return out;
}

export function runSignals(
  checkpoints: Checkpoint[],
  incidents: CaseIncident[],
  bugs: CaseBugSignature[],
  policy: Policy,
): SignalResult[] {
  const loops = loopRuns(checkpoints);
  return checkpoints.map((c): SignalResult => {
    if (c.mode === "free" || c.costCents === 0) {
      return { checkpointId: c.id, label: null, excluded: true, alsoMatched: [], flags: ["free_mode"] };
    }
    const matches = new Map<Label, CheckpointLabel>();
    const add = (label: Label, evidenceFields: CheckpointLabel["evidenceFields"], extra: Partial<CheckpointLabel> = {}) => {
      matches.set(label, { checkpointId: c.id, label, evidenceFields, source: "rule", confidence: 1, ...extra });
    };
    const flags: string[] = [];

    // known_bug: signature regex against the file list and the error text.
    const haystack = `${c.filesChanged.join("\n")}\n${c.errorText ?? ""}`;
    const bug = bugs.find((b) => new RegExp(b.pattern, "i").test(haystack));
    // Both the diff (file list) and the error text were examined, so both are cited.
    if (bug) add("known_bug", ["bug_signature", "filesChanged", ...(c.errorText ? (["errorText"] as const) : [])]);

    // incident_overlap: inside a public incident window and the Checkpoint errored.
    const inc = incidents.find((i) => c.ts >= i.startsAt && c.ts <= i.endsAt);
    if (inc && errored(c)) add("incident_overlap", ["ts", "incident"]);

    // reverted_after_fail / outside-window rollback.
    let outsideWindow = false;
    if (c.appTest.passed === false && c.rolledBackAt) {
      if (revertWithinWindow(minutesBetween(c.ts, c.rolledBackAt), policy)) {
        add("reverted_after_fail", ["appTest", "rolledBackAt"]);
      } else {
        outsideWindow = true;
        flags.push("rollback_outside_window");
      }
    }

    // loop: 3rd repeat onward is credited; the first two get an annotation.
    let note: string | undefined;
    const run = loops.get(c.id);
    if (run) {
      if (loopIsCredited(run.position, policy)) add("loop", ["errorSignature"], { repeat: run.position });
      else {
        note = `repeat ${run.position} of 3`;
        flags.push(note);
      }
    }

    // scope_overrun: files vs the pinned median for the request class.
    const klass = requestClass(c.requestText);
    const ratio = scopeRatio(c.filesChanged.length, klass, policy);
    if (ratio >= 5) flags.push(`scope_ratio:${Math.round(ratio * 10) / 10}`);
    if (isScopeOverrun(c.filesChanged.length, klass, policy)) add("scope_overrun", ["filesChanged"]);

    // user_choice_rollback: rolled back with no failure signal.
    if (c.rolledBackAt && c.appTest.passed !== false && c.errorText === null) add("user_choice_rollback", ["rolledBackAt"]);

    // planning: Plan Mode, no files, the claim describes a plan.
    if (c.planMode && c.filesChanged.length === 0 && /\bplan\b/i.test(c.agentClaimText)) {
      add("planning", ["planMode", "filesChanged"]);
    }

    const winner = LABEL_PRECEDENCE.find((l) => matches.has(l));
    if (winner) {
      return {
        checkpointId: c.id,
        label: { ...matches.get(winner)!, alsoMatched: [...matches.keys()].filter((l) => l !== winner) as Label[] },
        excluded: false,
        alsoMatched: [...matches.keys()].filter((l) => l !== winner) as Label[],
        flags, note,
      };
    }
    if (outsideWindow) {
      // The policy has no clause for a late rollback: a person decides.
      return {
        checkpointId: c.id,
        label: {
          checkpointId: c.id, label: "unknown", evidenceFields: ["appTest", "rolledBackAt"], source: "rule", confidence: 1,
          note: "rolled back after a failed test, but outside the 30-minute window",
        },
        excluded: false, alsoMatched: [], flags, note,
      };
    }
    return { checkpointId: c.id, label: null, excluded: false, alsoMatched: [], flags, note };
  });
}
