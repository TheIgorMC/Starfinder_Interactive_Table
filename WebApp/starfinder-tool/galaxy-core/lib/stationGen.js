// Station & ship generator (Docs/15-settlement-generators.md → "Station Gen").
//
// Everything is built from stylized prefab BLOCKS on a standard grid:
// 1 unit = 2 m × 2 m. Blocks are not standard — a light freighter's galley
// is 1×2 units, a megastation's habitation stack 100×150. Each block has one
// purpose (BLOCK_TYPES) and sits on one deck; decks are stacked plans.
//
// Archetypes (the overall shape):
//   orbital — grows in every direction from a core hub along branching
//             corridors, blocks attached to them (orbital stations).
//   vessel  — long and slender: bridge at the bow, hangars amidships,
//             engines and technical at the stern; bigger hulls add scattered
//             generators and shops for travellers (ships, mobile stations).
//   mining  — cubic, compact and dense: hangars, cargo, technical, one mess
//             hall, a couple of shops (mining / extraction platforms).
//   colossal — city-sized hulls (e.g. the Gemini): NOT built here, they go to
//             the city generator with dedicated parameters (returns null).
//
// Output (stored on the station body / notable ship as `layout`):
// {
//   style: "station", generator: 1, seed, archetype, unitM: 2, module,
//   footprint: { w, h },            // units; x = bow→stern for vessels
//   decks: [{ z, name, levels }],    // levels > 1 = several physical decks drawn as one
//   blocks: [{ id, type, name, deck, x, y, w, h, doors: [{ x, y, side, to }] }],
//   lifts: [{ id, x, y, w, h, decks: [z...] }],
//   shops: [{ id, blockId, name, kind }],
//   stats: { lengthM, population, crew, passengers, capacity }
// }
// Interior detail (rooms) is NOT stored: blockDetail() derives it from the
// block + seed whenever the viewer zooms in, so the stored JSON stays small.
import { createRng } from "./rng.js";

export const UNIT_M = 2;

export const BLOCK_TYPES = {
  transit: { label: "Transit", color: "#5b6270" },
  bridge: { label: "Command bridge", color: "#ff9a3c" },
  habitation: { label: "Habitation", color: "#4f8fd9" },
  dining: { label: "Dining", color: "#e0b341" },
  commercial: { label: "Commercial", color: "#d9744f" },
  recreation: { label: "Recreation", color: "#c45fb8" },
  medical: { label: "Medical", color: "#e8e3d8" },
  security: { label: "Security / armory", color: "#b8433a" },
  research: { label: "Research labs", color: "#5fc4b3" },
  factory: { label: "Factory", color: "#8a6b4a" },
  cargo: { label: "Cargo bay", color: "#9a8f6a" },
  hangar: { label: "Hangar", color: "#6fa35a" },
  technical: { label: "Technical", color: "#7a7f8c" },
  generator: { label: "Power generator", color: "#e6d24a" },
  engine: { label: "Engines", color: "#e0602f" },
};

// SF1e frame sizes (ft → m), used for ships.
export const SIZE_LENGTH_M = {
  Tiny: [6, 18], Small: [18, 37], Medium: [37, 91], Large: [91, 244],
  Huge: [244, 610], Gargantuan: [610, 4570], Colossal: [4570, 15000], Supercolossal: [15000, 40000],
};

// Program: relative floor-area share per type, by purpose.
const MIX = {
  cargo: { cargo: 8, habitation: 2, dining: 1, technical: 3, hangar: 2, medical: 0.3, security: 0.3, commercial: 0.3 },
  tourism: { habitation: 7, dining: 3, commercial: 3, recreation: 3, medical: 0.6, technical: 2, hangar: 1, cargo: 1, security: 0.4 },
  diplomacy: { habitation: 5, dining: 2, recreation: 1.5, commercial: 1, security: 1.5, medical: 0.5, technical: 2, hangar: 1, cargo: 0.6 },
  private: { habitation: 4, dining: 1.5, recreation: 1, cargo: 2, technical: 2, hangar: 1, medical: 0.3 },
  research: { research: 6, habitation: 3, dining: 1, medical: 1, cargo: 1.5, technical: 2.5, hangar: 1 },
  military: { security: 4, hangar: 4, habitation: 4, dining: 1, medical: 1, cargo: 2, technical: 3, factory: 0.5 },
  colony: { habitation: 12, dining: 2, commercial: 1.5, factory: 3, cargo: 4, medical: 1, recreation: 1, technical: 3, hangar: 1 },
  // stations
  trade: { commercial: 6, dining: 3, habitation: 5, recreation: 2, cargo: 4, hangar: 4, technical: 3, medical: 0.6, security: 1 },
  logistics: { cargo: 10, hangar: 6, habitation: 3, dining: 1, commercial: 1, technical: 3, security: 0.6 },
  shipyard: { factory: 8, hangar: 7, cargo: 3, habitation: 4, dining: 1, technical: 3, commercial: 0.6 },
  fortress: { security: 7, hangar: 5, habitation: 4, dining: 1, medical: 1, cargo: 2, technical: 3, generator: 1 },
  waystation: { habitation: 4, dining: 2, commercial: 2, recreation: 1, hangar: 3, cargo: 2, technical: 2, medical: 0.5 },
  fuel: { cargo: 4, technical: 5, hangar: 3, habitation: 2, dining: 1, commercial: 0.6 },
  metropolis: { habitation: 10, commercial: 5, dining: 3, recreation: 3, factory: 3, cargo: 3, hangar: 3, technical: 3, medical: 1, research: 1, security: 1 },
  mining: { technical: 7, cargo: 6, hangar: 4, factory: 3, habitation: 3, dining: 0.5, commercial: 0.4, medical: 0.3 },
};

const STATION_PURPOSE = {
  "refueling outpost": "fuel", waystation: "waystation", "mining platform": "mining", "research outpost": "research",
  "trade station": "trade", "cargo terminal": "logistics", "orbital shipyard": "shipyard", "orbital fortress": "fortress", megastation: "metropolis",
};

// m² of habitation per person, by how people live there
const M2_PER_PERSON = { colony: 10, mining: 9, military: 12, cargo: 18, default: 20, tourism: 30, diplomacy: 40 };

// ---------------------------------------------------------------------------
// Spec: what to build, from a station body or a ship (model + notable ship).

export function stationSpec(target, { archetype = "auto", purpose, seed } = {}) {
  const isShip = !!target.hullClass || !!target.model;
  if (isShip) {
    const model = target.model || target;
    const [lo, hi] = SIZE_LENGTH_M[model.sizeCategory] || SIZE_LENGTH_M.Medium;
    const r = createRng(`${seed}:len`)();
    const lengthM = Math.round(target.lengthM || lo + (hi - lo) * (0.25 + r * 0.5));
    const crew = Number(model.crew) || 4;
    const p = purpose || model.purpose || model.role || "private";
    const big = ["Large", "Huge", "Gargantuan", "Colossal", "Supercolossal"].indexOf(model.sizeCategory);
    const passengers = target.passengers ?? Math.round(
      p === "tourism" ? crew * (big >= 0 ? 8 + big * 10 : 1)
        : p === "colony" ? lengthM * lengthM * 0.02
          : p === "military" && big >= 1 ? crew * big * 3
            : p === "diplomacy" ? crew * 1.5 : 0,
    );
    const arch = archetype !== "auto" ? archetype : model.sizeCategory === "Supercolossal" ? "colossal" : "vessel";
    return { kind: "ship", archetype: arch, purpose: p, lengthM, crew, passengers, population: crew + passengers, size: model.sizeCategory, docks: big >= 2 ? big : 0 };
  }
  const cls = target.sizeClass || "waystation";
  const p = purpose || STATION_PURPOSE[cls] || "waystation";
  const population = Number(target.population) || 100;
  const lengthM = Number(target.lengthM) || 300;
  const arch = archetype !== "auto" ? archetype
    : (target.tags || []).includes("colossal") ? "colossal"
      : (target.tags || []).includes("mobile") ? "vessel"
        : p === "mining" ? "mining" : "orbital";
  return { kind: "station", archetype: arch, purpose: p, lengthM, crew: population, passengers: 0, population, docks: Number(target.docks) || 2, services: target.services || [] };
}

// ---------------------------------------------------------------------------
// Generation

export function generateStation(target, options = {}) {
  const seed = options.seed || `station:${target.slug || target.name || "x"}`;
  const spec = stationSpec(target, { ...options, seed });
  if (spec.archetype === "colossal") return null; // city generator's job
  const rng = createRng(`${seed}:layout`);
  const lengthU = Math.max(4, Math.round(spec.lengthM / UNIT_M));

  // module = base cell size in units; long side ≈ 6..34 modules (orbital
  // ≤ 26: it spreads in two directions) — keeps even a megastation to a few
  // hundred blocks per layout
  const nCap = spec.archetype === "orbital" ? 26 : spec.archetype === "mining" ? 30 : 34;
  const nTarget = Math.min(lengthU, nCap, Math.round(7 + 3.6 * Math.log2(Math.max(1, lengthU / 4))));
  const module = Math.max(1, Math.round(lengthU / nTarget));
  const N = Math.max(3, Math.round(lengthU / module));

  let grid; // { W, H, decks: [cells[y][x]] } cells: null | "T" (transit) | "B" (buildable) | "H" (hub)
  if (spec.archetype === "vessel") grid = vesselGrid(rng, N, spec);
  else if (spec.archetype === "mining") grid = miningGrid(rng, N, spec);
  else grid = orbitalGrid(rng, N, spec);

  // cells → rectangles. Module rectangles are merged once on the reference
  // (widest) deck and reused on every deck where they fit, so decks stack
  // cleanly; leftovers are merged per deck.
  const rects = [];
  const maxSpan = spec.archetype === "mining" || N >= 20 ? 3 : 2;
  const refDeck = grid.decks.reduce((best, c, z) => (count(c) > count(grid.decks[best]) ? z : best), 0);
  const refRects = mergeCells(rng, grid.decks[refDeck], 0, "B", maxSpan);
  grid.decks.forEach((cells, z) => {
    rects.push(...mergeCells(rng, cells, z, "T", 999));
    rects.push(...mergeCells(rng, cells, z, "H", 3).map((r) => ({ ...r, hub: true })));
    const left = cells.map((row) => row.slice());
    for (const r of refRects) {
      let fits = true;
      for (let j = 0; j < r.h && fits; j++) for (let i = 0; i < r.w; i++) if (left[r.y + j][r.x + i] !== "B") { fits = false; break; }
      if (!fits) continue;
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) left[r.y + j][r.x + i] = null;
      rects.push({ ...r, z });
    }
    rects.push(...mergeCells(rng, left, z, "B", maxSpan));
  });

  const blocks = rects.map((r, i) => ({
    id: `b${i + 1}`,
    type: r.kind === "T" ? "transit" : null,
    hub: !!r.hub,
    name: "",
    deck: r.z,
    x: r.x * module, y: r.y * module, w: r.w * module, h: r.h * module,
    doors: [],
  }));

  assignTypes(rng, blocks, grid, spec, module);
  const merged = mergeTall(rng, blocks);
  blocks.length = 0; blocks.push(...merged);
  nameBlocks(rng, blocks, spec);

  const layout = {
    style: "station",
    generator: 2,
    seed,
    archetype: spec.archetype,
    purpose: spec.purpose,
    unitM: UNIT_M,
    module,
    footprint: { w: grid.W * module, h: grid.H * module },
    decks: grid.decks.map((_, z) => ({ z, name: deckName(z, grid.decks.length, spec), levels: grid.levels })),
    blocks,
    lifts: placeLifts(grid, module),
    shops: [],
    stats: { lengthM: spec.lengthM, population: spec.population, crew: spec.crew, passengers: spec.passengers, capacity: 0 },
  };
  layout.shops = generateShops(createRng(`${seed}:shops`), layout, spec);
  recomputeDoors(layout);
  layout.stats.capacity = habitationCapacity(layout, spec);
  return layout;
}

function deckName(z, n, spec) {
  if (n === 1) return "Main deck";
  if (spec.archetype === "orbital") {
    const mid = Math.floor(n / 2);
    return z === mid ? "Core deck" : z < mid ? `Upper ${mid - z}` : `Lower ${z - mid}`;
  }
  return `Deck ${z + 1}`;
}

// Deck count and levels (a drawn deck can stand for several physical decks
// on huge hulls, so the plan never has more than 12 decks to page through).
// `heightM` is the hull's height; a physical deck is ~4.5 m.
const MAX_DRAWN_DECKS = 8;
function deckCount(spec, heightM) {
  const physical = Math.max(1, Math.round(heightM / 4.5));
  const decks = Math.max(1, Math.min(MAX_DRAWN_DECKS, physical));
  return { decks, levels: Math.max(1, Math.round(physical / decks)) };
}

function count(cells) { let n = 0; for (const row of cells) for (const v of row) if (v === "B") n++; return n; }
function emptyGrid(W, H) { return Array.from({ length: H }, () => new Array(W).fill(null)); }

function vesselGrid(rng, N, spec) {
  const L = N;
  const ratio = spec.purpose === "cargo" || spec.purpose === "colony" ? 0.24 : spec.purpose === "military" ? 0.18 : 0.2;
  const Wmax = Math.max(2, Math.round(L * ratio * (0.85 + rng() * 0.3)));
  const { decks, levels } = deckCount(spec, spec.lengthM * ratio * 0.75);
  const mid = Math.floor(Wmax / 2);
  // corridor rows: spine + parallels every 3; cross corridors every 5-7
  const rowIsT = (y) => Wmax >= 3 && (y === mid || (Wmax >= 7 && Math.abs(y - mid) % (Wmax >= 9 ? 4 : 3) === 0));
  const crossEvery = 5 + Math.floor(rng() * 3);
  const colIsT = (x) => L >= 10 && x > 1 && x < L - 2 && x % crossEvery === 0;
  const out = [];
  for (let z = 0; z < decks; z++) {
    const cells = emptyGrid(L, Wmax);
    // top/bottom decks slightly narrower
    const edge = decks >= 3 && (z === 0 || z === decks - 1) ? 1 : 0;
    for (let x = 0; x < L; x++) {
      const f = x / (L - 1 || 1);
      // tapered bow (first 18%), full body, slight stern narrowing
      let w = f < 0.18 ? Wmax * (0.45 + (f / 0.18) * 0.55) : f > 0.94 ? Wmax * 0.85 : Wmax;
      w = Math.max(1, Math.round(w) - edge * 2);
      const y0 = Math.floor((Wmax - w) / 2);
      for (let y = y0; y < y0 + w; y++) cells[y][x] = rowIsT(y) || (colIsT(x) && w >= 3) ? "T" : "B";
    }
    out.push(cells);
  }
  return { W: L, H: Wmax, decks: out, levels };
}

function miningGrid(rng, N, spec) {
  const S = Math.max(3, Math.round(N * (0.55 + rng() * 0.15)));
  const { decks, levels } = deckCount(spec, S * (spec.lengthM / N) * 0.8);
  const mid = Math.floor(S / 2);
  const out = [];
  for (let z = 0; z < decks; z++) {
    const cells = emptyGrid(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const t = S >= 4 && (x === mid || y === mid || (S >= 11 && (Math.abs(x - mid) === Math.floor(S / 3) || Math.abs(y - mid) === Math.floor(S / 3))));
      cells[y][x] = t ? "T" : "B";
    }
    out.push(cells);
  }
  return { W: S, H: S, decks: out, levels };
}

function orbitalGrid(rng, N, spec) {
  const G = N % 2 ? N : N + 1;
  const c = Math.floor(G / 2);
  const { decks, levels } = deckCount(spec, spec.lengthM * 0.15);
  const midDeck = Math.floor(decks / 2);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // One corridor plan for the whole station (the widest, middle deck); the
  // other decks are the same plan cut to a smaller radius, so decks stack
  // and sections line up vertically (and can span two decks).
  const plan = emptyGrid(G, G);
  const reach0 = Math.max(2, c);
  const inside0 = (x, y) => x >= 0 && y >= 0 && x < G && y < G && Math.hypot(x - c, y - c) <= reach0 + 0.5;
  const drng = createRng(`${spec.purpose}:plan:${rng()}`);
  const hr = G >= 7 ? 1 : 0; // core hub 3×3 (1×1 on tiny stations)
  for (let y = c - hr; y <= c + hr; y++) for (let x = c - hr; x <= c + hr; x++) plan[y][x] = "H";
  const nearT = (x, y, px, py) => dirs.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return !(nx === px && ny === py) && inside0(nx, ny) && plan[ny][nx] === "T";
  });
  const grow = (x, y, [dx, dy], len, depth) => {
    let px = x, py = y;
    for (let i = 1; i <= len; i++) {
      const nx = x + dx * i, ny = y + dy * i;
      if (!inside0(nx, ny) || plan[ny][nx] === "H" || plan[ny][nx] === "T") break;
      if (nearT(nx, ny, px, py)) { plan[ny][nx] = "T"; break; } // joined another corridor
      plan[ny][nx] = "T";
      px = nx; py = ny;
      if (depth < 3 && i >= 2 && i % 3 === 0 && drng() < 0.75) {
        const side = drng() < 0.5 ? 1 : -1;
        grow(nx, ny, [dy * side, dx * side], Math.round(len * (0.4 + drng() * 0.4)), depth + 1);
        if (drng() < 0.4) grow(nx, ny, [-dy * side, -dx * side], Math.round(len * (0.3 + drng() * 0.4)), depth + 1);
      }
    }
  };
  const arms = dirs.filter(() => drng() < 0.92);
  for (const d of (arms.length ? arms : dirs)) grow(c + d[0] * hr, c + d[1] * hr, d, Math.round(reach0 * (0.7 + drng() * 0.3)), 0);
  // modules up to 2 cells off the corridors
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (plan[y][x] || !inside0(x, y)) continue;
      const touch = dirs.some(([dx, dy]) => { const v = plan[y + dy]?.[x + dx]; return pass === 0 ? v === "T" || v === "H" : v === "B"; });
      if (touch && (pass === 0 || drng() < 0.8)) add.push([x, y]);
    }
    for (const [x, y] of add) plan[y][x] = "B";
  }
  const out = [];
  for (let z = 0; z < decks; z++) {
    const shrink = decks > 1 ? 1 - (Math.abs(z - midDeck) / decks) * 0.9 : 1;
    const reach = Math.max(2, Math.round(c * shrink));
    out.push(plan.map((row, y) => row.map((v, x) => (v && Math.hypot(x - c, y - c) <= reach + 0.5 ? v : null))));
  }
  return { W: G, H: G, decks: out, levels };
}

// Greedy rectangle merge of every cell of one kind into blocks.
function mergeCells(rng, cells, z, kind, maxSpan) {
  const H = cells.length, W = cells[0].length;
  const used = emptyGrid(W, H);
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cells[y][x] !== kind || used[y][x]) continue;
    const wantW = kind === "T" ? 999 : 1 + Math.floor(rng() * maxSpan);
    const wantH = kind === "T" ? 999 : 1 + Math.floor(rng() * maxSpan);
    let w = 1;
    while (w < wantW && x + w < W && cells[y][x + w] === kind && !used[y][x + w]) w++;
    let h = 1;
    // transit: only extend vertically when it's a 1-wide vertical run
    const growDown = kind !== "T" || w === 1;
    while (growDown && h < wantH && y + h < H) {
      let ok = true;
      for (let i = 0; i < w; i++) if (cells[y + h][x + i] !== kind || used[y + h][x + i]) { ok = false; break; }
      if (!ok) break;
      h++;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[y + j][x + i] = true;
    out.push({ kind, z, x, y, w, h });
  }
  return out;
}

// Sections. A station is organised in sections like any settlement: every
// block belongs to one zone (command, habitation, commerce, research,
// industry, docking, engineering) and each zone is ONE contiguous region —
// food courts sit with the shops, hangars with the cargo bays, never
// interleaved. Zones are cut out of an archetype-specific ordering of the
// blocks by floor area:
//   vessel  — transverse slices bow → stern (through every deck):
//             command · habitation · commerce · research · docking · industry · engineering
//   mining  — horizontal layers top → bottom: command · habitation · commerce ·
//             research · engineering · industry · docking (hangars on the faces)
//   orbital — core ring (command, commerce) around the hub, docking ring at
//             the rim, angular wings in between (habitation, research,
//             industry, engineering)
// Inside a zone the same ordering splits it by type, so each type is a
// cluster too (the food court, then the shopping street, then the arcade).
const ZONES = {
  command: ["bridge", "security", "medical"],
  habitation: ["habitation"],
  commerce: ["dining", "commercial", "recreation"],
  research: ["research"],
  industry: ["factory", "cargo"],
  docking: ["hangar", "cargo"],
  engineering: ["technical", "generator", "engine"],
};
// block types that may be two decks tall, with the chance a stacked pair merges
const TALL = { hangar: 0.75, engine: 0.8, generator: 0.7, cargo: 0.5, factory: 0.5, recreation: 0.4, dining: 0.2, research: 0.25 };

function assignTypes(rng, blocks, grid, spec, module) {
  const mix = { ...(MIX[spec.purpose] || MIX.waystation) };
  // a working crew doesn't run shops; only hulls carrying people who dock or
  // travel (passengers, big crews) get commerce and recreation
  if (spec.kind === "ship" && spec.passengers < 40 && spec.population < 200) { mix.commercial = 0; mix.recreation = 0; }
  const nDecks = grid.decks.length;
  const W = grid.W * module, H = grid.H * module;
  const build = blocks.filter((b) => b.type !== "transit");
  const area = (b) => b.w * b.h;
  const total = build.reduce((a, b) => a + area(b), 0) || 1;

  // habitation share follows the headcount (m² per person), within limits
  const m2 = spec.kind === "ship" && spec.population < 60 ? 6 : M2_PER_PERSON[spec.purpose] || M2_PER_PERSON.default;
  const needU = (spec.population * m2) / (UNIT_M * UNIT_M) / (grid.levels || 1);
  const mixSum = Object.values(mix).reduce((a, x) => a + x, 0);
  const habShare = Math.min(spec.purpose === "colony" ? 0.7 : 0.55, Math.max(0.06, needU / total));
  const rest = mixSum - (mix.habitation || 0);
  for (const k of Object.keys(mix)) if (k !== "habitation") mix[k] = (mix[k] / rest) * (1 - habShare);
  mix.habitation = habShare;
  mix.technical = (mix.technical || 0) + 0.02;
  if (spec.archetype !== "orbital" || spec.lengthM > 600) mix.generator = (mix.generator || 0) + (spec.lengthM > 240 ? 0.03 : 0.012);

  const isVessel = spec.archetype === "vessel";
  const cx = W / 2, cy = H / 2, rMax = Math.hypot(cx, cy) || 1;
  const P = new Map(build.map((b) => {
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    return [b, { f: x / W, r: Math.hypot(x - cx, y - cy) / rMax, a: Math.atan2(y - cy, x - cx), edge: b.x === 0 || b.y === 0 || b.x + b.w >= W || b.y + b.h >= H }];
  }));

  // fixed placements: engines at the stern, the hub, the bridge
  let bridge = null;
  for (const b of build) {
    if (isVessel && P.get(b).f > 0.9 && b.x + b.w >= W - module * 1.5) { b.type = "engine"; continue; }
    if (b.hub) { b.type = b.deck === Math.floor(nDecks / 2) && !bridge ? "bridge" : "technical"; if (b.type === "bridge") bridge = b; }
  }
  if (!bridge) {
    const cand = build.filter((b) => !b.type).sort((a, b) => (isVessel ? a.x - b.x : Math.abs(a.deck - nDecks / 2) - Math.abs(b.deck - nDecks / 2)) || area(a) - area(b))[0];
    if (cand) { cand.type = "bridge"; bridge = cand; }
  }
  const free = build.filter((b) => !b.type);
  const freeArea = free.reduce((a, b) => a + area(b), 0) || 1;

  // type → zone targets (cargo splits between industry and docking)
  const typeT = { ...mix };
  delete typeT.bridge; delete typeT.engine;
  const zoneT = {};
  const zoneTypes = {};
  for (const [z, ts] of Object.entries(ZONES)) {
    zoneTypes[z] = [];
    for (const t of ts) {
      let v = typeT[t] || 0;
      if (t === "cargo") v *= z === "industry" ? (mix.factory ? 0.4 : 0) : (mix.factory ? 0.6 : 1);
      if (v > 0) { zoneT[z] = (zoneT[z] || 0) + v; zoneTypes[z].push([t, v]); }
    }
  }
  const sumZ = Object.values(zoneT).reduce((a, x) => a + x, 0) || 1;
  for (const z of Object.keys(zoneT)) zoneT[z] = (zoneT[z] / sumZ) * freeArea;

  // cut a sorted list into consecutive runs by target area
  const cut = (list, parts, apply) => {
    const tot = parts.reduce((a, [, v]) => a + v, 0) || 1, have = list.reduce((a, b) => a + area(b), 0);
    let i = 0, acc = 0, bound = 0;
    for (const [name, v] of parts) {
      bound += (v / tot) * have;
      while (i < list.length && (acc + area(list[i]) / 2 <= bound || name === parts[parts.length - 1][0])) { apply(list[i], name); acc += area(list[i]); i++; }
    }
    while (i < list.length) apply(list[i++], parts[parts.length - 1][0]);
  };
  const zoneOf = new Map();
  const order = (names) => names.filter((z) => zoneT[z] > 0).map((z) => [z, zoneT[z]]);
  const jitter = new Map(free.map((b) => [b, rng() * 1e-6]));
  let subKey; // ordering used to split each zone into types

  if (isVessel) {
    const key = (b) => b.x + b.w / 2 + jitter.get(b);
    const list = [...free].sort((a, b) => key(a) - key(b));
    cut(list, order(["command", "habitation", "commerce", "research", "docking", "industry", "engineering"]), (b, z) => zoneOf.set(b, z));
    subKey = (b, z) => (z === "docking" ? (P.get(b).edge ? 0 : 1e6) + b.deck * 1e4 : 0) + key(b);
  } else if (spec.archetype === "mining") {
    const key = (b) => b.deck * 1e6 + P.get(b).r * 1e3 + jitter.get(b);
    const list = [...free].sort((a, b) => key(a) - key(b));
    cut(list, order(["command", "habitation", "commerce", "research", "engineering", "industry", "docking"]), (b, z) => zoneOf.set(b, z));
    subKey = (b, z) => (z === "docking" ? (P.get(b).edge ? 0 : 1e8) : 0) + key(b);
  } else {
    const a0 = rng() * Math.PI * 2;
    const ang = (b) => (P.get(b).a - a0 + Math.PI * 4) % (Math.PI * 2);
    const byR = [...free].sort((a, b) => P.get(a).r - P.get(b).r || jitter.get(a) - jitter.get(b));
    const takeArea = (list, target, z) => { let acc = 0; const out = []; while (list.length && acc < target) { const b = list.shift(); zoneOf.set(b, z); acc += area(b); out.push(b); } return out; };
    const inner = byR;
    takeArea(inner, zoneT.command || 0, "command");
    takeArea(inner, zoneT.commerce || 0, "commerce");
    const outer = inner.reverse();
    takeArea(outer, zoneT.docking || 0, "docking");
    const mid = outer.sort((a, b) => ang(a) - ang(b));
    cut(mid, order(["habitation", "research", "industry", "engineering"]), (b, z) => zoneOf.set(b, z));
    subKey = (b, z) => (z === "command" || z === "commerce" ? ang(b) : z === "docking" ? ang(b) : ang(b));
  }

  // split each zone into its types, in section order
  for (const z of Object.keys(ZONES)) {
    const members = free.filter((b) => zoneOf.get(b) === z);
    if (!members.length) continue;
    const parts = zoneTypes[z].length ? zoneTypes[z] : [[ZONES[z][0], 1]];
    members.sort((a, b) => subKey(a, z) - subKey(b, z));
    cut(members, parts, (b, t) => { b.type = t; b.zone = z; });
  }
  for (const b of build) if (!b.zone) b.zone = b.type === "bridge" ? "command" : b.type === "engine" ? "engineering" : b.hub ? "engineering" : "habitation";

  // big vessels scatter a few generators through the hull
  if (isVessel && spec.lengthM > 240) {
    const hull = free.filter((b) => ["habitation", "industry", "docking"].includes(b.zone)).sort((a, b) => a.x - b.x);
    const n = Math.min(4, Math.floor(spec.lengthM / 300));
    for (let i = 1; i <= n && hull.length; i++) { const b = hull[Math.floor((i / (n + 1)) * hull.length)]; b.type = "generator"; }
  }

  // a hull with docks always has at least one hangar; crews always eat somewhere
  const ensure = (t, when, zone) => {
    if (!when || build.some((b) => b.type === t)) return;
    const pool = build.filter((b) => b.zone === zone && !["bridge", "engine"].includes(b.type));
    const cand = (pool.length ? pool : build.filter((b) => !["bridge", "engine"].includes(b.type))).sort((a, b) => area(b) - area(a))[0];
    if (cand) cand.type = t;
  };
  ensure("hangar", spec.docks > 0 && build.length > 6, "docking");
  ensure("dining", spec.population >= 6 && build.length > 4, "commerce");
  ensure("habitation", build.length > 3, "habitation");
  ensure("technical", build.length > 5, "engineering");
}

// Stacked twins (same rectangle on consecutive decks, same type) of a
// tall-capable type merge into one two-deck block: hangars, reactors,
// cargo holds, assembly bays, atria.
function mergeTall(rng, blocks) {
  const at = new Map(blocks.map((b) => [`${b.deck}:${b.x}:${b.y}:${b.w}:${b.h}`, b]));
  const gone = new Set();
  for (const b of [...blocks].sort((a, c) => a.deck - c.deck)) {
    if (gone.has(b) || (b.span || 1) > 1 || !TALL[b.type]) continue;
    const t = at.get(`${b.deck + 1}:${b.x}:${b.y}:${b.w}:${b.h}`);
    if (!t || gone.has(t) || t.type !== b.type || (t.span || 1) > 1) continue;
    if (rng() >= TALL[b.type]) continue;
    b.span = 2; gone.add(t);
  }
  return blocks.filter((b) => !gone.has(b));
}

const NUMERAL = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "V", "W", "X"];
function nameBlocks(rng, blocks, spec) {
  const count = {};
  const smallCrew = spec.population < 60;
  for (const b of blocks) {
    const n = (count[b.type] = (count[b.type] || 0) + 1);
    const tag = `${NUMERAL[b.deck % NUMERAL.length]}-${n}`;
    const big = b.w * b.h * UNIT_M * UNIT_M > 20000;
    const names = {
      transit: big ? "Concourse" : b.w * b.h > 40 ? "Main corridor" : "Corridor",
      bridge: spec.kind === "ship" ? "Bridge" : "Operations center",
      habitation: spec.kind === "ship" && smallCrew ? "Crew quarters" : big ? "Residential stack" : "Habitation block",
      dining: spec.archetype === "mining" || (spec.kind === "ship" && smallCrew) ? "Mess" : "Food court",
      commercial: big ? "Market district" : "Shops",
      recreation: "Recreation deck",
      medical: "Med bay",
      security: spec.purpose === "military" ? "Armory" : "Security post",
      research: "Lab",
      factory: spec.purpose === "shipyard" ? "Assembly bay" : spec.archetype === "mining" ? "Refinery" : "Fabrication",
      cargo: "Cargo bay",
      hangar: spec.kind === "ship" ? "Hangar" : "Docking bay",
      technical: "Engineering",
      generator: "Reactor",
      engine: "Drive section",
    };
    b.name = `${names[b.type] || BLOCK_TYPES[b.type]?.label || b.type} ${tag}`;
  }
}

function placeLifts(grid, module) {
  if (grid.decks.length < 2) return [];
  const lifts = [];
  const H = grid.H, W = grid.W;
  const all = (x, y) => grid.decks.map((c, z) => (c[y][x] === "T" || c[y][x] === "H" ? z : -1)).filter((z) => z >= 0);
  const cand = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const zs = all(x, y);
    if (zs.length < 2) continue;
    // corridor junctions: transit on ≥3 sides on the busiest deck
    const c0 = grid.decks[zs[0]];
    const j = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => c0[y + dy]?.[x + dx] === "T").length;
    cand.push({ x, y, zs, score: zs.length * 3 + j });
  }
  cand.sort((a, b) => b.score - a.score);
  const minGap = Math.max(3, Math.round(Math.max(W, H) / 5));
  for (const c of cand) {
    if (lifts.some((l) => Math.abs(l.cx - c.x) + Math.abs(l.cy - c.y) < minGap)) continue;
    lifts.push({ cx: c.x, cy: c.y, zs: c.zs });
    if (lifts.length >= 8) break;
  }
  const s = Math.max(1, Math.round(module * 0.4));
  return lifts.map((l, i) => ({
    id: `l${i + 1}`,
    x: l.cx * module + Math.floor((module - s) / 2), y: l.cy * module + Math.floor((module - s) / 2), w: s, h: s,
    decks: l.zs,
  }));
}

// Doors on unit geometry, so they stay right after manual edits: every
// non-transit block opens onto each transit block it shares an edge with
// (max 2), else onto one neighbouring block.
export function recomputeDoors(layout) {
  const byDeck = new Map();
  for (const b of layout.blocks) {
    for (let z = b.deck; z < b.deck + (b.span || 1); z++) {
      if (!byDeck.has(z)) byDeck.set(z, []);
      byDeck.get(z).push(b);
    }
  }
  const shared = (a, b) => {
    const ox0 = Math.max(a.x, b.x), ox1 = Math.min(a.x + a.w, b.x + b.w);
    const oy0 = Math.max(a.y, b.y), oy1 = Math.min(a.y + a.h, b.y + b.h);
    if (ox1 > ox0 && (a.y + a.h === b.y || b.y + b.h === a.y)) return { x: (ox0 + ox1) / 2, y: a.y + a.h === b.y ? b.y : a.y, side: a.y + a.h === b.y ? "s" : "n", len: ox1 - ox0 };
    if (oy1 > oy0 && (a.x + a.w === b.x || b.x + b.w === a.x)) return { x: a.x + a.w === b.x ? b.x : a.x, y: (oy0 + oy1) / 2, side: a.x + a.w === b.x ? "e" : "w", len: oy1 - oy0 };
    return null;
  };
  for (const b of layout.blocks) b.doors = [];
  for (const [z, list] of byDeck) {
    for (const b of list) {
      if (b.type === "transit") continue;
      const touching = list.filter((o) => o !== b).map((o) => ({ o, s: shared(b, o) })).filter((t) => t.s);
      const tr = touching.filter((t) => t.o.type === "transit").sort((p, q) => q.s.len - p.s.len).slice(0, 2);
      const pick = tr.length ? tr : touching.sort((p, q) => q.s.len - p.s.len).slice(0, 1);
      // doors carry their deck: a two-deck block opens on both
      b.doors.push(...pick.map(({ o, s }) => ({ x: s.x, y: s.y, side: s.side, to: o.id, deck: z })));
    }
  }
  return layout;
}

function habitationCapacity(layout, spec) {
  const m2 = spec.kind === "ship" && spec.population < 60 ? 6 : M2_PER_PERSON[spec.purpose] || M2_PER_PERSON.default;
  const levels = layout.decks[0]?.levels || 1;
  const area = layout.blocks.filter((b) => b.type === "habitation").reduce((a, b) => a + b.w * b.h * (b.span || 1), 0) * UNIT_M * UNIT_M * levels;
  return Math.round(area / m2);
}

// ---------------------------------------------------------------------------
// Shops: every dining / commercial / recreation block holds named venues, so
// "is there a pub?" has an answer ("Yagori's Drop, deck B, food court 3").

export const SHOP_KINDS = {
  dining: ["pub", "bar", "cantina", "noodle stall", "café", "restaurant", "street food", "tea house", "diner"],
  commercial: ["general store", "weapons dealer", "armor outfitter", "tech shop", "medical supplies", "augmentation clinic", "tailor", "pawn shop", "ship parts", "curio dealer", "data broker", "grocer"],
  recreation: ["gym", "casino", "holo-theater", "spa", "arcade", "zero-g court", "gallery", "shrine"],
  mess: ["mess hall"],
};
const OWNERS = ["Yagori", "Tesk", "Mbali", "Oru", "Vashk", "Kellan", "Zhiri", "Dov", "Ansa", "Ruk", "Imre", "Sel", "Quill", "Nadja", "Brakk", "Ossa", "Fen", "Harrow", "Lio", "Maru", "Varro", "Ekkeh", "Tobi", "Sunna", "Gaz", "Pell", "Irri", "Jonas", "Cress", "Ydra", "Korv", "Min-Ha", "Talo", "Rhee", "Asgar", "Bex"];
const ADJ = ["Rusty", "Silent", "Golden", "Broken", "Red", "Drifting", "Last", "Lucky", "Cold", "Blue", "Burning", "Hollow", "Crooked", "Void-Touched", "Iron", "Little", "Velvet", "Wandering", "Neon", "Grey"];
const NOUNS = {
  pub: ["Drop", "Airlock", "Anchor", "Tankard", "Keel", "Hatch", "Bulkhead", "Flask"], bar: ["Lounge", "Spur", "Orbit", "Glass", "Static"], cantina: ["Cantina", "Dock", "Refuge", "Burrow"],
  "noodle stall": ["Noodles", "Bowl", "Broth"], café: ["Brew", "Cup", "Beans", "Grind"], restaurant: ["Table", "Kitchen", "Hearth", "Plate"], "street food": ["Grill", "Skewers", "Wok"], "tea house": ["Leaf", "Kettle", "Steam"], diner: ["Diner", "Counter", "Booth"],
  "general store": ["Supply", "Provisions", "Goods", "Sundries"], "weapons dealer": ["Arms", "Armory", "Iron", "Arsenal"], "armor outfitter": ["Plating", "Shell", "Aegis"], "tech shop": ["Circuits", "Tech", "Salvage"], "medical supplies": ["Remedies", "Apothecary", "Meds"],
  "augmentation clinic": ["Augments", "Chrome", "Grafts"], tailor: ["Threads", "Stitch", "Cloth"], "pawn shop": ["Pawn", "Trade", "Exchange"], "ship parts": ["Parts", "Spares", "Hullworks"], "curio dealer": ["Curios", "Relics", "Oddities"], "data broker": ["Data", "Nodes", "Archive"], grocer: ["Market", "Greens", "Pantry"],
  gym: ["Gym", "Iron Room", "Dojo"], casino: ["Casino", "Dice", "Table"], "holo-theater": ["Holos", "Theater", "Dreams"], spa: ["Baths", "Spa", "Springs"], arcade: ["Arcade", "Pixels"], "zero-g court": ["Court", "Arena"], gallery: ["Gallery", "Frames"], shrine: ["Shrine", "Chapel"], "mess hall": ["Mess Hall"],
};
function shopName(rng, kind, used) {
  for (let i = 0; i < 12; i++) {
    const nouns = NOUNS[kind] || ["Place"];
    const noun = nouns[Math.floor(rng() * nouns.length)];
    const owner = OWNERS[Math.floor(rng() * OWNERS.length)];
    const adj = ADJ[Math.floor(rng() * ADJ.length)];
    const r = rng();
    const name = kind === "mess hall" ? (r < 0.5 ? "Crew Mess Hall" : `${owner}'s Mess`)
      : r < 0.4 ? `${owner}'s ${noun}` : r < 0.75 ? `The ${adj} ${noun}` : r < 0.9 ? `${adj} ${noun}` : `${owner} & ${OWNERS[Math.floor(rng() * OWNERS.length)]} ${noun}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
  return `${OWNERS[Math.floor(rng() * OWNERS.length)]}'s ${kind}`;
}

// Stored venues are capped (MAX_SHOPS, spread over every venue block); a big
// block's other rooms get derived names in blockDetail(), so zooming in on a
// megastation's market still shows every shop without storing thousands.
const MAX_SHOPS = 160;
function generateShops(rng, layout, spec) {
  const shops = [];
  const used = new Set();
  const smallCrew = spec.kind === "ship" && spec.population < 60;
  let i = 0;
  const venues = layout.blocks.filter((b) => ["dining", "commercial", "recreation"].includes(b.type) && !(smallCrew && b.type !== "commercial"));
  // mining: a common mess and a few shops, nothing more
  // venues scale with the people aboard (a liner is all about them)
  const per = spec.archetype === "mining" ? 2500 : spec.kind === "ship" ? (spec.purpose === "tourism" ? 8 : 40) : 300;
  const cap = Math.max(spec.archetype === "mining" ? 3 : 2, Math.min(spec.archetype === "mining" ? 12 : MAX_SHOPS, Math.round(spec.population / per)));
  const perBlock = spec.archetype === "mining" ? 1 : Math.max(1, Math.min(6, Math.floor(cap / Math.max(1, venues.length))));
  for (const b of venues) {
    const areaM2 = b.w * b.h * UNIT_M * UNIT_M;
    const n = Math.max(1, Math.min(perBlock, Math.round(areaM2 / 180)));
    const pool = spec.archetype === "mining" && b.type === "dining" ? SHOP_KINDS.mess : SHOP_KINDS[b.type];
    const count = spec.archetype === "mining" && b.type === "dining" ? 1 : n;
    for (let k = 0; k < count; k++) {
      const kind = pool[Math.floor(rng() * pool.length)];
      shops.push({ id: `s${++i}`, blockId: b.id, name: shopName(rng, kind, used), kind });
    }
    if (shops.length >= cap) break;
  }
  return shops;
}

// ---------------------------------------------------------------------------
// Interior detail for one block, derived (not stored). Rooms are sized to
// the block's purpose; a huge block is split into sub-blocks first so the
// zoomed view never has more than ~150 rooms.

const ROOM = {
  habitation: [2, 2, "Cabin"], dining: [3, 3, "Seating"], commercial: [3, 3, "Shop"], recreation: [5, 5, "Hall"], medical: [3, 2, "Ward"],
  security: [3, 3, "Post"], research: [4, 3, "Lab"], factory: [6, 5, "Line"], cargo: [6, 6, "Bay"], hangar: [10, 8, "Berth"],
  technical: [4, 3, "Machinery"], generator: [6, 6, "Reactor"], engine: [6, 5, "Drive"], bridge: [3, 2, "Station"], transit: [0, 0, ""],
};

export function blockDetail(layout, block) {
  const [rw0, rh0, label] = ROOM[block.type] || [3, 3, "Room"];
  if (!rw0) return { rooms: [], hall: null };
  const rng = createRng(`${layout.seed}:detail:${block.id}:${block.type}`);
  const long = Math.max(block.w, block.h);
  const scale = Math.max(1, long / 14 / Math.max(rw0, rh0));
  const rw = Math.max(1, Math.round(rw0 * scale)), rh = Math.max(1, Math.round(rh0 * scale));
  const horiz = block.w >= block.h;
  // central hall along the long axis when there's room for rooms on both sides
  const across = horiz ? block.h : block.w;
  const hallW = across >= rh * 2 + 1 ? Math.max(1, Math.round(scale)) : 0;
  const rooms = [];
  let hall = null;
  const shopsHere = (layout.shops || []).filter((s) => s.blockId === block.id);
  let shopIdx = 0;
  const usedNames = new Set((layout.shops || []).map((s) => s.name));
  const bands = hallW ? [[0, Math.floor((across - hallW) / 2)], [Math.floor((across - hallW) / 2) + hallW, across - Math.floor((across - hallW) / 2) - hallW]] : [[0, across]];
  if (hallW) {
    const o = Math.floor((across - hallW) / 2);
    hall = horiz ? { x: block.x, y: block.y + o, w: block.w, h: hallW } : { x: block.x + o, y: block.y, w: hallW, h: block.h };
  }
  const along = horiz ? block.w : block.h;
  for (const [off, depth] of bands) {
    if (depth <= 0) continue;
    let p = 0;
    while (p < along) {
      let len = Math.max(1, Math.round(rw * (0.8 + rng() * 0.5)));
      if (along - (p + len) < Math.ceil(rw / 2)) len = along - p;
      const venue = ["commercial", "dining", "recreation"].includes(block.type);
      const shop = venue ? shopsHere[shopIdx++] : null;
      const r = horiz
        ? { x: block.x + p, y: block.y + off, w: len, h: depth }
        : { x: block.x + off, y: block.y + p, w: depth, h: len };
      let lbl = shop ? shop.name : `${label} ${rooms.length + 1}`, kind = shop?.kind || null;
      if (venue && !shop && scale > 1.5) { // unstored venue on a big block: derived, stable per block + index
        const pool = SHOP_KINDS[block.type];
        kind = pool[Math.floor(rng() * pool.length)];
        lbl = shopName(rng, kind, usedNames);
      }
      rooms.push({ ...r, label: lbl, kind, shopId: shop?.id || null });
      p += len;
      if (rooms.length > 160) break;
    }
  }
  return { rooms, hall };
}

// ---------------------------------------------------------------------------
// Editing helpers (pure: return a new layout). Doors are recomputed after
// every geometric change.

const clone = (l) => ({ ...l, blocks: l.blocks.map((b) => ({ ...b, doors: [...(b.doors || [])] })), shops: [...(l.shops || [])] });

export function updateBlock(layout, id, patch) {
  const next = clone(layout);
  next.blocks = next.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
  const b = next.blocks.find((x) => x.id === id);
  if (b) {
    b.w = Math.max(1, Math.round(b.w)); b.h = Math.max(1, Math.round(b.h)); b.x = Math.round(b.x); b.y = Math.round(b.y);
    b.span = Math.max(1, Math.min(layout.decks.length - b.deck, Math.round(b.span || 1)));
  }
  if (patch.type && !["dining", "commercial", "recreation"].includes(patch.type)) next.shops = next.shops.filter((s) => s.blockId !== id);
  return recomputeDoors(next);
}

export function addBlock(layout, deck, rect, type = "habitation") {
  const next = clone(layout);
  const n = next.blocks.reduce((m, b) => Math.max(m, Number(String(b.id).slice(1)) || 0), 0) + 1;
  const b = { id: `b${n}`, type, name: `${BLOCK_TYPES[type]?.label || type} ${n}`, deck, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)), doors: [] };
  next.blocks.push(b);
  recomputeDoors(next);
  return { layout: next, block: b };
}

export function removeBlock(layout, id) {
  const next = clone(layout);
  next.blocks = next.blocks.filter((b) => b.id !== id);
  next.shops = next.shops.filter((s) => s.blockId !== id);
  return recomputeDoors(next);
}

export function addShop(layout, blockId, kind, name) {
  const next = clone(layout);
  const n = next.shops.reduce((m, s) => Math.max(m, Number(String(s.id).slice(1)) || 0), 0) + 1;
  const used = new Set(next.shops.map((s) => s.name));
  const k = kind || "bar";
  next.shops.push({ id: `s${n}`, blockId, kind: k, name: name || shopName(createRng(`${layout.seed}:shop:${n}`), k, used) });
  return next;
}

export function updateShop(layout, id, patch) {
  const next = clone(layout);
  next.shops = next.shops.map((s) => (s.id === id ? { ...s, ...patch } : s));
  return next;
}

export function removeShop(layout, id) {
  const next = clone(layout);
  next.shops = next.shops.filter((s) => s.id !== id);
  return next;
}

// Compact text-friendly summary (MCP, inspector).
export function summarizeStation(layout) {
  const area = {};
  for (const b of layout.blocks) area[b.type] = (area[b.type] || 0) + b.w * b.h * (b.span || 1) * UNIT_M * UNIT_M * (layout.decks[0]?.levels || 1);
  return {
    archetype: layout.archetype,
    purpose: layout.purpose,
    footprintM: { length: layout.footprint.w * UNIT_M, width: layout.footprint.h * UNIT_M },
    decks: layout.decks.length * (layout.decks[0]?.levels || 1),
    drawnDecks: layout.decks.length,
    blocks: layout.blocks.length,
    lifts: layout.lifts.length,
    floorAreaM2: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, Math.round(v)])),
    ...layout.stats,
    shops: layout.shops.map((s) => {
      const b = layout.blocks.find((x) => x.id === s.blockId);
      return { name: s.name, kind: s.kind, where: b ? `${layout.decks[b.deck]?.name || `deck ${b.deck}`} · ${b.name}` : "?" };
    }),
  };
}
