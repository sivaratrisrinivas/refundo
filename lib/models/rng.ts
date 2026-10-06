import { createHash } from "node:crypto";

/** Deterministic PRNG seeded from any string. */
export function rngFrom(...parts: string[]): () => number {
  const h = createHash("sha256").update(parts.join("\u0000")).digest();
  let a = h.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}
