// Settlement layout + renderer (from the ARTS galaxy-viewer handoff's
// Settlement/MSettlement mockups). One copy, shared by the galaxy viewer's
// settlement view and the Galaxy Editor's Cities tab (preview + hand-placing
// districts), so what the GM sketches is exactly what players see.
//
// Site district schema (authored in the Galaxy Editor, carried in the project's
// body.sites[].districts[]):
//   { name, type, hidden?, host?, x?, y?, r?, sitRef? }
// x/y (settlement units, origin = city centre, +y = south) pin a district
// where the GM placed it; districts without x/y are laid out by the seeded
// relaxation below. `host` names the district a hidden one hides beside.

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export const DISTRICT_TYPES = {
  port: "#ff9a3c", government: "#ffd27a", administration: "#ffd27a", fortress: "#e0735a", hidden: "#8f8a80",
  commerce: "#c9c1ff", habitation: "#5fd3f3", industry: "#d9a066", academy: "#9fe6f8", residence: "#c7a4ff", park: "#7fd09a",
};
export const SETTLEMENT_TRANSIT = {
  rail: { n: "Maglev rail", c: "#5fd3f3", d: "Surface trains between districts", dash: "solid" },
  underground: { n: "Underground metro", c: "#ffb866", d: "Pressurised tunnels with stations", dash: "dashed" },
  shuttle: { n: "Aerial shuttle", c: "#c7a4ff", d: "Flights between landing pads", dash: "dotted" },
};
export const SETTLEMENT_NOTE = {
  moon: "No atmosphere: the districts are domes joined mostly by tunnels, with one surface rail spur.",
  "rocky planet": "Airless rock: tunnels do most of the work, with maglev on stable ground.",
  "ice world": "Tunnels run beneath the ice sheet; rail crosses the flats.",
  "terrestrial world": "Open ground allows every mode: surface rail, a metro and short shuttle hops.",
  "gas giant": "Nothing to stand on: every platform is linked by aerial shuttles.",
};
const MIX = {
  moon: [["underground", 0.8], ["rail", 0.2]], "rocky planet": [["underground", 0.7], ["rail", 0.3]], "ice world": [["underground", 0.55], ["rail", 0.45]],
  "terrestrial world": [["rail", 0.4], ["underground", 0.3], ["shuttle", 0.3]], "gas giant": [["shuttle", 1]],
};
function allocModes(kind, n, r, allowed) {
  let mix = MIX[kind] || MIX["rocky planet"];
  if (!n) return [];
  if (allowed && allowed.length) {
    let m2 = mix.filter(([k]) => allowed.includes(k));
    if (!m2.length) m2 = allowed.map((k) => [k, 1 / allowed.length]);
    const tot = m2.reduce((a, x) => a + x[1], 0);
    mix = m2.map(([k, w]) => [k, w / tot]);
    if (allowed.length >= 3 && n >= 3) kind = "terrestrial world";
  }
  const q = mix.map(([k, w]) => ({ k, c: Math.floor(w * n), f: w * n - Math.floor(w * n) }));
  let left = n - q.reduce((a, x) => a + x.c, 0);
  q.slice().sort((a, b) => b.f - a.f).forEach((x) => { if (left > 0) { x.c++; left--; } });
  if (kind === "terrestrial world" && n >= 3) q.forEach((x) => { if (!x.c) { const big = q.reduce((a, b) => (b.c > a.c ? b : a)); big.c--; x.c++; } });
  const out = [];
  q.forEach((x) => { for (let i = 0; i < x.c; i++) out.push(x.k); });
  for (let i = out.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
// Settlement styles (Docs/15-settlement-generators.md). Only `outpost` has
// its real design here (domes / floating platforms). `city` and `station`
// will get their own procedural generators (Galaxy Editor City Gen / Station
// Gen); until then they reuse this layout and render as "provisional".
export const SETTLEMENT_STYLES = {
  outpost: { n: "Outpost", final: true },
  city: { n: "City", final: false },
  station: { n: "Station", final: false },
};
export function settlementStyle(body, site) {
  const def = site.def || null;
  if (def && SETTLEMENT_STYLES[def.style]) return def.style;
  if (body.k === "orbital station") return "station";
  if ((body.t || []).includes("ecumenopolis")) return "city";
  if (def && ["city", "government"].includes(def.kind)) return "city";
  if (!def && site.id === "cap") return "city";
  return "outpost";
}
// Procedural district list for a generated city: size follows the site's
// population (`site.pop`), so a megalopolis isn't five domes.
const CITY_POOL = [
  "Administration", "Habitation North", "Commerce", "Industry", "Habitation South", "Hydroponics", "Power Plant",
  "Transit Hub", "Market District", "Arcology Ring", "Medical Center", "University", "Foundries", "Residential Spires",
  "Old Town", "Entertainment Strip", "Water Works", "Security Precinct", "Data Exchange", "Habitation East", "Habitation West",
];
function cityDistricts(site, r) {
  const n = site.pop || (site.id === "cap" ? 3e5 : 3e4);
  const count = n < 1e4 ? 5 : n < 1e5 ? 6 : n < 1e6 ? 8 : n < 1e7 ? 10 : n < 1e8 ? 12 : n < 1e9 ? 14 : 17;
  const port = site.id === "cap" || n >= 1e6 ? "Spaceport" : "Landing Field";
  const pool = CITY_POOL.slice();
  for (let i = pool.length - 1; i > 3; i--) { const j = 3 + Math.floor(r() * (i - 2)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return [port, ...pool.slice(0, count - 1)];
}
const pinned = (d) => typeof d.x === "number" && typeof d.y === "number";

// body: { s: slug, k: kind, t?: tags } · site: { id, type, def? } where def
// is the authored site ({ districts, transit }) or null for a procedural one.
export function layoutSettlement(body, site) {
  const kind = body.k, r = rng(hash(body.s + "|" + site.id));
  const isX = /extraction|harvester/i.test(site.type || ""), gas = kind === "gas giant";
  const def = site.def || null;
  const defs = def ? def.districts || [] : null;
  const names = defs ? defs.map((x) => x.name)
    : isX ? (gas ? ["Harvester Deck", "Refinery", "Crew Quarters", "Shuttle Pad"] : ["Processing Plant", "Drill Field", "Crew Habitat", "Landing Pad", "Ore Storage"])
    : cityDistricts(site, r);
  const col0 = (n) => /port|landing|pad/i.test(n) ? "#ff9a3c" : /Habitation|Crew|Quarters|Residential|Arcology/.test(n) ? "#5fd3f3" : /Hydroponics|Water/.test(n) ? "#7fd09a"
    : /Industry|Workshops|Plant|Refinery|Drill|Storage|Deck|Power|Foundries/.test(n) ? "#d9a066"
    : /Administration|Security/.test(n) ? "#ffd27a" : /University|Medical|Data/.test(n) ? "#9fe6f8" : "#c9c1ff";
  // Each district draws its randoms from its own name-seeded stream and its
  // spiral slot counts visible districts only, so stripping hidden districts
  // (players never receive them) leaves every other district exactly where
  // the GM sees it.
  let slot = 0;
  const ds = names.map((n, i) => {
    const dd = defs ? defs[i] : null, hidden = !!dd?.hidden;
    const rr = rng(hash(body.s + "|" + site.id + "|" + n));
    const k = hidden ? -1 : slot++;
    const a = Math.max(0, k) * 2.39996 + rr() * 0.5, d = k <= 0 ? 0 : 60 + Math.sqrt(k) * 105;
    const port = dd ? dd.type === "port" : /port|landing|pad/i.test(n);
    const rad = port ? 74 : (isX ? 36 : 44) + rr() * 22;
    const seed = (rr() * 1e9) | 0;
    const pin = dd && pinned(dd);
    return {
      name: n, type: dd?.type || null, x: pin ? dd.x : Math.cos(a) * d, y: pin ? dd.y : Math.sin(a) * d * 0.8,
      rad: dd && typeof dd.r === "number" ? dd.r : rad, port, color: dd ? DISTRICT_TYPES[dd.type] || "#c9c1ff" : col0(n),
      hidden, host: dd?.host || null, pinned: !!pin, sitRef: dd?.sitRef || null, seed, anchor: k === 0,
    };
  });
  // relaxation: push overlapping districts apart; pinned ones and the centre never move
  for (let it = 0; it < 120; it++) for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const A = ds[i], B = ds[j]; if (A.hidden || B.hidden) continue;
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, min = A.rad + B.rad + (gas ? 70 : 46);
    if (d >= min) continue;
    const mA = !(A.pinned || A.anchor), mB = !(B.pinned || B.anchor);
    if (!mA && !mB) continue;
    const p = (min - d) / 2, ux = dx / d, uy = dy / d;
    if (mA) { A.x -= ux * p; A.y -= uy * p; }
    if (mB) { B.x += ux * p; B.y += uy * p; }
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const vis = ds.map((x, i) => i).filter((i) => !ds[i].hidden), E = [];
  if (vis.length) {
    const used = new Set([vis[0]]);
    while (used.size < vis.length) {
      let best = null;
      for (const a of used) for (const j of vis) { if (used.has(j)) continue; const d = dist(ds[a], ds[j]); if (!best || d < best.d) best = { a, b: j, d }; }
      used.add(best.b); E.push(best);
    }
    if (vis.length > 4) {
      let best = null;
      for (const a of vis) for (const j of vis) { if (j <= a || E.find((e) => (e.a === a && e.b === j) || (e.a === j && e.b === a))) continue; const d = dist(ds[a], ds[j]); if (!best || d < best.d) best = { a, b: j, d }; }
      if (best) E.push(best);
    }
  }
  const modes = allocModes(kind, E.length, r, def && def.transit);
  const edges = E.map((e, i) => ({ a: e.a, b: e.b, mode: modes[i], ph: r(), bend: (r() < 0.5 ? -1 : 1) * (0.18 + r() * 0.12) }));
  // hidden districts: tucked beside their host with one secret tunnel, no public transit
  const hostOf = (h) => {
    if (h.host) { const i = ds.findIndex((x) => !x.hidden && x.name === h.host); if (i >= 0) return i; }
    const g = ds.findIndex((x) => !x.hidden && /gammon/i.test(x.name));
    if (g >= 0) return g;
    return vis.length ? vis.reduce((a, j) => (dist(ds[j], h) < dist(ds[a], h) ? j : a), vis[0]) : -1;
  };
  ds.forEach((h, i) => {
    if (!h.hidden) return;
    const hi = hostOf(h); if (hi < 0) return;
    const H = ds[hi];
    if (!h.pinned) {
      const ang = Math.atan2(h.y - H.y, h.x - H.x) || 0.8;
      h.rad = Math.min(h.rad, 40); h.x = H.x + Math.cos(ang) * (H.rad + h.rad + 30); h.y = H.y + Math.sin(ang) * (H.rad + h.rad + 30);
    }
    h.hostIdx = hi;
    edges.push({ a: hi, b: i, mode: "underground", secret: true, ph: r(), bend: 0 });
  });
  // a hidden district only ever moves itself (never its neighbours), so the
  // visible layout is identical with or without it
  for (let it = 0; it < 80; it++) ds.forEach((h, i) => {
    if (!h.hidden || h.pinned) return;
    ds.forEach((o, j) => {
      if (j === i || o.hidden) return;
      const dx = h.x - o.x, dy = h.y - o.y, dd = Math.hypot(dx, dy) || 1, min = o.rad + h.rad + (j === h.hostIdx ? 20 : 30);
      if (dd < min) { h.x += (dx / dd) * (min - dd); h.y += (dy / dd) * (min - dd); }
    });
  });
  const tr = rng(hash(body.s)), feat = [];
  for (let i = 0; i < 70; i++) feat.push({ x: (tr() - 0.5) * 2400, y: (tr() - 0.5) * 1800, r: 8 + Math.pow(tr(), 2.2) * 110, a: tr() * 6.28, s: tr() });
  return { ds, edges, feat, gas, isX, ecu: (body.t || []).includes("ecumenopolis"), kind, style: settlementStyle(body, site) };
}

function localPoint(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

// opts: { mobile, editable, onSelect(i|null), onHover(bool), onMove(i, x, y),
//         center(W,H) -> [cx, cy], area(W,H) -> [w, h] (free space the city is fitted into) }
export class SettlementView {
  constructor(cv, body, site, opts = {}) {
    this.cv = cv; this.o = opts; this.body = body;
    this.flags = { transit: true, labels: true }; this.sel = null; this.hover = null;
    this.cam = { x: 0, y: 0, k: 1 }; this.goal = null;
    this.setSite(body, site);
    this.bind();
    let raf = 0, logged = false;
    const loop = () => { raf = requestAnimationFrame(loop); try { this.frame(); } catch (e) { if (!logged) { logged = true; console.error(e); } } };
    raf = requestAnimationFrame(loop);
    this.stop = () => cancelAnimationFrame(raf);
  }
  destroy() { this.stop(); this.unbind(); }
  // keepCamera: re-layout in place (the editor calls this after every edit)
  setSite(body, site, keepCamera) { this.body = body; this.site = site; this.L = layoutSettlement(body, site); if (!keepCamera) this.home = null; }
  // Camera that frames every district in the free area (computed on the
  // first frame, once the canvas has a size).
  fitHome(W, H) {
    const ds = this.L.ds; if (!ds.length) return { x: 0, y: 0, k: 1 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of ds) { x0 = Math.min(x0, d.x - d.rad); x1 = Math.max(x1, d.x + d.rad); y0 = Math.min(y0, d.y - d.rad); y1 = Math.max(y1, d.y + d.rad + 30); }
    const [aw, ah] = this.o.area ? this.o.area(W, H) : [W - 80, H - 80];
    const k = Math.max(0.3, Math.min(1, aw / (x1 - x0 + 120), ah / (y1 - y0 + 40)));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
  }
  setFlag(k, v) { this.flags[k] = v; }
  setSel(i) { this.sel = i; }
  focus(i) { const d = this.L.ds[i]; if (d) this.goal = { x: d.x, y: d.y, k: Math.max(this.cam.k, this.o.mobile ? 0.9 : 1.4) }; }
  zoomIn() { this.goal = { x: this.cam.x, y: this.cam.y, k: Math.min(4, this.cam.k * 1.4) }; }
  zoomOut() { this.goal = { x: this.cam.x, y: this.cam.y, k: Math.max(0.3, this.cam.k / 1.4) }; }
  reset() { if (this.home) this.goal = { ...this.home }; }
  center(W, H) { return this.o.center ? this.o.center(W, H) : [W / 2, H / 2]; }
  toS(x, y) { const c = this.cam; return [this.CX + (x - c.x) * c.k, this.CY + (y - c.y) * c.k]; }
  toW(sx, sy) { const c = this.cam; return [c.x + (sx - this.CX) / c.k, c.y + (sy - this.CY) / c.k]; }
  pickAt(x, y) {
    let best = null;
    this.L.ds.forEach((d, i) => { const p = this.toS(d.x, d.y); if (Math.hypot(p[0] - x, p[1] - y) < Math.max(d.rad * this.cam.k, 14)) best = i; });
    return best;
  }
  bind() {
    const cv = this.cv, ptrs = new Map();
    let drag = null, pinch = null;
    const pd = () => { const a = [...ptrs.values()]; return { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1, cx: (a[0][0] + a[1][0]) / 2, cy: (a[0][1] + a[1][1]) / 2 }; };
    const zoomAt = (sx, sy, f) => { const c = this.cam, w = this.toW(sx, sy); c.k = Math.max(0.3, Math.min(4, c.k * f)); c.x = w[0] - (sx - this.CX) / c.k; c.y = w[1] - (sy - this.CY) / c.k; this.goal = null; };
    const h = {
      wheel: (e) => { e.preventDefault(); const p = localPoint(cv, e); zoomAt(p[0], p[1], Math.exp(-e.deltaY * 0.0015)); },
      down: (e) => {
        cv.setPointerCapture?.(e.pointerId); const p = localPoint(cv, e); ptrs.set(e.pointerId, p);
        if (ptrs.size === 1) {
          const hit = this.o.editable ? this.pickAt(p[0], p[1]) : null;
          drag = { x: p[0], y: p[1], moved: false, touch: e.pointerType === "touch", district: hit };
        } else { drag = null; pinch = pd(); }
      },
      move: (e) => {
        const p = localPoint(cv, e); if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
        if (ptrs.size === 2 && pinch) { const q = pd(); zoomAt(q.cx, q.cy, q.d / pinch.d); pinch = q; return; }
        if (!drag) { if (e.pointerType !== "touch") { const hv = this.pickAt(p[0], p[1]); if (hv !== this.hover) { this.hover = hv; this.o.onHover?.(hv != null); } } return; }
        const dx = p[0] - drag.x, dy = p[1] - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (drag.touch ? 5 : 3)) drag.moved = true;
        if (!drag.moved) return;
        if (drag.district != null) { const d = this.L.ds[drag.district]; d.x += dx / this.cam.k; d.y += dy / this.cam.k; d.pinned = true; }
        else { this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k; this.goal = null; }
        drag.x = p[0]; drag.y = p[1];
      },
      up: (e) => {
        const p = localPoint(cv, e);
        if (drag && !drag.moved) this.o.onSelect?.(this.pickAt(p[0], p[1]));
        else if (drag && drag.district != null) { const d = this.L.ds[drag.district]; this.o.onMove?.(drag.district, Math.round(d.x), Math.round(d.y)); }
        ptrs.delete(e.pointerId); drag = null; if (ptrs.size < 2) pinch = null;
      },
    };
    cv.addEventListener("wheel", h.wheel, { passive: false });
    cv.addEventListener("pointerdown", h.down); cv.addEventListener("pointermove", h.move);
    cv.addEventListener("pointerup", h.up); cv.addEventListener("pointercancel", h.up);
    this.unbind = () => {
      cv.removeEventListener("wheel", h.wheel);
      cv.removeEventListener("pointerdown", h.down); cv.removeEventListener("pointermove", h.move);
      cv.removeEventListener("pointerup", h.up); cv.removeEventListener("pointercancel", h.up);
    };
  }
  frame() {
    const cv = this.cv, dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 1, H = cv.clientHeight || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    [this.CX, this.CY] = this.center(W, H); this.W = W; this.H = H;
    if (!this.home) { this.home = this.fitHome(W, H); this.cam = { ...this.home }; }
    const t = performance.now() / 1000;
    if (this.goal) { const g = this.goal, m = this.cam; m.x += (g.x - m.x) * 0.12; m.y += (g.y - m.y) * 0.12; m.k += (g.k - m.k) * 0.12; if (Math.abs(g.x - m.x) < 0.3 && Math.abs(g.k - m.k) < 0.005) this.goal = null; }
    const L = this.L, k = this.cam.k;
    this.ground(c, L.kind, t);
    if (this.flags.transit) L.edges.filter((e) => e.mode === "underground").forEach((e) => this.edge(c, e, t));
    L.ds.forEach((d, i) => this.district(c, d, i, t));
    if (this.flags.transit) L.edges.filter((e) => e.mode !== "underground").forEach((e) => this.edge(c, e, t));
    if (this.flags.transit) L.edges.filter((e) => e.mode === "underground" && !e.secret).forEach((e) => [e.a, e.b].forEach((i) => {
      const d = L.ds[i], p = this.toS(d.x + d.rad * 0.45, d.y - d.rad * 0.45);
      c.fillStyle = "#140a02"; c.strokeStyle = "#ffb866"; c.lineWidth = 1.6; c.beginPath(); c.arc(p[0], p[1], 8, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#ffb866"; c.font = "700 9px Oxanium, sans-serif"; c.textAlign = "center"; c.fillText("M", p[0], p[1] + 3); c.textAlign = "left";
    }));
    if (this.flags.labels) {
      c.font = `600 ${this.o.mobile ? 11 : 12}px Oxanium, sans-serif`; c.textAlign = "center";
      L.ds.forEach((d, i) => {
        const p = this.toS(d.x, d.y + d.rad + 18 / k);
        c.fillStyle = this.sel === i ? "#ffb866" : "rgba(236,230,218,.88)"; c.shadowColor = "#000"; c.shadowBlur = 5;
        c.fillText(d.name.toUpperCase() + (d.hidden ? " · HIDDEN" : ""), p[0], p[1] + 4); c.shadowBlur = 0;
        if (this.o.editable && d.pinned) { c.fillStyle = "rgba(255,154,60,.8)"; c.fillText("◆", p[0], p[1] + 18); }
      });
      c.textAlign = "left";
    }
    const sel = this.sel;
    if (sel != null && L.ds[sel]) { const d = L.ds[sel], p = this.toS(d.x, d.y), R = d.rad * k + 10; c.strokeStyle = "#ff9a3c"; c.lineWidth = 1.6; for (let q = 0; q < 4; q++) { const a = t * 0.7 + (q * Math.PI) / 2; c.beginPath(); c.arc(p[0], p[1], R, a, a + 0.9); c.stroke(); } }
    if (this.hover != null && this.hover !== sel && L.ds[this.hover]) { const d = L.ds[this.hover], p = this.toS(d.x, d.y); c.strokeStyle = "rgba(95,211,243,.8)"; c.lineWidth = 1.2; c.beginPath(); c.arc(p[0], p[1], d.rad * k + 6, 0, 7); c.stroke(); }
  }
  ground(c, kind, t) {
    const k = this.cam.k, W = this.W, H = this.H, L = this.L;
    c.fillStyle = { moon: "#0c0c0e", "rocky planet": "#100d0b", "ice world": "#0a1118", "terrestrial world": "#0b120d", "gas giant": "#120c07" }[kind] || "#0c0c0e";
    c.fillRect(0, 0, W, H);
    if (kind === "gas giant") {
      for (let i = 0; i < 14; i++) {
        const span = H + 360, y = (((i * 90 - this.cam.y * k * 0.4 + t * 6 * ((i % 3) + 1)) % span) + span) % span - 180;
        const g = c.createLinearGradient(0, y - 60, 0, y + 60);
        g.addColorStop(0, "rgba(200,120,50,0)"); g.addColorStop(0.5, i % 2 ? "rgba(210,140,70,.10)" : "rgba(120,70,30,.14)"); g.addColorStop(1, "rgba(200,120,50,0)");
        c.fillStyle = g; c.fillRect(0, y - 60, W, 120);
      }
      L.feat.forEach((f) => { const p = this.toS(f.x + t * 4 * (f.s + 0.3), f.y); c.fillStyle = "rgba(230,190,140,.035)"; c.beginPath(); c.ellipse(p[0], p[1], f.r * 2.4 * k, f.r * 0.6 * k, 0, 0, 7); c.fill(); });
      return;
    }
    if (L.ecu) { c.fillStyle = "#0e0f13"; c.fillRect(0, 0, W, H); }
    const gs = (L.ecu ? 22 : 60) * k, ox = (((-this.cam.x * k + this.CX) % gs) + gs) % gs, oy = (((-this.cam.y * k + this.CY) % gs) + gs) % gs;
    c.strokeStyle = L.ecu ? "rgba(230,200,140,.07)" : "rgba(120,150,170,.05)"; c.lineWidth = 1; c.beginPath();
    for (let x = ox; x < W; x += gs) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = oy; y < H; y += gs) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    L.feat.forEach((f) => {
      const p = this.toS(f.x, f.y), r = f.r * k; if (p[0] < -r * 3 || p[0] > W + r * 3 || p[1] < -r * 3 || p[1] > H + r * 3) return;
      if (kind === "terrestrial world") { c.strokeStyle = "rgba(120,170,110,.07)"; c.lineWidth = 1; for (let q = 1; q <= 3; q++) { c.beginPath(); c.ellipse(p[0], p[1], r * q * 0.6, r * q * 0.42, f.a, 0, 7); c.stroke(); } }
      else if (kind === "ice world") { c.strokeStyle = "rgba(170,210,240,.10)"; c.lineWidth = 1; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + Math.cos(f.a) * r * 2, p[1] + Math.sin(f.a) * r * 2); c.lineTo(p[0] + Math.cos(f.a + 0.6) * r * 3, p[1] + Math.sin(f.a + 0.6) * r * 3); c.stroke(); }
      else { c.strokeStyle = "rgba(210,200,185,.09)"; c.lineWidth = 1.2; c.beginPath(); c.arc(p[0], p[1], r, 0, 7); c.stroke(); c.fillStyle = "rgba(0,0,0,.18)"; c.beginPath(); c.arc(p[0] + r * 0.12, p[1] + r * 0.12, r * 0.85, 0, 7); c.fill(); }
    });
  }
  district(c, d, i, t) {
    const k = this.cam.k, p = this.toS(d.x, d.y), R = d.rad * k, L = this.L, W = this.W, H = this.H;
    if (d.hidden) {
      c.setLineDash([4, 5]); c.strokeStyle = "rgba(160,155,145,.7)"; c.lineWidth = 1.3; c.fillStyle = "rgba(10,12,16,.75)";
      c.beginPath(); c.arc(p[0], p[1], R, 0, 7); c.fill(); c.stroke(); c.setLineDash([]);
      c.fillStyle = "rgba(120,255,160,.55)"; for (let q = 0; q < 6; q++) c.fillRect(p[0] - R * 0.4 + q * R * 0.16, p[1] - 3, R * 0.1, 6);
      return;
    }
    // style dispatch: outposts are always domes (platforms on gas giants);
    // city/station use the provisional generic look until their generators land
    const r = rng(d.seed), open = L.style !== "outpost" && L.kind === "terrestrial world" && !L.isX;
    if (p[0] < -R - 40 || p[0] > W + R + 40 || p[1] < -R - 40 || p[1] > H + R + 40) return;
    if (L.gas) { // floating platform
      c.fillStyle = "rgba(8,10,14,.92)"; c.beginPath(); c.arc(p[0], p[1], R, 0, 7); c.fill();
      c.strokeStyle = "rgba(255,154,60,.7)"; c.lineWidth = Math.max(2, 4 * k); c.stroke();
      c.strokeStyle = "rgba(255,154,60,.25)"; c.lineWidth = 1;
      for (let q = 0; q < 8; q++) { const a = (q * Math.PI) / 4; c.beginPath(); c.moveTo(p[0] + Math.cos(a) * R * 0.35, p[1] + Math.sin(a) * R * 0.35); c.lineTo(p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R); c.stroke(); }
    } else if (open) {
      c.save(); c.translate(p[0], p[1]); c.rotate((r() - 0.5) * 0.5);
      c.fillStyle = "rgba(20,30,26,.9)"; c.strokeStyle = "rgba(95,211,243,.35)"; c.lineWidth = 1;
      c.beginPath(); if (c.roundRect) c.roundRect(-R, -R * 0.8, R * 2, R * 1.6, 6 * k); else c.rect(-R, -R * 0.8, R * 2, R * 1.6); c.fill(); c.stroke();
      c.strokeStyle = "rgba(236,230,218,.08)"; for (let q = -R + 14 * k; q < R; q += 14 * k) { c.beginPath(); c.moveTo(q, -R * 0.8); c.lineTo(q, R * 0.8); c.stroke(); }
      c.restore();
    } else { // dome
      const g = c.createRadialGradient(p[0] - R * 0.3, p[1] - R * 0.35, R * 0.1, p[0], p[1], R); g.addColorStop(0, "rgba(140,210,240,.16)"); g.addColorStop(1, "rgba(40,80,110,.08)");
      c.fillStyle = "rgba(8,12,18,.9)"; c.beginPath(); c.arc(p[0], p[1], R, 0, 7); c.fill(); c.fillStyle = g; c.fill();
      c.strokeStyle = "rgba(95,211,243,.55)"; c.lineWidth = 1.4; c.stroke();
      c.strokeStyle = "rgba(95,211,243,.12)"; c.lineWidth = 1;
      c.beginPath(); c.ellipse(p[0], p[1], R, R * 0.45, 0, 0, 7); c.stroke(); c.beginPath(); c.ellipse(p[0], p[1], R * 0.45, R, 0, 0, 7); c.stroke();
    }
    if (d.port) {
      const n = L.gas ? 2 : 3;
      for (let q = 0; q < n; q++) {
        const a = q * 2.1 + 0.4, px = p[0] + Math.cos(a) * R * 0.45, py = p[1] + Math.sin(a) * R * 0.45, pr = R * 0.26;
        c.strokeStyle = "rgba(255,154,60,.85)"; c.lineWidth = 1.4; c.beginPath(); c.arc(px, py, pr, 0, 7); c.stroke();
        c.beginPath(); c.moveTo(px - pr * 0.4, py - pr * 0.45); c.lineTo(px - pr * 0.4, py + pr * 0.45); c.moveTo(px + pr * 0.4, py - pr * 0.45); c.lineTo(px + pr * 0.4, py + pr * 0.45); c.moveTo(px - pr * 0.4, py); c.lineTo(px + pr * 0.4, py); c.stroke();
      }
    } else {
      const n = 10 + ((r() * 10) | 0);
      for (let q = 0; q < n; q++) {
        const a = r() * 6.283, dd = Math.sqrt(r()) * R * 0.7, w = (5 + r() * 12) * k, h = (5 + r() * 12) * k;
        c.fillStyle = d.color; c.globalAlpha = 0.35 + r() * 0.4; c.fillRect(p[0] + Math.cos(a) * dd - w / 2, p[1] + Math.sin(a) * dd - h / 2, w, h);
      }
      c.globalAlpha = 1;
      const lt = 0.5 + 0.5 * Math.sin(t * 1.5 + i); c.fillStyle = `rgba(255,220,160,${0.25 + lt * 0.3})`; c.beginPath(); c.arc(p[0], p[1], 2.2 * k + 1, 0, 7); c.fill();
    }
  }
  edge(c, e, t) {
    const A = this.L.ds[e.a], B = this.L.ds[e.b], k = this.cam.k, a = this.toS(A.x, A.y), b = this.toS(B.x, B.y), col = SETTLEMENT_TRANSIT[e.mode].c;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const s0 = [a[0] + ux * A.rad * k * 0.9, a[1] + uy * A.rad * k * 0.9], s1 = [b[0] - ux * B.rad * k * 0.9, b[1] - uy * B.rad * k * 0.9];
    if (e.mode === "shuttle") {
      const mx = (s0[0] + s1[0]) / 2 - uy * L * e.bend, my = (s0[1] + s1[1]) / 2 + ux * L * e.bend;
      c.strokeStyle = "rgba(199,164,255,.85)"; c.lineWidth = 1.6; c.setLineDash([1.5, 6]); c.lineCap = "round";
      c.beginPath(); c.moveTo(s0[0], s0[1]); c.quadraticCurveTo(mx, my, s1[0], s1[1]); c.stroke(); c.setLineDash([]); c.lineCap = "butt";
      [s0, s1].forEach((q) => { c.strokeStyle = "rgba(199,164,255,.9)"; c.lineWidth = 1.4; c.beginPath(); c.arc(q[0], q[1], 7, 0, 7); c.stroke(); });
      const f = (t * 0.18 + e.ph) % 1, qx = (1 - f) * (1 - f) * s0[0] + 2 * (1 - f) * f * mx + f * f * s1[0], qy = (1 - f) * (1 - f) * s0[1] + 2 * (1 - f) * f * my + f * f * s1[1];
      c.fillStyle = "#e6d6ff"; c.shadowColor = col; c.shadowBlur = 10; c.beginPath(); c.arc(qx, qy, 3.2, 0, 7); c.fill(); c.shadowBlur = 0;
      return;
    }
    if (e.mode === "rail") {
      c.strokeStyle = "rgba(95,211,243,.25)"; c.lineWidth = 6; c.beginPath(); c.moveTo(s0[0], s0[1]); c.lineTo(s1[0], s1[1]); c.stroke();
      c.strokeStyle = col; c.lineWidth = 1.4; const nx = -uy * 1.8, ny = ux * 1.8;
      c.beginPath(); c.moveTo(s0[0] + nx, s0[1] + ny); c.lineTo(s1[0] + nx, s1[1] + ny); c.moveTo(s0[0] - nx, s0[1] - ny); c.lineTo(s1[0] - nx, s1[1] - ny); c.stroke();
      const f = (t * 0.12 + e.ph) % 1, g = f < 0.5 ? f * 2 : 2 - f * 2, x = s0[0] + (s1[0] - s0[0]) * g, y = s0[1] + (s1[1] - s0[1]) * g;
      c.save(); c.translate(x, y); c.rotate(Math.atan2(uy, ux)); c.fillStyle = "#dff8ff"; c.shadowColor = col; c.shadowBlur = 8; c.fillRect(-9, -2.5, 18, 5); c.restore(); c.shadowBlur = 0;
      return;
    }
    if (e.secret) { c.strokeStyle = "rgba(120,255,160,.45)"; c.lineWidth = 1.2; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); return; }
    // underground (x-ray view)
    c.strokeStyle = "rgba(255,184,102,.14)"; c.lineWidth = 8; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    c.strokeStyle = "rgba(255,184,102,.85)"; c.lineWidth = 1.6; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]);
    const f = (t * 0.1 + e.ph) % 1, g = f < 0.5 ? f * 2 : 2 - f * 2; c.fillStyle = "#ffd9a8"; c.beginPath(); c.arc(a[0] + dx * g, a[1] + dy * g, 2.6, 0, 7); c.fill();
  }
}
