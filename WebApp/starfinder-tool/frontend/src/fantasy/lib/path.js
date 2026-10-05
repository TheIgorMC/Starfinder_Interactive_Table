// Grid search (8-neighbour A* / Dijkstra) shared by road building and the
// travel estimator. `step(from, to, diag)` returns the cost of moving into
// `to` (Infinity = impassable).
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= val) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && v[c + 1] < v[c]) c++;
        if (v[c] >= lv) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// opts: { w, h, start, goal?(idx→bool), target?: idx (for the heuristic),
//         step, minStep (admissible per-cell lower bound), maxCost }
// → { path: [idx...], cost } or null
export function findPath({ w, h, start, isGoal, target = -1, step, minStep = 0, maxCost = Infinity }) {
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = target >= 0 ? target % w : 0, ty = target >= 0 ? Math.floor(target / w) : 0;
  const H = (i) => (target >= 0 ? Math.hypot((i % w) - tx, Math.floor(i / w) - ty) * minStep : 0);
  const heap = new Heap();
  g[start] = 0;
  heap.push(start, H(start));
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur !== start && isGoal(cur)) {
      const path = [];
      for (let c = cur; c >= 0; c = from[c]) path.push(c);
      return { path: path.reverse(), cost: g[cur] };
    }
    const cx = cur % w, cy = (cur - cx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const c = step(cur, ni, d >= 4);
      if (!(c < Infinity)) continue;
      const ng = g[cur] + c;
      if (ng >= g[ni] || ng > maxCost) continue;
      g[ni] = ng; from[ni] = cur;
      heap.push(ni, ng + H(ni));
    }
  }
  return null;
}
