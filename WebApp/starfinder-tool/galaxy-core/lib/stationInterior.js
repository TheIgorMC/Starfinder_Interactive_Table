// Block interiors from the Station Interiors kit (lib/stationKit.js,
// galaxy-core/data/station-interiors/). Derived on demand from block + seed
// (never stored): the editor calls it when a block is zoomed in.
//
// A block is filled like the kit's scale ladder describes: it is cut into
// clusters of ≤16U along its long axis (a cross hall between clusters, a V1
// stair core at the head of each, so nothing is further than 16U from a
// stair — rule V2), and each cluster into rows: [band][1U hall][band]…
// Modules are packed along each band with a connector turned towards the
// hall. The module mix follows the block's type:
//   habitation → H0–H3 by the kit's housing mix for the station's scale
//                (+ an F1 mess after every 3 racks, L0 nooks, T0 utility nodes)
//   dining     → F2 canteen (+ F3 cold store beside it), F1 mess, F0 ration walls
//   recreation → L3 park atrium when it fits, L2 gym, L1 bar, L0 nooks
//   technical  → T2 life support, T1 workshops, T0 nodes
//   generator  → T3 reactor hall when it fits (no SLEEP within 8U — reactors
//                only go in generator blocks), else T2 plants
// Other block types have no kit modules yet (null → generic rooms).
import { KIT } from "./stationKit.js";
import { createRng } from "./rng.js";

const MOD = Object.fromEntries(KIT.modules.map((m) => [m.id, m]));
const FACES = ["N", "E", "S", "W"];
const rotFace = (f, k) => FACES[(FACES.indexOf(f) + k) % 4];
const CLUSTER_U = 16;

export function stationScale(layout) {
  const pop = layout.stats?.population || 0;
  if (layout.stats && layout.stats.passengers != null && pop < 60) return 0;
  return pop < 3000 ? 0 : pop < 150000 ? 1 : pop < 3e6 ? 2 : 3;
}

function pools(type, scale) {
  const w = KIT.housing_mix.weights_0to3;
  switch (type) {
    case "habitation": return { depthOf: ["H3-RES", "H2-QTRS", "H1-CABIN", "H0-RACK"].sort((a, b) => w[b.slice(0, 2)][scale] - w[a.slice(0, 2)][scale])[0], mix: [["H0-RACK", w.H0[scale]], ["H1-CABIN", w.H1[scale]], ["H2-QTRS", w.H2[scale]], ["H3-RES", w.H3[scale]]] };
    case "dining": return { depthOf: "F2-CANTEEN", mix: [["F2-CANTEEN", 3], ["F1-MESS", 2], ["F0-RATION", 0.6]] };
    case "recreation": return { depthOf: "L2-GYM", mix: [["L2-GYM", 2], ["L1-BAR", 2], ["L0-NOOK", 1.5]], big: "L3-PARK" };
    case "technical": return { depthOf: "T2-LIFE", mix: [["T2-LIFE", 1.5], ["T1-SHOP", 3], ["T0-NODE", 0.8]] };
    case "generator": return { depthOf: "T2-LIFE", mix: [["T2-LIFE", 2], ["T1-SHOP", 1], ["T0-NODE", 0.6]], big: "T3-REACTOR" };
    default: return null;
  }
}

// orientations of a module whose connector faces `face` (local frame)
function orientations(m, face) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const faces = (m.connectors || []).map((c) => rotFace(c.face, k));
    if (faces.length && !faces.includes(face)) continue;
    const [W, H] = m.footprint_U;
    out.push({ k, len: k % 2 ? H : W, depth: k % 2 ? W : H });
  }
  return out;
}

// `clip` (optional, world units {x, y, w, h}): only clusters/bands that
// intersect it are generated — a megastation block is thousands of modules,
// the editor asks for the visible part only. Each cluster × band has its own
// seed, so what you see never depends on the clip.
export function blockInterior(layout, block, clip) {
  const pool = pools(block.type, stationScale(layout));
  if (!pool) return null;
  const rng = createRng(`${layout.seed}:interior:${block.id}:${block.type}`);
  const horiz = block.w >= block.h;
  const L = horiz ? block.w : block.h, A = horiz ? block.h : block.w;
  const mods = [], fill = [], halls = [];
  const put = (lx, ly, lw, lh, extra) => {
    // local (x along the block's long axis) → world; vertical blocks are the
    // local frame turned 90° clockwise
    const r = horiz ? { x: block.x + lx, y: block.y + ly, w: lw, h: lh } : { x: block.x + A - ly - lh, y: block.y + lx, w: lh, h: lw };
    if (extra.k != null && !horiz) extra = { ...extra, k: (extra.k + 1) % 4 };
    return { ...r, ...extra };
  };
  const addMod = (id, lx, ly, o) => { const m = MOD[id]; mods.push(put(lx, ly, o.len, o.depth, { id, k: o.k, name: m.name, family: m.family })); };
  const addFill = (lx, ly, lw, lh, zone = "STORE") => { if (lw > 0.01 && lh > 0.01) fill.push(put(lx, ly, lw, lh, { zone })); };
  const addHall = (lx, ly, lw, lh) => { if (lw > 0 && lh > 0) halls.push(put(lx, ly, lw, lh, {})); };

  // one big showpiece (reactor hall, park atrium) at the head of the block
  let x0 = 0;
  if (pool.big) {
    const m = MOD[pool.big];
    const o = orientations(m, "S").concat(orientations(m, "E")).filter((q) => q.depth <= A && q.len <= L).sort((a, b) => b.len * b.depth - a.len * a.depth)[0];
    if (o) {
      addMod(pool.big, 0, 0, o);
      addFill(0, o.depth, o.len, A - o.depth, "CIRC");
      addHall(o.len, 0, 1, A);
      x0 = o.len + 1;
    }
  }

  // band depth: the primary module's depth facing a hall, fitted to the block
  const primary = orientations(MOD[pool.depthOf], "S").map((o) => o.depth).sort((a, b) => a - b)[0] || 3;
  let d = primary, rows;
  if (A >= 2 * d + 1) rows = Math.floor((A + 0) / (2 * d + 1));
  else if (A >= d + 1) rows = 0;
  else { d = Math.max(1, Math.floor((A - 1) / 2)); rows = A >= 3 ? 1 : 0; }
  const bands = [];
  if (rows > 0) {
    for (let r = 0; r < rows; r++) {
      const y = r * (2 * d + 1);
      bands.push({ y, depth: d, face: "S" });
      bands.push({ y: y + d + 1, depth: d, face: "N" });
    }
    const left = A - rows * (2 * d + 1);
    if (left > 0) bands.push({ y: A - left, depth: left, face: "N", filler: left < 1 });
  } else {
    const dd = Math.max(1, A - 1);
    bands.push({ y: 0, depth: dd, face: "S" });
  }

  let rng2 = rng;
  const weighted = (list) => { const rng = rng2; const t = list.reduce((a, [, w]) => a + w, 0); let r = rng() * t; for (const [id, w] of list) { if ((r -= w) < 0) return id; } return list[list.length - 1][0]; };
  let racks = 0, sinceNook = 0;
  // clip → local ranges along L (clusters) and A (bands)
  let lc = null;
  if (clip) {
    const cx0 = clip.x - block.x, cy0 = clip.y - block.y;
    lc = horiz ? { l0: cx0, l1: cx0 + clip.w, a0: cy0, a1: cy0 + clip.h } : { l0: cy0, l1: cy0 + clip.h, a0: A - (cx0 + clip.w), a1: A - cx0 };
  }
  const clusters = [];
  for (let cx = x0; cx < L; cx += CLUSTER_U + 1) clusters.push([cx, Math.min(L, cx + CLUSTER_U)]);
  clusters.forEach(([c0, c1], ci) => {
    if (lc && (c1 + 1 < lc.l0 || c0 > lc.l1)) return;
    racks = 0; sinceNook = 0; // mess-per-3-racks and nooks are counted per cluster
    // cross hall after the cluster, row halls along it
    if (c1 < L) addHall(c1, 0, 1, A);
    if (rows > 0) for (let r = 0; r < rows; r++) addHall(c0, r * (2 * d + 1) + d, c1 - c0, 1);
    else if (A > 1) addHall(c0, A - 1, c1 - c0, 1);
    bands.forEach((b, bi) => {
      if (lc && (b.y + b.depth < lc.a0 || b.y > lc.a1)) return;
      rng2 = createRng(`${layout.seed}:interior:${block.id}:${ci}:${bi}`);
      let x = c0;
      if (b.filler) { addFill(c0, b.y, c1 - c0, b.depth); return; }
      // cluster head: stair core (first band) / utility node (second band)
      const head = bi === 0 ? "V1-STAIR" : bi === 1 && ["habitation", "technical", "generator"].includes(block.type) ? "T0-NODE" : null;
      const queue = head ? [head] : [];
      let guard = 0;
      while (x < c1 && guard++ < 400) {
        let id = queue.shift();
        if (!id) {
          if (block.type === "habitation" && racks >= 3) { id = "F1-MESS"; racks = 0; }
          else if (block.type === "habitation" && sinceNook > 10 && rng2() < 0.5) { id = "L0-NOOK"; sinceNook = 0; }
          else id = weighted(pool.mix);
        }
        const opts = orientations(MOD[id], b.face).filter((o) => o.depth <= b.depth && o.len <= c1 - x);
        let o = opts.sort((p, q) => q.depth - p.depth)[0];
        if (!o) {
          // try anything in the mix that still fits, smallest first
          const alt = pool.mix.map(([mid]) => ({ mid, o: orientations(MOD[mid], b.face).filter((q) => q.depth <= b.depth && q.len <= c1 - x).sort((p, q) => q.depth - p.depth)[0] })).filter((z) => z.o).sort((p, q) => p.o.len - q.o.len)[0];
          if (!alt) { addFill(x, b.y, c1 - x, b.depth); break; }
          id = alt.mid; o = alt.o;
        }
        const yy = b.face === "S" ? b.y + (b.depth - o.depth) : b.y; // hug the hall
        addMod(id, x, yy, o);
        addFill(x, b.face === "S" ? b.y : b.y + o.depth, o.len, b.depth - o.depth);
        x += o.len;
        if (id === "H0-RACK") racks++;
        if (id.startsWith("H")) sinceNook++;
        if (id === "F2-CANTEEN") queue.unshift("F3-STORE"); // cold store on its supply side
      }
    });
    void ci;
  });

  const cap = (key) => mods.reduce((a, m) => { const c = MOD[m.id].capacity || {}; const v = c[key]; return a + (typeof v === "number" ? v : typeof v === "string" ? Number(v.split("-").pop()) || 0 : 0); }, 0);
  return { modules: mods, fillers: fill, halls, berths: cap("berths") + cap("occupants"), seats: cap("seats") };
}

export const KIT_ZONE_COLORS = KIT.zones;
export function kitModule(id) { return MOD[id]; }
