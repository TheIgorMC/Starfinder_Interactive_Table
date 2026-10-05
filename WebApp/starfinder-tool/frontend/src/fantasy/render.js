// Map renderer. Terrain (colours, relief, coast, trees, mountains…) is
// painted once into an off-screen canvas at P px per cell and only
// repainted where the GM paints; everything else (rivers, roads, places,
// labels, selection, routes) is vector, redrawn each frame.
import { BIOMES, isWater } from "./lib/model.js";
import { cellHash } from "./lib/rng.js";

export const P = 8; // terrain canvas px per cell

export const THEMES = {
  parchment: {
    ink: "#3b2a1a", inkSoft: "rgba(59,42,26,.55)", paper: "#efe3c4", water: "#c3cdc0", waterInk: "#4d6a78",
    river: "#4d6f8a", label: "#4a3520", seaLabel: "#3e5a6a", frame: "#3b2a1a",
    roads: { royal: "#7a2e1c", road: "#5a3a22", track: "#6b4a2e", trail: "#6b4a2e" },
  },
  atlas: {
    ink: "#26323a", inkSoft: "rgba(38,50,58,.5)", paper: "#f4f1e8", water: "#7ea7c2", waterInk: "#2f5f7c",
    river: "#2f6f9f", label: "#2b2b2b", seaLabel: "#1f4f6f", frame: "#26323a",
    roads: { royal: "#a3271a", road: "#6a4626", track: "#7a5a3a", trail: "#7a5a3a" },
  },
};
const FONT = '"IM Fell English", "Palatino Linotype", Palatino, Georgia, serif';
const FONT_CAPS = 'Cinzel, "IM Fell English", Georgia, serif';

const hexRgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const BIOME_RGB = Object.fromEntries(Object.entries(BIOMES).map(([k, b]) => [k.charCodeAt(0), { paper: hexRgb(b.paper), atlas: hexRgb(b.atlas) }]));

// --- derived fields used by the terrain painter ---------------------------
export function terrainFields(world) {
  const { w, h, n, biome } = world;
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) water[i] = biome[i] === 79 || biome[i] === 76 ? 1 : 0;
  // distance (cells) from the coast, in the water — for the ripple lines
  const dist = new Float32Array(n).fill(99);
  const q = [];
  for (let i = 0; i < n; i++) if (!water[i]) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (dist[k] > dist[i] + 1) { dist[k] = dist[i] + 1; if (dist[k] < 8) q.push(k); }
    }
  }
  return { water, dist };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

let paperPattern = null;
function paperTexture(ctx) {
  if (paperPattern) return paperPattern;
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  for (let i = 0; i < 2600; i++) {
    const x = cellHash(i, 1, 7) * 256, y = cellHash(i, 2, 7) * 256, a = cellHash(i, 3, 7);
    g.fillStyle = a < 0.5 ? `rgba(120,90,50,${0.04 + a * 0.06})` : `rgba(255,250,235,${0.05 + (a - 0.5) * 0.1})`;
    g.fillRect(x, y, 1 + (a > 0.9 ? 1 : 0), 1);
  }
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(110,80,40,${0.025 + cellHash(i, 4, 9) * 0.03})`;
    g.beginPath();
    const x = cellHash(i, 5, 9) * 256, y = cellHash(i, 6, 9) * 256;
    g.moveTo(x, y); g.lineTo(x + (cellHash(i, 7, 9) - 0.5) * 60, y + (cellHash(i, 8, 9) - 0.5) * 20);
    g.stroke();
  }
  paperPattern = ctx.createPattern(c, "repeat");
  return paperPattern;
}

export function createTerrain(world, style) {
  const canvas = makeCanvas(world.w * P, world.h * P);
  const fields = terrainFields(world);
  const t = { canvas, fields, style };
  paintTerrain(t, world, { x0: 0, y0: 0, x1: world.w, y1: world.h });
  return t;
}

// repaint the cells in rect (plus a margin for overflowing symbols)
export function paintTerrain(t, world, rect) {
  const { canvas, style } = t;
  const ctx = canvas.getContext("2d");
  const th = THEMES[style] || THEMES.parchment;
  const { w, h, biome, height } = world;
  const x0 = Math.max(0, Math.floor(rect.x0)), y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(w, Math.ceil(rect.x1)), y1 = Math.min(h, Math.ceil(rect.y1));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0 * P, y0 * P, (x1 - x0) * P, (y1 - y0) * P); ctx.clip();

  // 1. colours: one pixel per cell, upscaled smoothly (no blocky cells)
  const bx0 = Math.max(0, x0 - 2), by0 = Math.max(0, y0 - 2), bx1 = Math.min(w, x1 + 2), by1 = Math.min(h, y1 + 2);
  const bw = bx1 - bx0, bh = by1 - by0;
  const small = makeCanvas(bw, bh), sg = small.getContext("2d");
  const img = sg.createImageData(bw, bh);
  const key = style === "atlas" ? "atlas" : "paper";
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    const i = y * w + x;
    const c = BIOME_RGB[biome[i]]?.[key] || [230, 220, 190];
    let shade = 0;
    if (!t.fields.water[i]) {
      const a = height[Math.max(0, y - 1) * w + Math.max(0, x - 1)], b = height[Math.min(h - 1, y + 1) * w + Math.min(w - 1, x + 1)];
      shade = (a - b) * (style === "atlas" ? 260 : 170);
    } else {
      shade = -Math.min(6, t.fields.dist[i]) * (style === "atlas" ? 5 : 2.5);
    }
    const o = ((y - by0) * bw + (x - bx0)) * 4;
    img.data[o] = c[0] + shade; img.data[o + 1] = c[1] + shade; img.data[o + 2] = c[2] + shade; img.data[o + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, bw, bh, (bx0 + 0.5) * P, (by0 + 0.5) * P, bw * P, bh * P);
  // edge strip (the half cell at the map border the offset leaves bare)
  if (x0 === 0 || y0 === 0) ctx.drawImage(small, 0, 0, bw, bh, bx0 * P, by0 * P, bw * P, bh * P);
  if (style !== "atlas") { ctx.fillStyle = paperTexture(ctx); ctx.fillRect(x0 * P, y0 * P, (x1 - x0) * P, (y1 - y0) * P); }

  // 2. coast: ripple lines in the water, then the ink coastline
  const { water, dist } = t.fields;
  const field = (fx, fy) => { // smoothed water fraction at a cell corner
    let s = 0, c = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const xx = fx + dx, yy = fy + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += water[yy * w + xx]; c++;
    }
    return c ? s / c : 0;
  };
  const distAt = (fx, fy) => {
    let s = 0, c = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const xx = fx + dx, yy = fy + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += Math.min(8, dist[yy * w + xx]); c++;
    }
    return c ? s / c : 0;
  };
  ctx.lineCap = "round";
  ctx.strokeStyle = th.waterInk;
  for (const [lvl, alpha] of [[1.6, 0.42], [2.8, 0.28], [4.2, 0.16]]) {
    ctx.globalAlpha = alpha; ctx.lineWidth = 0.9;
    marching(bx0, by0, bx1, by1, (x, y) => distAt(x, y), lvl, ctx);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.ink; ctx.lineWidth = style === "atlas" ? 1.2 : 1.8;
  marching(bx0, by0, bx1, by1, field, 0.5, ctx);

  // 3. symbols, anchored per cell (deterministic, so partial repaints match)
  const sx0 = Math.max(0, x0 - 4), sy0 = Math.max(0, y0 - 4), sx1 = Math.min(w, x1 + 4), sy1 = Math.min(h, y1 + 4);
  ctx.lineJoin = "round";
  for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
    const code = biome[y * w + x];
    const r = cellHash(x, y, 1), jx = cellHash(x, y, 2), jy = cellHash(x, y, 3);
    const px = (x + 0.15 + jx * 0.7) * P, py = (y + 0.15 + jy * 0.7) * P;
    switch (code) {
      case 77: if (r < 0.2) mountain(ctx, px, py, P * (2.2 + jx), th, false, style); break; // M
      case 83: if (r < 0.24) mountain(ctx, px, py, P * (2.8 + jx), th, true, style); break; // S
      case 72: if (r < 0.16) hill(ctx, px, py, P * (1.6 + jx * 0.6), th, style); break; // H
      case 70: if (r < 0.5) tree(ctx, px, py, P * (0.85 + jy * 0.3), th, "leaf", style); break; // F
      case 68: if (r < 0.8) tree(ctx, px, py, P * (0.95 + jy * 0.3), th, r < 0.4 ? "pine" : "leaf", style, true); break; // D
      case 84: if (r < 0.5) tree(ctx, px, py, P * (0.9 + jy * 0.3), th, "pine", style); break; // T
      case 87: if (r < 0.32) marsh(ctx, px, py, P, th); break; // W
      case 82: if (r < 0.45) dots(ctx, px, py, P, th, r); break; // R
      case 65: if (r < 0.9) furrows(ctx, x, y, th, r); break; // A
      case 71: if (r < 0.05) grass(ctx, px, py, P, th); break; // G
      default:
    }
  }
  ctx.restore();

  function furrows(ctx2, x, y, th2, r) {
    const blk = cellHash(Math.floor(x / 2), Math.floor(y / 2), 9);
    ctx2.strokeStyle = th2.inkSoft; ctx2.globalAlpha = 0.35; ctx2.lineWidth = 0.6;
    ctx2.beginPath();
    for (let k = 1; k < 4; k++) {
      if (blk < 0.5) { ctx2.moveTo(x * P, (y + k / 4) * P); ctx2.lineTo((x + 1) * P, (y + k / 4) * P); }
      else { ctx2.moveTo((x + k / 4) * P, y * P); ctx2.lineTo((x + k / 4) * P, (y + 1) * P); }
    }
    ctx2.stroke(); ctx2.globalAlpha = 1;
    if (r < 0.12) { ctx2.strokeStyle = th2.inkSoft; ctx2.lineWidth = 0.7; ctx2.strokeRect(x * P, y * P, P * 2, P * 2); }
  }
}

// marching squares: stroke the iso-line `lvl` of f over the corner grid
function marching(x0, y0, x1, y1, f, lvl, ctx) {
  ctx.beginPath();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = f(x, y), b = f(x + 1, y), c = f(x + 1, y + 1), d = f(x, y + 1);
    const idx = (a > lvl ? 8 : 0) | (b > lvl ? 4 : 0) | (c > lvl ? 2 : 0) | (d > lvl ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const lerp = (p, q) => (lvl - p) / (q - p || 1e-9);
    const T = [(x + lerp(a, b)) * P, y * P], R = [(x + 1) * P, (y + lerp(b, c)) * P], B = [(x + lerp(d, c)) * P, (y + 1) * P], L = [x * P, (y + lerp(a, d)) * P];
    const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
    switch (idx) {
      case 1: case 14: seg(L, B); break;
      case 2: case 13: seg(B, R); break;
      case 3: case 12: seg(L, R); break;
      case 4: case 11: seg(T, R); break;
      case 5: seg(L, T); seg(B, R); break;
      case 6: case 9: seg(T, B); break;
      case 7: case 8: seg(L, T); break;
      case 10: seg(L, B); seg(T, R); break;
      default:
    }
  }
  ctx.stroke();
}

function mountain(ctx, x, y, s, th, snow, style) {
  const hgt = s * 0.75, l = x - s / 2, r = x + s / 2, top = y - hgt, peak = x + s * 0.06;
  ctx.fillStyle = style === "atlas" ? (snow ? "#f4f4f2" : "#b9ab97") : th.paper;
  ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(peak, top); ctx.lineTo(r, y); ctx.closePath(); ctx.fill();
  // shaded east flank, hatched
  ctx.strokeStyle = th.ink; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.75;
  ctx.beginPath();
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    ctx.moveTo(peak + (r - peak) * t * 0.95, top + (y - top) * t);
    ctx.lineTo(peak + (r - peak) * t * 0.95 - s * 0.08, y);
  }
  ctx.stroke(); ctx.globalAlpha = 1;
  if (snow) {
    ctx.fillStyle = "#fbfaf5";
    ctx.beginPath(); ctx.moveTo(peak - s * 0.13, top + hgt * 0.28); ctx.lineTo(peak, top); ctx.lineTo(peak + s * 0.15, top + hgt * 0.3); ctx.lineTo(peak + s * 0.03, top + hgt * 0.22); ctx.closePath(); ctx.fill();
  }
  ctx.lineWidth = 1.2; ctx.strokeStyle = th.ink;
  ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(peak, top); ctx.lineTo(r, y); ctx.stroke();
}
function hill(ctx, x, y, s, th) {
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(x - s / 2, y); ctx.quadraticCurveTo(x, y - s * 0.7, x + s / 2, y); ctx.stroke();
  ctx.lineWidth = 0.6; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(x + s * 0.12, y - s * 0.22); ctx.lineTo(x + s * 0.2, y); ctx.moveTo(x + s * 0.26, y - s * 0.14); ctx.lineTo(x + s * 0.32, y); ctx.stroke();
  ctx.globalAlpha = 1;
}
function tree(ctx, x, y, s, th, kind, style, dark) {
  const fill = style === "atlas" ? (dark ? "#3f6a3a" : kind === "pine" ? "#4f7a55" : "#5f8f48") : dark ? "#cfc7a0" : th.paper;
  ctx.lineWidth = 0.8; ctx.strokeStyle = th.ink; ctx.fillStyle = fill;
  if (kind === "pine") {
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.38, y - s * 0.1); ctx.lineTo(x - s * 0.38, y - s * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - s * 0.1); ctx.lineTo(x, y + s * 0.1); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.1); ctx.lineTo(x, y - s * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - s * 0.55, s * 0.33, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(x + s * 0.1, y - s * 0.5, s * 0.18, 0, Math.PI * 0.8); ctx.stroke(); ctx.globalAlpha = 1;
  }
}
function marsh(ctx, x, y, s, th) {
  ctx.strokeStyle = th.ink; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y); ctx.lineTo(x + s * 0.4, y);
  for (const dx of [-0.2, 0, 0.2]) { ctx.moveTo(x + dx * s, y); ctx.lineTo(x + dx * s * 1.4, y - s * (0.3 + Math.abs(dx))); }
  ctx.moveTo(x - s * 0.25, y + s * 0.2); ctx.lineTo(x + s * 0.15, y + s * 0.2);
  ctx.stroke(); ctx.globalAlpha = 1;
}
function dots(ctx, x, y, s, th, r) {
  ctx.fillStyle = th.inkSoft;
  for (let k = 0; k < 3; k++) ctx.fillRect(x + (cellHash(k, r * 1e6, 4) - 0.5) * s, y + (cellHash(k, r * 1e6, 5) - 0.5) * s, 0.9, 0.9);
  if (r < 0.08) { ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x - s * 0.6, y); ctx.quadraticCurveTo(x, y - s * 0.4, x + s * 0.6, y); ctx.stroke(); }
}
function grass(ctx, x, y, s, th) {
  ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(x - s * 0.15, y); ctx.lineTo(x - s * 0.22, y - s * 0.25); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.3); ctx.moveTo(x + s * 0.15, y); ctx.lineTo(x + s * 0.22, y - s * 0.25); ctx.stroke();
}

// --- vector overlay ------------------------------------------------------
// view: { x, y, z }: screen = (cell - (x, y)) * z
export const toScreen = (v, x, y) => [(x - v.x) * v.z, (y - v.y) * v.z];
export const toCell = (v, sx, sy) => [sx / v.z + v.x, sy / v.z + v.y];

function smoothPath(ctx, pts, v) {
  if (!pts.length) return;
  const s = pts.map(([x, y]) => toScreen(v, x, y));
  ctx.moveTo(s[0][0], s[0][1]);
  if (s.length === 2) { ctx.lineTo(s[1][0], s[1][1]); return; }
  for (let k = 1; k < s.length - 1; k++) {
    const mx = (s[k][0] + s[k + 1][0]) / 2, my = (s[k][1] + s[k + 1][1]) / 2;
    ctx.quadraticCurveTo(s[k][0], s[k][1], mx, my);
  }
  ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
}

export const SETTLEMENT_SIZE = { capital: 15, city: 12, town: 9, village: 6.5, hamlet: 4, castle: 11 };

export function drawOverlay(ctx, st) {
  const { map, view: v, terrain, width, height, gm, sel, hover, route, draft, brush, cursor, showLabels = true, showEvents = true, highlight } = st;
  const hl = (id) => highlight && highlight.has(id);
  const th = THEMES[map.style] || THEMES.parchment;
  ctx.save();
  ctx.fillStyle = map.style === "atlas" ? "#1d2328" : "#2a2016";
  ctx.fillRect(0, 0, width, height);
  // terrain
  const [ox, oy] = toScreen(v, 0, 0);
  ctx.imageSmoothingEnabled = v.z < P;
  ctx.drawImage(terrain.canvas, ox, oy, map.w * v.z, map.h * v.z);
  // frame
  ctx.strokeStyle = th.frame; ctx.lineWidth = 3; ctx.strokeRect(ox - 4, oy - 4, map.w * v.z + 8, map.h * v.z + 8);
  ctx.lineWidth = 1; ctx.strokeRect(ox - 8, oy - 8, map.w * v.z + 16, map.h * v.z + 16);
  const k = Math.max(0.6, Math.min(1.8, v.z / 5));
  const isSel = (kind, id) => sel && sel.kind === kind && sel.id === id;
  const visible = (e) => gm || !e.hidden;

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // highlighted lines (cited by the open chapter) get a golden glow
  if (highlight?.size) for (const kind of ["rivers", "roads"]) for (const r of map[kind] || []) {
    if (!hl(r.id) || !visible(r)) continue;
    ctx.beginPath(); smoothPath(ctx, r.pts, v);
    ctx.strokeStyle = "rgba(230,170,40,.55)"; ctx.lineWidth = 10; ctx.stroke();
  }
  // rivers
  for (const r of map.rivers || []) {
    if (!visible(r)) continue;
    ctx.beginPath(); smoothPath(ctx, r.pts, v);
    ctx.strokeStyle = isSel("rivers", r.id) ? "#c0392b" : th.river;
    ctx.lineWidth = Math.max(0.8, (r.width || 1) * v.z * 0.16 * (isSel("rivers", r.id) ? 1.6 : 1));
    ctx.globalAlpha = r.hidden ? 0.4 : 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // roads (wide first, so junctions read cleanly)
  const order = { royal: 0, road: 1, track: 2, trail: 3 };
  const roads = [...(map.roads || [])].filter(visible).sort((a, b) => order[a.type] - order[b.type]);
  for (const r of roads) {
    const selected = isSel("roads", r.id);
    ctx.globalAlpha = r.hidden ? 0.4 : 1;
    ctx.beginPath(); smoothPath(ctx, r.pts, v);
    ctx.setLineDash([]);
    if (r.type === "royal") {
      ctx.strokeStyle = selected ? "#c0392b" : th.roads.royal; ctx.lineWidth = 3.2 * k; ctx.stroke();
      ctx.strokeStyle = map.style === "atlas" ? "#f3d27a" : "#e9d6a8"; ctx.lineWidth = 1.3 * k; ctx.stroke();
    } else if (r.type === "road") {
      ctx.strokeStyle = selected ? "#c0392b" : th.roads.road; ctx.lineWidth = 1.9 * k; ctx.stroke();
    } else if (r.type === "track") {
      ctx.strokeStyle = selected ? "#c0392b" : th.roads.track; ctx.lineWidth = 1.3 * k; ctx.setLineDash([6 * k, 3.5 * k]); ctx.stroke();
    } else {
      ctx.strokeStyle = selected ? "#c0392b" : th.roads.trail; ctx.lineWidth = 1.1 * k; ctx.setLineDash([1.5 * k, 3.5 * k]); ctx.stroke();
    }
    if (selected) { ctx.setLineDash([]); for (const [x, y] of r.pts) { const [sx, sy] = toScreen(v, x, y); ctx.fillStyle = "#c0392b"; ctx.fillRect(sx - 3, sy - 3, 6, 6); } }
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (sel?.kind === "rivers") {
    const r = map.rivers.find((x) => x.id === sel.id);
    if (r) for (const [x, y] of r.pts) { const [sx, sy] = toScreen(v, x, y); ctx.fillStyle = "#c0392b"; ctx.fillRect(sx - 3, sy - 3, 6, 6); }
  }

  // area labels
  if (showLabels) for (const l of map.labels || []) {
    if (!visible(l)) continue;
    const size = Math.max(9, Math.min(64, (l.size || 2) * v.z * 0.9));
    if ((l.size || 2) * v.z < 6) continue;
    const [sx, sy] = toScreen(v, l.x, l.y);
    const water = l.type === "sea" || l.type === "lake";
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(((l.angle || 0) * Math.PI) / 180);
    const caps = l.type === "region" || l.type === "sea" || l.type === "mountains";
    ctx.font = `${caps ? "" : "italic "}${size}px ${caps ? FONT_CAPS : FONT}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * (caps ? 0.25 : 0.08)}px`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = l.hidden ? 0.35 : l.type === "region" ? 0.7 : 0.82;
    ctx.fillStyle = isSel("labels", l.id) ? "#c0392b" : water ? th.seaLabel : th.label;
    ctx.fillText(caps ? l.name.toUpperCase() : l.name, 0, 0);
    ctx.restore();
  }

  // points of interest
  for (const p of map.pois || []) {
    if (!visible(p)) continue;
    const [sx, sy] = toScreen(v, p.x, p.y);
    if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;
    ctx.globalAlpha = p.hidden ? 0.45 : 1;
    if (hl(p.id)) glow(ctx, sx, sy, 13 * k);
    poiIcon(ctx, p.type, sx, sy, 9 * k, th, map.style);
    if (isSel("pois", p.id) || hover?.id === p.id) ring(ctx, sx, sy, 10 * k);
    if (v.z >= 5.5 || isSel("pois", p.id)) textHalo(ctx, p.name, sx, sy + 11 * k, `italic ${Math.round(10 * Math.min(1.3, k))}px ${FONT}`, th, map.style);
  }
  ctx.globalAlpha = 1;

  // settlements
  const ss = [...(map.settlements || [])].filter(visible).sort((a, b) => SETTLEMENT_SIZE[a.type] - SETTLEMENT_SIZE[b.type]);
  for (const s of ss) {
    const [sx, sy] = toScreen(v, s.x, s.y);
    if (sx < -60 || sy < -60 || sx > width + 60 || sy > height + 60) continue;
    const size = SETTLEMENT_SIZE[s.type] * k;
    ctx.globalAlpha = s.hidden ? 0.45 : 1;
    if (hl(s.id)) glow(ctx, sx, sy, size * 0.9 + 6);
    settlementIcon(ctx, s.type, sx, sy, size, th, map.style);
    if (isSel("settlements", s.id) || hover?.id === s.id) ring(ctx, sx, sy, size * 0.9 + 3);
    const showName = { capital: 0, city: 0, town: 2.6, village: 4.5, hamlet: 7, castle: 3.5 }[s.type] <= v.z || isSel("settlements", s.id);
    if (showName) {
      const fs = { capital: 17, city: 14.5, town: 12.5, village: 11, hamlet: 10, castle: 11.5 }[s.type] * Math.min(1.35, Math.max(0.85, k));
      const font = s.type === "capital" || s.type === "city" ? `${fs}px ${FONT_CAPS}` : s.type === "castle" ? `italic ${fs}px ${FONT}` : `${fs}px ${FONT}`;
      textHalo(ctx, s.name, sx, sy + size * 0.6 + fs * 0.8, font, th, map.style);
    }
  }
  ctx.globalAlpha = 1;

  // events pinned on the map
  if (showEvents) for (const e of map.events || []) {
    if (!visible(e) || e.x == null) continue;
    const [sx, sy] = toScreen(v, e.x, e.y);
    if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;
    ctx.globalAlpha = e.hidden ? 0.45 : 1;
    if (hl(e.id)) glow(ctx, sx, sy - 6 * k, 13 * k);
    eventIcon(ctx, sx, sy, 10 * k, map.style);
    if (isSel("events", e.id) || hover?.id === e.id) ring(ctx, sx, sy - 6 * k, 12 * k);
    if (v.z >= 4.5 || isSel("events", e.id)) textHalo(ctx, e.name + (e.date ? ` (${e.date})` : ""), sx, sy + 8 * k, `italic ${Math.round(10.5 * Math.min(1.3, k))}px ${FONT}`, { ...th, ink: "#7a1f12" }, map.style);
  }
  ctx.globalAlpha = 1;

  // travel route
  if (route?.pts?.length) {
    ctx.beginPath(); smoothPath(ctx, route.pts, v);
    ctx.strokeStyle = "rgba(255,248,230,.85)"; ctx.lineWidth = 5; ctx.setLineDash([]); ctx.stroke();
    ctx.strokeStyle = "#b0261b"; ctx.lineWidth = 2.4; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (route?.waypoints) route.waypoints.forEach(([x, y], j) => {
    const [sx, sy] = toScreen(v, x, y);
    ctx.fillStyle = "#b0261b"; ctx.strokeStyle = "#fff8e6"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff8e6"; ctx.font = `bold 9px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(j + 1), sx, sy + 0.5);
  });
  // road / river being drawn
  if (draft?.pts?.length) {
    ctx.beginPath(); smoothPath(ctx, cursor ? [...draft.pts, cursor] : draft.pts, v);
    ctx.strokeStyle = draft.kind === "river" ? th.river : "#b0261b"; ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    for (const [x, y] of draft.pts) { const [sx, sy] = toScreen(v, x, y); ctx.fillStyle = "#b0261b"; ctx.fillRect(sx - 3, sy - 3, 6, 6); }
  }
  // terrain brush
  if (brush && cursor) {
    const [sx, sy] = toScreen(v, cursor[0], cursor[1]);
    ctx.strokeStyle = "#b0261b"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, brush.r * v.z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  decorations(ctx, st, th);
  ctx.restore();
}

function glow(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(240,180,40,.75)"); g.addColorStop(1, "rgba(240,180,40,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
// a pennant on a pole: the event marker
export function eventIcon(ctx, x, y, s, style) {
  const red = style === "atlas" ? "#c0392b" : "#8a2c1c";
  ctx.setLineDash([]);
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 1.4); ctx.stroke();
  ctx.fillStyle = red; ctx.beginPath();
  ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s * 1.05, y - s * 1.1); ctx.lineTo(x, y - s * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#3b2a1a"; ctx.beginPath(); ctx.ellipse(x, y, s * 0.35, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
}
function ring(ctx, x, y, r) {
  ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
}
function textHalo(ctx, text, x, y, font, th, style) {
  ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.lineJoin = "round"; ctx.lineWidth = 3.5;
  ctx.strokeStyle = style === "atlas" ? "rgba(255,255,255,.85)" : "rgba(239,227,196,.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = th.ink; ctx.fillText(text, x, y);
}

export function settlementIcon(ctx, type, x, y, s, th, style) {
  const paper = style === "atlas" ? "#fffaf0" : "#efe3c4";
  const red = style === "atlas" ? "#b23a2a" : "#8a2c1c";
  ctx.lineWidth = 1.2; ctx.strokeStyle = th.ink; ctx.fillStyle = paper; ctx.setLineDash([]);
  const r = s / 2;
  if (type === "capital" || type === "city") {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const towers = type === "capital" ? 8 : 6;
    for (let t = 0; t < towers; t++) {
      const a = (t / towers) * Math.PI * 2;
      ctx.fillStyle = paper; ctx.fillRect(x + Math.cos(a) * r - 1.8, y + Math.sin(a) * r - 1.8, 3.6, 3.6);
      ctx.strokeRect(x + Math.cos(a) * r - 1.8, y + Math.sin(a) * r - 1.8, 3.6, 3.6);
    }
    ctx.fillStyle = type === "capital" ? red : th.ink;
    if (type === "capital") star(ctx, x, y, r * 0.55, r * 0.24);
    else { ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
  } else if (type === "town") {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, Math.PI * 2); ctx.fill();
  } else if (type === "village") {
    ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.6); ctx.lineTo(x - r, y - r * 0.1); ctx.lineTo(x, y - r * 0.9); ctx.lineTo(x + r, y - r * 0.1); ctx.lineTo(x + r, y + r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (type === "hamlet") {
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  } else if (type === "castle") {
    const w = s * 0.8, h = s * 0.7;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h / 2); ctx.lineTo(x - w / 2, y - h / 2);
    for (let c = 0; c < 3; c++) { const cx = x - w / 2 + (c * w) / 2.5; ctx.lineTo(cx, y - h / 2 - 2.5); ctx.lineTo(cx + w / 5, y - h / 2 - 2.5); ctx.lineTo(cx + w / 5, y - h / 2); ctx.lineTo(cx + w / 2.5, y - h / 2); }
    ctx.lineTo(x + w / 2, y + h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = th.ink; ctx.fillRect(x - 1.6, y + h / 2 - 4, 3.2, 4);
    ctx.strokeStyle = red; ctx.beginPath(); ctx.moveTo(x, y - h / 2 - 2.5); ctx.lineTo(x, y - h / 2 - 8); ctx.stroke();
    ctx.fillStyle = red; ctx.beginPath(); ctx.moveTo(x, y - h / 2 - 8); ctx.lineTo(x + 5, y - h / 2 - 6.5); ctx.lineTo(x, y - h / 2 - 5); ctx.fill();
  }
}
function star(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r : R; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}

export function poiIcon(ctx, type, x, y, s, th, style) {
  const paper = style === "atlas" ? "#fffaf0" : "#efe3c4";
  ctx.strokeStyle = th.ink; ctx.fillStyle = paper; ctx.lineWidth = 1.1; ctx.setLineDash([]);
  const r = s / 2;
  ctx.beginPath();
  switch (type) {
    case "cave":
      ctx.moveTo(x - r * 1.2, y + r * 0.6); ctx.quadraticCurveTo(x, y - r * 1.6, x + r * 1.2, y + r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = th.ink; ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.6); ctx.quadraticCurveTo(x, y - r * 0.5, x + r * 0.45, y + r * 0.6); ctx.fill(); break;
    case "mine":
      ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r); ctx.moveTo(x + r, y + r); ctx.lineTo(x - r, y - r);
      ctx.moveTo(x + r * 0.4, y - r * 1.2); ctx.quadraticCurveTo(x + r * 1.1, y - r * 1.1, x + r * 1.2, y - r * 0.4);
      ctx.moveTo(x - r * 0.4, y - r * 1.2); ctx.quadraticCurveTo(x - r * 1.1, y - r * 1.1, x - r * 1.2, y - r * 0.4); ctx.stroke(); break;
    case "ruin":
      for (const [dx, hh] of [[-0.7, 1.4], [0, 0.8], [0.7, 1.1]]) { ctx.rect(x + dx * r - r * 0.18, y + r - hh * r, r * 0.36, hh * r); }
      ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - r * 1.1, y + r); ctx.lineTo(x + r * 1.1, y + r); ctx.stroke(); break;
    case "tower":
      ctx.rect(x - r * 0.4, y - r * 1.1, r * 0.8, r * 2.1); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.55, y - r * 1.1); ctx.lineTo(x, y - r * 1.8); ctx.lineTo(x + r * 0.55, y - r * 1.1); ctx.closePath(); ctx.fillStyle = th.ink; ctx.fill(); break;
    case "shrine": case "monastery": case "temple":
      if (type === "temple") { ctx.moveTo(x - r * 1.1, y - r * 0.3); ctx.lineTo(x, y - r * 1.1); ctx.lineTo(x + r * 1.1, y - r * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); for (const dx of [-0.7, -0.23, 0.23, 0.7]) { ctx.moveTo(x + dx * r, y - r * 0.3); ctx.lineTo(x + dx * r, y + r * 0.8); } ctx.moveTo(x - r * 1.1, y + r * 0.8); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.stroke(); }
      else if (type === "monastery") { ctx.rect(x - r, y - r * 0.2, r * 2, r); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - r * 0.2); ctx.lineTo(x, y - r * 1.4); ctx.moveTo(x - r * 0.4, y - r * 0.95); ctx.lineTo(x + r * 0.4, y - r * 0.95); ctx.stroke(); }
      else { ctx.moveTo(x, y + r); ctx.lineTo(x, y - r * 1.2); ctx.moveTo(x - r * 0.55, y - r * 0.5); ctx.lineTo(x + r * 0.55, y - r * 0.5); ctx.lineWidth = 1.6; ctx.stroke(); }
      break;
    case "dungeon":
      ctx.arc(x, y - r * 0.2, r * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.17, 0, Math.PI * 2); ctx.arc(x + r * 0.3, y - r * 0.3, r * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - r * 0.4, y + r * 0.8); ctx.lineTo(x + r * 0.4, y + r * 0.8); ctx.stroke(); break;
    case "lair":
      for (const dx of [-0.6, 0, 0.6]) { ctx.moveTo(x + dx * r - r * 0.2, y + r); ctx.quadraticCurveTo(x + dx * r + r * 0.4, y, x + dx * r - r * 0.1, y - r); }
      ctx.lineWidth = 1.5; ctx.strokeStyle = style === "atlas" ? "#8a1f14" : "#6a1f12"; ctx.stroke(); break;
    case "camp":
      ctx.moveTo(x - r * 1.1, y + r * 0.8); ctx.lineTo(x, y - r); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r * 0.8); ctx.stroke(); break;
    case "inn":
      ctx.rect(x - r, y - r * 0.3, r * 2, r * 1.2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 1.2, y - r * 0.3); ctx.lineTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y - r * 0.3); ctx.stroke();
      ctx.fillStyle = style === "atlas" ? "#b23a2a" : "#8a2c1c"; ctx.fillRect(x + r * 0.9, y - r * 0.1, r * 0.6, r * 0.5); break;
    case "stones":
      for (const [dx, dy] of [[-0.9, 0.2], [-0.3, -0.3], [0.3, -0.3], [0.9, 0.2]]) ctx.rect(x + dx * r - r * 0.17, y + dy * r - r * 0.5, r * 0.34, r);
      ctx.fill(); ctx.stroke(); break;
    case "battlefield":
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      ctx.moveTo(x - r * 0.9, y - r * 0.4); ctx.lineTo(x - r * 0.4, y - r * 0.9); ctx.moveTo(x + r * 0.9, y - r * 0.4); ctx.lineTo(x + r * 0.4, y - r * 0.9);
      ctx.lineWidth = 1.5; ctx.stroke(); break;
    case "lighthouse":
      ctx.moveTo(x - r * 0.5, y + r); ctx.lineTo(x - r * 0.25, y - r * 0.8); ctx.lineTo(x + r * 0.25, y - r * 0.8); ctx.lineTo(x + r * 0.5, y + r); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); for (const a of [-0.5, 0, 0.5]) { ctx.moveTo(x + r * 0.4, y - r * 0.9); ctx.lineTo(x + r * 1.4, y - r * 0.9 + a * r); } ctx.strokeStyle = "#c08a20"; ctx.stroke(); break;
    case "bridge":
      ctx.moveTo(x - r * 1.2, y); ctx.lineTo(x + r * 1.2, y); ctx.moveTo(x - r, y); ctx.quadraticCurveTo(x, y - r * 1.2, x + r, y); ctx.lineWidth = 1.4; ctx.stroke(); break;
    case "portal":
      ctx.ellipse(x, y, r * 0.7, r * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.35, r * 0.65, 0, 0, Math.PI * 2); ctx.strokeStyle = "#6a4aa0"; ctx.stroke(); break;
    default:
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function decorations(ctx, st, th) {
  const { map, view: v, width, height } = st;
  // scale bar
  const kmPerPx = (map.kmPerCell || 1) / v.z;
  const unit = map.travel?.unit === "mi" ? "mi" : "km";
  const perUnit = unit === "mi" ? 1.609344 : 1;
  const target = 140 * kmPerPx / perUnit;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((m) => m * pow).filter((x) => x <= target).pop() || pow;
  const px = (nice * perUnit) / kmPerPx;
  const x0 = 24, y0 = height - 30;
  ctx.fillStyle = "rgba(239,227,196,.88)"; ctx.fillRect(x0 - 10, y0 - 22, px + 64, 38);
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x0 - 10, y0 - 22, px + 64, 38);
  for (let s = 0; s < 4; s++) { ctx.fillStyle = s % 2 ? "#efe3c4" : th.ink; ctx.fillRect(x0 + (px * s) / 4, y0, px / 4, 5); }
  ctx.strokeRect(x0, y0, px, 5);
  ctx.fillStyle = th.ink; ctx.font = `12px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.fillText(`0`, x0 - 3, y0 - 6); ctx.fillText(`${nice} ${unit}`, x0 + px - 6, y0 - 6);
  // compass rose
  const cx = width - 54, cy = height - 60, R = 30;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = "rgba(239,227,196,.85)"; ctx.beginPath(); ctx.arc(0, 0, R + 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, R + 2, 0, Math.PI * 2); ctx.stroke();
  for (let q = 0; q < 8; q++) {
    const a = (q * Math.PI) / 4, L = q % 2 ? R * 0.55 : R;
    ctx.save(); ctx.rotate(a);
    ctx.fillStyle = q % 2 ? th.inkSoft : th.ink;
    ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(4, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#efe3c4"; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(-4, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = th.ink; ctx.font = `bold 12px ${FONT_CAPS}`; ctx.textAlign = "center"; ctx.fillText("N", 0, -R - 9);
  ctx.restore();
}

// --- hit testing ------------------------------------------------------------
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function hitTest(map, v, sx, sy, gm, showEvents = true) {
  const vis = (e) => gm || !e.hidden;
  const k = Math.max(0.6, Math.min(1.8, v.z / 5));
  if (showEvents) for (const e of map.events || []) {
    if (!vis(e) || e.x == null) continue;
    const [x, y] = toScreen(v, e.x, e.y);
    if (Math.abs(sx - x - 4 * k) < 9 * k && sy < y + 3 && sy > y - 16 * k) return { kind: "events", id: e.id };
  }
  for (const s of [...(map.settlements || [])].reverse()) {
    if (!vis(s)) continue;
    const [x, y] = toScreen(v, s.x, s.y);
    if (Math.hypot(sx - x, sy - y) <= SETTLEMENT_SIZE[s.type] * k * 0.6 + 4) return { kind: "settlements", id: s.id };
  }
  for (const p of map.pois || []) {
    if (!vis(p)) continue;
    const [x, y] = toScreen(v, p.x, p.y);
    if (Math.hypot(sx - x, sy - y) <= 9 * k) return { kind: "pois", id: p.id };
  }
  for (const l of map.labels || []) {
    if (!vis(l)) continue;
    const [x, y] = toScreen(v, l.x, l.y);
    const size = Math.max(9, Math.min(64, (l.size || 2) * v.z * 0.9));
    if ((l.size || 2) * v.z >= 6 && Math.abs(sy - y) < size * 0.6 && Math.abs(sx - x) < l.name.length * size * 0.38) return { kind: "labels", id: l.id };
  }
  for (const kind of ["roads", "rivers"]) {
    for (const r of map[kind] || []) {
      if (!vis(r)) continue;
      const s = r.pts.map(([x, y]) => toScreen(v, x, y));
      for (let j = 1; j < s.length; j++) if (distSeg(sx, sy, s[j - 1][0], s[j - 1][1], s[j][0], s[j][1]) < 5) return { kind, id: r.id };
    }
  }
  return null;
}
export function vertexAt(pts, v, sx, sy) {
  for (let j = 0; j < pts.length; j++) { const [x, y] = toScreen(v, pts[j][0], pts[j][1]); if (Math.hypot(sx - x, sy - y) < 7) return j; }
  return -1;
}
export { isWater };
