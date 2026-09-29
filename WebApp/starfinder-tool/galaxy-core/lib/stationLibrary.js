// Station Interiors block library (schema "station-interiors/blocks v0.2",
// galaxy-core/data/station-interiors/blocks.json, built by blocks_generator.py).
//
// The shipped library is read-only; the GM's own designs live in the project:
//   project.stationKit = { blocks: { [id]: block }, disabled: [id, …] }
// A project block with the id of a library block REPLACES it (a hand-edited
// design); any other id ADDS a new design. `disabled` hides library blocks
// from the generator. The generator and the editor always work on the merged
// library returned by libraryFor(project).
//
// Block: { id, family (H F T L V D C K P), name, size:[w,d] U, height U,
//   capacity, scale:[outpost|station|hub|mega], wealth:[poor|std|rich],
//   spine: N|E|S|W|RISER|MID|null, hull: N|E|S|W|null,
//   zones:[{z, r:[x,y,w,h]}], items:[{k, r, l?}], parts:[[x1,y1,x2,y2]],
//   conns:[{id, face, at, w, type, opt}], desc, tags, base? }
import { KIT_BLOCKS } from "./stationKitBlocks.js";

export const FAMILY_NAMES = KIT_BLOCKS.families;
export const ZONE_COLORS = KIT_BLOCKS.zones;
export const ITEM_KINDS = ["box", "bed", "round", "cross", "dash", "solid"];
export const CONN_TYPES = ["personnel", "cargo", "plaza", "dock", "platform"];
export const SCALES = ["outpost", "station", "hub", "mega"];
export const WEALTHS = ["poor", "std", "rich"];
export const FACES = ["N", "E", "S", "W"];

const BASE = KIT_BLOCKS.blocks;
const BASE_BY_ID = new Map(BASE.map((b) => [b.id, b]));
export const isLibraryBlock = (id) => BASE_BY_ID.has(id);
export const libraryBlock = (id) => BASE_BY_ID.get(id) || null;

let cache = { key: null, lib: null };
export function libraryFor(project) {
  const kit = project?.stationKit || null;
  if (cache.key === kit && cache.lib) return cache.lib;
  const own = kit?.blocks || {};
  const disabled = new Set(kit?.disabled || []);
  const blocks = [];
  for (const b of BASE) blocks.push(own[b.id] ? { ...own[b.id], custom: "edited" } : b);
  for (const [id, b] of Object.entries(own)) if (!BASE_BY_ID.has(id)) blocks.push({ ...b, custom: "new" });
  const lib = {
    blocks,
    active: blocks.filter((b) => !disabled.has(b.id)),
    byId: new Map(blocks.map((b) => [b.id, b])),
    disabled,
    zones: ZONE_COLORS,
    families: FAMILY_NAMES,
  };
  cache = { key: kit, lib };
  return lib;
}

// a blank design to start from scratch
export function blankBlock(id, family = "H") {
  return {
    id, family, name: "New module", size: [3, 3], height: 1, capacity: "", scale: ["station"], wealth: ["std"],
    spine: "N", hull: null, zones: [{ z: "LIVE", r: [0, 0, 3, 3] }], items: [], parts: [],
    conns: [{ id: "S1", face: "S", at: 1.25, w: 0.5, type: "personnel", opt: false }], desc: "", tags: [],
  };
}

// validation used by the designer (same checks as blocks_generator.py)
export function validateBlock(b) {
  const errs = [];
  const [W, D] = b.size || [0, 0];
  if (!b.id) errs.push("missing id");
  if (!(W > 0 && D > 0)) errs.push("size must be > 0");
  if (!(b.height >= 1)) errs.push("height must be ≥ 1U");
  for (const k of ["zones", "items"]) for (const e of b[k] || []) {
    const [x, y, w, h] = e.r;
    if (x < -1e-6 || y < -1e-6 || x + w > W + 1e-6 || y + h > D + 1e-6) errs.push(`${k === "zones" ? `zone ${e.z}` : `item ${e.l || e.k}`} outside the footprint`);
  }
  for (const c of b.conns || []) {
    const L = c.face === "N" || c.face === "S" ? W : D;
    if (c.at < -1e-6 || c.at + c.w > L + 1e-6) errs.push(`connector ${c.id} outside its face`);
  }
  return errs;
}

// capacity strings ("10 berths", "56 seats · 150/meal", "3–4") → numbers
export function capacityOf(b) {
  const s = String(b.capacity || "");
  const n = (re) => { const m = s.match(re); return m ? Number(m[1]) : 0; };
  const first = n(/(\d+)/);
  return {
    berths: b.family === "H" ? n(/(\d+)\s*(?:berths|pods)/) || Math.max(first, n(/[–-]\s*(\d+)/)) : 0,
    seats: n(/(\d+)\s*seats/),
  };
}
