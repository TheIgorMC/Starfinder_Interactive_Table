import { pointInPolygon } from "./geometry.js";

// Bridson-style Poisson-disc sampling with a spatially-varying minimum
// spacing, constrained to an arbitrary polygon. `radiusAt(x, y)` returns
// the local minimum spacing in world units — Docs/10-galaxy-mapgen.md §3
// stage 4: "denser field = smaller minimum spacing, so cluster/void shape
// follows the paint without manual placement."
// `existingPoints` (world [x,y] pairs, e.g. locked systems already placed
// in this sector) seed the spacing grid as obstacles new points must
// respect, but are never themselves included in the returned points —
// callers already have the real objects for those.
export function poissonDiscInPolygon({ polygon, bounds, radiusAt, rng, maxAttempts = 30, existingPoints = [] }) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(bounds.width, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(bounds.height, Math.max(...ys));
  if (maxX <= minX || maxY <= minY) return [];

  const minPossibleRadius = Math.max(1, estimateMinRadius(radiusAt, minX, minY, maxX, maxY));
  const cellSize = minPossibleRadius / Math.SQRT2;
  const gridW = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const gridH = Math.max(1, Math.ceil((maxY - minY) / cellSize));
  const cellGrid = new Array(gridW * gridH).fill(null);

  const points = [];
  const radii = [];
  const active = [];

  const cellOf = (x, y) => [
    Math.floor((x - minX) / cellSize),
    Math.floor((y - minY) / cellSize),
  ];

  function fits(x, y, r) {
    if (x < minX || y < minY || x > maxX || y > maxY) return false;
    if (!pointInPolygon(x, y, polygon)) return false;
    const [gx, gy] = cellOf(x, y);
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const idx = cellGrid[ny * gridW + nx];
        if (idx == null) continue;
        const [px, py] = points[idx];
        const minD = Math.max(r, radii[idx]);
        if (Math.hypot(px - x, py - y) < minD) return false;
      }
    }
    return true;
  }

  function addPoint(x, y, r) {
    const idx = points.length;
    points.push([x, y]);
    radii.push(r);
    const [gx, gy] = cellOf(x, y);
    cellGrid[gy * gridW + gx] = idx;
    active.push(idx);
  }

  for (const [ex, ey] of existingPoints) {
    if (ex < minX || ex > maxX || ey < minY || ey > maxY) continue;
    if (!pointInPolygon(ex, ey, polygon)) continue;
    addPoint(ex, ey, radiusAt(ex, ey));
  }
  const existingCount = points.length;

  let seeded = existingCount > 0;
  for (let i = 0; i < 60 && !seeded; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (pointInPolygon(x, y, polygon)) {
      addPoint(x, y, radiusAt(x, y));
      seeded = true;
    }
  }
  if (!seeded) return [];

  while (active.length > 0) {
    const activeSlot = Math.floor(rng() * active.length);
    const pointIdx = active[activeSlot];
    const [px, py] = points[pointIdx];
    const pr = radii[pointIdx];
    let found = false;
    for (let k = 0; k < maxAttempts; k++) {
      const angle = rng() * Math.PI * 2;
      const dist = pr * (1 + rng());
      const nx = px + Math.cos(angle) * dist;
      const ny = py + Math.sin(angle) * dist;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nr = radiusAt(nx, ny);
      if (fits(nx, ny, nr)) {
        addPoint(nx, ny, nr);
        found = true;
      }
    }
    if (!found) active.splice(activeSlot, 1);
  }

  return points.slice(existingCount);
}

function estimateMinRadius(radiusAt, minX, minY, maxX, maxY, samples = 25) {
  let min = Infinity;
  for (let i = 0; i < samples; i++) {
    const x = minX + (maxX - minX) * (i / samples);
    const y = minY + (maxY - minY) * (((i * 7) % samples) / samples);
    min = Math.min(min, radiusAt(x, y));
  }
  return Number.isFinite(min) ? min : 20;
}
