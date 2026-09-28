import { hash, rng, cap, noiseGen, mixc, allocModes, mst, TRANSIT, fitCanvas, attachPointer, startLoop } from "./common.js";

// Planet surface view (from the handoff's Planet/MPlanet mockups): a
// procedural globe seeded by the body slug, surface sites (authored, or
// generated — the data has no surface coordinates for most bodies),
// transit links between them, and ring/orbital stations.
const TW = 512, TH = 256;

function v3(la, lo) { return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; }
const isEcu = (b) => (b.t || []).includes("ecumenopolis");

// Surface sites for a body — pure and deterministic, so the settlement view
// can rebuild the exact same list from just the URL. Authored `sites` win;
// otherwise settled bodies get a capital + settlements, extraction bodies
// get per-resource sites, gas giants get floating cities / harvesters.
export function planetSites(b) {
  const seed = hash(b.s), k = b.k, fb = noiseGen(seed);
  const settled = b.st === "colonized" || !!b.pp, ecu = isEcu(b), gas = k === "gas giant";
  const heightAt = (x, y) => {
    const lat = (0.5 - (y + 0.5) / TH) * Math.PI, lon = ((x + 0.5) / TW) * Math.PI * 2, cl0 = Math.cos(lat);
    return fb(cl0 * Math.cos(lon) * 1.6 + 11, Math.sin(lat) * 1.6, cl0 * Math.sin(lon) * 1.6, 6);
  };
  const rnd = rng(seed ^ 0x51ed), sites = [];
  const land = k === "terrestrial world" && !ecu;
  const place = () => {
    for (let n = 0; n < 60; n++) {
      const la = (rnd() * 1.7 - 0.85) * Math.PI / 2, lo = rnd() * Math.PI * 2;
      if (!land) return [la, lo];
      const y = Math.min(TH - 1, ((0.5 - la / Math.PI) * TH) | 0), x = (((lo / (Math.PI * 2)) * TW) | 0) % TW;
      if (heightAt(x, y) > 0.52) return [la, lo];
    }
    return [0, rnd() * 6.28];
  };
  const code = b.s.split("-").map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  if (b.sites && b.sites.length) {
    b.sites.forEach((x) => sites.push({ id: x.slug, name: x.name, type: x.type || "", color: x.kind === "government" ? "#ffd27a" : "#5fd3f3", lat: (x.lat * Math.PI) / 180, lon: (x.lon * Math.PI) / 180, def: x }));
  } else if (settled) {
    const p = place();
    sites.push({ id: "cap", name: gas ? "Cloud City Prime" : "Capital Port", type: gas ? "Floating city · starport" : "Starport · settlement", color: "#5fd3f3", lat: p[0], lon: p[1] });
    const n = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < n; i++) { const q = place(); sites.push({ id: "set" + i, name: (gas ? "Aerostat " : "Settlement ") + code + "-" + (i + 1), type: gas ? "Floating habitat" : "Settlement", color: "#9fe6f8", lat: q[0], lon: q[1] }); }
  }
  if (b.st === "extraction" && !(b.sites && b.sites.length)) {
    const res = b.res && b.res.length ? b.res : ["raw materials"];
    res.forEach((r, ri) => {
      const n = 1 + ((rnd() * 2) | 0);
      for (let i = 0; i < n; i++) { const q = place(); sites.push({ id: "x" + ri + i, name: cap(r) + (gas ? " Harvester " : " Extraction ") + String.fromCharCode(65 + i), type: gas ? "Floating harvester" : "Automated extraction", color: "#ffb866", lat: q[0], lon: q[1], res: r }); }
    });
  }
  return sites;
}

export function planetNet(b, sites) {
  const seed = hash(b.s);
  const gd = (a, c) => { const va = v3(a.lat, a.lon), vb = v3(c.lat, c.lon); return Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))); };
  const E = mst(sites, gd);
  if (sites.length > 4) {
    let best = null;
    for (let a = 0; a < sites.length; a++) for (let c = a + 1; c < sites.length; c++) {
      if (E.find((e) => (e.a === a && e.b === c) || (e.a === c && e.b === a))) continue;
      const d = gd(sites[a], sites[c]); if (!best || d < best.d) best = { a, b: c, d };
    }
    if (best) E.push(best);
  }
  const modes = allocModes(b.k, E.length, rng(seed ^ 0x7a11));
  return E.map((e, i) => ({ a: e.a, b: e.b, om: e.d, mode: modes[i], ph: rng(seed + i)() }));
}

function buildTexture(b) {
  const seed = hash(b.s), fb = noiseGen(seed), fc = noiseGen(seed ^ 0x9e3779b9), k = b.k;
  const tex = new Uint8ClampedArray(TW * TH * 3), cl = new Uint8ClampedArray(TW * TH), lights = new Uint8ClampedArray(TW * TH);
  const settled = b.st === "colonized" || b.pp, ecu = isEcu(b);
  for (let y = 0; y < TH; y++) {
    const lat = (0.5 - (y + 0.5) / TH) * Math.PI, cl0 = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < TW; x++) {
      const lon = ((x + 0.5) / TW) * Math.PI * 2, px = cl0 * Math.cos(lon), py = sl, pz = cl0 * Math.sin(lon);
      const i = y * TW + x; let col;
      if (k === "gas giant") {
        const turb = fb(px * 2.2 + 7, py * 2.2, pz * 2.2, 4); const band = Math.sin(py * 14 + turb * 6) * 0.5 + 0.5, band2 = Math.sin(py * 37 + turb * 9) * 0.5 + 0.5;
        col = mixc(mixc([196, 142, 92], [236, 208, 160], band), [150, 96, 70], band2 * 0.35);
        const storm = fb(px * 6, py * 6 + 3, pz * 6, 3); if (storm > 0.68) col = mixc(col, [205, 110, 70], (storm - 0.68) * 4);
      } else {
        const h = fb(px * 1.6 + 11, py * 1.6, pz * 1.6, 6), d = fb(px * 8, py * 8, pz * 8, 3);
        if (ecu) { // city-planet: continuous urban grid, lit everywhere at night
          const gx = Math.abs(((x / TW) * 96) % 1 - 0.5), gy = Math.abs(((y / TH) * 48) % 1 - 0.5), road = gx > 0.44 || gy > 0.44;
          const big = Math.abs(((x / TW) * 12) % 1 - 0.5) > 0.47 || Math.abs(((y / TH) * 6) % 1 - 0.5) > 0.47;
          col = mixc([62, 64, 72], [118, 112, 104], h); col = mixc(col, [150, 138, 110], d * 0.5);
          if (road) col = mixc(col, [190, 170, 120], 0.35); if (big) col = mixc(col, [235, 210, 150], 0.6);
          if (h < 0.33) col = mixc([18, 40, 60], [30, 60, 80], h * 2);
          if (h >= 0.33 && (big || (road && fc(px * 30, py * 30, pz * 30, 1) > 0.45))) lights[i] = big ? 200 : 110;
        } else if (k === "terrestrial world") {
          const sea = 0.5;
          if (h < sea) col = mixc([10, 34, 66], [26, 82, 118], (h - 0.25) / 0.25);
          else { const e = (h - sea) / 0.35; col = mixc(mixc([58, 112, 62], [122, 110, 72], e * 1.4), [190, 180, 165], (e - 0.7) * 3); col = mixc(col, [150, 130, 90], d * 0.3); }
          if (Math.abs(sl) > 0.86 + (d - 0.5) * 0.1) col = mixc(col, [236, 242, 248], 0.9);
          if (settled && h > sea + 0.02 && h < sea + 0.2 && fc(px * 26, py * 26, pz * 26, 2) > 0.72) lights[i] = 150;
        } else if (k === "ice world") {
          col = mixc([150, 190, 214], [240, 246, 250], h * 1.3 - 0.2); col = mixc(col, [110, 150, 190], Math.max(0, d - 0.6) * 2.5);
        } else {
          const base = k === "moon" ? [128, 124, 118] : [150, 122, 98];
          col = mixc(mixc(base, [70, 60, 52], 1 - h * 1.4), [200, 190, 178], Math.max(0, h - 0.62) * 3);
          const cr = fc(px * 10, py * 10, pz * 10, 2); if (cr > 0.7) col = mixc(col, [60, 54, 50], (cr - 0.7) * 3);
        }
        if (b.st === "extraction" && !settled && fc(px * 22, py * 22, pz * 22, 2) > 0.7 && h > 0.45) lights[i] = 180;
      }
      tex[i * 3] = col[0]; tex[i * 3 + 1] = col[1]; tex[i * 3 + 2] = col[2];
      if (k === "terrestrial world") { const c2 = fc(px * 3 + 2, py * 5, pz * 3, 5); cl[i] = Math.max(0, Math.min(255, (c2 - 0.52) * 900)); }
    }
  }
  return { tex, cl, lights, atm: k === "terrestrial world" ? [110, 170, 255] : k === "gas giant" ? [240, 200, 150] : k === "ice world" ? [180, 220, 255] : null };
}

// opts: { mobile, onSite(id), onHover(bool), layout(W,H) -> {cx, cy, R} }
export class PlanetView {
  constructor(cv, sys, body, opts = {}) {
    this.cv = cv; this.o = opts;
    this.flags = { grid: true, clouds: true, sites: true, transit: true, spin: true };
    this.rot = { lon: 0, lat: 0.25 }; this.goal = null; this.t = 0; this.last = performance.now(); this.markers = []; this.site = null;
    this.setBody(sys, body);
    this.input = attachPointer(cv, {
      onDrag: (dx, dy) => { this.goal = null; this.rot.lon -= dx / this.R; this.rot.lat = Math.max(-1.4, Math.min(1.4, this.rot.lat + dy / this.R)); },
      onHover: (p) => { const h = p ? this.markAt(p[0], p[1]) : null; this.o.onHover?.(h != null); },
      onTap: (p) => { const m = this.markAt(p[0], p[1]); if (m != null) this.o.onSite?.(m); },
    });
    this.stop = startLoop(() => this.frame());
  }
  destroy() { this.stop(); this.input.detach(); }
  setFlag(k, v) { this.flags[k] = v; }
  setBody(sys, b) {
    this.body = b; this.T = buildTexture(b);
    this.sites = planetSites(b); this.net = planetNet(b, this.sites);
    this.stations = sys.b.filter((x) => x.p === b.s && x.k === "orbital station");
    this.site = null; this.off = null;
  }
  focusSite(id) {
    const s = this.sites.find((x) => x.id === id); this.site = id; if (!s) return;
    let lo = s.lon; while (lo - this.rot.lon > Math.PI) lo -= Math.PI * 2; while (lo - this.rot.lon < -Math.PI) lo += Math.PI * 2;
    this.goal = { lon: lo, lat: s.lat };
  }
  markAt(x, y) { const lim = this.o.mobile ? 24 : 14; for (const m of this.markers) if (Math.hypot(m.x - x, m.y - y) < lim) return m.id; return null; }
  proj(la, lo) {
    const dl = lo - this.rot.lon, x = Math.cos(la) * Math.sin(dl), yp = Math.sin(la), zp = Math.cos(la) * Math.cos(dl), c = Math.cos(this.rot.lat), s = Math.sin(this.rot.lat);
    const y = yp * c - zp * s, z = yp * s + zp * c; return [this.CX + x * this.R, this.CY - y * this.R, z];
  }
  frame() {
    const { ctx: c, W, H } = fitCanvas(this.cv);
    const lay = this.o.layout ? this.o.layout(W, H) : { cx: W / 2, cy: H / 2, R: Math.min(W, H) / 3 };
    this.CX = lay.cx; this.CY = lay.cy; this.R = lay.R;
    const CX = this.CX, CY = this.CY, R = this.R;
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.t += dt;
    if (this.goal) { this.rot.lon += (this.goal.lon - this.rot.lon) * 0.1; this.rot.lat += (this.goal.lat - this.rot.lat) * 0.1; if (Math.abs(this.goal.lon - this.rot.lon) < 0.002) this.goal = null; }
    else if (this.flags.spin && !this.input?.dragging()) this.rot.lon += dt * 0.06;
    c.fillStyle = "#03050a"; c.fillRect(0, 0, W, H);
    const rs = rng(3); c.fillStyle = "#dfe6ff";
    for (let i = 0; i < 500; i++) { c.globalAlpha = 0.08 + rs() * 0.3; const sz = rs() < 0.1 ? 1.4 : 0.8; c.fillRect(rs() * W, rs() * H, sz, sz); }
    c.globalAlpha = 1;
    const T = this.T, st = this.stations || [];
    if (T.atm) { const g = c.createRadialGradient(CX, CY, R * 0.96, CX, CY, R * 1.14); g.addColorStop(0, `rgba(${T.atm},.45)`); g.addColorStop(1, `rgba(${T.atm},0)`); c.fillStyle = g; c.beginPath(); c.arc(CX, CY, R * 1.14, 0, 7); c.fill(); }
    this.drawOrbit(c, st, false);
    // globe raster at a fixed resolution, scaled to R
    const N = this.o.mobile ? 300 : 420;
    if (!this.off) { this.off = document.createElement("canvas"); this.off.width = N; this.off.height = N; this.octx = this.off.getContext("2d"); this.oimg = this.octx.createImageData(N, N); }
    const P = this.oimg.data, cl = Math.cos(this.rot.lat), sl = Math.sin(this.rot.lat), L = [-0.62, 0.42, 0.66], cOff = this.t * 0.012, showC = this.flags.clouds;
    for (let j = 0; j < N; j++) {
      const v = ((j + 0.5) / N) * 2 - 1;
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1, rr = u * u + v * v, o = (j * N + i) * 4;
        if (rr > 1) { P[o + 3] = 0; continue; }
        const z = Math.sqrt(1 - rr), y = -v, yp = y * cl + z * sl, zp = -y * sl + z * cl;
        const la = Math.asin(Math.max(-1, Math.min(1, yp))), lo = Math.atan2(u, zp) + this.rot.lon;
        const tx = ((((lo / (Math.PI * 2)) % 1) + 1) % 1 * TW) | 0; let ty = ((0.5 - la / Math.PI) * TH) | 0; if (ty >= TH) ty = TH - 1;
        const ti = ty * TW + tx;
        const dif = Math.max(0, u * L[0] + y * L[1] + z * L[2]), sh = 0.06 + 0.94 * Math.pow(dif, 0.85);
        let r = T.tex[ti * 3] * sh, g = T.tex[ti * 3 + 1] * sh, bb = T.tex[ti * 3 + 2] * sh;
        if (showC) { const cx2 = (tx + ((cOff * TW) | 0)) % TW, ca = T.cl[ty * TW + cx2] / 255; if (ca) { const cs = 255 * (0.05 + 0.95 * dif); r += (cs - r) * ca * 0.85; g += (cs - g) * ca * 0.85; bb += (cs - bb) * ca * 0.85; } }
        if (T.lights[ti] && dif < 0.12) { const k2 = ((0.12 - dif) / 0.12) * T.lights[ti] / 255; r += 255 * k2; g += 160 * k2; bb += 70 * k2; }
        const rim = Math.pow(1 - z, 3) * 0.5; if (T.atm) { r += T.atm[0] * rim * dif; g += T.atm[1] * rim * dif; bb += T.atm[2] * rim * dif; }
        P[o] = r; P[o + 1] = g; P[o + 2] = bb; P[o + 3] = 255;
      }
    }
    this.octx.putImageData(this.oimg, 0, 0); c.imageSmoothingEnabled = true; c.drawImage(this.off, CX - R, CY - R, R * 2, R * 2);
    if (this.flags.grid) {
      c.strokeStyle = "rgba(95,211,243,.16)"; c.lineWidth = 1;
      for (let la = -60; la <= 60; la += 30) { c.beginPath(); let pen = false; for (let lo = 0; lo <= 360; lo += 4) { const p = this.proj((la * Math.PI) / 180, (lo * Math.PI) / 180); if (p[2] > 0) { pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; } else pen = false; } c.stroke(); }
      for (let lo = 0; lo < 360; lo += 30) { c.beginPath(); let pen = false; for (let la = -90; la <= 90; la += 4) { const p = this.proj((la * Math.PI) / 180, (lo * Math.PI) / 180); if (p[2] > 0) { pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; } else pen = false; } c.stroke(); }
    }
    c.strokeStyle = "rgba(255,154,60,.35)"; c.lineWidth = 1;
    c.beginPath(); c.arc(CX, CY, R + 18, -2.6, -0.55); c.stroke(); c.beginPath(); c.arc(CX, CY, R + 18, 0.55, 2.6); c.stroke();
    this.drawNet(c, now);
    this.markers = [];
    if (this.flags.sites) {
      const sel = this.site; c.font = "500 12px Oxanium, sans-serif";
      for (const s of this.sites) {
        const p = this.proj(s.lat, s.lon); if (p[2] < 0.05) continue;
        const on = sel === s.id, a = Math.min(1, p[2] * 3);
        c.globalAlpha = a; const q = on ? 7 : 5; c.fillStyle = s.color;
        c.beginPath(); c.moveTo(p[0], p[1] - q); c.lineTo(p[0] + q, p[1]); c.lineTo(p[0], p[1] + q); c.lineTo(p[0] - q, p[1]); c.closePath(); c.fill();
        c.strokeStyle = "rgba(3,5,10,.8)"; c.lineWidth = 1.5; c.stroke();
        if (on) { const t = now / 1000; c.strokeStyle = "#ff9a3c"; c.lineWidth = 1.5; for (let k = 0; k < 4; k++) { const an = t + (k * Math.PI) / 2; c.beginPath(); c.arc(p[0], p[1], 14, an, an + 0.9); c.stroke(); } }
        if (on || p[2] > 0.35) {
          const lx = p[0] + (on ? 24 : 12), ly = p[1] - (on ? 22 : 10);
          c.strokeStyle = "rgba(236,230,218,.35)"; c.lineWidth = 1; c.beginPath(); c.moveTo(p[0] + 4, p[1] - 4); c.lineTo(lx, ly); c.lineTo(lx + 6, ly); c.stroke();
          c.fillStyle = on ? "#ffb866" : "rgba(236,230,218,.85)"; c.shadowColor = "#000"; c.shadowBlur = 4; c.fillText(s.name.toUpperCase(), lx + 10, ly + 4); c.shadowBlur = 0;
        }
        c.globalAlpha = 1; this.markers.push({ id: s.id, x: p[0], y: p[1] });
      }
    }
    this.drawOrbit(c, st, true);
  }
  drawNet(c, now) {
    if (!this.flags.transit || !this.net) return;
    const t = now / 1000, CX = this.CX, CY = this.CY, R = this.R;
    for (const e of this.net) {
      const A = this.sites[e.a], B = this.sites[e.b], va = v3(A.lat, A.lon), vb = v3(B.lat, B.lon), om = Math.max(1e-4, e.om), so = Math.sin(om);
      const at = (f) => {
        const k1 = Math.sin((1 - f) * om) / so, k2 = Math.sin(f * om) / so;
        const x = va[0] * k1 + vb[0] * k2, y = va[1] * k1 + vb[1] * k2, z = va[2] * k1 + vb[2] * k2;
        const p = this.proj(Math.asin(Math.max(-1, Math.min(1, z))), Math.atan2(y, x));
        const h = e.mode === "shuttle" ? 1 + 0.03 + 0.09 * Math.sin(Math.PI * f) * Math.min(1, om * 1.4) : 1;
        const sx = CX + (p[0] - CX) * h, sy = CY + (p[1] - CY) * h;
        return [sx, sy, p[2] > 0 || (h > 1 && Math.hypot(sx - CX, sy - CY) > R)];
      };
      const col = TRANSIT[e.mode].c; c.lineCap = "round";
      const path = (w, stroke, dash) => {
        c.strokeStyle = stroke; c.lineWidth = w; c.setLineDash(dash); c.beginPath(); let pen = false;
        for (let i = 0; i <= 40; i++) { const p = at(i / 40); if (p[2]) { pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; } else pen = false; }
        c.stroke(); c.setLineDash([]);
      };
      if (e.mode === "rail") { path(4, "rgba(95,211,243,.28)", []); path(1.6, col, []); }
      else if (e.mode === "underground") { path(3, "rgba(255,184,102,.12)", []); path(1.4, "rgba(255,184,102,.85)", [4, 4]); }
      else path(1.6, "rgba(199,164,255,.9)", [1, 5]);
      const f = (t * (e.mode === "shuttle" ? 0.12 : 0.08) + e.ph) % 1, f2 = e.mode === "shuttle" ? f : f < 0.5 ? f * 2 : 2 - f * 2, p = at(f2);
      if (p[2]) { c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 8; c.beginPath(); c.arc(p[0], p[1], e.mode === "underground" ? 2.2 : 3, 0, 7); c.fill(); c.shadowBlur = 0; }
      if (e.mode === "underground") [0, 1].forEach((q) => { const p2 = at(q); if (p2[2]) { c.strokeStyle = "rgba(255,184,102,.9)"; c.lineWidth = 1.2; c.beginPath(); c.arc(p2[0], p2[1], 8, 0, 7); c.stroke(); } });
    }
    c.lineCap = "butt";
  }
  drawOrbit(c, st, front) {
    const CX = this.CX, CY = this.CY, R = this.R;
    const rings = st.filter((x) => (x.t || []).includes("ring-station")); st = st.filter((x) => !rings.includes(x));
    rings.forEach((rs) => {
      const rx = R * 1.32, ry = R * 0.3, rot = -0.18; c.save(); c.translate(CX, CY); c.rotate(rot);
      const a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : Math.PI * 2, lw = Math.max(5, R / 29);
      c.strokeStyle = front ? "rgba(214,200,176,.85)" : "rgba(214,200,176,.45)"; c.lineWidth = lw; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a1); c.stroke();
      c.strokeStyle = "rgba(20,22,28,.9)"; c.lineWidth = lw * 0.4; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a1); c.stroke();
      c.strokeStyle = "rgba(255,210,140,.95)"; c.lineWidth = 1.4; c.setLineDash([2, 7]); c.lineDashOffset = -this.t * 6; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a1); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
      if (front) {
        c.rotate(-rot); c.font = "600 12px Oxanium, sans-serif"; c.fillStyle = "#ffc58c"; c.shadowColor = "#000"; c.shadowBlur = 4; c.textAlign = "center";
        c.fillText(rs.n.toUpperCase(), -rx + 20, 34); c.font = "500 10px Oxanium, sans-serif"; c.fillStyle = "rgba(236,230,218,.7)"; c.fillText("RING STATION", -rx + 20, 49); c.textAlign = "left"; c.shadowBlur = 0;
      }
      c.restore();
    });
    if (!st.length) return;
    const rx = R * 1.42, ry = R * 0.36, rot = -0.32, t = this.t;
    c.save(); c.translate(CX, CY); c.rotate(rot);
    c.strokeStyle = "rgba(255,154,60,.35)"; c.lineWidth = 1; c.setLineDash([4, 6]); c.beginPath(); c.ellipse(0, 0, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); c.stroke(); c.setLineDash([]);
    st.forEach((s, i) => {
      const a = t * 0.25 + i * Math.PI * 0.9, x = Math.cos(a) * rx, y = Math.sin(a) * ry, isFront = Math.sin(a) > 0; if (isFront !== front) return;
      c.fillStyle = "#ff9a3c"; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath(); c.fill();
      c.rotate(-rot); const p = [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
      c.font = "500 12px Oxanium, sans-serif"; c.fillStyle = "#ffc58c"; c.shadowColor = "#000"; c.shadowBlur = 4; c.fillText(s.n.toUpperCase(), p[0] + 12, p[1] + 4); c.shadowBlur = 0; c.rotate(rot);
    });
    c.restore();
  }
}
