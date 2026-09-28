// Minimal Bowyer-Watson Delaunay triangulation. Returns the unique edge list
// (as point-index pairs) for a set of 2D points — used as the seed graph
// for hyperlane generation (Docs/10-galaxy-mapgen.md §3 stage 6), which then
// prunes/thickens it rather than rendering the raw triangulation.
function circumcircle(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null; // collinear, no finite circumcircle
  const ax2ay2 = ax * ax + ay * ay;
  const bx2by2 = bx * bx + by * by;
  const cx2cy2 = cx * cx + cy * cy;
  const ux = (ax2ay2 * (by - cy) + bx2by2 * (cy - ay) + cx2cy2 * (ay - by)) / d;
  const uy = (ax2ay2 * (cx - bx) + bx2by2 * (ax - cx) + cx2cy2 * (bx - ax)) / d;
  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  return { x: ux, y: uy, r2 };
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function delaunayEdges(points) {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) return [[0, 1]];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const dx = maxX - minX, dy = maxY - minY;
  const delta = Math.max(dx, dy) || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

  // Super-triangle indices come after all real points.
  const allPoints = [
    ...points,
    [midX - 20 * delta, midY - delta],
    [midX, midY + 20 * delta],
    [midX + 20 * delta, midY - delta],
  ];
  let triangles = [[n, n + 1, n + 2]];

  for (let pi = 0; pi < n; pi++) {
    const point = allPoints[pi];
    const bad = [];
    for (const tri of triangles) {
      const circ = circumcircle(allPoints[tri[0]], allPoints[tri[1]], allPoints[tri[2]]);
      if (!circ) continue;
      const ddx = point[0] - circ.x, ddy = point[1] - circ.y;
      if (ddx * ddx + ddy * ddy <= circ.r2) bad.push(tri);
    }

    const edgeCount = new Map();
    for (const tri of bad) {
      const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      for (const [a, b] of edges) {
        const key = edgeKey(a, b);
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    const boundary = [];
    for (const tri of bad) {
      const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      for (const [a, b] of edges) {
        if (edgeCount.get(edgeKey(a, b)) === 1) boundary.push([a, b]);
      }
    }

    const badSet = new Set(bad);
    triangles = triangles.filter((t) => !badSet.has(t));
    for (const [a, b] of boundary) triangles.push([a, b, pi]);
  }

  triangles = triangles.filter((tri) => tri[0] < n && tri[1] < n && tri[2] < n);

  const seen = new Set();
  const edges = [];
  for (const [i, j, k] of triangles) {
    for (let [a, b] of [[i, j], [j, k], [k, i]]) {
      if (a > b) [a, b] = [b, a];
      const key = `${a}_${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}
