import { GalaxyMap } from "../../galaxy/galaxy-map.js";
import { localPoint } from "../../galaxy/common.js";
import { GRID_SIZE } from "@galaxy-core/lib/grid.js";
import { FIELD_DEFS } from "@galaxy-core/lib/project.js";

// The Galaxy Editor's map IS the viewer's map (galaxy/galaxy-map.js: same
// layers, labels, reticle, territories), fed from the live project through
// the same compact format the viewer loads, plus an editing overlay drawn on
// top of each frame (painted fields, sector outlines, faction seeds, the
// sector being drawn, brush cursor…) and tool-aware input in place of the
// viewer's select-only pointer handling.
//
// opts (on top of GalaxyMap's): onPick({kind, id}|null), onPaint(wx, wy, erase),
// onSectorPoint(wx, wy) / onSectorClose(), onPlaceSystem(wx, wy),
// onLane(systemId), onFactionSeed(wx, wy, homeSlug, homeName)
const SNAP_PX = 12;

export class EditorMap extends GalaxyMap {
  // `D`: prepGalaxy(buildCompact(project)), built by the shell (it needs the
  // same data for its panels) and handed in on every change.
  constructor(cv, project, D, opts = {}) {
    super(cv, D, opts);
    this.input.detach(); // the viewer's pointer handling → tool-aware one below
    this.project = project;
    this.ed = {
      tool: "select", field: null, showField: false, brush: { radius: 80, strength: 0.6 },
      selSector: null, selFaction: null, pending: null, pendingClosed: false, pendingSeed: null,
      laneFrom: null, cursor: null, showSeeds: true,
    };
    this.fieldImg = null; this.fieldKey = null;
    this.input = this.attachInput();
  }

  // --- data -----------------------------------------------------------------
  setProject(p, D) {
    const popChanged = p.fields?.population !== this.project.fields?.population;
    this.project = p;
    if (D && D !== this.D) {
      const selSlug = this.sel >= 0 ? this.D.sys[this.sel]?.s : null;
      const hovSlug = this.hover >= 0 ? this.D.sys[this.hover]?.s : null;
      this.D = D;
      this.prep(); this.imgs = {}; this.wcache = {};
      this.sel = selSlug && D.bySlug[selSlug] ? D.bySlug[selSlug].idx : -1;
      this.hover = hovSlug && D.bySlug[hovSlug] ? D.bySlug[hovSlug].idx : -1;
    } else if (popChanged) {
      this.D.fld.population = p.fields.population;
      this.prep(); // rebuilds the population haze
    }
  }
  selectSystemId(id) {
    const s = id ? this.project.systems.find((x) => x.id === id) : null;
    this.sel = s && this.D.bySlug[s.slug] ? this.D.bySlug[s.slug].idx : -1;
  }
  focusSystemId(id, minK) {
    const s = this.project.systems.find((x) => x.id === id);
    const c = s && this.D.bySlug[s.slug];
    if (c) this.focus(c.idx, minK);
  }
  setEd(patch) { Object.assign(this.ed, patch); }
  systemAtIdx(i) { const c = this.D.sys[i]; return c ? this.project.systems.find((s) => s.slug === c.s) : null; }

  // --- input ----------------------------------------------------------------
  attachInput() {
    const cv = this.cv;
    let drag = null;
    const hit = (p, rad = 12) => this.pick(p[0], p[1], rad);
    const onWheel = (e) => { e.preventDefault(); const p = localPoint(cv, e); this.zoomAt(p[0], p[1], Math.exp(-e.deltaY * 0.0016)); };
    const onDown = (e) => {
      cv.setPointerCapture?.(e.pointerId);
      const p = localPoint(cv, e), w = this.toWorld(p[0], p[1]);
      const panBtn = e.button === 1 || e.button === 2 || this.spaceDown;
      const paint = this.ed.tool === "paint" && !panBtn;
      drag = { x: p[0], y: p[1], moved: false, paint, pan: !paint };
      if (paint) this.o.onPaint?.(w[0], w[1], e.shiftKey || e.altKey);
    };
    const onMove = (e) => {
      const p = localPoint(cv, e), w = this.toWorld(p[0], p[1]);
      this.ed.cursor = p;
      if (drag) {
        const dx = p[0] - drag.x, dy = p[1] - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.paint) this.o.onPaint?.(w[0], w[1], e.shiftKey || e.altKey);
        else if (drag.moved) { this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k; this.goal = null; }
        drag.x = p[0]; drag.y = p[1];
        return;
      }
      const t = this.ed.tool;
      if (t === "paint") this.o.onCursor?.(w[0], w[1]);
      const h = t === "paint" || t === "sector" || t === "system" ? -1 : hit(p);
      if (h !== this.hover) { this.hover = h; this.o.onHover?.(h >= 0); }
    };
    const onUp = (e) => {
      const d = drag; drag = null;
      if (!d || d.moved || d.paint || e.button !== 0) return;
      this.tap(localPoint(cv, e));
    };
    const onLeave = () => { this.ed.cursor = null; if (this.hover >= 0) { this.hover = -1; this.o.onHover?.(false); } };
    const onDbl = (e) => { if (this.ed.tool !== "select") return; const p = localPoint(cv, e), w = this.toWorld(p[0], p[1]); this.goal = { x: w[0], y: w[1], k: this.clampK(this.cam.k * 2.4) }; };
    const onCtx = (e) => e.preventDefault();
    const onKey = (e) => { if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { this.spaceDown = e.type === "keydown"; } };
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", () => { drag = null; });
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("dblclick", onDbl);
    cv.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKey);
    return {
      detach() {
        cv.removeEventListener("wheel", onWheel);
        cv.removeEventListener("pointerdown", onDown);
        cv.removeEventListener("pointermove", onMove);
        cv.removeEventListener("pointerup", onUp);
        cv.removeEventListener("pointerleave", onLeave);
        cv.removeEventListener("dblclick", onDbl);
        cv.removeEventListener("contextmenu", onCtx);
        window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey);
      },
    };
  }

  tap(p) {
    const w = this.toWorld(p[0], p[1]), t = this.ed.tool, P = this.project;
    if (t === "sector") {
      if (this.ed.pendingClosed) return;
      const snap = this.snapVertex(p);
      if (snap?.close) { this.o.onSectorClose?.(); return; }
      const q = snap ? snap.w : w;
      this.o.onSectorPoint?.(q[0], q[1]);
      return;
    }
    if (t === "system") { this.o.onPlaceSystem?.(w[0], w[1]); return; }
    if (t === "lane") { const i = this.pick(p[0], p[1], 12); this.o.onLane?.(i >= 0 ? this.systemAtIdx(i)?.id : null); return; }
    if (t === "faction") {
      const i = this.pick(p[0], p[1], SNAP_PX), s = i >= 0 ? this.systemAtIdx(i) : null;
      if (s) this.o.onFactionSeed?.(s.position.x, s.position.y, s.slug, s.name);
      else this.o.onFactionSeed?.(w[0], w[1], null, null);
      return;
    }
    // select: system > faction seed > sector > nothing
    const i = this.pick(p[0], p[1], 14);
    if (i >= 0) { this.o.onPick?.({ kind: "system", id: this.systemAtIdx(i)?.id }); return; }
    if (this.ed.showSeeds) {
      const f = P.factions.find((x) => { const q = this.toScreen(x.seed.x, x.seed.y); return Math.hypot(q[0] - p[0], q[1] - p[1]) < 10; });
      if (f) { this.o.onPick?.({ kind: "faction", id: f.id }); return; }
    }
    const sec = P.sectors.find((s) => inPoly(w[0], w[1], s.points));
    this.o.onPick?.(sec ? { kind: "sector", id: sec.id } : null);
  }

  snapVertex(p) {
    let best = null, bd = SNAP_PX;
    const consider = (q, close) => { const s = this.toScreen(q[0], q[1]); const d = Math.hypot(s[0] - p[0], s[1] - p[1]); if (d <= bd) { bd = d; best = { w: q, close }; } };
    for (const s of this.project.sectors) for (const q of s.points) consider(q, false);
    const pend = this.ed.pending;
    if (pend) pend.forEach((q, i) => consider(q, i === 0 && pend.length >= 3));
    return best;
  }

  // --- drawing --------------------------------------------------------------
  frame() {
    if (this.paused) return;
    super.frame();
    const c = this.ctx; if (!c) return;
    const P = this.project, ed = this.ed, W = this.W, H = this.H;
    if (ed.showField && ed.field) this.drawField(c);
    this.drawSectorEdits(c);
    if (ed.showSeeds) this.drawSeeds(c);
    // sector being drawn
    const pend = ed.pending;
    if (pend && pend.length) {
      const pts = pend.map((q) => this.toScreen(q[0], q[1]));
      c.strokeStyle = "#5fd3f3"; c.lineWidth = 2; c.setLineDash(ed.pendingClosed ? [] : [6, 4]);
      c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      if (ed.pendingClosed) { c.closePath(); c.fillStyle = "rgba(95,211,243,.12)"; c.fill(); }
      else if (ed.cursor && ed.tool === "sector") c.lineTo(ed.cursor[0], ed.cursor[1]);
      c.stroke(); c.setLineDash([]);
      pts.forEach((q, i) => {
        const close = i === 0 && pts.length >= 3 && !ed.pendingClosed;
        c.fillStyle = "#5fd3f3"; c.beginPath(); c.arc(q[0], q[1], close ? 6 : 3.5, 0, 7); c.fill();
        if (close) { c.strokeStyle = "#fff4e6"; c.lineWidth = 1.5; c.stroke(); }
      });
    }
    if (ed.tool === "sector" && ed.cursor && !ed.pendingClosed) {
      const snap = this.snapVertex(ed.cursor);
      if (snap) { const q = this.toScreen(snap.w[0], snap.w[1]); c.strokeStyle = snap.close ? "#7fdc9f" : "#ffb866"; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 9, 0, 7); c.stroke(); }
    }
    // lane tool: first pick + rubber band
    if (ed.tool === "lane" && ed.laneFrom) {
      const s = P.systems.find((x) => x.id === ed.laneFrom);
      if (s) {
        const a = this.toScreen(s.position.x, s.position.y);
        c.strokeStyle = "#5fd3f3"; c.lineWidth = 1.6; c.beginPath(); c.arc(a[0], a[1], 9, 0, 7); c.stroke();
        if (ed.cursor) { c.setLineDash([5, 4]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(ed.cursor[0], ed.cursor[1]); c.stroke(); c.setLineDash([]); }
      }
    }
    // pending faction seed
    if (ed.pendingSeed) {
      const q = this.toScreen(ed.pendingSeed.x, ed.pendingSeed.y);
      this.diamond(c, q[0], q[1], 7, "#5fd3f3", true);
    }
    // cursors
    if (ed.cursor) {
      const [x, y] = ed.cursor;
      if (ed.tool === "paint") {
        const r = ed.brush.radius * this.cam.k;
        c.strokeStyle = "rgba(255,244,230,.7)"; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
        c.strokeStyle = "rgba(255,154,60,.35)"; c.setLineDash([3, 4]); c.beginPath(); c.arc(x, y, r * 0.5, 0, 7); c.stroke(); c.setLineDash([]);
      } else if (ed.tool === "system") {
        c.strokeStyle = "rgba(255,184,102,.9)"; c.lineWidth = 1.2;
        c.beginPath(); c.arc(x, y, 6, 0, 7); c.moveTo(x - 12, y); c.lineTo(x - 8, y); c.moveTo(x + 8, y); c.lineTo(x + 12, y); c.moveTo(x, y - 12); c.lineTo(x, y - 8); c.moveTo(x, y + 8); c.lineTo(x, y + 12); c.stroke();
      }
    }
    void W; void H;
  }

  drawField(c) {
    const P = this.project, key = this.ed.field, grid = P.fields?.[key];
    if (!grid) return;
    if (this.fieldKey !== grid) {
      const def = FIELD_DEFS.find((f) => f.key === key);
      const rgb = (def?.color || "255,154,60").split(",").map(Number);
      const cv = document.createElement("canvas"); cv.width = GRID_SIZE; cv.height = GRID_SIZE;
      const x = cv.getContext("2d"), im = x.createImageData(GRID_SIZE, GRID_SIZE);
      for (let i = 0; i < grid.length; i++) { const v = grid[i]; im.data[i * 4] = rgb[0]; im.data[i * 4 + 1] = rgb[1]; im.data[i * 4 + 2] = rgb[2]; im.data[i * 4 + 3] = v > 0.01 ? Math.min(230, 20 + v * 200) : 0; }
      x.putImageData(im, 0, 0); this.fieldImg = cv; this.fieldKey = grid;
    }
    const o = this.toScreen(0, 0), b = P.bounds;
    c.imageSmoothingEnabled = true; c.globalAlpha = 0.75;
    c.drawImage(this.fieldImg, o[0], o[1], b.width * this.cam.k, b.height * this.cam.k);
    c.globalAlpha = 1;
  }

  drawSectorEdits(c) {
    const ed = this.ed, show = ed.tool === "sector" || ed.tool === "paint" || ed.tool === "system" || this.mode === "sectors";
    for (const s of this.project.sectors) {
      const sel = s.id === ed.selSector;
      if (!show && !sel) continue;
      c.beginPath(); s.points.forEach((q, i) => { const p = this.toScreen(q[0], q[1]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath();
      if (sel) { c.fillStyle = "rgba(255,154,60,.08)"; c.fill(); }
      c.strokeStyle = sel ? "#ff9a3c" : "rgba(255,154,60,.35)"; c.lineWidth = sel ? 2 : 1; c.setLineDash(sel ? [] : [6, 5]); c.stroke(); c.setLineDash([]);
      if (ed.tool === "sector" || sel) for (const q of s.points) { const p = this.toScreen(q[0], q[1]); c.fillStyle = sel ? "#ff9a3c" : "rgba(255,154,60,.5)"; c.fillRect(p[0] - 2, p[1] - 2, 4, 4); }
    }
  }

  diamond(c, x, y, r, col, stroke) {
    c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
    c.fillStyle = col; c.fillRect(-r / 1.4, -r / 1.4, r * 1.41, r * 1.41);
    if (stroke) { c.strokeStyle = "#fff4e6"; c.lineWidth = 1.5; c.strokeRect(-r / 1.4, -r / 1.4, r * 1.41, r * 1.41); }
    c.restore();
  }
  drawSeeds(c) {
    const ed = this.ed, show = ed.tool === "faction" || this.mode === "factions";
    for (const f of this.project.factions) {
      const sel = f.id === ed.selFaction;
      if (!show && !sel) continue;
      if (f.origin === "generated" && !sel && ed.tool !== "faction") continue;
      const q = this.toScreen(f.seed.x, f.seed.y);
      this.diamond(c, q[0], q[1], sel ? 8 : 5.5, f.color || "#888", sel);
      if (sel || ed.tool === "faction" || this.cam.k > this.home().k * 1.6) {
        c.font = "600 11px Oxanium, sans-serif"; c.textAlign = "center"; c.fillStyle = sel ? "#fff4e6" : "rgba(236,230,218,.8)";
        c.shadowColor = "rgba(0,0,0,.9)"; c.shadowBlur = 4; c.fillText(f.name.toUpperCase(), q[0], q[1] - 12); c.shadowBlur = 0; c.textAlign = "left";
      }
    }
  }
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
