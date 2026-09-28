import { MODES, POPL, secRGB, css, mix, secLabel, rng, fitCanvas, attachPointer, startLoop } from "./common.js";

// Galaxy map canvas renderer + input (from the handoff's Main/MMap mockups).
// Pure canvas: pan/zoom never touches React. The owning component pushes
// state in (setMode/setSel/...) and gets selection/hover out via callbacks.
//
// opts: { onSelect(idx), onHover(bool), keepOut(W,H,sel) -> [[x0,y0,x1,y1]], focusOffsetY(), scaleY(H), mobile }
export class GalaxyMap {
  constructor(cv, data, opts = {}) {
    this.cv = cv; this.D = data; this.o = opts;
    this.mode = "factions"; this.lanes = true; this.labels = true; this.sel = -1; this.hover = -1;
    this.goal = null; this.wcache = {}; this.imgs = {};
    this.bg = []; const r0 = rng(7);
    for (let i = 0; i < 700; i++) this.bg.push({ x: r0(), y: r0(), a: 0.08 + r0() * 0.35, s: r0() < 0.1 ? 1.4 : 0.8, p: 0.01 + r0() * 0.04 });
    this.prep();
    this.cam = this.home();
    this.input = attachPointer(cv, {
      onWheel: (f, p) => this.zoomAt(p[0], p[1], f),
      onDblClick: (p) => { const w = this.toWorld(p[0], p[1]); this.goal = { x: w[0], y: w[1], k: this.clampK(this.cam.k * 2.4) }; },
      onPinch: (f, cx, cy, dx, dy) => { this.zoomAt(cx, cy, f); this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k; },
      onDrag: (dx, dy) => { this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k; this.goal = null; },
      onHover: (p) => { const h = p ? this.pick(p[0], p[1], 12) : -1; if (h !== this.hover) { this.hover = h; this.o.onHover?.(h >= 0); } },
      onTap: (p, touch) => { const i = this.pick(p[0], p[1], touch ? 22 : 14); this.o.onSelect?.(i); },
    });
    this.stop = startLoop(() => this.frame());
    if (document.fonts?.ready) document.fonts.ready.then(() => { this.wcache = {}; });
  }
  destroy() { this.stop(); this.input.detach(); }
  setMode(m) { this.mode = m; }
  setLanes(v) { this.lanes = v; }
  setLabels(v) { this.labels = v; }
  setSel(i) { this.sel = i; }

  get W() { return this.cv.clientWidth || 1; }
  get H() { return this.cv.clientHeight || 1; }
  home() {
    const { W, H } = this, ww = this.D.w, wh = this.D.h;
    const k = this.o.mobile ? (W / ww) * 1.1 : (Math.min(W / ww, H / wh)) * 0.93;
    return { x: ww / 2, y: wh / 2 + (this.o.mobile ? 40 : 5), k };
  }
  clampK(k) { const k0 = this.home().k; return Math.max(k0 * 0.7, Math.min(40, k)); }
  zoomIn() { this.goal = { x: this.cam.x, y: this.cam.y, k: this.clampK(this.cam.k * 1.8) }; }
  zoomOut() { this.goal = { x: this.cam.x, y: this.cam.y, k: this.clampK(this.cam.k / 1.8) }; }
  reset() { this.goal = this.home(); }
  focus(i, minK) {
    const s = this.D.sys[i];
    const k = Math.max(this.cam.k, minK || (this.o.mobile ? 3.2 : 5));
    const off = this.o.focusOffsetY?.() || 0;
    this.goal = { x: s.x, y: s.y + off / k, k };
  }

  prep() {
    const d = this.D, S = d.sys, ww = d.w;
    const B = {};
    S.forEach((s, i) => { const k = ((s.x / 50) | 0) + "," + ((s.y / 50) | 0); (B[k] = B[k] || []).push(i); });
    this.byPri = S.map((s, i) => i).sort((a, b) => S[b].prio - S[a].prio);
    // nearest-system grid for territories
    const G = 320, R = 44 * (ww / 1000), cs = ww / G, near = new Int16Array(G * G).fill(-1), dist = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const wx = (gx + 0.5) * cs, wy = (gy + 0.5) * (d.h / G), bx = (wx / 50) | 0, by = (wy / 50) | 0;
      let best = -1, bd = R;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const L = B[(bx + ox) + "," + (by + oy)]; if (!L) continue;
        for (const j of L) { const dx = S[j].x - wx, dy = S[j].y - wy, dd = Math.sqrt(dx * dx + dy * dy); if (dd < bd) { bd = dd; best = j; } }
      }
      near[gy * G + gx] = best; dist[gy * G + gx] = bd;
    }
    this.G = G; this.R = R; this.near = near; this.dist = dist;
    // background haze from the population field
    const pop = d.fld.population || [], n = Math.round(Math.sqrt(pop.length)) || 1;
    const hz = document.createElement("canvas"); hz.width = n; hz.height = n;
    const hx = hz.getContext("2d"), im = hx.createImageData(n, n);
    pop.forEach((v, i) => { im.data[i * 4] = 120; im.data[i * 4 + 1] = 130; im.data[i * 4 + 2] = 210; im.data[i * 4 + 3] = v * 70; });
    hx.putImageData(im, 0, 0); this.haze = hz;
  }
  territory(mode) {
    if (this.imgs[mode] !== undefined) return this.imgs[mode];
    if (mode === "sectors" || mode === "trade") { this.imgs[mode] = null; return null; }
    const S = this.D.sys, F = this.D.f, G = this.G, R = this.R, near = this.near, dist = this.dist;
    const c = document.createElement("canvas"); c.width = G; c.height = G;
    const x = c.getContext("2d"), im = x.createImageData(G, G), P = im.data;
    for (let i = 0; i < G * G; i++) {
      const n = near[i]; if (n < 0) continue;
      const s = S[n], f = 1 - dist[i] / R; let col = null, a = 0;
      if (mode === "factions") {
        if (s.lf < 0) continue;
        col = F[s.lf].rgb; a = 0.07 + 0.2 * Math.pow(f, 0.7);
        const gx = i % G, gy = (i / G) | 0, nb = [gx < G - 1 ? i + 1 : -1, gy < G - 1 ? i + G : -1, gx > 0 ? i - 1 : -1, gy > 0 ? i - G : -1];
        for (const j of nb) { if (j < 0) continue; const m = near[j]; const lf = m < 0 ? -2 : S[m].lf; if (lf !== s.lf) { a = 0.6; break; } }
      } else if (mode === "security") { col = secRGB(s.sd); a = 0.05 + 0.3 * Math.pow(f, 0.8); }
      else if (mode === "conflict") { col = [255, 61, 61]; a = s.war * 0.55 * Math.pow(f, 0.8); }
      else if (mode === "population") { col = [255, 160, 70]; a = (s.pr / 5) * 0.42 * Math.pow(f, 1.2); }
      P[i * 4] = col[0]; P[i * 4 + 1] = col[1]; P[i * 4 + 2] = col[2]; P[i * 4 + 3] = Math.min(255, a * 255);
    }
    x.putImageData(im, 0, 0); this.imgs[mode] = c; return c;
  }

  toScreen(x, y) { const c = this.cam; return [this.W / 2 + (x - c.x) * c.k, this.H / 2 + (y - c.y) * c.k]; }
  toWorld(sx, sy) { const c = this.cam; return [c.x + (sx - this.W / 2) / c.k, c.y + (sy - this.H / 2) / c.k]; }
  zoomAt(sx, sy, f) { const w = this.toWorld(sx, sy), k = this.clampK(this.cam.k * f); this.cam.k = k; this.cam.x = w[0] - (sx - this.W / 2) / k; this.cam.y = w[1] - (sy - this.H / 2) / k; this.goal = null; }
  pick(sx, sy, rad) {
    let best = -1, bd = rad * rad;
    this.D.sys.forEach((s, i) => { const p = this.toScreen(s.x, s.y), dx = p[0] - sx, dy = p[1] - sy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  frame() {
    const { ctx: c, W, H } = fitCanvas(this.cv);
    this.ctx = c;
    if (this.goal) {
      const g = this.goal, m = this.cam, t = 0.14;
      m.x += (g.x - m.x) * t; m.y += (g.y - m.y) * t; m.k += (g.k - m.k) * t;
      if (Math.abs(g.k - m.k) < 0.002 && Math.abs(g.x - m.x) < 0.05) this.goal = null;
    }
    c.fillStyle = "#03050a"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#dfe6ff";
    for (const p of this.bg) {
      c.globalAlpha = p.a;
      const x = ((p.x * W - this.cam.x * p.p * this.cam.k) % W + W) % W, y = ((p.y * H - this.cam.y * p.p * this.cam.k) % H + H) % H;
      c.fillRect(x, y, p.s, p.s);
    }
    c.globalAlpha = 1;
    const D = this.D, S = D.sys, k = this.cam.k, mode = this.mode, t = performance.now() / 1000;
    const o = this.toScreen(0, 0), szx = D.w * k, szy = D.h * k;
    c.imageSmoothingEnabled = true;
    c.globalAlpha = mode === "population" ? 0.5 : 0.9; c.drawImage(this.haze, o[0], o[1], szx, szy); c.globalAlpha = 1;
    const img = this.territory(mode);
    if (img) { c.imageSmoothingQuality = "high"; c.filter = `blur(${Math.max(1.2, Math.min(3, k * 0.9))}px)`; c.drawImage(img, o[0], o[1], szx, szy); c.filter = "none"; }
    if (mode === "sectors") this.drawSectors(c, k);
    const sel = this.sel, hov = this.hover;
    if (this.lanes) this.drawLanes(c, k, mode, sel, hov, W, H);
    const zs = Math.max(0.8, Math.min(2.4, 0.8 + (k - 1) * 0.1));
    const P = new Array(S.length);
    for (const s of S) {
      const p = this.toScreen(s.x, s.y); P[s.idx] = p;
      if (p[0] < -30 || p[0] > W + 30 || p[1] < -30 || p[1] > H + 30) continue;
      let r = s.r * zs; if (mode === "population") r = (0.9 + s.pr * 0.75) * zs;
      const dim = sel >= 0 && sel !== s.idx && !S[sel].nb.includes(s.idx) ? 0.55 : 1;
      if (s.i > 0.25 || s.pr >= 4 || (mode === "population" && s.pr >= 3)) {
        const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 5);
        g.addColorStop(0, mode === "population" ? "rgba(255,170,80,.45)" : "rgba(255,220,170,.28)"); g.addColorStop(1, "rgba(255,200,140,0)");
        c.fillStyle = g; c.globalAlpha = dim; c.fillRect(p[0] - r * 5, p[1] - r * 5, r * 10, r * 10);
      }
      c.globalAlpha = dim;
      if (s.so) { c.strokeStyle = s.col; c.lineWidth = 1.2; c.beginPath(); const q = r + 1.2; c.moveTo(p[0], p[1] - q); c.lineTo(p[0] + q, p[1]); c.lineTo(p[0], p[1] + q); c.lineTo(p[0] - q, p[1]); c.closePath(); c.stroke(); }
      else if (s.st.includes("binary")) { c.fillStyle = s.col; const q = r * 0.6; c.beginPath(); c.arc(p[0] - q, p[1], r * 0.7, 0, 7); c.arc(p[0] + q, p[1], r * 0.55, 0, 7); c.fill(); }
      else { c.fillStyle = s.col; c.beginPath(); c.arc(p[0], p[1], r, 0, 7); c.fill(); }
      if (mode === "factions" && k > 2.2 && s.cb.length) { // influence ring
        let a0 = -Math.PI / 2; const rr = r + 4; c.lineWidth = 2;
        for (const cb of s.cb) { const fx = D.fBySlug[cb[0]]; const a1 = a0 + cb[1] * Math.PI * 2; c.strokeStyle = fx ? fx.c : "#888"; c.beginPath(); c.arc(p[0], p[1], rr, a0 + 0.06, a1 - 0.06); c.stroke(); a0 = a1; }
      }
      c.globalAlpha = 1;
    }
    if (this.labels) this.drawLabels(c, k, P, sel, hov, W, H);
    if (sel >= 0) this.drawReticle(c, P[sel], S[sel].r * zs, t);
    if (hov >= 0 && hov !== sel) {
      const p = P[hov]; c.strokeStyle = "rgba(95,211,243,.9)"; c.lineWidth = 1.2; c.beginPath(); c.arc(p[0], p[1], S[hov].r * zs + 7, 0, 7); c.stroke();
      this.drawTip(c, p, S[hov], mode, W, H);
    }
    this.drawScale(c, k, W, H);
  }
  drawSectors(c, k) {
    const secs = this.D.sec; c.lineWidth = 1.2; c.setLineDash([6, 5]);
    secs.forEach((sc, i) => {
      c.beginPath(); sc.p.forEach((q, j) => { const p = this.toScreen(q[0], q[1]); j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath();
      c.fillStyle = i % 2 ? "rgba(255,154,60,.045)" : "rgba(95,211,243,.04)"; c.fill(); c.strokeStyle = "rgba(255,154,60,.55)"; c.stroke();
    });
    c.setLineDash([]);
    secs.forEach((sc) => {
      if (!sc.p.length) return;
      let x = 0, y = 0; sc.p.forEach((q) => { x += q[0]; y += q[1]; });
      const p = this.toScreen(x / sc.p.length, y / sc.p.length);
      c.textAlign = "center"; c.fillStyle = "rgba(255,176,100,.5)"; c.font = `600 ${Math.max(14, Math.min(40, k * 16))}px Oxanium, sans-serif`;
      c.fillText(sc.n.toLowerCase() === "core" ? "CORE" : `SECTOR ${sc.n}`.toUpperCase(), p[0], p[1]);
      c.font = "500 12px Oxanium, sans-serif"; c.fillStyle = "rgba(236,230,218,.55)"; c.fillText((sc.fo || "").toUpperCase(), p[0], p[1] + 18);
    });
    c.textAlign = "left";
  }
  drawLanes(c, k, mode, sel, hov, W, H) {
    const S = this.D.sys, lw = Math.max(0.8, Math.min(1.8, k / 1.4));
    const vis = (a, b) => !((a[0] < 0 && b[0] < 0) || (a[0] > W && b[0] > W) || (a[1] < 0 && b[1] < 0) || (a[1] > H && b[1] > H));
    if (mode === "trade") {
      for (const l of this.D.ln) {
        const a = this.toScreen(S[l[0]].x, S[l[0]].y), b = this.toScreen(S[l[1]].x, S[l[1]].y); if (!vis(a, b)) continue;
        const col = mix([95, 211, 243], [255, 106, 43], l[3]);
        c.strokeStyle = css(col, l[2] === 2 ? 0.85 : l[2] === 1 ? 0.55 : 0.4); c.lineWidth = (l[2] === 2 ? 2.4 : l[2] === 1 ? 1.2 : 1) * lw;
        c.setLineDash(l[2] === 0 ? [3, 4] : []); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      c.setLineDash([]);
    } else {
      const sty = [["rgba(95,211,243,.2)", 0.9, [3, 4]], ["rgba(95,211,243,.26)", 1, []], ["rgba(95,211,243,.42)", 1.3, []]];
      for (let cp = 0; cp < 3; cp++) {
        c.strokeStyle = sty[cp][0]; c.lineWidth = sty[cp][1] * lw; c.setLineDash(sty[cp][2]); c.beginPath();
        for (const l of this.D.ln) {
          if (l[2] !== cp) continue;
          const a = this.toScreen(S[l[0]].x, S[l[0]].y), b = this.toScreen(S[l[1]].x, S[l[1]].y); if (!vis(a, b)) continue;
          c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        }
        c.stroke();
      }
      c.setLineDash([]);
    }
    const hi = (i, col, w) => {
      const s = S[i], a = this.toScreen(s.x, s.y); c.strokeStyle = col; c.lineWidth = w; c.beginPath();
      for (const j of s.nb) { const b = this.toScreen(S[j].x, S[j].y); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      c.stroke();
    };
    if (hov >= 0) hi(hov, "rgba(95,211,243,.75)", 1.5);
    if (sel >= 0) hi(sel, "rgba(255,170,90,.95)", 2);
  }
  measure(s, font, txt) {
    const key = s.idx + font + txt; let w = this.wcache[key];
    if (w == null) { this.ctx.font = font; this.ctx.letterSpacing = "0px"; w = this.ctx.measureText(txt).width; this.wcache[key] = w; }
    return w;
  }
  drawLabels(c, k, P, sel, hov, W, H) {
    const S = this.D.sys, placed = [], zs = Math.max(0.8, Math.min(2.4, 0.8 + (k - 1) * 0.1)), k0 = this.home().k;
    const free = (r) => { for (const q of placed) { if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return false; } return true; };
    placed.push(...(this.o.keepOut?.(W, H, sel) || []));
    const order = []; if (sel >= 0) order.push(sel); if (hov >= 0 && hov !== sel) order.push(hov);
    for (const i of this.byPri) if (i !== sel && i !== hov) order.push(i);
    const kr = k / k0; // zoom relative to the fitted view — thresholds hold at any screen size
    let budget = 60 + kr * 34;
    for (const i of order) {
      const s = S[i], p = P[i]; if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue;
      const tier = s.i >= 0.45 ? 1 : s.i >= 0.08 || s.pr >= 5 ? 2 : 3;
      const forced = i === sel || i === hov;
      if (!forced && tier === 3 && kr < 2.1) continue;
      if (!forced && tier === 2 && kr < 1.25 && s.i < 0.2) continue;
      const font = tier === 1 ? "600 13px Oxanium, sans-serif" : tier === 2 ? "500 12px Oxanium, sans-serif" : "400 11px Oxanium, sans-serif";
      const txt = tier === 1 || forced ? s.n.toUpperCase() : s.n;
      const w = this.measure(s, font, txt) + (tier === 1 ? txt.length * 1.2 : 0), h = tier === 1 ? 14 : 12, r = s.r * zs + 5;
      let rect = [p[0] + r, p[1] - h / 2 - 1, p[0] + r + w + 4, p[1] + h / 2 + 1];
      if (!free(rect)) { rect = [p[0] - r - w - 4, p[1] - h / 2 - 1, p[0] - r, p[1] + h / 2 + 1]; if (!free(rect) && !forced) continue; }
      placed.push(rect);
      c.font = font; c.letterSpacing = tier === 1 ? "1.2px" : "0px";
      c.fillStyle = forced ? (i === sel ? "#ffb866" : "#bdeefb") : tier === 1 ? "#ffb15c" : tier === 2 ? "#e6dfd2" : "rgba(200,194,182,.8)";
      c.shadowColor = "rgba(0,0,0,.9)"; c.shadowBlur = 4; c.fillText(txt, rect[0] + 2, p[1] + 4); c.shadowBlur = 0;
      if (--budget <= 0) break;
    }
    c.letterSpacing = "0px";
  }
  drawReticle(c, p, r, t) {
    const R = r + 9 + Math.sin(t * 3) * 1.5; c.strokeStyle = "#ff9a3c"; c.lineWidth = 1.6;
    for (let q = 0; q < 4; q++) { const a = t * 0.8 + (q * Math.PI) / 2; c.beginPath(); c.arc(p[0], p[1], R, a, a + 0.9); c.stroke(); }
    const b = R + 8, l = 6; c.lineWidth = 1.2; c.strokeStyle = "rgba(255,154,60,.7)";
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((d) => { c.beginPath(); c.moveTo(p[0] + d[0] * b, p[1] + d[1] * (b - l)); c.lineTo(p[0] + d[0] * b, p[1] + d[1] * b); c.lineTo(p[0] + d[0] * (b - l), p[1] + d[1] * b); c.stroke(); });
  }
  drawTip(c, p, s, mode, W, H) {
    const F = this.D.f; let line2 = "";
    if (mode === "security") line2 = "Security: " + secLabel(s.sd);
    else if (mode === "conflict") line2 = "War risk: " + Math.round(s.war * 100) + "%";
    else if (mode === "population") line2 = POPL[s.pop] || "—";
    else if (mode === "trade") line2 = "Exports: " + (s.ex.join(", ") || "—");
    else if (mode === "sectors") line2 = s.sc === "core" ? "Core sector" : "Sector " + s.sc;
    else line2 = s.lf >= 0 ? (s.ow ? "Controlled by " : "Led by ") + F[s.lf].n : "Unclaimed";
    c.font = '500 13px "Barlow Semi Condensed", sans-serif'; const w = Math.max(c.measureText(line2).width, 60) + 20;
    let x = p[0] + 16, y = p[1] + 16; if (x + w > W - 10) x = p[0] - 16 - w; if (y + 30 > H - 10) y = p[1] - 46;
    c.fillStyle = "rgba(7,11,18,.92)"; c.fillRect(x, y, w, 28); c.strokeStyle = "rgba(95,211,243,.45)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, 27);
    c.fillStyle = "#d9f5fc"; c.fillText(line2, x + 10, y + 18);
  }
  drawScale(c, k, W, H) {
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200]; let u = nice[0];
    for (const n of nice) if (n * k <= 140) u = n;
    const px = u * k, x = W / 2 - px / 2, y = this.o.scaleY ? this.o.scaleY(H) : H - 44;
    c.strokeStyle = "rgba(236,230,218,.55)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x, y); c.lineTo(x + px, y); c.lineTo(x + px, y - 4); c.stroke();
    c.font = "500 11px Oxanium, sans-serif"; c.fillStyle = "rgba(236,230,218,.7)"; c.textAlign = "center"; c.fillText(u + " LY", W / 2, y - 8); c.textAlign = "left";
  }
}

export { MODES };
