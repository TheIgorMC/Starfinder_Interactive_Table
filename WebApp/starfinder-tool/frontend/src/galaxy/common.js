// Shared constants + seeded procedural helpers for the galaxy viewer
// (ported from the ARTS galaxy-viewer design handoff). Everything here is
// deterministic: the same slug always yields the same globe, sites and
// district layout, on every device.

export const POPR = {
  "core world (50 million+)": 5, "major colony (1 - 50 million)": 4, "colony (50,000 - 1 million)": 3,
  "small colony (500 - 50,000)": 2, "outpost (< 500)": 1, "uninhabited / automated only": 0,
};
export const POPL = {
  "core world (50 million+)": "Core world", "major colony (1 - 50 million)": "Major colony", "colony (50,000 - 1 million)": "Colony",
  "small colony (500 - 50,000)": "Small colony", "outpost (< 500)": "Outpost", "uninhabited / automated only": "Automated only",
};
export const MODES = {
  factions: { t: "POWERS", sub: "territory by leading faction" },
  security: { t: "SECURITY", sub: "lawless ↔ secure" },
  conflict: { t: "CONFLICT", sub: "chance of war" },
  sectors: { t: "SECTORS", sub: "administrative regions" },
  population: { t: "POPULACE", sub: "settlement size" },
  trade: { t: "TRADE", sub: "lane capacity & risk" },
};
export const KCOL = {
  "gas giant": "#d9a066", "rocky planet": "#a8927e", "ice world": "#bfe3f0", "terrestrial world": "#5fb08a",
  moon: "#9a948d", "asteroid belt": "#8f877c", "orbital station": "#ff9a3c",
};
export const KLAB = {
  "gas giant": "GAS GIANT", "rocky planet": "ROCKY PLANET", "ice world": "ICE WORLD", "terrestrial world": "TERRESTRIAL",
  moon: "MOON", "asteroid belt": "ASTEROID BELT", "orbital station": "STATION",
};

export function starColor(t) {
  t = t || "";
  if (t.includes("neutron")) return "#a8f2ff";
  if (t.includes("binary")) return "#ffd9a0";
  return ({ O: "#9db8ff", B: "#b3cbff", A: "#e8eeff", F: "#fff4de", G: "#ffe29a", K: "#ffb566", M: "#ff7a52" })[t[0]] || "#ffffff";
}
export function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function mixc(a, b, t) { return mix(a, b, Math.max(0, Math.min(1, t))); }
export function secRGB(v) { const a = [255, 90, 54], m = [217, 167, 95], b = [63, 140, 255]; return v < 0.5 ? mix(a, m, v * 2) : mix(m, b, (v - 0.5) * 2); }
export function css(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
export function secLabel(v) { return v >= 0.75 ? "High" : v >= 0.4 ? "Medium" : v >= 0.15 ? "Low" : "Anarchy"; }
export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function short(n, sys) { return n.indexOf(sys) === 0 ? n.slice(sys.length).trim() || n : n; }
export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function sectorName(sc) { return sc === "core" ? "Core sector" : `Sector ${sc}`; }

// One counting rule shared by the galaxy panel and the system view, so the
// two can never disagree.
export function counts(s) {
  const c = { planet: 0, moon: 0, belt: 0, station: 0 };
  for (const b of s.b) {
    if (b.k === "moon") c.moon++;
    else if (b.k === "asteroid belt") c.belt++;
    else if (b.k === "orbital station") c.station++;
    else c.planet++;
  }
  return c;
}
export function hasSurface(b) { return b.k !== "orbital station" && b.k !== "asteroid belt"; }
export function bestBody(s) {
  const c = s.b.filter(hasSurface);
  const score = (b) => (b.st === "colonized" ? 100 : 0) + (b.k === "terrestrial world" ? 50 : 0) + (b.st === "extraction" ? 20 : 0) + (b.r || 0) / 10000;
  c.sort((a, b) => score(b) - score(a));
  return c[0] || null;
}
export function fmtDeg(r, p) {
  let d = (r * 180) / Math.PI;
  if (p === "lon") d = (((d % 360) + 540) % 360) - 180;
  return `${Math.abs(d).toFixed(1)}° ${d >= 0 ? (p === "lat" ? "N" : "E") : p === "lat" ? "S" : "W"}`;
}

// Transit mix per body type: moons & rocky worlds live underground,
// terrestrial worlds mix, floating cities fly.
export const MIX = {
  moon: [["underground", 0.8], ["rail", 0.2]],
  "rocky planet": [["underground", 0.7], ["rail", 0.3]],
  "ice world": [["underground", 0.55], ["rail", 0.45]],
  "terrestrial world": [["rail", 0.4], ["underground", 0.3], ["shuttle", 0.3]],
  "gas giant": [["shuttle", 1]],
};
export const TRANSIT = {
  rail: { n: "Maglev rail", c: "#5fd3f3", dash: "solid" },
  underground: { n: "Underground metro", c: "#ffb866", dash: "dashed" },
  shuttle: { n: "Aerial shuttle", c: "#c7a4ff", dash: "dotted" },
};
// `allowed` = an authored site's own transit list; it overrides the mix.
export function allocModes(kind, n, r, allowed) {
  let mix = MIX[kind] || MIX["rocky planet"];
  if (!n) return [];
  if (allowed && allowed.length) {
    let m2 = mix.filter(([k]) => allowed.includes(k));
    if (!m2.length) m2 = allowed.map((k) => [k, 1 / allowed.length]);
    const tot = m2.reduce((a, x) => a + x[1], 0);
    mix = m2.map(([k, w]) => [k, w / tot]);
    if (allowed.length >= 3 && n >= 3) kind = "terrestrial world";
  }
  const q = mix.map(([k, w]) => ({ k, c: Math.floor(w * n), f: w * n - Math.floor(w * n) }));
  let left = n - q.reduce((a, x) => a + x.c, 0);
  q.slice().sort((a, b) => b.f - a.f).forEach((x) => { if (left > 0) { x.c++; left--; } });
  if (kind === "terrestrial world" && n >= 3) q.forEach((x) => { if (!x.c) { const big = q.reduce((a, b) => (b.c > a.c ? b : a)); big.c--; x.c++; } });
  const out = [];
  q.forEach((x) => { for (let i = 0; i < x.c; i++) out.push(x.k); });
  for (let i = out.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function mst(pts, dist) {
  const n = pts.length, E = [];
  if (n < 2) return E;
  const used = new Set([0]);
  while (used.size < n) {
    let best = null;
    for (const a of used) for (let b = 0; b < n; b++) { if (used.has(b)) continue; const d = dist(pts[a], pts[b]); if (!best || d < best.d) best = { a, b, d }; }
    used.add(best.b); E.push(best);
  }
  return E;
}
export function noiseGen(seed) {
  const P = new Uint8Array(512), r = rng(seed), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const V = new Float32Array(256).map(() => r());
  const f = (t) => t * t * (3 - 2 * t);
  const l = (a, b, t) => a + (b - a) * t;
  const n = (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), xf = f(x - X), yf = f(y - Y), zf = f(z - Z), xi = X & 255, yi = Y & 255, zi = Z & 255;
    const v = (a, b, c) => V[P[P[P[a] + b] + c]];
    return l(l(l(v(xi, yi, zi), v(xi + 1, yi, zi), xf), l(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), xf), yf),
      l(l(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), xf), l(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), xf), yf), zf);
  };
  return (x, y, z, o) => { let s = 0, a = 0.5, fq = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n(x * fq, y * fq, z * fq); t += a; a *= 0.5; fq *= 2.03; } return s / t; };
}

// Index the compact payload once: neighbours, leading faction, label
// priority, star colour. Mutates in place (the payload is private to the viewer).
export function prepGalaxy(d) {
  const S = d.sys, F = d.f, fi = {};
  F.forEach((f, i) => { fi[f.s] = i; f.rgb = rgb(f.c || "#888888"); f.count = 0; });
  S.forEach((s, i) => {
    s.idx = i; s.pr = POPR[s.pop] || 0; s.col = starColor(s.st);
    const lead = s.ow || (s.cb[0] && s.cb[0][0]);
    s.lf = lead != null && fi[lead] != null ? fi[lead] : -1;
    if (s.lf >= 0) F[s.lf].count++;
    s.nb = [];
    s.prio = s.i * 100 + s.pr * 2.2 + (s.so ? 0 : 0.5) + (s.t.includes("administrative") ? 1 : 0);
    s.r = 1.2 + s.pr * 0.32 + Math.sqrt(s.i) * 3.4;
  });
  d.ln.forEach((l) => { S[l[0]].nb.push(l[1]); S[l[1]].nb.push(l[0]); });
  d.bySlug = Object.fromEntries(S.map((s) => [s.s, s]));
  d.fBySlug = Object.fromEntries(F.map((f) => [f.s, f]));
  return d;
}

// Canvas helper: sizes the backing store to the element's CSS box × DPR and
// returns {ctx, W, H} in CSS pixels. Views call this every frame, so the
// canvas follows any layout change (rotation, panel collapse) for free.
export function fitCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 1, H = cv.clientHeight || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}
export function localPoint(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
export function reticle(c, x, y, R, t, col = "#ff9a3c") {
  c.strokeStyle = col; c.lineWidth = 1.5;
  for (let q = 0; q < 4; q++) { const a = t * 0.8 + (q * Math.PI) / 2; c.beginPath(); c.arc(x, y, R, a, a + 0.9); c.stroke(); }
}

// Pointer plumbing shared by every view: drag / tap / hover / pinch / wheel.
// Handlers: onDrag(dx,dy,p), onTap(p), onHover(p), onPinch(factor, cx, cy, dcx, dcy), onWheel(factor, p), onDblClick(p).
export function attachPointer(cv, h) {
  const ptrs = new Map();
  let drag = null, pinch = null;
  const pinchInfo = () => { const a = [...ptrs.values()]; return { cx: (a[0][0] + a[1][0]) / 2, cy: (a[0][1] + a[1][1]) / 2, d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1 }; };
  const onWheel = (e) => { e.preventDefault(); h.onWheel?.(Math.exp(-e.deltaY * 0.0016), localPoint(cv, e)); };
  const onDbl = (e) => h.onDblClick?.(localPoint(cv, e));
  const onDown = (e) => {
    cv.setPointerCapture?.(e.pointerId);
    const p = localPoint(cv, e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) drag = { x: p[0], y: p[1], moved: false, touch: e.pointerType === "touch" };
    else { drag = null; pinch = pinchInfo(); }
  };
  const onMove = (e) => {
    const p = localPoint(cv, e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (ptrs.size === 2 && pinch) { const q = pinchInfo(); h.onPinch?.(q.d / pinch.d, q.cx, q.cy, q.cx - pinch.cx, q.cy - pinch.cy); pinch = q; return; }
    if (drag) {
      const dx = p[0] - drag.x, dy = p[1] - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > (drag.touch ? 5 : 3)) drag.moved = true;
      if (drag.moved) { h.onDrag?.(dx, dy, p); drag.x = p[0]; drag.y = p[1]; }
    } else if (e.pointerType !== "touch") h.onHover?.(p);
  };
  const onUp = (e) => {
    const p = localPoint(cv, e);
    if (drag && !drag.moved) h.onTap?.(p, drag.touch);
    ptrs.delete(e.pointerId); drag = null;
    if (ptrs.size < 2) pinch = null;
    h.onRelease?.();
  };
  const onLeave = () => h.onHover?.(null);
  cv.addEventListener("wheel", onWheel, { passive: false });
  cv.addEventListener("dblclick", onDbl);
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", onUp);
  cv.addEventListener("pointerleave", onLeave);
  return {
    dragging: () => !!drag,
    detach() {
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDbl);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("pointerleave", onLeave);
    },
  };
}

// requestAnimationFrame loop that survives a thrown frame (logged once).
export function startLoop(fn) {
  let raf = 0, logged = false;
  const loop = () => { raf = requestAnimationFrame(loop); try { fn(); } catch (e) { if (!logged) { logged = true; console.error(e); } } };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
