// Draft image → guide grid. The picture is shrunk to the map grid, its
// colours are grouped (k-means) and each group gets a terrain — guessed from
// the hue, then confirmed by the GM — so any style of draft works: a pencil
// sketch, a coloured doodle, another tool's export.
export const GUIDE_CHOICES = [
  ["~", "Sea / water"], ["o", "Lake"], [" ", "Land (let the climate decide)"], [".", "Plains"], [",", "Farmland"],
  ["f", "Forest"], ["F", "Deep forest"], ["t", "Taiga"], ["h", "Hills"], ["m", "Mountains"], ["M", "Snowy peaks"],
  ["s", "Marsh"], ["d", "Desert"], ["#", "Ink / lettering (ignore)"],
];

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not an image"));
    img.src = URL.createObjectURL(file);
  });
}

function hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
export function guessTerrain(rgb) {
  const [h, s, v] = hsv(rgb);
  if (v < 0.22) return "#";
  if (s < 0.1) return v > 0.85 ? " " : v > 0.6 ? "h" : "m";
  if (h >= 170 && h <= 260) return "~";
  if (h >= 70 && h < 170) return v < 0.45 ? "F" : s < 0.3 && v > 0.7 ? "." : "f";
  if (h >= 40 && h < 70) return s > 0.35 && v > 0.7 ? "d" : ".";
  if (h >= 15 && h < 40) return v < 0.55 ? "m" : s < 0.3 ? "." : "h";
  return " ";
}

// → { w, h, px: Uint8ClampedArray (w*h*4), clusters: [{ rgb, count, pick }], label: Uint8Array }
export function analyze(img, w, k = 8) {
  const h = Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const n = w * h;
  // farthest-point seeding: every distinct colour gets a centre, even a
  // small one (a mountain range drawn in brown on a sea of blue)
  const at = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  const d2 = (a, c) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
  const sample = [];
  for (let i = 0; i < n; i += 5) sample.push(at(i));
  const cent = [sample[0]];
  while (cent.length < k) {
    let best = null, bd = -1;
    for (const c of sample) { const d = Math.min(...cent.map((q) => d2(c, q))); if (d > bd) { bd = d; best = c; } }
    if (bd < 300) break; // no more distinct colours
    cent.push(best);
  }
  k = cent.length;
  const label = new Uint8Array(n);
  for (let it = 0; it < 12; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = (r - cent[j][0]) ** 2 + (gg - cent[j][1]) ** 2 + (b - cent[j][2]) ** 2; if (d < bd) { bd = d; best = j; } }
      label[i] = best; const s = sum[best]; s[0] += r; s[1] += gg; s[2] += b; s[3]++;
    }
    for (let j = 0; j < k; j++) if (sum[j][3]) cent[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) counts[label[i]]++;
  const clusters = cent.map((rgb, j) => ({ rgb: rgb.map(Math.round), count: counts[j], pick: guessTerrain(rgb) }));
  // small groups that sit between two big colours are anti-aliased edges
  // (the blur between sea and land): they follow the nearer big colour
  const big = clusters.filter((c) => c.count >= n * 0.04);
  for (const c of clusters) {
    if (c.count >= n * 0.025) continue;
    let best = null;
    for (let x = 0; x < big.length; x++) for (let y = x + 1; y < big.length; y++) {
      const A = big[x].rgb, B = big[y].rgb, P = c.rgb;
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / L));
      const d = Math.hypot(P[0] - A[0] - t * ab[0], P[1] - A[1] - t * ab[1], P[2] - A[2] - t * ab[2]);
      if (!best || d < best.d) best = { d, near: t < 0.5 ? big[x] : big[y] };
    }
    if (best && best.d < 22) c.pick = best.near.pick;
  }
  return { w, h, clusters, label };
}

export function toGuide(a, picks) {
  const rows = [];
  for (let y = 0; y < a.h; y++) {
    let r = "";
    for (let x = 0; x < a.w; x++) { const c = a.clusters[a.label[y * a.w + x]]; r += c.count ? picks[a.label[y * a.w + x]] ?? c.pick : " "; }
    rows.push(r);
  }
  return rows;
}
