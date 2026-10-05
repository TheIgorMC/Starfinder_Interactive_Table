// Deterministic PRNG + 2D value noise (no dependencies, so the generator also
// runs under plain node for tests).
export function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}
export function rngFrom(seed) {
  let a = hashStr(String(seed)) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// cheap stateless hash → [0,1), for per-cell decisions that must not depend
// on iteration order (symbol placement, partial redraws)
export function cellHash(x, y, salt = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

export function makeNoise(rng) {
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => rng());
  const lat = (x, y) => val[perm[(x & 255) + perm[y & 255]]];
  const s = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
    const a = lat(x0, y0), b = lat(x0 + 1, y0), c = lat(x0, y0 + 1), d = lat(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y, oct = 5, gain = 0.5) => {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) { sum += noise(x * f + o * 17.3, y * f - o * 9.1) * amp; norm += amp; amp *= gain; f *= 2.03; }
    return sum / norm;
  };
  const ridged = (x, y, oct = 4) => {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) { const n = 1 - Math.abs(noise(x * f + o * 31.7, y * f + o * 5.3) * 2 - 1); sum += n * n * amp; norm += amp; amp *= 0.5; f *= 2.1; }
    return sum / norm;
  };
  return { noise, fbm, ridged };
}
