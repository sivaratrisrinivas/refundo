import type { Policy, RequestClass } from "./policy";

/** C2: a rollback counts only within the window after the failed test. */
export function revertWithinWindow(minutesToRollback: number, policy: Policy): boolean {
  return minutesToRollback >= 0 && minutesToRollback <= (policy.clauses.C2.windowMin ?? 30);
}

/** C3: a loop is credited from the Nth consecutive repeat (N = 3) onward. */
export function loopIsCredited(repeat: number, policy: Policy): boolean {
  return repeat >= (policy.clauses.C3.creditFromRepeat ?? 3);
}

/** C5: files changed relative to the pinned median for the request class. */
export function scopeRatio(filesChanged: number, requestClass: RequestClass, policy: Policy): number {
  return filesChanged / policy.medianFiles[requestClass];
}

export function isScopeOverrun(filesChanged: number, requestClass: RequestClass, policy: Policy): boolean {
  return scopeRatio(filesChanged, requestClass, policy) >= (policy.clauses.C5.filesRatio ?? 10);
}
