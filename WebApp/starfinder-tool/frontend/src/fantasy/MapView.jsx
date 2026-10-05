import { useCallback, useEffect, useRef, useState } from "react";
import { drawOverlay, hitTest, toCell, toScreen, vertexAt, SETTLEMENT_SIZE } from "./render.js";

// The map canvas: pan (drag empty space / right button), wheel zoom, and
// the active tool. All edits go out through callbacks; painting mutates the
// runtime world directly (fast) and commits once at the end of the stroke.
export default function MapView({ map, world, terrain, terrainRev, gm, tool, toolOpts, sel, onSelect, onMove, onMoveVertex, onDeleteVertex,
  onPlace, draft, onDraftPoint, onFinishDraft, fitRev, route, onWaypoint, onPaintDab, onPaintEnd, focus, paused }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hover, setHover] = useState(null);
  const drag = useRef(null);

  // fit on load / size change of the map
  const fit = useCallback(() => {
    const z = Math.min(size.w / (map.w + 4), size.h / (map.h + 4));
    setView({ z, x: map.w / 2 - size.w / 2 / z, y: map.h / 2 - size.h / 2 / z });
  }, [size.w, size.h, map.w, map.h]);
  // refit on a new map, on request, and on resize until the user moves the view
  const touched = useRef(false);
  useEffect(() => { touched.current = false; }, [map.w, map.h, map.seed, fitRev]);
  useEffect(() => { if (size.w > 10 && !touched.current) fit(); }, [map.w, map.h, map.seed, size.w, size.h, fitRev]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setSize({ w: el.clientWidth, h: el.clientHeight }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // center on a requested item
  useEffect(() => {
    if (!focus || !view) return;
    touched.current = true;
    const z = Math.max(view.z, focus.z || 6);
    setView({ z, x: focus.x - size.w / 2 / z, y: focus.y - size.h / 2 / z });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // draw
  const raf = useRef(0);
  useEffect(() => {
    if (!view || paused) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = ref.current;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== size.w * dpr) { c.width = size.w * dpr; c.height = size.h * dpr; }
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(ctx, {
        map, view, terrain, width: size.w, height: size.h, gm, sel, hover, route, draft, cursor,
        brush: tool === "brush" ? { r: toolOpts.brushR } : null,
      });
    });
  }, [map, view, terrain, terrainRev, size, gm, sel, hover, route, draft, cursor, tool, toolOpts.brushR, paused]);

  // wheel zoom around the pointer
  useEffect(() => {
    const el = ref.current;
    const onWheel = (e) => {
      e.preventDefault();
      touched.current = true;
      setView((v) => {
        if (!v) return v;
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const [cx, cy] = toCell(v, sx, sy);
        const z = Math.min(60, Math.max(1, v.z * (e.deltaY > 0 ? 1 / 1.15 : 1.15)));
        return { z, x: cx - sx / z, y: cy - sy / z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const snapToSettlement = (sx, sy) => {
    for (const s of map.settlements) {
      const [x, y] = toScreen(view, s.x, s.y);
      if (Math.hypot(sx - x, sy - y) < SETTLEMENT_SIZE[s.type] + 6) return [s.x, s.y, s];
    }
    return null;
  };

  const down = (e) => {
    if (!view) return;
    ref.current.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e);
    const [cx, cy] = toCell(view, sx, sy);
    const base = { sx, sy, cx, cy, v0: view, moved: false, button: e.button };
    if (e.button === 2 || e.button === 1) { drag.current = { ...base, mode: "pan" }; return; }

    if (tool === "brush" && gm) {
      drag.current = { ...base, mode: "paint" };
      onPaintDab(cx, cy);
      return;
    }
    if (tool === "select") {
      // vertex of the selected road/river first
      if (gm && sel && (sel.kind === "roads" || sel.kind === "rivers")) {
        const item = map[sel.kind].find((r) => r.id === sel.id);
        const j = item ? vertexAt(item.pts, view, sx, sy) : -1;
        if (j >= 0) {
          if (e.altKey) { onDeleteVertex(sel, j); drag.current = null; return; }
          drag.current = { ...base, mode: "vertex", j, item: sel };
          return;
        }
      }
      const hit = hitTest(map, view, sx, sy, gm);
      if (hit && gm && (hit.kind === "settlements" || hit.kind === "pois" || hit.kind === "labels")) {
        const it = map[hit.kind].find((x) => x.id === hit.id);
        drag.current = { ...base, mode: "move", hit, ox: it.x - cx, oy: it.y - cy };
        return;
      }
      drag.current = { ...base, mode: "pan", hit };
      return;
    }
    drag.current = { ...base, mode: "tap" };
  };

  const move = (e) => {
    if (!view) return;
    const [sx, sy] = local(e);
    const [cx, cy] = toCell(view, sx, sy);
    setCursor([cx, cy]);
    const d = drag.current;
    if (!d) {
      if (tool === "select" || tool === "travel") {
        const h = hitTest(map, view, sx, sy, gm);
        setHover(h && (h.kind === "settlements" || h.kind === "pois") ? h : null);
      }
      return;
    }
    if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
    if (d.mode === "pan" || (d.mode === "tap" && d.moved)) {
      d.mode = "pan"; touched.current = true;
      setView({ ...d.v0, x: d.v0.x - (sx - d.sx) / d.v0.z, y: d.v0.y - (sy - d.sy) / d.v0.z });
    } else if (d.mode === "move" && d.moved) {
      onMove(d.hit, Math.max(0, Math.min(map.w, cx + d.ox)), Math.max(0, Math.min(map.h, cy + d.oy)), true);
    } else if (d.mode === "vertex" && d.moved) {
      const s = snapToSettlement(sx, sy);
      onMoveVertex(d.item, d.j, s ? s[0] : cx, s ? s[1] : cy, true);
    } else if (d.mode === "paint") {
      onPaintDab(cx, cy);
    }
  };

  const up = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !view) return;
    const [sx, sy] = local(e);
    const [cx, cy] = toCell(view, sx, sy);
    if (d.mode === "paint") { onPaintEnd(); return; }
    if (d.mode === "move") { if (d.moved) onMove(d.hit, Math.max(0, Math.min(map.w, cx + d.ox)), Math.max(0, Math.min(map.h, cy + d.oy)), false); else onSelect(d.hit); return; }
    if (d.mode === "vertex") { if (d.moved) { const s = snapToSettlement(sx, sy); onMoveVertex(d.item, d.j, s ? s[0] : cx, s ? s[1] : cy, false); } return; }
    if (d.moved || d.button !== 0) return;
    if (d.mode === "pan") { onSelect(d.hit || null); return; }
    // taps with a placing tool
    if (cx < 0 || cy < 0 || cx > map.w || cy > map.h) return;
    if (tool === "travel") {
      const s = snapToSettlement(sx, sy);
      onWaypoint(s ? [s[0], s[1]] : [cx, cy], s?.[2]);
    } else if (tool === "road" || tool === "river") {
      const s = snapToSettlement(sx, sy);
      const p = s ? [s[0], s[1]] : [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10];
      if (e.detail >= 2 && draft?.pts?.length >= 2) { onFinishDraft(); return; }
      onDraftPoint(tool, p);
    } else if (gm) {
      onPlace(tool, cx, cy);
    }
  };

  return (
    <canvas
      ref={ref}
      className={"fm-canvas tool-" + tool}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
