// Travel-time estimates. Each mode has a base speed on good road and
// per-terrain / per-road factors; a route is the fastest grid path for that
// mode between the waypoints (so a cart sticks to roads while a rider cuts
// across the plains), or the straight line when "as the crow flies".
import { findPath } from "./path.js";
import { RANK_TYPE, simplify } from "./model.js";

const off = (o) => o; // readability
export const MODES = {
  foot: {
    name: "On foot", kmh: 4.8, hours: 8, note: "about 38 km a day on a road (D&D: 24 mi/day)",
    road: { royal: 1, road: 1, track: 0.95, trail: 0.9 }, river: 0.3,
    terrain: off({ G: 0.8, A: 0.8, F: 0.6, D: 0.45, T: 0.6, H: 0.6, M: 0.35, S: 0.2, W: 0.35, R: 0.6 }),
  },
  horse: {
    name: "On horseback", kmh: 6.5, hours: 8, note: "a horse walking and trotting, rested daily",
    road: { royal: 1, road: 1, track: 0.85, trail: 0.6 }, river: 0.4,
    terrain: off({ G: 0.85, A: 0.8, F: 0.5, D: 0.3, T: 0.55, H: 0.55, M: 0.25, S: 0.1, W: 0.25, R: 0.6 }),
  },
  courier: {
    name: "Courier (relay horses)", kmh: 12, hours: 10, note: "fresh horses at every post station",
    road: { royal: 1, road: 0.95, track: 0.7, trail: 0.4 }, river: 0.3,
    terrain: off({ G: 0.65, A: 0.6, F: 0.35, D: 0.2, T: 0.4, H: 0.4, M: 0.15, S: 0.05, W: 0.15, R: 0.5 }),
  },
  wagon: {
    name: "Wagon / cart", kmh: 3.5, hours: 8, note: "loaded ox or horse cart",
    road: { royal: 1, road: 0.95, track: 0.7, trail: 0 }, river: 0.15,
    terrain: off({ G: 0.55, A: 0.5, F: 0.25, D: 0, T: 0.35, H: 0.3, M: 0, S: 0, W: 0, R: 0.45 }),
  },
  carriage: {
    name: "Carriage", kmh: 5.5, hours: 8, note: "needs a road or a cart track",
    road: { royal: 1, road: 0.95, track: 0.6, trail: 0 }, river: 0,
    terrain: off({ G: 0.35, A: 0.35, R: 0.3 }),
  },
  riverboat: { name: "River boat", kmh: 5, hours: 10, note: "barge or keelboat on rivers and lakes", water: "river" },
  ship: { name: "Sailing ship", kmh: 8, hours: 24, note: "about 4 knots, sailing day and night", water: "sea" },
};
export const PACES = {
  slow: { name: "Slow", f: 2 / 3, extra: 0, note: "careful, can move stealthily" },
  normal: { name: "Normal", f: 1, extra: 0, note: "" },
  fast: { name: "Fast", f: 4 / 3, extra: 0, note: "less attentive to surroundings" },
  forced: { name: "Forced march", f: 1, extra: 4, note: "+4 h a day: exhaustion risk" },
};

const roadName = (world, i) => RANK_TYPE[world.road[i]] || "";

// speed factor of a mode in cell i (0 = impassable)
function factor(world, mode, i, isEnd) {
  const code = String.fromCharCode(world.biome[i]);
  const water = code === "O" || code === "L";
  if (mode.water) {
    if (isEnd) return 0.5; // boarding at a quay / beach
    if (mode.water === "sea") return water ? 1 : 0;
    return world.river[i] || code === "L" ? 1 : 0;
  }
  if (water) return 0;
  const r = roadName(world, i);
  if (r) return mode.road[r] || 0;
  const t = mode.terrain[code] || 0;
  if (world.river[i]) return t * mode.river;
  return t;
}

function hoursForStep(world, mode, a, b, diag, isEnd) {
  const f = factor(world, mode, b, isEnd);
  if (!f) return Infinity;
  return ((diag ? 1.4142 : 1) * world.kmPerCell) / (mode.kmh * f);
}

// waypoints: [[x, y], ...] in cells. → { ok, pts, km, hours, legs, by: {kind: km} }
export function computeRoute(world, waypoints, modeKey, { crow = false } = {}) {
  const mode = MODES[modeKey];
  const { w, h } = world;
  const cell = ([x, y]) => Math.max(0, Math.min(h - 1, Math.floor(y))) * w + Math.max(0, Math.min(w - 1, Math.floor(x)));
  const out = { ok: true, pts: [], km: 0, hours: 0, legs: [], by: {} };
  const add = (i, km) => {
    const code = String.fromCharCode(world.biome[i]);
    const k = mode.water ? "water" : roadName(world, i) || (code === "O" || code === "L" ? "water" : "offroad");
    out.by[k] = (out.by[k] || 0) + km;
  };
  for (let l = 1; l < waypoints.length; l++) {
    const A = waypoints[l - 1], B = waypoints[l];
    const s = cell(A), t = cell(B);
    let leg;
    if (crow) {
      const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const steps = Math.max(1, Math.ceil(d * 2));
      let hours = 0, blocked = false;
      for (let j = 1; j <= steps; j++) {
        const i = cell([A[0] + ((B[0] - A[0]) * j) / steps, A[1] + ((B[1] - A[1]) * j) / steps]);
        const km = (d / steps) * world.kmPerCell;
        const f = factor(world, mode, i, i === s || i === t);
        if (!f) blocked = true;
        hours += km / (mode.kmh * (f || 0.1));
        add(i, km);
      }
      leg = { km: d * world.kmPerCell, hours, pts: [A, B], blocked };
    } else {
      const p = s === t ? { path: [s], cost: 0 } : findPath({
        w, h, start: s, target: t, isGoal: (k) => k === t,
        step: (a, b, diag) => hoursForStep(world, mode, a, b, diag, b === t || a === s),
        minStep: world.kmPerCell / (mode.kmh * 1),
      });
      if (!p) { out.ok = false; out.legs.push({ km: 0, hours: 0, pts: [A, B], blocked: true }); continue; }
      let km = 0;
      for (let j = 1; j < p.path.length; j++) {
        const a = p.path[j - 1], b = p.path[j];
        const d = (Math.abs(a - b) === 1 || Math.abs(a - b) === w ? 1 : 1.4142) * world.kmPerCell;
        km += d; add(b, d);
      }
      const pts = [A, ...p.path.slice(1, -1).map((k) => [k % w + 0.5, Math.floor(k / w) + 0.5]), B];
      leg = { km, hours: p.cost, pts: simplify(pts, 0.4), blocked: false };
    }
    if (leg.blocked) out.ok = false;
    out.legs.push(leg);
    out.km += leg.km; out.hours += leg.hours;
    out.pts.push(...(out.pts.length ? leg.pts.slice(1) : leg.pts));
  }
  return out;
}

// travelling hours → { days, hours } for a mode and pace
export function schedule(hoursAtNormal, modeKey, paceKey) {
  const mode = MODES[modeKey], pace = PACES[paceKey];
  const moving = hoursAtNormal / pace.f;
  const perDay = Math.min(24, mode.hours + pace.extra);
  return { moving, perDay, days: moving / perDay };
}

export function fmtDuration(moving, perDay) {
  if (!isFinite(moving)) return "—";
  if (moving < 1) return `${Math.max(1, Math.round(moving * 60))} min`;
  if (moving <= perDay) return `${moving < 10 ? moving.toFixed(1) : Math.round(moving)} h`;
  const d = Math.floor(moving / perDay), r = Math.round(moving - d * perDay);
  return `${d} d${r ? ` ${r} h` : ""}`;
}
