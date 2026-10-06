import { createHash } from "node:crypto";

/**
 * Error signature: lowercase, strip file paths, line/column numbers, hex
 * addresses, UUIDs and timestamps, then hash. Two errors that differ only in a
 * line number are the same loop.
 */
export function normalizeError(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?z?/g, "<ts>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/g, "<hex>")
    .replace(/(?:[a-z]:)?(?:\/|\.\/)?(?:[\w.@-]+\/)+[\w.@-]+/g, "<path>")
    .replace(/\b[\w-]+\.(?:tsx?|jsx?|py|json|css|html|rs|go)\b/g, "<file>")
    .replace(/:\d+(?::\d+)?/g, ":<n>")
    .replace(/\b(?:line|col|column)\s+\d+/g, "line <n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function errorSignature(text: string | null | undefined): string | null {
  if (!text) return null;
  return createHash("sha1").update(normalizeError(text)).digest("hex").slice(0, 12);
}
