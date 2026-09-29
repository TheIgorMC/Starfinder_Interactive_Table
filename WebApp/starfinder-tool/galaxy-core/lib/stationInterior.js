// Block interiors from the Station Interiors library (lib/stationLibrary.js —
// blocks v0.2 + the GM's own designs). Derived on demand from block + seed
// (never stored): the editor calls it when a block is zoomed in.
//
// A station block is filled the way the kit's scale ladder describes:
//  1. anchors — big set pieces (hangar decks, warehouses, reactor halls, park
//     atria, command centres, megaplants) at the head of the block when the
//     block is big enough AND tall enough;
//  2. clusters of ≤16U along the long axis, a cross hall between them and a
//     stair core at the head of each (rule V2: ≤16U to a stair);
//  3. rows of [band][1U hall][band] inside each cluster; modules packed along
//     each band with a personnel/cargo/plaza connector turned to the hall.
// Module choice: the families that match the block type, filtered by the
// station's scale (outpost/station/hub/mega) and wealth (poor/std/rich), and
// by HEIGHT — a module of h U only goes where the block is at least h U tall
// (a drawn deck ≈ 2U; two-deck blocks and multi-level decks allow taller
// modules: reactor halls 4U, park atria 6U, flight decks 8U).
import { libraryFor, capacityOf, SCALES } from "./stationLibrary.js";
import { createRng } from "./rng.js";

const FACES = ["N", "E", "S", "W"];
const rotFace = (f, k) => FACES[(FACES.indexOf(f) + k) % 4];
const CLUSTER_U = 16;
export const DECK_U = 2; // one drawn deck ≈ 4.5 m ≈ 2U of kit height

// block type → library families (+ preferred ids for anchors)
const TYPE_FAMILIES = {
  habitation: { fam: ["H"], extra: ["F1-MESS", "L0-NOOK"] },
  dining: { fam: ["F"] },
  commercial: { fam: [], ids: ["L3-MARKET", "F2-DINER", "F2-FOODCOURT", "L1-BAR", "L1-TEA", "L1-CASINO", "L1-DIVE", "L0-LIBRARY", "K-VAULT"] },
  recreation: { fam: ["L"] },
  technical: { fam: ["T"], exclude: /^T3-/ },
  generator: { fam: ["T"], only: /^T[023]-/ },
  engine: { fam: [], ids: ["T3-RADIATOR", "T2-MINI", "T0-NODE", "T0-BATTERY"] },
  hangar: { fam: ["D"] },
  cargo: { fam: ["K"] },
  factory: { fam: ["P"], ids: ["T1-FABHALL", "T1-SHOP", "T1-DRONE"] },
  bridge: { fam: ["C"] },
  security: { fam: [], ids: ["C1-SECURITY", "C1-ONEROW", "K-VAULT", "T1-EVA"] },
  research: { fam: [], ids: ["T1-SHOP", "T1-DRONE", "F4-HYDRO", "F4-ALGAE", "T2-ALGAE", "C1-ONEROW"] },
  medical: { fam: [], ids: ["H1-SOLO", "H1-OFFICER", "L0-CHAPEL", "T2-WATER"] },
};
const ANCHOR_AREA = 48; // U² — anything this big is placed as a set piece

export function stationScale(layout) {
  const pop = layout.stats?.population || 0;
  if (layout.stats && layout.stats.passengers != null && pop < 60) return 0;
  return pop < 3000 ? 0 : pop < 150000 ? 1 : pop < 3e6 ? 2 : 3;
}
// station wealth: explicit on the layout, else from its purpose
export function stationWealth(layout) {
  if (layout.wealth) return layout.wealth;
  const p = layout.purpose;
  if (["mining", "fuel", "cargo", "logistics", "colony", "military", "fortress"].includes(p)) return "poor";
  if (["tourism", "diplomacy", "metropolis"].includes(p)) return "rich";
  return "std";
}

// orientations of a block whose connector faces `face` (local frame)
function orientations(b, face) {
  const out = [];
  const conns = (b.conns || []).filter((c) => c.type !== "dock" && c.type !== "platform");
  for (let k = 0; k < 4; k++) {
    if (conns.length && !conns.some((c) => rotFace(c.face, k) === face)) continue;
    const [W, D] = b.size;
    out.push({ k, len: k % 2 ? D : W, depth: k % 2 ? W : D });
  }
  return out;
}

function candidatesFor(lib, type, scaleName, wealth, maxH) {
  const spec = TYPE_FAMILIES[type];
  if (!spec) return [];
  const pick = (strict) => lib.active.filter((b) => {
    const inFam = spec.fam.includes(b.family) || (spec.ids || []).includes(b.id) || (spec.extra || []).includes(b.id);
    if (!inFam) return false;
    if (spec.exclude && spec.exclude.test(b.id)) return false;
    if (spec.only && !spec.only.test(b.id)) return false;
    if ((b.height || 1) > maxH) return false;
    if (b.family === "V") return false;
    if (strict >= 1 && b.scale?.length && !b.scale.includes(scaleName)) return false;
    if (strict >= 2 && b.wealth?.length && !b.wealth.includes(wealth)) return false;
    return true;
  });
  let c = pick(2);
  if (c.length < 2) c = pick(1);
  if (!c.length) c = pick(0);
  return c;
}

export function blockInterior(layout, block, clip, libOrProject) {
  const lib = libOrProject?.active ? libOrProject : libraryFor(libOrProject || null);
  const scaleName = SCALES[stationScale(layout)];
  const wealth = stationWealth(layout);
  const maxH = (block.span || 1) * (layout.decks?.[0]?.levels || 1) * DECK_U;
  const cands = candidatesFor(lib, block.type, scaleName, wealth, maxH);
  if (!cands.length) return null;
  const extraIds = new Set(TYPE_FAMILIES[block.type]?.extra || []);
  const anchors = cands.filter((b) => b.size[0] * b.size[1] >= ANCHOR_AREA && !extraIds.has(b.id));
  const regular = cands.filter((b) => b.size[0] * b.size[1] < ANCHOR_AREA && !extraIds.has(b.id));
  const pool = regular.length ? regular : cands;
  const weightOf = (b) => (b.base ? 1 : 2) * (b.wealth?.includes(wealth) ? 1.5 : 1) * (b.scale?.includes(scaleName) ? 1.5 : 1);

  // iseed (layout / block): bumped by "reroll interior" to redraw the fit-out
  // without touching the block itself
  const ls = layout.iseed ? `${layout.seed}~${layout.iseed}` : layout.seed;
  const bid = block.iseed ? `${block.id}~${block.iseed}` : block.id;
  const rng = createRng(`${ls}:interior:${bid}:${block.type}`);
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
  const addMod = (b, lx, ly, o) => mods.push(put(lx, ly, o.len, o.depth, { id: b.id, k: o.k, name: b.name, family: b.family, height: b.height || 1 }));
  const addFill = (lx, ly, lw, lh, zone = "STORE") => { if (lw > 0.01 && lh > 0.01) fill.push(put(lx, ly, lw, lh, { zone })); };
  const addHall = (lx, ly, lw, lh) => { if (lw > 0 && lh > 0) halls.push(put(lx, ly, lw, lh, {})); };
  const weighted = (r, list) => { const t = list.reduce((a, b) => a + weightOf(b), 0); let x = r() * t; for (const b of list) { if ((x -= weightOf(b)) < 0) return b; } return list[list.length - 1]; };

  // 1. anchors at the head of the block
  let x0 = 0;
  const ar = createRng(`${ls}:anchor:${bid}`);
  for (let n = 0; n < 3 && anchors.length; n++) {
    const fits = anchors.map((b) => ({ b, o: orientations(b, "S").concat(orientations(b, "E")).filter((q) => q.depth <= A && q.len <= L - x0 - (n ? 0 : 0)).sort((p, q) => q.depth - p.depth)[0] })).filter((z) => z.o);
    if (!fits.length || (n > 0 && ar() < 0.45) || (n === 0 && L - x0 < 24 && ar() < 0.3)) break;
    const pickA = fits[Math.floor(ar() * fits.length)];
    addMod(pickA.b, x0, 0, pickA.o);
    addFill(x0, pickA.o.depth, pickA.o.len, A - pickA.o.depth, "CIRC");
    x0 += pickA.o.len;
    if (x0 < L) { addHall(x0, 0, 1, A); x0 += 1; }
  }
  if (x0 >= L) return finish();

  // 2./3. band depth from a typical module of this block's mix
  const depths = pool.flatMap((b) => orientations(b, "S").map((o) => o.depth)).filter((d) => d <= A).sort((a, b) => a - b);
  let d = depths.length ? depths[Math.floor(depths.length * 0.6)] : 3;
  let rows;
  if (A >= 2 * d + 1) rows = Math.floor(A / (2 * d + 1));
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
    bands.push({ y: 0, depth: Math.max(1, A - 1), face: "S" });
  }

  // clip → local ranges along L (clusters) and A (bands)
  let lc = null;
  if (clip) {
    const cx0 = clip.x - block.x, cy0 = clip.y - block.y;
    lc = horiz ? { l0: cx0, l1: cx0 + clip.w, a0: cy0, a1: cy0 + clip.h } : { l0: cy0, l1: cy0 + clip.h, a0: A - (cx0 + clip.w), a1: A - cx0 };
  }
  const stair = lib.byId.get(scaleName === "outpost" ? "V0-LADDER" : scaleName === "mega" && wealth === "rich" ? "V1-TWIN" : "V1-STAIR") || lib.byId.get("V1-STAIR");
  const node = lib.byId.get("T0-NODE");
  const mess = lib.byId.get("F1-MESS"), nook = lib.byId.get("L0-NOOK");
  const clusters = [];
  for (let cx = x0; cx < L; cx += CLUSTER_U + 1) clusters.push([cx, Math.min(L, cx + CLUSTER_U)]);
  clusters.forEach(([c0, c1], ci) => {
    if (lc && (c1 + 1 < lc.l0 || c0 > lc.l1)) return;
    if (c1 < L) addHall(c1, 0, 1, A);
    if (rows > 0) for (let r = 0; r < rows; r++) addHall(c0, r * (2 * d + 1) + d, c1 - c0, 1);
    else if (A > 1) addHall(c0, A - 1, c1 - c0, 1);
    let racks = 0, sinceNook = 0; // an F1 mess per 3 racks, a nook now and then (housing)
    bands.forEach((b, bi) => {
      if (b.filler) { addFill(c0, b.y, c1 - c0, b.depth); return; }
      if (lc && (b.y + b.depth < lc.a0 || b.y > lc.a1)) return;
      const r = createRng(`${ls}:interior:${bid}:${ci}:${bi}`);
      const queue = [];
      if (bi === 0 && stair) queue.push(stair);
      if (bi === 1 && node && ["habitation", "technical", "generator", "factory"].includes(block.type)) queue.push(node);
      let x = c0, guard = 0;
      while (x < c1 && guard++ < 400) {
        let m = queue.shift();
        if (!m) {
          if (block.type === "habitation" && racks >= 3 && mess) { m = mess; racks = 0; }
          else if (block.type === "habitation" && sinceNook > 10 && nook && r() < 0.5) { m = nook; sinceNook = 0; }
          else m = weighted(r, pool);
        }
        const fitting = (bb) => orientations(bb, b.face).filter((o) => o.depth <= b.depth && o.len <= c1 - x).sort((p, q) => q.depth - p.depth)[0];
        let o = fitting(m);
        if (!o) {
          const alt = pool.map((bb) => ({ bb, o: fitting(bb) })).filter((z) => z.o).sort((p, q) => q.o.len * q.o.depth - p.o.len * p.o.depth);
          if (!alt.length) { addFill(x, b.y, c1 - x, b.depth); break; }
          const z = alt[Math.floor(r() * Math.min(3, alt.length))];
          m = z.bb; o = z.o;
        }
        const yy = b.face === "S" ? b.y + (b.depth - o.depth) : b.y; // hug the hall
        addMod(m, x, yy, o);
        addFill(x, b.face === "S" ? b.y : b.y + o.depth, o.len, b.depth - o.depth);
        x += o.len;
        if (/^H0-/.test(m.id)) racks++;
        if (m.family === "H") sinceNook++;
        if (/^F2-CANTEEN|^F2-MIRROR/.test(m.id)) { const st = lib.byId.get("F3-STORE"); if (st) queue.unshift(st); } // cold store on its supply side
      }
    });
  });
  return finish();

  function finish() {
    let berths = 0, seats = 0;
    for (const m of mods) { const c = capacityOf(lib.byId.get(m.id) || {}); berths += c.berths; seats += c.seats; }
    return { modules: mods, fillers: fill, halls, berths, seats, maxHeightU: maxH, scale: scaleName, wealth };
  }
}
