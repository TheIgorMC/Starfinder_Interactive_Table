import { useEffect, useRef, useState, useCallback } from "react";
import { GRID_SIZE, getCell, worldToGrid, gridToWorld } from "../lib/grid.js";
import { centroid, pointInPolygon, distance } from "../lib/geometry.js";
import { FIELD_DEFS } from "../lib/project.js";
import { computeControlShares, hexToRgba } from "../lib/factionGen.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const SNAP_PX = 12; // screen-space snap radius, so it stays easy to hit at any zoom
const SYSTEM_HIT_PX = 8; // screen-space click radius for selecting a system
const FACTION_HIT_PX = 9; // screen-space click radius for selecting a faction seed
// A system's label needs the view zoomed to LABEL_ZOOM_MULTIPLIER times the
// initial fit-to-bounds scale before it reveals, scaled down toward 0 by
// importance (so a 1.0 landmark always shows). Anchored to the fit scale
// rather than a fixed number so it isn't crowded at the default view
// regardless of galaxy size/bounds/canvas dimensions.
const LABEL_ZOOM_MULTIPLIER = 2.5;
const FACTION_SEED_SNAP_PX = 12; // screen-space radius for snapping a new faction seed onto an existing system

export default function GalaxyCanvas({
  project,
  tool,
  activeField,
  brush,
  showSectors,
  showFactions,
  showFieldOverlay,
  selectedSectorId,
  selectedSystemId,
  selectedFactionId,
  pendingPoints,
  pendingClosed,
  pendingFactionSeed,
  onPaint,
  onAddSectorPoint,
  onCloseSectorDraft,
  onCancelSectorDraft,
  onAddFactionSeed,
  onCancelFactionSeed,
  onPlaceSystem,
  onToggleHyperlane,
  onSelectSector,
  onSelectSystem,
  onSelectFaction,
  onHover,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [fitScale, setFitScale] = useState(1); // the zoom-to-fit scale, so label thresholds scale with it rather than a fixed number
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState(null); // {sx, sy} screen coords
  const [snapPreview, setSnapPreview] = useState(null); // { world: [x,y], isCloseVertex }
  const [factionSystemSnap, setFactionSystemSnap] = useState(null); // system a new faction seed would anchor to
  const [hyperlaneFrom, setHyperlaneFrom] = useState(null); // system id the Hyperlane tool's first click picked
  const dragState = useRef(null); // { mode: "pan" | "paint", lastX, lastY }

  // Switching away from the Hyperlane tool abandons any half-made pick.
  useEffect(() => {
    if (tool !== "hyperlane") setHyperlaneFrom(null);
  }, [tool]);

  const fieldDef = FIELD_DEFS.find((f) => f.key === activeField);

  // Fit the galaxy bounds into the viewport on mount / when bounds change.
  useEffect(() => {
    const w = size.w;
    const h = size.h;
    const scale = Math.min(w / project.bounds.width, h / project.bounds.height) * 0.92;
    const offsetX = (w - project.bounds.width * scale) / 2;
    const offsetY = (h - project.bounds.height * scale) / 2;
    setView({ scale, offsetX, offsetY });
    setFitScale(scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.bounds.width, project.bounds.height, size.w, size.h]);

  // Track container size. Seeds from the container's actual box the
  // instant the ref attaches (rather than waiting on ResizeObserver's own
  // first callback) so a container that's already a non-default size on
  // mount — e.g. the side panels were dragged before a reload — doesn't
  // sit at the stale 800×600 fallback until some later resize fires.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setSize({ w: Math.max(200, box.width), h: Math.max(200, box.height) });
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

  // Finds the nearest system within snap range of a screen point — placing
  // a faction seed there anchors the faction to that system instead of an
  // arbitrary point (Docs/10-galaxy-mapgen.md §4 "seed IN a system": the
  // anchored faction then holds that one system outright).
  const findFactionSystemSnap = useCallback(
    (sx, sy) => {
      let best = null;
      let bestDist = FACTION_SEED_SNAP_PX;
      for (const system of project.systems) {
        const [px, py] = worldToScreen(system.position.x, system.position.y);
        const d = distance(px, py, sx, sy);
        if (d <= bestDist) {
          bestDist = d;
          best = system;
        }
      }
      return best;
    },
    [project.systems, worldToScreen],
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
    if (fieldDef && showFieldOverlay) {
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

    // Faction territory overlay (Docs/10-galaxy-mapgen.md §4) — a coarse
    // read of the same weighted-Voronoi control contest used at generation
    // time, sampled on the fly at grid resolution rather than persisted.
    if (showFactions && project.factions.length > 0) {
      const cellW = (bx1 - bx0) / GRID_SIZE;
      const cellH = (by1 - by0) / GRID_SIZE;
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const [wx, wy] = gridToWorld(gx + 0.5, gy + 0.5, project.bounds, GRID_SIZE);
          const shares = computeControlShares(wx, wy, project.factions);
          const top = shares[0];
          if (!top || top.share < 0.05) continue;
          const faction = project.factions.find((f) => f.slug === top.slug);
          if (!faction) continue;
          ctx.fillStyle = hexToRgba(faction.color, Math.min(0.55, top.share * 0.55));
          ctx.fillRect(bx0 + gx * cellW, by0 + gy * cellH, cellW + 0.5, cellH + 0.5);
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

    // Hyperlanes (Docs/10-galaxy-mapgen.md §3 stage 6) — drawn under the
    // system dots so the nodes read cleanly on top of the line ends.
    if (project.hyperlanes && project.hyperlanes.length > 0) {
      const byId = new Map(project.systems.map((s) => [s.id, s]));
      for (const edge of project.hyperlanes) {
        const a = byId.get(edge.a);
        const b = byId.get(edge.b);
        if (!a || !b) continue;
        const [ax, ay] = worldToScreen(a.position.x, a.position.y);
        const [bx, by] = worldToScreen(b.position.x, b.position.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        if (edge.capacity === "major trade route") {
          ctx.strokeStyle = "rgba(120,200,255,0.55)";
          ctx.lineWidth = 1.6;
        } else if (edge.capacity === "backwater spur") {
          ctx.strokeStyle = "rgba(120,140,150,0.25)";
          ctx.lineWidth = 0.75;
        } else {
          ctx.strokeStyle = "rgba(150,170,185,0.35)";
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }
    }

    // Systems (Docs/10-galaxy-mapgen.md §3 stage 4-5).
    const actorsBySystem = new Map();
    for (const a of project.actors || []) {
      if (!a.location) continue;
      const entry = actorsBySystem.get(a.location) || { authored: 0, generated: 0 };
      if (a.origin === "authored") entry.authored++; else entry.generated++;
      actorsBySystem.set(a.location, entry);
    }
    for (const system of project.systems) {
      const [sx, sy] = worldToScreen(system.position.x, system.position.y);
      const selected = system.id === selectedSystemId;
      const importance = Math.max(0, Math.min(1, Number(system.important) || 0));
      const baseRadius = selected ? 4 : 1.5 + importance;

      // Higher importance lowers the zoom level needed to reveal a label —
      // a 1.0 landmark always shows (required scale 0), an unremarkable
      // 0.0 system needs several times the initial fit-to-bounds zoom, and
      // everything in between graduates smoothly, so the map isn't
      // crowded with every generated name until the GM actually zooms in.
      const requiredScale = fitScale * LABEL_ZOOM_MULTIPLIER * (1 - importance);
      const showLabel = selected || view.scale >= requiredScale;

      // Dim the dot itself once its label is showing (unless selected —
      // that already has its own ring) so the name reads cleanly instead
      // of competing with a bright dot sitting right under it.
      const dotRgb = system.stationOnly ? "138,151,163" : "242,230,179";
      const dotAlpha = showLabel && !selected ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(sx, sy, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${dotRgb},${dotAlpha})`;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#6db3f2";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Hyperlane tool's first click — cyan ring so it's obvious which
      // system the next click will connect (or disconnect) against.
      if (tool === "hyperlane" && system.id === hyperlaneFrom) {
        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#5fd0e0";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // Contested systems (§4) are a first-class state — flag them right on
      // the map, not just in the inspector.
      if (system.control && !system.control.owner && system.control.contestedBy?.length > 0) {
        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = "#f2b537";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // A notable person/group calls this system home (§6) — a small dot
      // offset from the system marker itself, so it doesn't get confused
      // with the security/contested rings which are centered and larger.
      // Full-weight if any actor there is curated (`authored`); dimmed and
      // smaller when it's only cheap background (`generated`) presence,
      // per §3 stage 10.
      const actorInfo = actorsBySystem.get(system.slug);
      if (actorInfo) {
        const hasAuthored = actorInfo.authored > 0;
        ctx.beginPath();
        ctx.arc(sx + baseRadius + 2, sy - baseRadius - 2, hasAuthored ? 2 : 1.3, 0, Math.PI * 2);
        ctx.fillStyle = hasAuthored ? "#7ee787" : "rgba(126,231,135,0.55)";
        ctx.fill();
      }
      if (showLabel) {
        ctx.fillStyle = "#e6e9ec";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(system.name, sx, sy - (baseRadius + 4));
      }
    }

    // Faction control seeds (§4) — drawn as diamonds so they read distinctly
    // from system dots even when a faction sits near/inside a sector.
    if (showFactions) {
      for (const faction of project.factions) {
        const [fx, fy] = worldToScreen(faction.seed.x, faction.seed.y);
        const selected = faction.id === selectedFactionId;
        const r = selected ? 7 : 5;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = faction.color;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        if (selected) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-r, -r, r * 2, r * 2);
        }
        ctx.restore();
        // A home-anchored faction (§4) gets a solid ring around its own
        // system, distinct from the diamond, so "this is a capital" reads
        // at a glance even unselected.
        if (faction.homeSystem) {
          const home = project.systems.find((s) => s.slug === faction.homeSystem);
          if (home) {
            const [hx, hy] = worldToScreen(home.position.x, home.position.y);
            ctx.beginPath();
            ctx.arc(hx, hy, 9, 0, Math.PI * 2);
            ctx.strokeStyle = faction.color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        ctx.fillStyle = "#e6e9ec";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(faction.name, fx, fy - r - 6);
      }

      // Snap target while placing a seed: hovering near a system shows a
      // violet ring — clicking there anchors the faction to that system
      // instead of dropping a plain seed on open ground.
      if (tool === "faction" && factionSystemSnap) {
        const [hx, hy] = worldToScreen(factionSystemSnap.position.x, factionSystemSnap.position.y);
        ctx.beginPath();
        ctx.arc(hx, hy, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "#b56df2";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (pendingFactionSeed) {
        const [px, py] = worldToScreen(pendingFactionSeed.x, pendingFactionSeed.y);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#4f8ef7";
        ctx.fillRect(-6, -6, 12, 12);
        ctx.restore();
        if (pendingFactionSeed.homeSystem) {
          ctx.beginPath();
          ctx.arc(px, py, 10, 0, Math.PI * 2);
          ctx.strokeStyle = "#b56df2";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
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
  }, [project, view, fitScale, size, activeField, showSectors, showFactions, showFieldOverlay, selectedSectorId, selectedSystemId, selectedFactionId, pendingPoints, pendingClosed, pendingFactionSeed, cursor, snapPreview, factionSystemSnap, hyperlaneFrom, tool, brush.radius]);

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
    if (tool === "faction" && e.button === 0) {
      const systemSnap = findFactionSystemSnap(sx, sy);
      if (systemSnap) {
        onAddFactionSeed(systemSnap.position.x, systemSnap.position.y, systemSnap.slug, systemSnap.name);
      } else {
        onAddFactionSeed(wx, wy);
      }
      return;
    }
    if (tool === "system" && e.button === 0) {
      onPlaceSystem(wx, wy);
      return;
    }
    if (tool === "hyperlane" && e.button === 0) {
      const systemHit = project.systems.find((s) => {
        const [px, py] = worldToScreen(s.position.x, s.position.y);
        return distance(px, py, sx, sy) <= SYSTEM_HIT_PX;
      });
      if (!systemHit) {
        setHyperlaneFrom(null); // clicked empty space — cancel
        return;
      }
      if (hyperlaneFrom == null) {
        setHyperlaneFrom(systemHit.id);
      } else if (hyperlaneFrom === systemHit.id) {
        setHyperlaneFrom(null); // clicked the same system twice — cancel
      } else {
        onToggleHyperlane(hyperlaneFrom, systemHit.id);
        setHyperlaneFrom(null);
      }
      return;
    }
    if (tool === "select" && e.button === 0) {
      const systemHit = project.systems.find((s) => {
        const [px, py] = worldToScreen(s.position.x, s.position.y);
        return distance(px, py, sx, sy) <= SYSTEM_HIT_PX;
      });
      if (systemHit) {
        onSelectSystem(systemHit.id);
        return;
      }
      const factionHit = project.factions.find((f) => {
        const [px, py] = worldToScreen(f.seed.x, f.seed.y);
        return distance(px, py, sx, sy) <= FACTION_HIT_PX;
      });
      if (factionHit) {
        onSelectFaction(factionHit.id);
        return;
      }
      const sectorHit = project.sectors.find((s) => pointInPolygon(wx, wy, s.points));
      onSelectSector(sectorHit ? sectorHit.id : null);
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({ sx, sy });
    const [wx, wy] = screenToWorld(sx, sy);
    setSnapPreview(tool === "sector" && !pendingClosed ? findSnapCandidate(sx, sy) : null);
    setFactionSystemSnap(tool === "faction" ? findFactionSystemSnap(sx, sy) : null);

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
    if (tool === "sector") {
      if (e.key === "Escape") onCancelSectorDraft();
      if (e.key === "Enter" && pendingPoints?.length >= 3 && !pendingClosed) onCloseSectorDraft();
    }
    if (tool === "faction" && e.key === "Escape" && pendingFactionSeed) onCancelFactionSeed();
    if (tool === "hyperlane" && e.key === "Escape" && hyperlaneFrom) setHyperlaneFrom(null);
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
          setFactionSystemSnap(null);
          dragState.current = null;
          onHover?.(null, null, null);
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => tool === "brush" && e.preventDefault()}
      />
    </div>
  );
}
