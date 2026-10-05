// Fantasy region generator — in the spirit of Azgaar's Fantasy Map
// Generator, scaled down to one territory (a few hundred km): heightmap →
// sea level → lakes (filled depressions) → drainage & rivers → climate →
// biomes → settlements → road network (A* that reuses existing roads, so
// lanes join into highways) → points of interest → region labels.
import { rngFrom, makeNoise, pick } from "./rng.js";
import { encodeTerrain, simplify, SETTLEMENT_TYPES, LABEL_TYPES, newId, forEachCellOnLine, ROAD_TYPES } from "./model.js";
const LABEL_KEYS = Object.keys(LABEL_TYPES);
import { makeNamer } from "./names.js";
import { findPath } from "./path.js";

export const SIZES = { small: [180, 120], medium: [240, 160], large: [320, 214] };
export const TEMPLATES = {
  coast: "Coastline (sea on one side)",
  peninsula: "Peninsula",
  island: "Island",
  archipelago: "Archipelago",
  inland: "Inland (lakes only)",
  highlands: "Highlands",
};
export const CLIMATES = { temperate: "Temperate", cold: "Cold north", warm: "Warm south", arid: "Arid" };

export const DEFAULT_OPTIONS = {
  name: "", seed: "", size: "medium", widthKm: 300, template: "coast", climate: "temperate",
  forests: 0.5, mountains: 0.5, density: 0.5, culture: "anglo",
};

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const C = (s) => s.charCodeAt(0);
const BC = Object.fromEntries("OLGAFDTHMSWR".split("").map((k) => [k, C(k)]));

// Guide grids (a draft map to rebuild): rows of characters, any resolution,
// stretched over the map. " " = land, let the climate decide; "#" = ink
// (lines, lettering) — filled from the neighbouring cells.
export const GUIDE_LEGEND = {
  "~": "O", o: "L", ".": "G", ",": "A", f: "F", F: "D", t: "T", h: "H", m: "M", M: "S", s: "W", d: "R", " ": "", "#": "#",
};
export const GUIDE_HELP = "~ sea · o lake · . plains · , farmland · f forest · F deep forest · t taiga · h hills · m mountains · M snowy peaks · s marsh · d desert · (space) land, climate decides · # ink/unknown, filled from neighbours";

// → Uint8Array of biome codes (0 = free land) at w×h, or null
function sampleGuide(rows, w, h) {
  const R = rows.length, Cn = Math.max(...rows.map((r) => r.length));
  const g = new Uint8Array(w * h);
  const INK = 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = (rows[Math.min(R - 1, Math.floor((y + 0.5) * R / h))] || "")[Math.min(Cn - 1, Math.floor((x + 0.5) * Cn / w))] ?? " ";
    const m = GUIDE_LEGEND[ch];
    g[y * w + x] = m === undefined || m === "#" ? INK : m ? C(m) : 0;
  }
  // ink → nearest known value (multi-source BFS)
  const q = [];
  for (let k = 0; k < w * h; k++) if (g[k] !== INK) q.push(k);
  if (!q.length) return null;
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], x = k % w, y = (k - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const kk = yy * w + xx;
      if (g[kk] === INK) { g[kk] = g[k]; q.push(kk); }
    }
  }
  return g;
}

export function generateMap(opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const seed = o.seed || Math.random().toString(36).slice(2, 8);
  const guideRows = Array.isArray(o.guide) ? o.guide.filter((r) => typeof r === "string") : null;
  const hasGuide = !!(guideRows && guideRows.length >= 2);
  let [w, h] = SIZES[o.size] || SIZES.medium;
  if (hasGuide) { // keep the draft's proportions
    const ratio = guideRows.length / Math.max(...guideRows.map((r) => r.length));
    h = Math.round(Math.max(w * 0.35, Math.min(w * 1.6, w * ratio)));
  }
  const n = w * h;
  const G = hasGuide ? sampleGuide(guideRows, w, h) : null;
  const rng = rngFrom(seed);
  const nz = makeNoise(rngFrom(seed + ":h"));
  const mz = makeNoise(rngFrom(seed + ":m"));

  // ---- 1. heightmap ------------------------------------------------------
  const height = new Float32Array(n);
  const sc = 3.2 / w;
  const side = Math.floor(rng() * 4);
  const mtn = o.template === "highlands" ? Math.max(0.75, o.mountains) : o.mountains;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = x / w, ny = y / h;
    const base = nz.fbm(x * sc, y * sc, 6);
    const warp = (nz.fbm(x * sc * 0.7 + 50, y * sc * 0.7 + 50, 3) - 0.5) * 0.35;
    let v;
    if (o.template === "island" || o.template === "archipelago") {
      const d = Math.hypot((nx - 0.5) / 0.55, (ny - 0.5) / 0.55) + warp;
      v = base * (o.template === "archipelago" ? 1 : 0.6) + (1 - d * d) * (o.template === "archipelago" ? 0.25 : 0.6);
    } else if (o.template === "coast" || o.template === "peninsula") {
      const t = [nx, 1 - nx, ny, 1 - ny][side] + warp;
      let mask = Math.min(1, Math.max(0, (t - 0.1) / 0.5));
      if (o.template === "peninsula") {
        const across = [ny, ny, nx, nx][side];
        mask = Math.min(mask, 1 - Math.min(1, Math.abs(across - 0.5) * 2.4 - (1 - t) * 0.3 + warp));
      }
      v = base * 0.55 + mask * 0.55;
    } else {
      v = 0.35 + base * 0.65;
    }
    const ridge = nz.ridged(x * sc * 1.6 + 100, y * sc * 1.6 + 100, 4);
    const belt = Math.max(0, Math.min(1, (nz.fbm(x * sc * 0.5 + 300, y * sc * 0.5 + 300, 2) - 0.42) / 0.2));
    v += mtn * 0.5 * Math.pow(ridge, 3) * belt;
    height[i(x, y)] = v;
  }
  function i(x, y) { return y * w + x; }
  normalize(height);

  // sea level from the template's land share; inland: no sea, only lakes
  const landShare = { coast: 0.68, peninsula: 0.5, island: 0.42, archipelago: 0.3, inland: 1, highlands: 0.85 }[o.template] ?? 0.65;
  const sorted = Float32Array.from(height).sort();
  let sea = landShare >= 1 ? sorted[0] - 0.001 : sorted[Math.floor((1 - landShare) * (n - 1))];

  const biome = new Uint8Array(n).fill(BC.G);
  if (G) {
    // a draft decides where land and water are; relief rises with the
    // distance from the shore, plus the hills and mountains it marks
    sea = 0.4;
    const isW = (k) => G[k] === BC.O || G[k] === BC.L;
    const dLand = distanceTo(w, h, (k) => !isW(k), 40), dWater = distanceTo(w, h, isW, 60);
    for (let k = 0; k < n; k++) {
      const x = k % w, y = (k - x) / w, nzv = nz.fbm(x * sc * 1.5, y * sc * 1.5, 5) - 0.5;
      if (isW(k)) { height[k] = sea - 0.03 - Math.min(0.3, dLand[k] * 0.015) + nzv * 0.04; continue; }
      let e = 0.08 + 0.42 * (1 - Math.exp(-dWater[k] / 14)) + nzv * 0.3;
      if (G[k] === BC.H) e = Math.max(e, 0.52 + nzv * 0.15);
      if (G[k] === BC.M || G[k] === BC.S) e = Math.max(e, 0.72 + nz.ridged(x * sc * 2 + 9, y * sc * 2 + 9, 3) * 0.25 + (G[k] === BC.S ? 0.08 : 0));
      height[k] = sea + (1 - sea) * Math.max(0.02, Math.min(1, e));
    }
    // guided water: touching the map edge = sea, inland = lake (unless marked)
    for (const comp of components(w, h, isW)) {
      const edge = comp.some((k) => { const x = k % w, y = (k - x) / w; return x === 0 || y === 0 || x === w - 1 || y === h - 1; });
      for (const k of comp) biome[k] = G[k] === BC.L || !edge ? BC.L : BC.O;
    }
  } else {
    // ocean = below sea and connected to the border
    const below = (k) => height[k] <= sea;
    floodFromBorder(w, h, below, (k) => { biome[k] = BC.O; });
  }

  // ---- 2. depressions → lakes; drainage surface ------------------------
  const filled = priorityFill(w, h, height, biome);
  if (!G) for (let k = 0; k < n; k++) {
    if (biome[k] === BC.O) continue;
    if (height[k] <= sea || filled[k] - height[k] > 0.035) biome[k] = BC.L;
  }
  // keep the deepest basins up to ~4% of the land as lakes; specks and the
  // rest go back to land (they still drain through)
  const lakes = components(w, h, (k) => biome[k] === BC.L).map((comp) => ({ comp, depth: Math.max(...comp.map((k) => filled[k] - height[k])) }));
  lakes.sort((a, b) => b.depth - a.depth);
  let lakeBudget = G ? Infinity : Math.round(n * 0.04);
  for (const l of lakes) {
    const keep = l.comp.length >= 4 && l.comp.length <= lakeBudget;
    if (keep) lakeBudget -= l.comp.length;
    else for (const k of l.comp) biome[k] = BC.G;
  }

  // ---- 3. climate ------------------------------------------------------
  const distW = distanceTo(w, h, (k) => biome[k] === BC.O || biome[k] === BC.L, 30);
  const tBase = { temperate: 0.55, cold: 0.3, warm: 0.75, arid: 0.72 }[o.climate] ?? 0.55;
  const mBase = o.climate === "arid" ? -0.22 : o.climate === "cold" ? 0.05 : 0;
  const moist = new Float32Array(n), temp = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = i(x, y);
    const e = Math.max(0, (height[k] - sea) / (1 - sea));
    moist[k] = mz.fbm(x * sc * 1.3, y * sc * 1.3, 5) + 0.3 * Math.exp(-distW[k] / 10) + mBase + (o.forests - 0.5) * 0.3;
    temp[k] = tBase + (y / h - 0.5) * 0.25 - e * 0.55 + (mz.noise(x * sc * 0.8 + 70, y * sc * 0.8) - 0.5) * 0.1;
  }

  // ---- 4. rivers (drainage on the filled surface) ------------------------
  const down = new Int32Array(n).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = i(x, y);
    if (biome[k] === BC.O) continue;
    let best = -1, bh = filled[k];
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) { if (best < 0 && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) best = -2; continue; }
      const kk = i(xx, yy);
      if (filled[kk] < bh) { bh = filled[kk]; best = kk; }
    }
    down[k] = best;
  }
  const order = Array.from({ length: n }, (_, k) => k).filter((k) => biome[k] !== BC.O).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(n);
  for (const k of order) {
    acc[k] += 0.4 + Math.max(0, moist[k]);
    if (down[k] >= 0) acc[down[k]] += acc[k];
  }
  const landAcc = order.filter((k) => biome[k] !== BC.L).map((k) => acc[k]).sort((a, b) => a - b);
  const T = landAcc[Math.floor(landAcc.length * 0.975)] || Infinity;
  const isLandRiver = (k) => biome[k] !== BC.O && biome[k] !== BC.L && acc[k] >= T;
  const onRiver = new Uint8Array(n);
  const rivers = [];
  const sources = [];
  for (const k of order) {
    if (!isLandRiver(k)) continue;
    const x = k % w, y = (k - x) / w;
    let fed = false;
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const kk = i(xx, yy);
      if (down[kk] === k && isLandRiver(kk)) { fed = true; break; }
    }
    if (!fed) sources.push(k);
  }
  const jr = rngFrom(seed + ":rv");
  for (const s of sources) {
    const cells = [];
    let k = s, end = null;
    while (k >= 0 && cells.length < 4000) {
      cells.push(k);
      if (onRiver[k] && cells.length > 1) { end = "join"; break; }
      onRiver[k] = 1;
      const d = down[k];
      if (d < 0) { end = "edge"; break; }
      if (biome[d] === BC.O || biome[d] === BC.L) { cells.push(d); end = "water"; break; }
      k = d;
    }
    if (cells.length < (end === "join" ? 3 : 6)) continue;
    const pts = cells.map((c, j) => {
      const cx = c % w, cy = (c - cx) / w;
      const jit = j === 0 || j === cells.length - 1 ? 0 : 0.28;
      return [cx + 0.5 + (jr() - 0.5) * jit * 2, cy + 0.5 + (jr() - 0.5) * jit * 2];
    });
    if (end === "edge") { const [lx, ly] = pts[pts.length - 1]; pts.push([lx <= 1 ? 0 : lx >= w - 1 ? w : lx, ly <= 1 ? 0 : ly >= h - 1 ? h : ly]); }
    const last = cells[cells.length - (end === "water" ? 2 : 1)];
    rivers.push({ pts: simplify(pts, 0.35), acc: acc[last] });
  }
  const maxAcc = Math.max(1, ...rivers.map((r) => r.acc));

  // ---- 5. biomes -------------------------------------------------------
  // relief by land-height percentile, so the "mountains" slider means the
  // same share of the land whatever the template
  const landIdx = [];
  for (let k = 0; k < n; k++) if (biome[k] !== BC.O && biome[k] !== BC.L) landIdx.push(k);
  landIdx.sort((a, b) => height[a] - height[b]);
  const prank = new Float32Array(n);
  landIdx.forEach((k, j) => { prank[k] = j / Math.max(1, landIdx.length - 1); });
  const mShare = 0.03 + mtn * 0.2, hShare = 0.08 + mtn * 0.14;
  const fShift = (o.forests - 0.5) * 0.25;
  for (let k = 0; k < n; k++) {
    if (biome[k] === BC.O || biome[k] === BC.L) continue;
    const e = (height[k] - sea) / (1 - sea), pr = prank[k];
    const m = moist[k] + (onRiver[k] ? 0.08 : 0), t = temp[k];
    let b = BC.G;
    if (G && G[k]) { biome[k] = G[k]; continue; } // the draft said so
    if (G ? e > 0.85 : pr > 1 - mShare * 0.3) b = t < 0.5 ? BC.S : BC.M;
    else if (G ? e > 0.68 : pr > 1 - mShare) b = BC.M;
    else if (G ? e > 0.5 : pr > 1 - mShare - hShare) b = m > 0.66 - fShift ? BC.F : BC.H;
    else if (t < 0.22) b = m > 0.5 ? BC.T : BC.G;
    else if (m < 0.3 && t > 0.6) b = BC.R;
    else if (e < 0.07 && m > 0.66) b = BC.W;
    else if (m > 0.7 - fShift) b = BC.D;
    else if (m > 0.56 - fShift) b = t < 0.32 ? BC.T : BC.F;
    biome[k] = b;
  }

  // ---- 6. settlements ----------------------------------------------------
  const world = { w, h, n, height, biome, sea, river: onRiver };
  const namer = makeNamer(rngFrom(seed + ":names"), o.culture, o.names);
  const landCells = biome.reduce((a, b) => a + (b !== BC.O && b !== BC.L ? 1 : 0), 0);
  const scale = (landCells / 38400) * (0.5 + o.density);
  const sRng = rngFrom(seed + ":s");
  const fertile = { [BC.G]: 1, [BC.A]: 1, [BC.F]: 0.55, [BC.T]: 0.45, [BC.H]: 0.6, [BC.R]: 0.25, [BC.W]: 0.12, [BC.D]: 0.2, [BC.M]: 0.04, [BC.S]: 0 };
  const near = (k, test, r = 1) => {
    const x = k % w, y = (k - x) / w;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && test(i(xx, yy))) return true;
    }
    return false;
  };
  const score = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const f = fertile[biome[k]] ?? 0;
    if (!f) continue;
    score[k] = f + (near(k, (q) => onRiver[q], 1) ? 0.6 : 0) + (near(k, (q) => biome[q] === BC.O, 1) ? 0.5 : 0)
      + (near(k, (q) => biome[q] === BC.L, 1) ? 0.3 : 0) + sRng() * 0.35;
  }
  const settlements = [];
  const place = (type, count, minD, extra = () => 0) => {
    const cands = [];
    for (let k = 0; k < n; k++) if (score[k] > 0.3) cands.push(k);
    cands.sort((a, b) => score[b] + extra(b) - (score[a] + extra(a)));
    let made = 0;
    for (const k of cands) {
      if (made >= count) break;
      const x = k % w + 0.5, y = Math.floor(k / w) + 0.5;
      const dmin = (t) => (t === "capital" || t === "city" ? minD * 1 : t === "town" ? Math.min(minD, w / 18) : Math.min(minD, w / 40));
      if (settlements.some((s) => Math.hypot(s.x - x, s.y - y) < Math.max(minD, dmin(s.type) * 0.6))) continue;
      const [p0, p1] = SETTLEMENT_TYPES[type].pop;
      const coast = near(k, (q) => biome[q] === BC.O, 1);
      settlements.push({
        id: newId("s"), type, name: namer.place(type), x, y, cell: k,
        population: Math.round((p0 + (p1 - p0) * sRng() ** 2) / 10) * 10,
        port: coast, description: "", images: [], gmNotes: "", hidden: false,
      });
      made++;
    }
  };
  // places given by the caller (a draft's towns), at fractions of the map
  // (fx, fy in 0..1); nudged onto the nearest land
  const given = { capital: 0, city: 0, town: 0, village: 0, hamlet: 0, castle: 0 };
  for (const p of Array.isArray(o.places) ? o.places : []) {
    const type = SETTLEMENT_TYPES[p.type] ? p.type : "village";
    let x = Math.max(0, Math.min(w - 1, Math.floor((p.fx ?? 0.5) * w))), y = Math.max(0, Math.min(h - 1, Math.floor((p.fy ?? 0.5) * h)));
    const land = (k) => biome[k] !== BC.O && biome[k] !== BC.L;
    if (!land(i(x, y))) {
      let best = null;
      for (let r = 1; r < 12 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && land(i(xx, yy))) { best = [xx, yy]; break; }
      }
      if (best) [x, y] = best;
    }
    const k = i(x, y), [p0, p1] = SETTLEMENT_TYPES[type].pop;
    settlements.push({
      id: newId("s"), type, name: p.name || namer.place(type), x: x + 0.5, y: y + 0.5, cell: k,
      population: p.population ?? Math.round((p0 + (p1 - p0) * sRng() ** 2) / 10) * 10,
      port: near(k, (q) => biome[q] === BC.O, 1), description: p.description || "", images: [], gmNotes: "", hidden: false,
    });
    given[type]++;
  }
  const extra = o.extraSettlements !== false;
  const count = (type, nAuto) => (extra ? Math.max(0, nAuto - given[type]) : 0);
  const center = (k) => { const x = k % w, y = (k - x) / w; return -Math.hypot(x / w - 0.5, y / h - 0.5) * 1.2; };
  if (!given.capital) place("capital", extra || !settlements.length ? 1 : 0, 0, center);
  place("city", count("city", Math.max(1, Math.round(3.5 * scale))), w / 8);
  place("town", count("town", Math.max(2, Math.round(11 * scale))), w / 18);
  place("village", count("village", Math.max(4, Math.round(34 * scale))), w / 40);
  // castles watch the hills near the settled land
  const hillScore = (k) => (biome[k] === BC.H ? 0.8 : biome[k] === BC.M ? 0.3 : 0);
  place("castle", count("castle", Math.max(1, Math.round(5 * scale))), w / 14, hillScore);

  // fields around farming settlements
  const fRng = rngFrom(seed + ":fields");
  for (const s of settlements) {
    const r = { capital: 6, city: 4.5, town: 3, village: 2, hamlet: 1, castle: 1.2 }[s.type];
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const x = Math.floor(s.x) + dx, y = Math.floor(s.y) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = i(x, y);
      if (Math.hypot(dx, dy) > r * (0.7 + fRng() * 0.5)) continue;
      if (biome[k] === BC.G || biome[k] === BC.F || biome[k] === BC.H && fRng() < 0.4) biome[k] = BC.A;
    }
  }

  // ---- 7. roads ----------------------------------------------------------
  const roads = buildRoads(world, settlements, rngFrom(seed + ":r"));

  // ---- 8. points of interest ---------------------------------------------
  const pois = placePois(world, settlements, roads, namer, rngFrom(seed + ":p"), scale);
  for (const r of roads) if (r.type === "trail" && r.poi) delete r.poi;

  // ---- 9. names for rivers and areas -------------------------------------
  rivers.sort((a, b) => b.acc - a.acc);
  const riverOut = rivers.map((r, j) => ({
    id: newId("v"), name: j < 8 ? namer.feature("river") : "", width: Math.round((0.6 + 2.6 * Math.sqrt(r.acc / maxAcc)) * 10) / 10,
    pts: r.pts.map(([x, y]) => [round2(x), round2(y)]), description: "", images: [], gmNotes: "", hidden: false,
  }));
  let labels = areaLabels(world, namer);
  if (Array.isArray(o.labels) && o.labels.length) {
    const mine = o.labels.map((l) => ({
      id: newId("l"), type: LABEL_KEYS.includes(l.type) ? l.type : "region", name: l.name || namer.feature(l.type || "region"),
      x: round2(Math.max(0, Math.min(w, (l.fx ?? 0.5) * w))), y: round2(Math.max(0, Math.min(h, (l.fy ?? 0.5) * h))),
      size: l.size ?? (l.type === "region" ? 4 : 2.5), angle: l.angle ?? 0, description: "", images: [], gmNotes: "", hidden: false,
    }));
    // a named feature of the draft replaces the generated name of the same kind nearby
    labels = labels.filter((a) => !mine.some((m) => m.type === a.type && Math.hypot(m.x - a.x, m.y - a.y) < w / 8));
    labels.push(...mine);
  }

  for (const s of settlements) delete s.cell;
  const terrain = encodeTerrain({ n, height, biome, sea });
  return {
    format: "sit-fantasy-map", formatVersion: 1,
    name: o.name || namer.feature("region"), seed, w, h,
    kmPerCell: Math.round((o.widthKm / w) * 1000) / 1000,
    options: { ...o, guide: hasGuide ? `${guideRows.length} rows` : undefined, places: undefined, labels: undefined }, terrain,
    settlements, roads, rivers: riverOut, pois, labels, events: [], books: [],
    style: "parchment", playerVisible: false, description: "", images: [], gmNotes: "",
    currency: defaultCurrencyRef(), travel: { unit: "km" },
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
function defaultCurrencyRef() { return null; } // filled by currency.js defaults in the app

function normalize(a) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const r = hi - lo || 1;
  for (let k = 0; k < a.length; k++) a[k] = (a[k] - lo) / r;
}

function floodFromBorder(w, h, test, mark) {
  const seen = new Uint8Array(w * h);
  const q = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) q.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) q.push(y * w + x);
  while (q.length) {
    const k = q.pop();
    if (seen[k] || !test(k)) continue;
    seen[k] = 1; mark(k);
    const x = k % w, y = (k - x) / w;
    if (x > 0) q.push(k - 1); if (x < w - 1) q.push(k + 1); if (y > 0) q.push(k - w); if (y < h - 1) q.push(k + w);
  }
}

// priority-flood (Barnes et al.) with a tiny epsilon so every land cell
// drains; seeds are the ocean and the map border
function priorityFill(w, h, height, biome) {
  const n = w * h, filled = new Float32Array(height);
  const done = new Uint8Array(n);
  const heapK = [], heapV = [];
  const push = (k, v) => { let j = heapK.length; heapK.push(k); heapV.push(v); while (j > 0) { const p = (j - 1) >> 1; if (heapV[p] <= v) break; heapK[j] = heapK[p]; heapV[j] = heapV[p]; j = p; } heapK[j] = k; heapV[j] = v; };
  const pop = () => { const top = heapK[0]; const lk = heapK.pop(), lv = heapV.pop(); if (heapK.length) { let j = 0; const m = heapK.length; for (;;) { let c = 2 * j + 1; if (c >= m) break; if (c + 1 < m && heapV[c + 1] < heapV[c]) c++; if (heapV[c] >= lv) break; heapK[j] = heapK[c]; heapV[j] = heapV[c]; j = c; } heapK[j] = lk; heapV[j] = lv; } return top; };
  for (let k = 0; k < n; k++) {
    const x = k % w, y = (k - x) / w;
    if (biome[k] === 79 || x === 0 || y === 0 || x === w - 1 || y === h - 1) { done[k] = 1; push(k, filled[k]); }
  }
  while (heapK.length) {
    const k = pop();
    const x = k % w, y = (k - x) / w;
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const kk = yy * w + xx;
      if (done[kk]) continue;
      done[kk] = 1;
      if (filled[kk] <= filled[k]) filled[kk] = filled[k] + 1e-5;
      push(kk, filled[kk]);
    }
  }
  return filled;
}

function distanceTo(w, h, test, cap) {
  const d = new Float32Array(w * h).fill(cap);
  const q = [];
  for (let k = 0; k < w * h; k++) if (test(k)) { d[k] = 0; q.push(k); }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], x = k % w, y = (k - x) / w;
    for (const [dx, dy] of N8.slice(0, 4)) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const kk = yy * w + xx;
      if (d[kk] > d[k] + 1) { d[kk] = d[k] + 1; if (d[kk] < cap) q.push(kk); }
    }
  }
  return d;
}

export function components(w, h, test) {
  const seen = new Uint8Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !test(s)) continue;
    const comp = [], q = [s];
    seen[s] = 1;
    while (q.length) {
      const k = q.pop(); comp.push(k);
      const x = k % w, y = (k - x) / w;
      for (const kk of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
        if (kk >= 0 && !seen[kk] && test(kk)) { seen[kk] = 1; q.push(kk); }
      }
    }
    out.push(comp);
  }
  return out;
}

// ---- roads ------------------------------------------------------------------
const BUILD_COST = { [BC.G]: 1, [BC.A]: 1, [BC.R]: 1.5, [BC.T]: 1.7, [BC.F]: 2, [BC.H]: 2.4, [BC.D]: 3.5, [BC.W]: 5, [BC.M]: 9, [BC.S]: 25 };
export function buildRoads(world, settlements, rng) {
  const { w, h, n, biome, height, river } = world;
  const rank = new Uint8Array(n);
  const sCell = new Map(settlements.map((s) => [Math.floor(s.y) * w + Math.floor(s.x), s]));
  const roads = [];
  const step = (a, b, diag) => {
    const base = BUILD_COST[biome[b]];
    if (base === undefined) return Infinity; // water
    let c = base + Math.abs(height[b] - height[a]) * 40;
    if (river[b] && !rank[b]) c += 6; // a bridge or ford
    if (rank[b] >= 3) c *= 0.3; else if (rank[b]) c *= 0.5;
    return diag ? c * 1.4142 : c;
  };
  const commit = (path, type, from, to) => {
    const r = ROAD_TYPES[type].rank;
    // trim the stretch that runs along an existing road at least as good
    let a = 0, b = path.length - 1;
    while (a < b - 1 && rank[path[a + 1]] >= r) a++;
    while (b > a + 1 && rank[path[b - 1]] >= r) b--;
    const seg = path.slice(a, b + 1);
    for (const k of seg) if (rank[k] < r) rank[k] = r;
    const pts = seg.map((k) => [k % w + 0.5, Math.floor(k / w) + 0.5]);
    if (pts.length < 2) return;
    roads.push({ id: newId("r"), auto: true, type, name: "", from: from?.id || null, to: to?.id || null, pts: simplify(pts, 0.6), description: "", images: [], gmNotes: "", hidden: false });
  };
  const cellOf = (s) => Math.floor(s.y) * w + Math.floor(s.x);

  // royal roads: minimum spanning tree over capital + cities
  const hubs = settlements.filter((s) => s.type === "capital" || s.type === "city");
  const inTree = [hubs[0]].filter(Boolean), rest = hubs.slice(1);
  while (rest.length) {
    let best = null;
    for (const a of inTree) for (const b of rest) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!best || d < best.d) best = { a, b, d };
    }
    rest.splice(rest.indexOf(best.b), 1);
    inTree.push(best.b);
    const t = cellOf(best.b);
    const p = findPath({ w, h, start: cellOf(best.a), isGoal: (k) => k === t, target: t, step, minStep: 0.3 });
    if (p) commit(p.path, "royal", best.a, best.b);
  }
  // roads: towns join the network; tracks: villages and castles join any road
  const connect = (list, type, minRank, maxCost) => {
    list.sort((a, b) => Math.hypot(a.x - hubs[0]?.x, a.y - hubs[0]?.y) - Math.hypot(b.x - hubs[0]?.x, b.y - hubs[0]?.y));
    for (const s of list) {
      const start = cellOf(s);
      const goal = (k) => rank[k] >= minRank || (sCell.has(k) && sCell.get(k) !== s && (minRank <= 2 || ["capital", "city", "town"].includes(sCell.get(k).type)));
      const p = findPath({ w, h, start, isGoal: goal, step, maxCost });
      if (p) commit(p.path, type, s, sCell.get(p.path[p.path.length - 1]) || null);
    }
  };
  connect(settlements.filter((s) => s.type === "town"), "road", 3, 400);
  connect(settlements.filter((s) => s.type === "village" || s.type === "castle" || s.type === "hamlet"), "track", 2, 160);
  world.roadRank = rank;
  return roads;
}

// ---- points of interest -------------------------------------------------------
function placePois(world, settlements, roads, namer, rng, scale) {
  const { w, h, n, biome } = world;
  const rank = world.roadRank;
  const pois = [];
  const free = (x, y, d) => !pois.some((p) => Math.hypot(p.x - x, p.y - y) < d) && !settlements.some((s) => Math.hypot(s.x - x, s.y - y) < 4);
  const want = (type, count, ok, minD = 8) => {
    let made = 0;
    for (let tries = 0; tries < 4000 && made < count; tries++) {
      const k = Math.floor(rng() * n);
      if (!ok(k)) continue;
      const x = (k % w) + 0.5, y = Math.floor(k / w) + 0.5;
      if (!free(x, y, minD)) continue;
      pois.push({ id: newId("p"), type, name: namer.poi(type), x, y, description: "", images: [], gmNotes: "", hidden: false });
      made++;
    }
  };
  const B = (k) => String.fromCharCode(biome[k]);
  const c = (x) => Math.max(1, Math.round(x * scale));
  const nearRoad = (k, r) => { const x = k % w, y = (k - x) / w; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && rank[yy * w + xx] >= 3) return true; } return false; };
  want("cave", c(6), (k) => "HM".includes(B(k)));
  want("mine", c(4), (k) => B(k) === "M" || B(k) === "H" && rng() < 0.3);
  want("ruin", c(5), (k) => "GFDHRWT".includes(B(k)));
  want("tower", c(3), (k) => "GHF".includes(B(k)));
  want("shrine", c(4), (k) => "GAFH".includes(B(k)));
  want("monastery", c(2), (k) => "HF".includes(B(k)));
  want("dungeon", c(2), (k) => "MDH".includes(B(k)));
  want("lair", c(2), (k) => "DMWS".includes(B(k)));
  want("stones", c(2), (k) => "GH".includes(B(k)));
  want("battlefield", 1, (k) => "GA".includes(B(k)));
  want("inn", c(4), (k) => rank[k] >= 3 && !nearRoad(k, 0) === false, 12);
  want("lighthouse", biome.includes(79) ? c(2) : 0, (k) => B(k) !== "O" && B(k) !== "L" && [k - 1, k + 1, k - w, k + w].some((q) => q >= 0 && q < n && biome[q] === 79), 20);
  return pois;
}

// ---- area labels ---------------------------------------------------------------
function areaLabels(world, namer) {
  const { w, h, biome } = world;
  const groups = [
    { type: "forest", codes: "FDT", min: 70 }, { type: "mountains", codes: "MS", min: 35 }, { type: "hills", codes: "H", min: 90 },
    { type: "marsh", codes: "W", min: 45 }, { type: "desert", codes: "R", min: 60 }, { type: "sea", codes: "O", min: 250 }, { type: "lake", codes: "L", min: 14 },
  ];
  const out = [];
  for (const g of groups) {
    const set = new Set(g.codes.split("").map(C));
    for (const comp of components(w, h, (k) => set.has(biome[k]))) {
      if (comp.length < g.min) continue;
      // the label goes at the area's innermost cell (farthest from its
      // edge), nudged toward the centroid — a sea around an island gets its
      // name out in open water, not on the beach
      let sx = 0, sy = 0;
      for (const k of comp) { sx += k % w; sy += Math.floor(k / w); }
      sx /= comp.length; sy /= comp.length;
      const inComp = new Set(comp), depth = new Map(), q = [];
      for (const k of comp) {
        const x = k % w, y = (k - x) / w;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && !inComp.has(yy * w + xx); })) { depth.set(k, 0); q.push(k); }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const k = q[qi], x = k % w, y = (k - x) / w, d = depth.get(k);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy, kk = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !inComp.has(kk) || depth.has(kk)) continue;
          depth.set(kk, d + 1); q.push(kk);
        }
      }
      let best = comp[0], bs = -Infinity;
      for (const k of comp) {
        const s = Math.min(depth.get(k) ?? 0, 14) - Math.hypot(k % w - sx, Math.floor(k / w) - sy) * 0.08;
        if (s > bs) { bs = s; best = k; }
      }
      out.push({
        id: newId("l"), type: g.type, name: namer.feature(g.type), x: (best % w) + 0.5, y: Math.floor(best / w) + 0.5,
        size: Math.round(Math.max(1.6, Math.min(6, Math.sqrt(comp.length) * 0.16)) * 10) / 10, angle: 0,
        description: "", images: [], gmNotes: "", hidden: false,
      });
    }
  }
  return out;
}

// re-run the road network over a map's current terrain + settlements
export function regenerateRoads(map, world) {
  const w2 = { ...world, river: world.river };
  const settlements = map.settlements.map((s) => ({ ...s }));
  return buildRoads(w2, settlements, rngFrom((map.seed || "x") + ":r2"));
}
export { forEachCellOnLine };

// A road from a to b (cell coords) that follows the terrain: avoids water,
// prefers flat ground, reuses existing roads, pays for bridges. → points.
export function traceRoad(world, a, b) {
  const cell = ([x, y]) => Math.min(world.h - 1, Math.max(0, Math.floor(y))) * world.w + Math.min(world.w - 1, Math.max(0, Math.floor(x)));
  const s = cell(a), t = cell(b);
  if (s === t) return [a, b];
  const step = (p, q, diag) => {
    const cost = BUILD_COST[world.biome[q]];
    if (cost === undefined) return Infinity;
    const c = (cost + Math.abs(world.height[q] - world.height[p]) * 40) * (world.road?.[q] ? 0.4 : 1) + (world.river?.[q] && !world.road?.[q] ? 6 : 0);
    return diag ? c * 1.4142 : c;
  };
  const r = findPath({ w: world.w, h: world.h, start: s, target: t, isGoal: (k) => k === t, step, minStep: 0.4 });
  if (!r) return null;
  const mid = r.path.slice(1, -1).map((k) => [k % world.w + 0.5, Math.floor(k / world.w) + 0.5]);
  return simplify([a, ...mid, b], 0.6);
}
