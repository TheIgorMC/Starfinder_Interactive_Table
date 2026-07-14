import { useEffect, useRef, useState, useCallback } from "react";
import { GRID_SIZE, getCell, worldToGrid } from "../lib/grid.js";
import { centroid, pointInPolygon, distance } from "../lib/geometry.js";
import { FIELD_DEFS } from "../lib/project.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const SNAP_PX = 12; // screen-space snap radius, so it stays easy to hit at any zoom

export default function GalaxyCanvas({
  project,
  tool,
  activeField,
  brush,
  showSectors,
  selectedSectorId,
  pendingPoints,
  pendingClosed,
  onPaint,
  onAddSectorPoint,
  onCloseSectorDraft,
  onCancelSectorDraft,
  onSelectSector,
  onHover,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState(null); // {sx, sy} screen coords
  const [snapPreview, setSnapPreview] = useState(null); // { world: [x,y], isCloseVertex }
  const dragState = useRef(null); // { mode: "pan" | "paint", lastX, lastY }

  const fieldDef = FIELD_DEFS.find((f) => f.key === activeField);

  // Fit the galaxy bounds into the viewport on mount / when bounds change.
  useEffect(() => {
    const w = size.w;
    const h = size.h;
    const scale = Math.min(w / project.bounds.width, h / project.bounds.height) * 0.92;
    const offsetX = (w - project.bounds.width * scale) / 2;
    const offsetY = (h - project.bounds.height * scale) / 2;
    setView({ scale, offsetX, offsetY });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.bounds.width, project.bounds.height, size.w, size.h]);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setSize({ w: Math.max(200, box.width), h: Math.max(200, box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (x, y) => [x * view.scale + view.offsetX, y * view.scale + view.offsetY],
    [view],
  );
  const screenToWorld = useCallback(
    (sx, sy) => [(sx - view.offsetX) / view.scale, (sy - view.offsetY) / view.scale],
    [view],
  );

  // Finds the nearest existing vertex (any committed sector, or the current
  // in-progress boundary) within SNAP_PX of a screen point — this is what
  // lets neighboring sectors share an exact vertex instead of drifting
  // apart by a few units, and lets closing the current boundary snap back
  // onto its own first point instead of dropping a duplicate on top of it.
  const findSnapCandidate = useCallback(
    (sx, sy) => {
      let best = null;
      let bestDist = SNAP_PX;
      const consider = (wx, wy, isCloseVertex) => {
        const [px, py] = worldToScreen(wx, wy);
        const d = distance(px, py, sx, sy);
        if (d <= bestDist) {
          bestDist = d;
          best = { world: [wx, wy], isCloseVertex };
        }
      };
      for (const sector of project.sectors) {
        for (const [wx, wy] of sector.points) consider(wx, wy, false);
      }
      if (pendingPoints) {
        pendingPoints.forEach(([wx, wy], i) => {
          consider(wx, wy, i === 0 && pendingPoints.length >= 3);
        });
      }
      return best;
    },
    [project.sectors, pendingPoints, worldToScreen],
  );

  // --- Draw ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // Background.
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, size.w, size.h);

    // Galaxy bounds rectangle.
    const [bx0, by0] = worldToScreen(0, 0);
    const [bx1, by1] = worldToScreen(project.bounds.width, project.bounds.height);
    ctx.fillStyle = "#0b0e11";
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);

    // Active field heatmap.
    if (fieldDef) {
      const grid = project.fields[activeField];
      const cellW = ((bx1 - bx0) / GRID_SIZE);
      const cellH = ((by1 - by0) / GRID_SIZE);
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const v = grid[gy * GRID_SIZE + gx];
          if (v <= 0.01) continue;
          ctx.fillStyle = `rgba(${fieldDef.color}, ${Math.min(0.9, v * 0.85 + 0.05)})`;
          ctx.fillRect(
            bx0 + gx * cellW,
            by0 + gy * cellH,
            cellW + 0.5,
            cellH + 0.5,
          );
        }
      }
    }

    // Bounds border.
    ctx.strokeStyle = "#33414f";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

    // Sectors.
    if (showSectors) {
      for (const sector of project.sectors) {
        const pts = sector.points.map(([x, y]) => worldToScreen(x, y));
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        const selected = sector.id === selectedSectorId;
        ctx.fillStyle = selected ? "rgba(79,142,247,0.14)" : "rgba(230,230,235,0.05)";
        ctx.fill();
        ctx.strokeStyle = selected ? "#6db3f2" : "#5a6773";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.stroke();

        const [cx, cy] = worldToScreen(...centroid(sector.points));
        ctx.fillStyle = "#c9d3dc";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${sector.name} (${sector.focus})`, cx, cy);
      }
    }

    // In-progress sector polygon.
    if (pendingPoints && pendingPoints.length > 0) {
      const pts = pendingPoints.map(([x, y]) => worldToScreen(x, y));

      if (pendingClosed) {
        // Boundary is finalized (not yet named/committed) — draw it as a
        // real closed shape, no rubber-band/cursor tracking anymore.
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = "rgba(79,142,247,0.18)";
        ctx.fill();
        ctx.strokeStyle = "#4f8ef7";
        ctx.lineWidth = 2;
        ctx.stroke();
        pts.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#4f8ef7";
          ctx.fill();
        });
      } else {
        // Still drawing: a faint closing preview back to the start, always
        // visible once there's enough of a shape to close, plus a
        // rubber-band from the last vertex to the live cursor.
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
          ctx.lineTo(pts[0][0], pts[0][1]);
          ctx.strokeStyle = "rgba(79,142,247,0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.stroke();
        }

        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        if (cursor) ctx.lineTo(cursor.sx, cursor.sy);
        ctx.strokeStyle = "#4f8ef7";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        pts.forEach(([x, y], i) => {
          const isCloseTarget = i === 0 && pts.length >= 3;
          ctx.beginPath();
          ctx.arc(x, y, isCloseTarget ? 7 : 4, 0, Math.PI * 2);
          ctx.fillStyle = "#4f8ef7";
          ctx.fill();
          if (isCloseTarget) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
      }
    }

    // Snap target highlight — a vertex (this boundary's own start, or
    // another sector's corner) the next click will lock onto. Only
    // relevant while still placing points (state is cleared once closed).
    if (snapPreview) {
      const [sx, sy] = worldToScreen(...snapPreview.world);
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.strokeStyle = snapPreview.isCloseVertex ? "#7ee787" : "#f2b537";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Brush cursor.
    if (tool === "brush" && cursor) {
      ctx.beginPath();
      ctx.arc(cursor.sx, cursor.sy, brush.radius * view.scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, view, size, activeField, showSectors, selectedSectorId, pendingPoints, pendingClosed, cursor, snapPreview, tool, brush.radius]);

  // --- Interaction ---
  const handleWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);
    const factor = Math.pow(1.1, -e.deltaY / 100);
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      return {
        scale,
        offsetX: sx - wx * scale,
        offsetY: sy - wy * scale,
      };
    });
  };

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);

    if (e.button === 1 || tool === "pan") {
      dragState.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (tool === "brush" && e.button === 0) {
      dragState.current = { mode: "paint" };
      onPaint(wx, wy, e.shiftKey);
      return;
    }
    if (tool === "sector" && e.button === 0) {
      if (pendingClosed) return; // boundary is locked — use the Sectors panel to edit/create/cancel
      const snap = findSnapCandidate(sx, sy);
      if (snap?.isCloseVertex) {
        onCloseSectorDraft();
        return;
      }
      const [px, py] = snap ? snap.world : [wx, wy];
      onAddSectorPoint(px, py);
      return;
    }
    if (tool === "select" && e.button === 0) {
      const hit = project.sectors.find((s) => pointInPolygon(wx, wy, s.points));
      onSelectSector(hit ? hit.id : null);
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({ sx, sy });
    const [wx, wy] = screenToWorld(sx, sy);
    setSnapPreview(tool === "sector" && !pendingClosed ? findSnapCandidate(sx, sy) : null);

    const drag = dragState.current;
    if (drag?.mode === "pan") {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      setView((v) => ({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }));
      return;
    }
    if (drag?.mode === "paint") {
      onPaint(wx, wy, e.shiftKey);
    }

    if (wx >= 0 && wy >= 0 && wx <= project.bounds.width && wy <= project.bounds.height) {
      const [gx, gy] = worldToGrid(wx, wy, project.bounds);
      const v = getCell(project.fields[activeField], GRID_SIZE, Math.floor(gx), Math.floor(gy));
      onHover?.(wx, wy, v);
    } else {
      onHover?.(null, null, null);
    }
  };

  const handleMouseUp = () => {
    dragState.current = null;
  };

  const handleKeyDown = (e) => {
    if (tool !== "sector") return;
    if (e.key === "Escape") onCancelSectorDraft();
    if (e.key === "Enter" && pendingPoints?.length >= 3 && !pendingClosed) onCloseSectorDraft();
  };

  return (
    <div className="gg-canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setCursor(null);
          setSnapPreview(null);
          dragState.current = null;
          onHover?.(null, null, null);
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => tool === "brush" && e.preventDefault()}
      />
    </div>
  );
}
