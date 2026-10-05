// Fantasy map data model (Docs/16-fantasy-maps.md).
//
// A map is one JSON document; coordinates are in CELLS (floats, 0..w / 0..h),
// one cell = `kmPerCell` km. The terrain grid is stored compactly:
//   terrain.h — heights 0..255, base64 (one byte per cell, row-major)
//   terrain.b — biome codes, one character per cell (BIOMES keys)
// Everything else is plain arrays of objects that all share
//   { id, name, description, images: [url], gmNotes, hidden }
// so the inspector, the index and the player filter treat them alike.

export const BIOMES = {
  O: { name: "Sea", water: true, atlas: "#7ea7c2", paper: "#c7d0c4" },
  L: { name: "Lake", water: true, atlas: "#8db7cf", paper: "#cbd5c9" },
  G: { name: "Plains", atlas: "#bccb8c", paper: "#ecdfba" },
  A: { name: "Farmland", atlas: "#cfd391", paper: "#ede0b6" },
  F: { name: "Forest", atlas: "#7ea25f", paper: "#e2dab0" },
  D: { name: "Deep forest", atlas: "#5c8550", paper: "#d9d3a6" },
  T: { name: "Taiga", atlas: "#86a38a", paper: "#e0dcbc" },
  H: { name: "Hills", atlas: "#bcb07c", paper: "#e6d6ab" },
  M: { name: "Mountains", atlas: "#a39684", paper: "#e0d0a8" },
  S: { name: "Snowy peaks", atlas: "#eef0f1", paper: "#f1e9d6" },
  W: { name: "Marsh", atlas: "#93ab8e", paper: "#dcd8b0" },
  R: { name: "Desert", atlas: "#e6d398", paper: "#f0dfb2" },
};
export const LAND_BRUSHES = ["G", "A", "F", "D", "T", "H", "M", "S", "W", "R", "L", "O"];
export const isWater = (code) => code === "O" || code === "L";

export const ROAD_TYPES = {
  royal: { name: "Royal road", desc: "paved highway between cities", rank: 4 },
  road: { name: "Road", desc: "maintained dirt or gravel road", rank: 3 },
  track: { name: "Cart track", desc: "rutted lane between villages", rank: 2 },
  trail: { name: "Footpath", desc: "trail, too narrow for carts", rank: 1 },
};
export const RANK_TYPE = ["", "trail", "track", "road", "royal"];

export const SETTLEMENT_TYPES = {
  capital: { name: "Capital", pop: [20000, 60000] },
  city: { name: "City", pop: [5000, 20000] },
  town: { name: "Town", pop: [1000, 5000] },
  village: { name: "Village", pop: [120, 900] },
  hamlet: { name: "Hamlet", pop: [20, 120] },
  castle: { name: "Castle", pop: [40, 300] },
};

export const POI_TYPES = {
  cave: "Cave", mine: "Mine", ruin: "Ruins", tower: "Tower", shrine: "Shrine", temple: "Temple",
  monastery: "Monastery", dungeon: "Dungeon", lair: "Monster lair", camp: "Camp", inn: "Inn",
  stones: "Standing stones", battlefield: "Battlefield", lighthouse: "Lighthouse", bridge: "Bridge",
  portal: "Portal", landmark: "Landmark",
};

export const LABEL_TYPES = {
  region: "Region / realm", forest: "Forest", mountains: "Mountains", hills: "Hills", marsh: "Marsh",
  desert: "Desert", sea: "Sea", lake: "Lake", river: "River", note: "Note",
};

export const COLLECTIONS = {
  settlements: "Settlement", pois: "Place", roads: "Road", rivers: "River", labels: "Label",
};

export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// --- byte <-> base64 (browser + node) ------------------------------------
export function u8ToB64(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToU8(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// --- runtime view of a map ----------------------------------------------
// Typed arrays decoded from the stored strings, plus rasterized roads and
// rivers. Rebuilt when the map's terrain/roads/rivers change (cheap: a few
// ms for 240×160).
export function buildWorld(map) {
  const { w, h } = map;
  const n = w * h;
  const height = new Float32Array(n);
  const hb = b64ToU8(map.terrain.h);
  for (let i = 0; i < n; i++) height[i] = (hb[i] || 0) / 255;
  const biome = new Uint8Array(n);
  const bs = map.terrain.b;
  for (let i = 0; i < n; i++) biome[i] = bs.charCodeAt(i) || 71;
  const world = { w, h, n, height, biome, sea: map.terrain.sea ?? 0.4, kmPerCell: map.kmPerCell || 1 };
  world.road = rasterRoads(map, w, h);
  world.river = rasterRivers(map, w, h);
  return world;
}
export const codeAt = (world, i) => String.fromCharCode(world.biome[i]);

export function encodeTerrain(world) {
  const hb = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) hb[i] = Math.max(0, Math.min(255, Math.round(world.height[i] * 255)));
  let b = "";
  for (let i = 0; i < world.n; i += 4096) b += String.fromCharCode.apply(null, world.biome.subarray(i, Math.min(world.n, i + 4096)));
  return { h: u8ToB64(hb), b, sea: world.sea };
}

// walk a polyline cell by cell (dense sampling, so no gaps at diagonals)
export function forEachCellOnLine(pts, w, h, fn) {
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(x0 + ((x1 - x0) * s) / steps), y = Math.floor(y0 + ((y1 - y0) * s) / steps);
      if (x >= 0 && y >= 0 && x < w && y < h) fn(y * w + x);
    }
  }
}
export function rasterRoads(map, w, h) {
  const g = new Uint8Array(w * h);
  for (const r of map.roads || []) {
    const rank = ROAD_TYPES[r.type]?.rank || 1;
    forEachCellOnLine(r.pts, w, h, (i) => { if (g[i] < rank) g[i] = rank; });
  }
  return g;
}
export function rasterRivers(map, w, h) {
  const g = new Uint8Array(w * h);
  for (const r of map.rivers || []) {
    const v = Math.max(1, Math.min(255, Math.round((r.width || 1) * 40)));
    forEachCellOnLine(r.pts, w, h, (i) => { if (g[i] < v) g[i] = v; });
  }
  return g;
}

// Ramer–Douglas–Peucker
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const polyLength = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

export function fmtDist(km, unit = "km") {
  const v = unit === "mi" ? km * 0.621371 : km;
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${unit}`;
}
export function fmtPop(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
