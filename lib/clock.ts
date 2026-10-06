/**
 * The single source of "now". The demo clock is frozen so ages, the 30-day
 * Headroom window and demo reset are identical for every reviewer.
 */
export const DEMO_NOW_ISO = "2026-10-06T12:00:00.000Z";

export function now(): Date {
  return new Date(DEMO_NOW_ISO);
}

export function nowIso(): string {
  return DEMO_NOW_ISO;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 60_000;
}

export function ageHours(fromIso: string): number {
  return (now().getTime() - Date.parse(fromIso)) / 3_600_000;
}
