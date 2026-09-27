import { KCOL, starColor, hash, rng, short, fitCanvas, attachPointer, startLoop, reticle } from "./common.js";

// System view (from the handoff's Orrery/MOrrery mockups): a tilted,
// log-scaled "realistic" orrery (drag to orbit, paused by default) and an
// Elite-style schematic — horizontal spine on desktop, vertical on mobile.
//
// opts: { mobile, onSelect(id|null), onHover(bool), layout(W,H) -> {cx, cy, extent} }
function schemR(b) {
  if (b.k === "asteroid belt") return 16;
  if ((b.t || []).includes("ring-station")) return 9;
  if (b.k === "orbital station") return 6;
  const r = Math.max(9, (Math.log10(b.r || 800) - 2) * 15);
  return b.k === "moon" ? Math.max(4.5, r * 0.45) : r;
}

export class SystemView {
  constructor(cv, sys, opts = {}) {
    this.cv = cv; this.o = opts; this.mode = "real"; this.playing = false; this.sel = null; this.hover = null;
    this.view = { yaw: 0, tilt: 0.42, z: 1 }; this.goalZ = 1; this.simT = 0; this.last = performance.now(); this.screen = [];
    this.sx = 0; this.sy = 0; this.sz = 1; this.goalSZ = 1;
    this.setSystem(sys);
    this.input = attachPointer(cv, {
      onWheel: (f) => this.zoomBy(f),
      onPinch: (f) => { if (this.mode === "schem") this.goalSZ = this.sz = this.clampSZ(this.sz * f); else this.goalZ = this.view.z = Math.max(0.5, Math.min(4, this.view.z * f)); },
      onDrag: (dx, dy) => {
        if (this.mode === "schem") {
          if (this.o.mobile) this.sy = Math.min(0, Math.max(-(this.schemH || 0) + 420, this.sy + dy));
          else this.sx += dx;
          return;
        }
        this.view.yaw += dx * 0.006; this.view.tilt = Math.max(0.12, Math.min(1, this.view.tilt + dy * 0.003));
      },
      onHover: (p) => { const h = p ? this.pickAt(p[0], p[1]) : null; if (h !== this.hover) { this.hover = h; this.o.onHover?.(!!h); } },
      onTap: (p) => { const id = this.pickAt(p[0], p[1]); if (id || !this.o.mobile) this.o.onSelect?.(id); },
    });
    this.stop = startLoop(() => this.frame());
  }
  destroy() { this.stop(); this.input.detach(); }
  setSel(id) { this.sel = id; }
  setMode(m) { this.mode = m; }
  setPlaying(v) { this.playing = v; }
  clampSZ(v) { return Math.max(this.o.mobile ? 0.5 : 0.4, Math.min(this.o.mobile ? 2.2 : 2.5, v)); }
  zoomBy(f) { if (this.mode === "schem") this.goalSZ = this.clampSZ(this.goalSZ * f); else this.goalZ = Math.max(0.5, Math.min(4, this.goalZ * f)); }
  zoomIn() { this.zoomBy(this.mode === "schem" ? 1.3 : 1.4); }
  zoomOut() { this.zoomBy(this.mode === "schem" ? 1 / 1.3 : 1 / 1.4); }

  setSystem(s) {
    const B = s.b, kids = {};
    B.forEach((b) => { if (b.p) (kids[b.p] = kids[b.p] || []).push(b); });
    const prim = B.filter((b) => !b.p).sort((a, b) => (a.au || 0) - (b.au || 0));
    const aus = prim.map((b) => b.au).filter(Boolean).concat(prim.map((b) => b.auo).filter(Boolean));
    const lo = Math.log10(Math.min(...(aus.length ? aus : [0.1])) * 0.7), hi = Math.log10(Math.max(...(aus.length ? aus : [10])));
    this.L = { s, prim, kids, lo, hi };
    let w = 150 + 95 * 2 + 50;
    prim.forEach((b) => { w += schemR(b) * 2 + 46 + (b.k === "gas giant" ? 24 : 0); });
    this.schemW = w; this.sx = 0; this.sy = 0;
    this.goalSZ = this.sz = this.o.mobile ? 1 : Math.max(0.5, Math.min(1.15, (this.cv.clientWidth * 0.7) / w));
  }
  layout(W, H) {
    return this.o.layout ? this.o.layout(W, H) : { cx: W / 2, cy: H / 2, extent: Math.min(W, H) / 2 - 60 };
  }
  orbitR(au) { const L = this.L; const f = (Math.log10(au) - L.lo) / Math.max(0.3, L.hi - L.lo); return (70 + f * 300) * this.u * this.view.z; }
  bodyR(b) {
    if (b.k === "orbital station") return 3.2;
    let px = (Math.log10(b.r || 800) - 2) * 2.9;
    px = b.k === "moon" ? Math.max(1.8, px * 0.7) : Math.max(3.2, px);
    return px * Math.sqrt(this.view.z);
  }
  proj(x, y) { const v = this.view, c = Math.cos(v.yaw), s = Math.sin(v.yaw), rx = x * c - y * s, ry = x * s + y * c; return [this.CX + rx, this.CY + ry * v.tilt, ry]; }
  pickAt(x, y) {
    let best = null, bd = 1e9; const min = this.o.mobile ? 22 : 16;
    for (const p of this.screen) { const dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy, lim = Math.pow(Math.max(min, (p.r || 0) + 6), 2); if (d < lim && d < bd) { bd = d; best = p.id; } }
    return best;
  }

  frame() {
    const { ctx: c, W, H } = fitCanvas(this.cv);
    const lay = this.layout(W, H);
    this.CX = lay.cx; this.CY = lay.cy; this.u = Math.max(0.3, lay.extent / 370);
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.playing && this.mode === "real") this.simT += dt; // 1 day per second
    this.view.z += (this.goalZ - this.view.z) * 0.15;
    const CX = this.CX, CY = this.CY;
    c.fillStyle = "#03050a"; c.fillRect(0, 0, W, H);
    if (this.mode === "schem") { this.sz += (this.goalSZ - this.sz) * 0.15; if (this.o.mobile) this.frameSchemV(c, now, W, H); else this.frameSchem(c, now, W, H); return; }
    const g0 = c.createRadialGradient(CX, CY, 0, CX, CY, 700); g0.addColorStop(0, "rgba(40,60,110,.22)"); g0.addColorStop(1, "rgba(3,5,10,0)"); c.fillStyle = g0; c.fillRect(0, 0, W, H);
    const L = this.L, s = L.s, t = this.simT, sel = this.sel, hov = this.hover, v = this.view, u = this.u;
    c.strokeStyle = "rgba(95,211,243,.06)"; c.lineWidth = 1;
    for (let i = 1; i <= 6; i++) { c.beginPath(); c.ellipse(CX, CY, i * 70 * u * v.z, i * 70 * u * v.z * v.tilt, 0, 0, Math.PI * 2); c.stroke(); }
    for (let a = 0; a < 12; a++) { const p = this.proj(Math.cos((a * Math.PI) / 6) * 420 * u * v.z, Math.sin((a * Math.PI) / 6) * 420 * u * v.z); c.beginPath(); c.moveTo(CX, CY); c.lineTo(p[0], p[1]); c.stroke(); }
    const items = []; this.screen = [];
    const add = (b, x, y, depth, r) => { items.push({ b, x, y, depth, r }); this.screen.push({ id: b.s, x, y }); };
    for (const b of L.prim) {
      if (b.k === "asteroid belt") {
        const r0 = this.orbitR(b.au || 1), r1 = b.auo ? this.orbitR(b.auo) : r0 + 14 * v.z; const on = sel === b.s || hov === b.s;
        c.fillStyle = on ? "rgba(255,190,120,.55)" : "rgba(190,175,150,.28)";
        for (let i = 0; i < 260; i++) { const a = i * 2.399 + t * 0.002, rr = r0 + (((i * 37) % 100) / 100) * (r1 - r0); const p = this.proj(Math.cos(a) * rr, Math.sin(a) * rr); c.fillRect(p[0], p[1], 1.2, 1.2); }
        const pa = this.proj(0, -(r0 + r1) / 2); this.screen.push({ id: b.s, x: pa[0], y: pa[1] }); items.push({ b, x: pa[0], y: pa[1], depth: -1e9, r: 0 });
        (L.kids[b.s] || []).forEach((m, j) => { const rr = (r0 + r1) / 2, ma = (((m.a || 0) + (360 * t) / (400 + j * 90)) * Math.PI) / 180; const q = this.proj(Math.cos(ma) * rr, Math.sin(ma) * rr); add(m, q[0], q[1], q[2], this.bodyR(m)); });
        continue;
      }
      const R = this.orbitR(b.au || 0.1); const on = sel === b.s;
      c.strokeStyle = on ? "rgba(255,154,60,.75)" : "rgba(95,211,243,.22)"; c.lineWidth = on ? 1.4 : 1;
      c.beginPath(); c.ellipse(CX, CY, R, R * v.tilt, 0, 0, Math.PI * 2); c.stroke();
      const ang = (((b.a || 0) + (b.pd ? (360 * t) / b.pd : 0)) * Math.PI) / 180; const p = this.proj(Math.cos(ang) * R, Math.sin(ang) * R);
      const br = this.bodyR(b); add(b, p[0], p[1], p[2], br);
      (L.kids[b.s] || []).forEach((m, j) => {
        const lr = br + 8 * Math.sqrt(v.z) + j * 7 * Math.sqrt(v.z);
        if (on || v.z > 1.6) { c.strokeStyle = "rgba(95,211,243,.14)"; c.lineWidth = 1; c.beginPath(); c.ellipse(p[0], p[1], lr, lr * v.tilt, 0, 0, Math.PI * 2); c.stroke(); }
        if ((m.t || []).includes("ring-station")) {
          const rr = br + 5 * Math.sqrt(v.z); c.strokeStyle = sel === m.s ? "#ffb866" : "rgba(214,200,176,.85)"; c.lineWidth = 2.2;
          c.beginPath(); c.ellipse(p[0], p[1], rr * 1.25, rr * 1.25 * v.tilt, 0, 0, Math.PI * 2); c.stroke();
          this.screen.push({ id: m.s, x: p[0] + rr * 1.25, y: p[1], r: 6 }); return;
        }
        const per = m.k === "orbital station" ? 1.2 : 4 + j * 3.5; const ma = (((m.a || 0) + (360 * t) / per) * Math.PI) / 180;
        const q = this.proj(Math.cos(ma) * lr, Math.sin(ma) * lr); add(m, p[0] + q[0] - CX, p[1] + q[1] - CY, p[2] + (q[2] || 0), this.bodyR(m));
      });
    }
    items.push({ star: true, depth: 0 });
    items.sort((a, b) => a.depth - b.depth);
    const sc = starColor(s.st), bin = s.st.includes("binary");
    for (const it of items) {
      if (it.star) {
        const sr = 16 * Math.max(0.69, Math.min(1, u)) * Math.sqrt(v.z);
        const g = c.createRadialGradient(CX, CY, 0, CX, CY, sr * 6); g.addColorStop(0, sc); g.addColorStop(0.18, sc); g.addColorStop(0.3, "rgba(255,210,150,.25)"); g.addColorStop(1, "rgba(255,200,140,0)");
        c.fillStyle = g; c.fillRect(CX - sr * 6, CY - sr * 6, sr * 12, sr * 12);
        if (bin) { const a = t * 0.05; c.fillStyle = "#fff"; c.beginPath(); c.arc(CX + Math.cos(a) * sr * 0.9, CY + Math.sin(a) * sr * 0.9 * v.tilt, sr * 0.55, 0, 7); c.fill(); c.beginPath(); c.arc(CX - Math.cos(a) * sr * 0.9, CY - Math.sin(a) * sr * 0.9 * v.tilt, sr * 0.4, 0, 7); c.fill(); }
        else { c.fillStyle = "#fffaf0"; c.beginPath(); c.arc(CX, CY, sr * 0.75, 0, 7); c.fill(); }
        this.screen.push({ id: "__star", x: CX, y: CY, r: sr });
        if (sel === "__star") reticle(c, CX, CY, sr + 8, now / 1000);
        continue;
      }
      const b = it.b; if (it.r === 0) continue;
      if (b.k === "orbital station") { const q = it.r + 1; c.fillStyle = "#ff9a3c"; c.beginPath(); c.moveTo(it.x, it.y - q); c.lineTo(it.x + q, it.y); c.lineTo(it.x, it.y + q); c.lineTo(it.x - q, it.y); c.closePath(); c.fill(); }
      else {
        const col = KCOL[b.k] || "#aaa", dx = CX - it.x, dy = CY - it.y, dl = Math.hypot(dx, dy) || 1, lx = it.x + (dx / dl) * it.r * 0.5, ly = it.y + (dy / dl) * it.r * 0.5;
        const g = c.createRadialGradient(lx, ly, it.r * 0.1, it.x, it.y, it.r * 1.1); g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, col); g.addColorStop(1, "#07090e");
        c.fillStyle = g; c.beginPath(); c.arc(it.x, it.y, it.r, 0, 7); c.fill();
        if (b.k === "gas giant") { c.strokeStyle = "rgba(230,200,150,.5)"; c.lineWidth = 1; c.beginPath(); c.ellipse(it.x, it.y, it.r * 1.9, it.r * 0.55, -0.25, 0, Math.PI * 2); c.stroke(); }
        if (b.st === "colonized") { c.strokeStyle = "rgba(95,211,243,.8)"; c.lineWidth = 1; c.beginPath(); c.arc(it.x, it.y, it.r + 3, 0, 7); c.stroke(); }
        if (b.st === "extraction") { c.fillStyle = "#ffb866"; c.fillRect(it.x + it.r * 0.7, it.y - it.r * 0.7 - 3, 3, 3); }
      }
      if (hov === b.s && sel !== b.s) { c.strokeStyle = "rgba(95,211,243,.9)"; c.lineWidth = 1.2; c.beginPath(); c.arc(it.x, it.y, it.r + 7, 0, 7); c.stroke(); }
      if (sel === b.s) reticle(c, it.x, it.y, it.r + 7, now / 1000);
    }
    c.font = "500 12px Oxanium, sans-serif"; c.textAlign = "center";
    for (const it of items) {
      if (it.star || !it.b || it.b.p) continue; const b = it.b, on = sel === b.s;
      c.fillStyle = on ? "#ffb866" : "rgba(236,230,218,.72)"; c.shadowColor = "#000"; c.shadowBlur = 4;
      c.fillText(short(b.n, s.n).toUpperCase(), it.x, it.y + it.r + 16); c.shadowBlur = 0;
    }
    if (sel) { const it = items.find((i) => i.b && i.b.s === sel && i.b.p); if (it) { c.fillStyle = "#ffb866"; c.fillText(short(it.b.n, s.n).toUpperCase(), it.x, it.y - it.r - 12); } }
    c.textAlign = "left";
  }

  sphere(c, b, x, y, r) {
    const col = KCOL[b.k] || "#aaa";
    const gg = c.createRadialGradient(x - r * 0.45, y - r * 0.35, r * 0.1, x, y, r * 1.05); gg.addColorStop(0, "#fff8ee"); gg.addColorStop(0.3, col); gg.addColorStop(1, "#0a0c10");
    c.fillStyle = gg; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    if (b.k === "gas giant") {
      c.save(); c.beginPath(); c.arc(x, y, r, 0, 7); c.clip(); c.strokeStyle = "rgba(120,70,30,.28)";
      for (let i = -4; i <= 4; i++) { c.lineWidth = r * 0.09; c.beginPath(); c.moveTo(x - r, y + i * r * 0.22); c.lineTo(x + r, y + i * r * 0.22 + r * 0.03); c.stroke(); }
      c.restore();
    }
  }
  ringDraw(c, x, y, r, front) { c.strokeStyle = "rgba(225,210,185,.75)"; c.lineWidth = Math.max(2, r * 0.16); c.beginPath(); c.ellipse(x, y, r * 1.75, r * 0.38, -0.12, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); c.stroke(); }
  starDisc(c, x, y, SR, z, dots) {
    const sc = starColor(this.L.s.st);
    const g = c.createRadialGradient(x, y, SR * 0.6, x, y, SR * 1.7); g.addColorStop(0, "rgba(255,150,80,.45)"); g.addColorStop(1, "rgba(255,120,60,0)"); c.fillStyle = g; c.fillRect(x - SR * 1.8, y - SR * 1.8, SR * 3.6, SR * 3.6);
    const g2 = c.createRadialGradient(x - SR * 0.2, y - SR * 0.2, SR * 0.1, x, y, SR); g2.addColorStop(0, "#fff6e0"); g2.addColorStop(0.35, sc); g2.addColorStop(1, "#b8431a"); c.fillStyle = g2; c.beginPath(); c.arc(x, y, SR, 0, 7); c.fill();
    const rg = rng(5); c.fillStyle = "rgba(255,240,200,.35)";
    for (let i = 0; i < dots; i++) { const a = rg() * 6.283, d = Math.sqrt(rg()) * SR * 0.95; c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rg() * 2.2 * z, 0, 7); c.fill(); }
  }
  satellite(c, m, x, y, mr) {
    c.fillStyle = "#04060b"; c.beginPath(); c.arc(x, y, mr + 4, 0, 7); c.fill();
    c.strokeStyle = "rgba(236,230,218,.5)"; c.lineWidth = 1; c.beginPath(); c.arc(x, y, mr + 4, 0, 7); c.stroke();
    if ((m.t || []).includes("ring-station")) { c.strokeStyle = "#e6d6bd"; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y, mr + 1, (mr + 1) * 0.45, -0.2, 0, Math.PI * 2); c.stroke(); c.fillStyle = "#ff9a3c"; c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
    else if (m.k === "orbital station") { c.fillStyle = "#ff9a3c"; c.beginPath(); c.moveTo(x, y - mr); c.lineTo(x + mr, y); c.lineTo(x, y + mr); c.lineTo(x - mr, y); c.closePath(); c.fill(); }
    else this.sphere(c, m, x, y, mr);
    if (m.st === "colonized") { c.strokeStyle = "rgba(95,211,243,.9)"; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, mr + 7, 0, 7); c.stroke(); }
    else if (m.st === "extraction") { c.strokeStyle = "rgba(255,184,102,.8)"; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, mr + 7, 0, 7); c.stroke(); }
  }
  schemGround(c, W, H, gs, ox, oy, n) {
    c.fillStyle = "#04060b"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(120,140,170,.07)"; c.lineWidth = 1; c.beginPath();
    for (let x = ((ox % gs) + gs) % gs; x < W; x += gs) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = ((oy % gs) + gs) % gs; y < H; y += gs) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    const rs = rng(11); c.fillStyle = "#dfe6ff";
    for (let i = 0; i < n; i++) { c.globalAlpha = 0.05 + rs() * 0.25; c.fillRect(rs() * W, rs() * H, 1, 1); }
    c.globalAlpha = 1;
  }
  frameSchem(c, now, W, H) {
    const L = this.L, s = L.s, sel = this.sel, hov = this.hover, z = this.sz, t = now / 1000;
    const BY = Math.min(330, H * 0.37);
    this.schemGround(c, W, H, 48 * z, this.sx, BY, 260);
    this.screen = [];
    const x0 = this.sx + 60 + 95 * z, SR = 95 * z;
    let cur = x0 + SR + 50 * z; const pos = [];
    for (const b of L.prim) { const r = schemR(b) * z, ring = b.k === "gas giant" ? 12 * z : 0; const cx = cur + r + ring; pos.push({ b, cx, r }); cur = cx + r + ring + 46 * z; }
    const last = pos.length ? pos[pos.length - 1].cx : x0;
    c.strokeStyle = "rgba(236,230,218,.35)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x0, BY); c.lineTo(last, BY); c.stroke();
    this.starDisc(c, x0, BY, SR, z, 140);
    this.screen.push({ id: "__star", x: x0, y: BY, r: SR });
    if (sel === "__star") reticle(c, x0, BY, SR + 10, t);
    c.font = "500 12px Oxanium, sans-serif"; c.textAlign = "center";
    for (const p of pos) {
      const b = p.b, x = p.cx, r = p.r, on = sel === b.s, ks = L.kids[b.s] || [];
      if (ks.length) { const y1 = BY + r + 26 * z + (ks.length - 1) * 38 * z; c.strokeStyle = "rgba(236,230,218,.45)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, BY + r + (b.k === "gas giant" ? 10 * z : 6 * z)); c.lineTo(x, y1); c.stroke(); }
      if (b.k === "asteroid belt") {
        const rr = rng(hash(b.s)); c.fillStyle = on ? "#ffd3a0" : "#cbbfae";
        for (let i = 0; i < 46; i++) { const dx = (rr() - 0.5) * r * 1.3, dy = (rr() - 0.5) * r * 4.2, sz = (0.8 + rr() * 2) * z; c.globalAlpha = 0.5 + rr() * 0.5; c.fillRect(x + dx, BY + dy, sz, sz); }
        c.globalAlpha = 1;
      } else {
        if (b.k === "gas giant") this.ringDraw(c, x, BY, r, false);
        this.sphere(c, b, x, BY, r);
        if (b.k === "gas giant") this.ringDraw(c, x, BY, r, true);
        if (b.st === "colonized") { c.strokeStyle = "rgba(95,211,243,.85)"; c.lineWidth = 1.5; c.beginPath(); c.arc(x, BY, r + 5, 0, 7); c.stroke(); }
      }
      this.screen.push({ id: b.s, x, y: BY, r: Math.max(r, 14) });
      c.font = "500 12px Oxanium, sans-serif"; c.textAlign = "center";
      c.fillStyle = on ? "#ffb866" : "rgba(236,230,218,.75)"; c.fillText(short(b.n, s.n).toUpperCase(), x, BY - r * (b.k === "asteroid belt" ? 2.2 : 1) - 14 * z);
      if (b.st === "extraction") { c.fillStyle = "#ffb866"; c.fillText("◆", x, BY - r * (b.k === "asteroid belt" ? 2.2 : 1) - 28 * z); }
      if (hov === b.s && !on) { c.strokeStyle = "rgba(95,211,243,.9)"; c.lineWidth = 1.2; c.beginPath(); c.arc(x, BY, Math.max(r, 14) + 8, 0, 7); c.stroke(); }
      if (on) reticle(c, x, BY, Math.max(r, 14) + 9, t);
      ks.forEach((m, j) => {
        const y = BY + r + 26 * z + j * 38 * z, mr = schemR(m) * z, mon = sel === m.s;
        this.satellite(c, m, x, y, mr);
        this.screen.push({ id: m.s, x, y, r: Math.max(mr, 10) });
        if (mon || hov === m.s || z >= 0.9) {
          c.textAlign = "left"; c.font = "500 11px Oxanium, sans-serif"; c.fillStyle = mon ? "#ffb866" : hov === m.s ? "#bdeefb" : "rgba(200,194,182,.7)";
          c.fillText(short(m.n, s.n).replace(short(b.n, s.n), "").trim().toUpperCase() || short(m.n, s.n).toUpperCase(), x + mr + 11, y + 4);
          c.textAlign = "center"; c.font = "500 12px Oxanium, sans-serif";
        }
        if (mon) reticle(c, x, y, mr + 10, t);
      });
    }
    c.textAlign = "left";
  }
  frameSchemV(c, now, W, H) {
    const L = this.L, s = L.s, sel = this.sel, z = this.sz, t = now / 1000;
    const SX = Math.round(W * 0.33);
    this.schemGround(c, W, H, 40 * z, SX - 10, this.sy, 160);
    this.screen = [];
    const SR = 56 * z, y0 = this.sy + 140 + SR;
    let cur = y0 + SR + 42 * z; const pos = [];
    for (const b of L.prim) {
      const r = schemR(b) * z * 0.78, ring = b.k === "gas giant" ? 6 * z : 0, extra = b.k === "asteroid belt" ? r * 0.2 : 0;
      const cy = cur + r + ring + extra; pos.push({ b, cy, r });
      cur = cy + r + ring + extra + 34 * z + (Math.ceil((L.kids[b.s] || []).length / 6) > 1 ? 30 * z : 0);
    }
    this.schemH = cur - this.sy;
    const last = pos.length ? pos[pos.length - 1].cy : y0;
    c.strokeStyle = "rgba(236,230,218,.35)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(SX, y0); c.lineTo(SX, last); c.stroke();
    this.starDisc(c, SX, y0, SR, z * 0.8, 90);
    this.screen.push({ id: "__star", x: SX, y: y0, r: SR });
    if (sel === "__star") reticle(c, SX, y0, SR + 8, t);
    for (const p of pos) {
      const b = p.b, y = p.cy, r = p.r, on = sel === b.s, ks = L.kids[b.s] || [];
      if (ks.length) { const n = Math.min(6, ks.length); c.strokeStyle = "rgba(236,230,218,.45)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(SX + r + 6, y); c.lineTo(SX + r + 26 * z + (n - 1) * 36 * z, y); c.stroke(); }
      if (b.k === "asteroid belt") {
        const rr = rng(hash(b.s)); c.fillStyle = on ? "#ffd3a0" : "#cbbfae";
        for (let i = 0; i < 40; i++) { const dx = (rr() - 0.5) * r * 4, dy = (rr() - 0.5) * r * 1.2; c.globalAlpha = 0.5 + rr() * 0.5; c.fillRect(SX + dx, y + dy, 1.6 * z, 1.6 * z); }
        c.globalAlpha = 1;
      } else {
        if (b.k === "gas giant") this.ringDraw(c, SX, y, r, false);
        this.sphere(c, b, SX, y, r);
        if (b.k === "gas giant") this.ringDraw(c, SX, y, r, true);
        if (b.st === "colonized") { c.strokeStyle = "rgba(95,211,243,.85)"; c.lineWidth = 1.5; c.beginPath(); c.arc(SX, y, r + 5, 0, 7); c.stroke(); }
      }
      this.screen.push({ id: b.s, x: SX, y, r: Math.max(r, 16) });
      c.font = "600 12px Oxanium, sans-serif"; c.textAlign = "right"; c.fillStyle = on ? "#ffb866" : "rgba(236,230,218,.8)";
      c.fillText(short(b.n, s.n).toUpperCase(), SX - Math.max(r, 16) * (b.k === "asteroid belt" ? 2 : 1) - 12, y + 4); c.textAlign = "left";
      if (on) reticle(c, SX, y, Math.max(r, 14) + 9, t);
      ks.forEach((m, j) => {
        const x = SX + r + 26 * z + (j % 6) * 36 * z, yy = y + Math.floor(j / 6) * 34 * z, mr = Math.max(4, schemR(m) * z * 0.8), mon = sel === m.s;
        this.satellite(c, m, x, yy, mr);
        this.screen.push({ id: m.s, x, y: yy, r: 14 });
        if (mon) { reticle(c, x, yy, mr + 10, t); c.font = "500 11px Oxanium, sans-serif"; c.fillStyle = "#ffb866"; c.textAlign = "center"; c.fillText(short(m.n, s.n).toUpperCase(), x, yy + mr + 22); c.textAlign = "left"; }
      });
    }
  }
}
