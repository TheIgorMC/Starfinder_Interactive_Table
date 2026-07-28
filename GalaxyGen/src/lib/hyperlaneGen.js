import { delaunayEdges } from "./delaunay.js";
import { createRng } from "./rng.js";
import { GRID_SIZE, sampleBilinear } from "./grid.js";

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// Gabriel-graph test: true if point `p` lies inside the circle whose
// diameter is segment ab (Docs/10-galaxy-mapgen.md §3 stage 6 — "prune
// edges using relative-neighborhood/Gabriel-graph rules for a natural look").
function circleContainsPoint(a, b, p) {
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  const r2 = ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) / 4;
  const dx = p[0] - midX, dy = p[1] - midY;
  return dx * dx + dy * dy < r2 - 1e-9;
}

// Builds the hyperlane graph from already-placed systems: Delaunay
// triangulation -> Gabriel-graph pruning for a natural look -> add pruned
// edges back where the painted hyperlane-density field is high -> guarantee
// a single connected component (Docs/10-galaxy-mapgen.md §3 stage 6).
// Deterministic for a given seed + system layout + hyperlane field.
export function generateHyperlanes(project) {
  const systems = project.systems;
  if (systems.length < 2) return { edges: [], systems };

  const points = systems.map((s) => [s.position.x, s.position.y]);
  const rng = createRng(`${project.seed}:hyperlanes`);
  const densityGrid = project.fields.hyperlane;

  const delaunay = delaunayEdges(points);

  const kept = [];
  const pruned = [];
  for (const [i, j] of delaunay) {
    let gabriel = true;
    for (let k = 0; k < points.length; k++) {
      if (k === i || k === j) continue;
      if (circleContainsPoint(points[i], points[j], points[k])) {
        gabriel = false;
        break;
      }
    }
    (gabriel ? kept : pruned).push([i, j]);
  }

  // Thicken connectivity in densely-connected regions: a pruned edge whose
  // midpoint sits in high hyperlane-density territory gets added back.
  for (const [i, j] of pruned) {
    const midX = (points[i][0] + points[j][0]) / 2;
    const midY = (points[i][1] + points[j][1]) / 2;
    const density = sampleBilinear(densityGrid, GRID_SIZE, midX, midY, project.bounds);
    if (rng() < density) kept.push([i, j]);
  }

  // Connectivity guarantee. The Gabriel graph always contains the Euclidean
  // minimum spanning tree, so this should never actually fire — it's a
  // safety net for the "if disconnected" case the design doc calls out.
  const parent = points.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (const [i, j] of kept) union(i, j);

  let componentCount = new Set(points.map((_, i) => find(i))).size;
  while (componentCount > 1) {
    let best = null;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (find(i) === find(j)) continue;
        const dx = points[i][0] - points[j][0], dy = points[i][1] - points[j][1];
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.d2) best = { i, j, d2 };
      }
    }
    kept.push([best.i, best.j]);
    union(best.i, best.j);
    componentCount = new Set(points.map((_, i) => find(i))).size;
  }

  const edgeMap = new Map();
  for (const [i, j] of kept) {
    const key = edgeKey(i, j);
    if (edgeMap.has(key)) continue;
    const a = systems[i], b = systems[j];
    const length = Math.round(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y));
    // Danger is a placeholder until Phase 3 (factions/war-chance, §4) exists
    // to derive it properly — for now, lower Dominion security along the
    // route reads as higher risk.
    const secA = a.security?.dominion ?? 0.5;
    const secB = b.security?.dominion ?? 0.5;
    const risk = Number(Math.max(0, Math.min(1, 1 - (secA + secB) / 2)).toFixed(2));
    const midX = (a.position.x + b.position.x) / 2;
    const midY = (a.position.y + b.position.y) / 2;
    const density = sampleBilinear(densityGrid, GRID_SIZE, midX, midY, project.bounds);
    const capacity = density >= 0.66 ? "major trade route" : density <= 0.25 ? "backwater spur" : null;
    edgeMap.set(key, {
      id: crypto.randomUUID(),
      a: a.id,
      b: b.id,
      aSlug: a.slug,
      bSlug: b.slug,
      length,
      risk,
      capacity,
    });
  }
  const edges = [...edgeMap.values()];

  const neighborSlugs = new Map(systems.map((s) => [s.id, new Set()]));
  for (const e of edges) {
    neighborSlugs.get(e.a).add(e.bSlug);
    neighborSlugs.get(e.b).add(e.aSlug);
  }
  const updatedSystems = systems.map((s) => ({
    ...s,
    hyperlanes: [...neighborSlugs.get(s.id)].sort(),
  }));

  return { edges, systems: updatedSystems };
}
