// Deterministic PRNG so "same seed + same painted fields" reproduces the
// same galaxy (Docs/10-galaxy-mapgen.md §3: "deterministic given a seed").
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToInt(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

export function createRng(seedStr) {
  return mulberry32(hashStringToInt(String(seedStr)));
}

export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

// entries: [{ value, weight }, ...]
export function weightedPick(rng, entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of entries) {
    if (r < e.weight) return e.value;
    r -= e.weight;
  }
  return entries[entries.length - 1].value;
}
