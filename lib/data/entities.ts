/**
 * Public-looking reference entities. The status-history and forum sources could
 * not be reached while building (egress blocked), so every window and signature
 * is marked `synthetic: true`: typed from the build plan's pointers, not verified
 * against the source. Check them against the URLs before presenting them as real.
 */
export interface IncidentSeed {
  id: string; title: string; startsAt: string; endsAt: string; sourceUrl: string; synthetic: boolean;
}
export interface BugSeed {
  id: string; name: string; pattern: string; linearIssueRef: string; confirmedSourceUrl: string | null; synthetic: boolean;
}

export const INCIDENTS: IncidentSeed[] = [
  { id: "inc-2026-09-17-degraded-agent", title: "Degraded Agent Performance", startsAt: "2026-09-17T14:10:00Z", endsAt: "2026-09-17T16:40:00Z", sourceUrl: "https://status.replit.com/history", synthetic: true },
  { id: "inc-2026-09-02-checkpoint-delays", title: "Delayed checkpoint creation", startsAt: "2026-09-02T09:00:00Z", endsAt: "2026-09-02T10:30:00Z", sourceUrl: "https://status.replit.com/history", synthetic: true },
  { id: "inc-2026-08-24-preview-outage", title: "Preview environment unavailable", startsAt: "2026-08-24T18:20:00Z", endsAt: "2026-08-24T19:05:00Z", sourceUrl: "https://status.replit.com/history", synthetic: true },
  { id: "inc-2026-09-25-model-timeouts", title: "Elevated model request timeouts", startsAt: "2026-09-25T11:00:00Z", endsAt: "2026-09-25T12:15:00Z", sourceUrl: "https://status.replit.com/history", synthetic: true },
];

export const BUG_SIGNATURES: BugSeed[] = [
  {
    id: "bug-task-merge-duplication", name: "File content duplicated after a task merge",
    pattern: "duplicat\\w*\\s+(?:file\\s+)?content.*(?:merge|task)|(?:merge|task).*duplicat\\w*\\s+(?:file\\s+)?content",
    linearIssueRef: "AGENT-1142", confirmedSourceUrl: "https://forum.replit.com/", synthetic: true,
  },
  {
    id: "bug-synthetic-env-reset", name: "Environment variables reset after a rollback (synthetic)",
    pattern: "environment variables?\\s+(?:were\\s+)?reset.*rollback", linearIssueRef: "AGENT-2207", confirmedSourceUrl: null, synthetic: true,
  },
  {
    id: "bug-synthetic-stale-preview", name: "Preview serves a stale build after deploy (synthetic)",
    pattern: "stale\\s+preview\\s+build", linearIssueRef: "AGENT-2318", confirmedSourceUrl: null, synthetic: true,
  },
];
