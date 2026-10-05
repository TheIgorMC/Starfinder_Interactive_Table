import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useWs } from "../api.js";
import MapView from "./MapView.jsx";
import { Inspector, MapProperties } from "./Inspector.jsx";
import TravelPanel from "./TravelPanel.jsx";
import Treasury from "./Treasury.jsx";
import IndexPanel from "./IndexPanel.jsx";
import TimelinePanel from "./TimelinePanel.jsx";
import BooksPanel from "./BooksPanel.jsx";
import GeneratorDialog from "./GeneratorDialog.jsx";
import { createTerrain, paintTerrain, terrainFields, settlementIcon, poiIcon, THEMES } from "./render.js";
import { buildWorld, encodeTerrain, BIOMES, LAND_BRUSHES, SETTLEMENT_TYPES, POI_TYPES, ROAD_TYPES, LABEL_TYPES, EVENT_TYPES, newId, simplify, citing, findChapter } from "./lib/model.js";
import { generateMap, buildRoads } from "./lib/generate.js";
import { makeNamer } from "./lib/names.js";
import { rngFrom } from "./lib/rng.js";
import { findPath } from "./lib/path.js";
import { computeRoute } from "./lib/travel.js";
import { defaultTreasury } from "./lib/currency.js";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "./fantasy.css";

const TOOLS = [
  { key: "select", k: "v", label: "Select", gm: false },
  { key: "settlement", k: "s", label: "Settlement", gm: true },
  { key: "poi", k: "p", label: "Place", gm: true },
  { key: "road", k: "r", label: "Road", gm: true },
  { key: "river", k: "i", label: "River", gm: true },
  { key: "brush", k: "b", label: "Terrain", gm: true },
  { key: "label", k: "l", label: "Label", gm: true },
  { key: "event", k: "e", label: "Event", gm: true },
  { key: "travel", k: "m", label: "Travel", gm: false },
];

async function req(method, url, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// deep links: /fantasy?map=3&sel=settlements:s123  or  &ch=<chapter id>
function readDeepLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const [kind, id] = (q.get("sel") || "").split(":");
    return { map: Number(q.get("map")) || null, sel: kind && id ? { kind, id } : null, ch: q.get("ch") || null, book: q.get("book") || null };
  } catch { return {}; }
}

export default function FantasyApp({ embedded = false, active = true }) {
  const { user } = useAuth();
  const deep = useRef(embedded ? {} : readDeepLink());
  const gm = user?.role === "gm";
  const [list, setList] = useState(null);
  const [cur, setCur] = useState(null); // { id, version }
  const [map, setMapState] = useState(null);
  const savedRef = useRef(null);
  const [status, setStatus] = useState("saved");
  const [remote, setRemote] = useState(null);
  const [error, setError] = useState("");
  const past = useRef([]), future = useRef([]), live = useRef(false);
  const mapRef = useRef(null);
  mapRef.current = map;
  const ownVersions = useRef(new Set());

  // ---- loading / saving ----------------------------------------------------
  const refreshList = useCallback(async () => {
    const r = await req("GET", "/api/fantasy");
    if (r.ok) setList(r.data);
    return r.data || [];
  }, []);
  const open = useCallback(async (id) => {
    const r = await req("GET", `/api/fantasy/${id}`);
    if (!r.ok) { setError(r.data?.error || "could not open the map"); return; }
    past.current = []; future.current = [];
    // maps made before events/books existed
    const loaded = { events: [], books: [], ...r.data.data };
    r.data.data = loaded;
    savedRef.current = loaded;
    setMapState(loaded);
    setCur({ id: r.data.id, version: r.data.version });
    setStatus("saved"); setRemote(null); setSel(null); setDraft(null); setOpenChapter(null); setPinFor(null);
    setTrip((t) => ({ ...t, waypoints: [], names: [] }));
    const d = deep.current;
    if (d.map === r.data.id) {
      const data = r.data.data;
      if (d.sel) {
        const it = data[d.sel.kind]?.find((x) => x.id === d.sel.id);
        if (it) {
          setSel(d.sel); setTab("details");
          const p = it.pts ? it.pts[Math.floor(it.pts.length / 2)] : it.x != null ? [it.x, it.y] : null;
          if (p) setTimeout(() => setFocus({ x: p[0], y: p[1], z: 6, t: Date.now() }), 300);
        }
      }
      if (d.ch && findChapter(data, d.ch)) { setTab("book"); setOpenChapter(d.ch); }
      if (d.book && (data.books || []).some((b) => b.id === d.book)) setTab("book");
      deep.current = {};
    }
    try { localStorage.setItem("fm-last", String(id)); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    if (user === undefined) return;
    refreshList().then((l) => {
      let last = null;
      try { last = Number(localStorage.getItem("fm-last")); } catch { /* ignore */ }
      const pickId = l.find((m) => m.id === deep.current.map)?.id ?? l.find((m) => m.id === last)?.id ?? l[0]?.id;
      if (pickId) open(pickId);
    });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMap = useCallback((fn, opts = {}) => {
    setMapState((m) => {
      const next = typeof fn === "function" ? fn(m) : fn;
      if (next === m) return m;
      if (opts.live) { if (!live.current) { past.current.push(m); live.current = true; } }
      else if (live.current) live.current = false;
      else if (!opts.noHistory) past.current.push(m);
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      return next;
    });
  }, []);
  useEffect(() => { if (map && savedRef.current && map !== savedRef.current && status === "saved") setStatus("pending"); }, [map, status]);

  const save = useCallback(async (overwrite) => {
    const m = mapRef.current;
    if (!gm || !m || !cur) return;
    setStatus("saving");
    const r = await req("PUT", `/api/fantasy/${cur.id}`, { data: m, name: m.name, baseVersion: overwrite ? undefined : cur.version });
    if (r.status === 409) { setStatus("conflict"); setRemote(r.data?.version ?? -1); return; }
    if (!r.ok) { setStatus("error"); setError(r.data?.error || "save failed"); return; }
    savedRef.current = m;
    setCur({ id: cur.id, version: r.data.version });
    ownVersions.current.add(r.data.version);
    setRemote(null);
    setStatus(mapRef.current === m ? "saved" : "pending");
    refreshList();
  }, [gm, cur, refreshList]);
  useWs((msg) => {
    if (msg.type !== "fantasy:updated") return;
    const p = msg.payload || {};
    if (!cur || p.id !== cur.id) { refreshList(); return; }
    if (p.deleted) { setMapState(null); setCur(null); refreshList(); return; }
    if (ownVersions.current.has(p.version) || p.version === cur.version) return;
    if (mapRef.current === savedRef.current) open(cur.id);
    else setRemote(p.version);
  });
  useEffect(() => {
    const warn = (e) => { if (gm && mapRef.current && mapRef.current !== savedRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [gm]);

  // ---- derived runtime ---------------------------------------------------
  const world = useMemo(() => (map ? buildWorld(map) : null), [map?.terrain, map?.roads, map?.rivers, map?.kmPerCell]); // eslint-disable-line react-hooks/exhaustive-deps
  const [styleOverride, setStyleOverride] = useState(null);
  const style = (gm ? map?.style : styleOverride || map?.style) || "parchment";
  const viewMap = useMemo(() => (map ? { ...map, style } : null), [map, style]);
  const [terrain, setTerrain] = useState(null);
  const [terrainRev, setTerrainRev] = useState(0);
  const paintedTerrain = useRef(null);
  const terrainKey = useRef({});
  // the terrain canvas is rebuilt whenever the stored terrain changes (load,
  // undo, regenerate) — except right after a brush stroke, which already
  // painted its cells in place
  useEffect(() => {
    if (!map || !world) { setTerrain(null); terrainKey.current = {}; return; }
    const k = terrainKey.current;
    if (k.terrain === map.terrain && k.style === style) return;
    const justPainted = terrain && paintedTerrain.current === map.terrain && k.style === style;
    terrainKey.current = { terrain: map.terrain, style };
    if (!justPainted) setTerrain(createTerrain(world, style));
  }, [map?.terrain, style, world]); // eslint-disable-line react-hooks/exhaustive-deps

  const treasury = useMemo(() => map?.currency || defaultTreasury(), [map?.currency]);
  const setTreasury = (fn) => setMap((m) => ({ ...m, currency: fn(m.currency || treasury) }));
  const unit = map?.travel?.unit || "km";

  // ---- UI state ------------------------------------------------------------
  const [tool, setToolState] = useState("select");
  const [toolOpts, setToolOpts] = useState({ settlementType: "village", poiType: "cave", roadType: "road", labelType: "region", brush: "F", brushR: 3, autoTrace: true, riverWidth: 1.2 });
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("details");
  const [draft, setDraft] = useState(null);
  const [focus, setFocus] = useState(null);
  const [fitRev, setFitRev] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [trip, setTrip] = useState({ waypoints: [], names: [], mode: "foot", pace: "normal", crow: false });
  const [openChapter, setOpenChapter] = useState(null);
  const [showEvents, setShowEvents] = useState(true);
  const [pinFor, setPinFor] = useState(null); // event waiting for a map click
  const [toast, setToast] = useState("");
  const setTool = (t) => { setToolState(t); setDraft(null); setPinFor(null); if (t === "travel") setTab("travel"); };
  const select = (s) => { setSel(s); if (s) setTab("details"); };

  const namer = useMemo(() => makeNamer(rngFrom(Math.random()), map?.options?.culture || "anglo"), [map?.options?.culture]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- edits ---------------------------------------------------------------
  const update = (s, patch, opts) => setMap((m) => ({ ...m, [s.kind]: m[s.kind].map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }), opts);
  const remove = (s) => { setMap((m) => ({ ...m, [s.kind]: m[s.kind].filter((x) => x.id !== s.id) })); setSel(null); };
  const onMove = (hit, x, y, isLive) => update(hit, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }, { live: isLive });
  const onMoveVertex = (s, j, x, y, isLive) => setMap((m) => ({ ...m, [s.kind]: m[s.kind].map((r) => (r.id !== s.id ? r : { ...r, pts: r.pts.map((p, k) => (k === j ? [Math.round(x * 100) / 100, Math.round(y * 100) / 100] : p)) })) }), { live: isLive });
  const onDeleteVertex = (s, j) => setMap((m) => ({ ...m, [s.kind]: m[s.kind].map((r) => (r.id !== s.id || r.pts.length <= 2 ? r : { ...r, pts: r.pts.filter((_, k) => k !== j) })) }));
  const blank = { description: "", images: [], gmNotes: "", hidden: false };
  const onPlace = (t, x, y) => {
    x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
    let kind, item;
    if (t === "settlement") {
      const type = toolOpts.settlementType, [p0, p1] = SETTLEMENT_TYPES[type].pop;
      kind = "settlements"; item = { id: newId("s"), type, name: namer.place(type), x, y, population: Math.round((p0 + p1) / 20) * 10, port: false, ...blank };
    } else if (t === "poi") {
      kind = "pois"; item = { id: newId("p"), type: toolOpts.poiType, name: namer.poi(toolOpts.poiType), x, y, ...blank };
    } else if (t === "event") {
      if (pinFor) {
        update({ kind: "events", id: pinFor }, { x, y });
        select({ kind: "events", id: pinFor });
        setPinFor(null); setToolState("select");
        return;
      }
      kind = "events"; item = { id: newId("e"), type: "other", name: "New event", date: "", sort: null, places: [], refs: [], x, y, ...blank };
      // tie it to the nearest settlement or place, if close
      const near = [...map.settlements.map((q) => ({ kind: "settlements", q })), ...map.pois.map((q) => ({ kind: "pois", q }))]
        .map((o) => ({ ...o, d: Math.hypot(o.q.x - x, o.q.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 3) item.places = [{ kind: near.kind, id: near.q.id }];
    } else if (t === "label") {
      kind = "labels"; item = { id: newId("l"), type: toolOpts.labelType, name: toolOpts.labelType === "note" ? "Note" : namer.feature(toolOpts.labelType), x, y, size: 2.5, angle: 0, ...blank };
    } else return;
    setMap((m) => ({ ...m, [kind]: [...m[kind], item] }));
    select({ kind, id: item.id });
  };
  const traceStep = (a, b, diag) => {
    const code = world.biome[b];
    const cost = { 71: 1, 65: 1, 82: 1.5, 84: 1.7, 70: 2, 72: 2.4, 68: 3.5, 87: 5, 77: 9, 83: 25 }[code];
    if (cost === undefined) return Infinity;
    const c = (cost + Math.abs(world.height[b] - world.height[a]) * 40) * (world.road[b] ? 0.4 : 1) + (world.river[b] && !world.road[b] ? 6 : 0);
    return diag ? c * 1.4142 : c;
  };
  const onDraftPoint = (kind, p) => {
    setDraft((dr) => {
      const pts = dr?.kind === kind ? dr.pts : [];
      if (kind === "road" && toolOpts.autoTrace && pts.length && world) {
        const last = pts[pts.length - 1];
        const cell = ([x, y]) => Math.min(world.h - 1, Math.max(0, Math.floor(y))) * world.w + Math.min(world.w - 1, Math.max(0, Math.floor(x)));
        const s = cell(last), t = cell(p);
        const r = s !== t && findPath({ w: world.w, h: world.h, start: s, target: t, isGoal: (k) => k === t, step: traceStep, minStep: 0.4 });
        if (r) {
          const mid = r.path.slice(1, -1).map((k) => [k % world.w + 0.5, Math.floor(k / world.w) + 0.5]);
          return { kind, pts: [...pts, ...simplify([last, ...mid, p], 0.6).slice(1)] };
        }
      }
      return { kind, pts: [...pts, p] };
    });
  };
  const finishDraft = () => {
    if (!draft || draft.pts.length < 2) { setDraft(null); return; }
    const pts = draft.pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    let s;
    if (draft.kind === "road") {
      const item = { id: newId("r"), type: toolOpts.roadType, name: "", pts, ...blank };
      setMap((m) => ({ ...m, roads: [...m.roads, item] })); s = { kind: "roads", id: item.id };
    } else {
      const item = { id: newId("v"), name: "", width: toolOpts.riverWidth, pts, ...blank };
      setMap((m) => ({ ...m, rivers: [...m.rivers, item] })); s = { kind: "rivers", id: item.id };
    }
    setDraft(null);
    select(s);
  };

  // terrain brush: mutate the runtime world, repaint the dab, commit at the end
  const stroke = useRef(null);
  const onPaintDab = (cx, cy) => {
    if (!world || !terrain) return;
    const code = toolOpts.brush.charCodeAt(0), r = toolOpts.brushR, sea = world.sea;
    const rel = (e) => sea + (1 - sea) * e;
    let touched = false;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const i = y * world.w + x;
      if (world.biome[i] === code) continue;
      world.biome[i] = code; touched = true;
      const h = world.height[i];
      if (code === 79 || code === 76) world.height[i] = Math.min(h, sea - 0.02);
      else if (code === 77) world.height[i] = Math.max(h, rel(0.7));
      else if (code === 83) world.height[i] = Math.max(h, rel(0.85));
      else if (code === 72) world.height[i] = Math.min(Math.max(h, rel(0.5)), rel(0.62));
      else world.height[i] = Math.min(Math.max(h, rel(0.04)), rel(0.45));
    }
    if (!touched) return;
    stroke.current = true;
    terrain.fields = terrainFields(world);
    paintTerrain(terrain, world, { x0: cx - r - 6, y0: cy - r - 6, x1: cx + r + 6, y1: cy + r + 6 });
    setTerrainRev((v) => v + 1);
  };
  const onPaintEnd = () => {
    if (!stroke.current || !world) return;
    stroke.current = null;
    const t = encodeTerrain(world);
    paintedTerrain.current = t;
    setMap((m) => ({ ...m, terrain: t }));
  };

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(mapRef.current);
    setMapState(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(mapRef.current);
    setMapState(next);
  };

  const pick = (s) => {
    const it = map[s.kind]?.find((x) => x.id === s.id);
    if (!it) return;
    const p = it.pts ? it.pts[Math.floor(it.pts.length / 2)] : it.x != null ? [it.x, it.y] : null;
    select(s);
    if (p) setFocus({ x: p[0], y: p[1], z: 6, t: Date.now() });
  };
  // where an in-text link or a citation leads
  const onLink = (t) => {
    if (t.kind === "chapter") { setTab("book"); setOpenChapter(t.id); return; }
    if (t.kind === "book") { setTab("book"); setOpenChapter(null); return; }
    pick(t);
  };
  const newEvent = () => {
    const item = { id: newId("e"), type: "other", name: "New event", date: "", sort: null, places: sel && sel.kind !== "events" && sel.kind !== "roads" ? [{ kind: sel.kind, id: sel.id }] : [], refs: [], x: null, y: null, description: "", images: [], gmNotes: "", hidden: false };
    setMap((m) => ({ ...m, events: [...(m.events || []), item] }));
    select({ kind: "events", id: item.id });
  };
  const linkFor = (t) => {
    const base = `${window.location.origin}/fantasy?map=${cur?.id}`;
    return t.kind === "map" ? base : t.kind === "chapter" ? `${base}&ch=${t.id}` : t.kind === "book" ? `${base}&book=${t.id}` : `${base}&sel=${t.kind}:${t.id}`;
  };
  const copyLink = async (t) => {
    const url = linkFor(t);
    try { await navigator.clipboard.writeText(url); setToast("Link copied — paste it in your manuscript"); }
    catch { window.prompt("Copy this link", url); }
    setTimeout(() => setToast(""), 2500);
  };
  // keep the address bar on what is open, so it can be bookmarked or shared
  useEffect(() => {
    if (embedded || !cur) return;
    const url = openChapter && tab === "book" ? `/fantasy?map=${cur.id}&ch=${openChapter}` : sel ? `/fantasy?map=${cur.id}&sel=${sel.kind}:${sel.id}` : `/fantasy?map=${cur.id}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [embedded, cur, sel, openChapter, tab]);
  const highlight = useMemo(() => {
    if (!map || tab !== "book" || !openChapter) return null;
    return new Set(citing(map, openChapter).map((c) => c.item.id));
  }, [map, tab, openChapter]);

  // ---- map-level actions -----------------------------------------------------
  const createMap = async (opts) => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    const data = generateMap(opts);
    data.currency = defaultTreasury();
    const r = await req("POST", "/api/fantasy", { data, name: data.name });
    setBusy(false);
    if (!r.ok) { setError(r.data?.error || "could not create the map"); return; }
    setDialog(null);
    await refreshList();
    open(r.data.id);
  };
  const regenerate = async (opts) => {
    if (!window.confirm("Replace this map's terrain, settlements, roads and places with a new generation? (Undo still works until you leave.)")) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    const data = generateMap(opts);
    setBusy(false);
    setDialog(null);
    setSel(null);
    setMap((m) => ({ ...data, currency: m.currency, travel: m.travel, playerVisible: m.playerVisible, description: m.description, images: m.images, gmNotes: m.gmNotes }));
    setFitRev((v) => v + 1);
  };
  const rebuildRoads = () => {
    if (!window.confirm("Re-trace the generated roads between the current settlements? Roads you drew yourself are kept.")) return;
    const roads = buildRoads({ ...world, river: world.river }, map.settlements.map((s) => ({ ...s })), rngFrom(map.seed + ":rb"));
    setMap((m) => ({ ...m, roads: [...m.roads.filter((r) => !r.auto), ...roads] }));
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(map)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(map.name || "map").replace(/[^a-z0-9_-]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const r = await req("POST", "/api/fantasy", { data, name: data.name });
      if (!r.ok) throw new Error(r.data?.error || "import failed");
      await refreshList();
      open(r.data.id);
    } catch (e) { setError(e.message); }
  };
  const deleteMap = async () => {
    if (!window.confirm(`Delete "${map.name}" for good?`)) return;
    await req("DELETE", `/api/fantasy/${cur.id}`);
    setMapState(null); setCur(null);
    const l = await refreshList();
    if (l[0]) open(l[0].id);
  };

  // ---- keyboard ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (!active || !map) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z" && gm) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y" && gm) { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      if (e.key === "Escape") { if (pinFor) { setPinFor(null); setToolState("select"); } else if (draft) setDraft(null); else if (sel) setSel(null); else setTool("select"); return; }
      if (e.key === "Enter" && draft) { finishDraft(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && gm && sel) { e.preventDefault(); remove(sel); return; }
      const t = TOOLS.find((x) => x.k === e.key.toLowerCase() && (gm || !x.gm));
      if (t) setTool(t.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const routeView = useMemo(() => {
    if (tab !== "travel" && tool !== "travel") return null;
    if (!world || trip.waypoints.length < 2) return { waypoints: trip.waypoints };
    const r = computeRoute(world, trip.waypoints, trip.mode, { crow: trip.crow });
    return { pts: r.ok ? r.pts : [], waypoints: trip.waypoints };
  }, [world, trip, tab, tool]);

  // ---- render ------------------------------------------------------------------
  if (user === undefined || list === null) return <div className="fm fm-empty">Unrolling the maps…</div>;
  const STATUS = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…", conflict: "Conflict", error: "Save failed" };
  const tools = TOOLS.filter((t) => gm || !t.gm);
  return (
    <div className={"fm" + (embedded ? " embedded" : "")}>
      <header className="fm-top">
        {!embedded && <Link to="/" className="fm-back" title="Back to SIT">‹</Link>}
        <div className="fm-brand">Fantasy Atlas</div>
        {list.length > 0 && (
          <select className="fm-in fm-picker" value={cur?.id || ""} onChange={(e) => {
            if (gm && mapRef.current !== savedRef.current && !window.confirm("Leave this map without saving?")) return;
            open(Number(e.target.value));
          }}>
            {list.map((m) => <option key={m.id} value={m.id}>{m.name}{gm && m.player_visible ? " · shared" : ""}</option>)}
          </select>
        )}
        {gm && <button className="fm-btn" onClick={() => setDialog({ mode: "new" })}>New map</button>}
        {gm && <label className="fm-btn">Import<input type="file" accept="application/json" hidden onChange={(e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; }} /></label>}
        <div className="fm-spacer" />
        {map && (
          <div className="fm-seg small">
            {["parchment", "atlas"].map((s) => <button key={s} className={style === s ? "on" : ""} onClick={() => (gm ? setMap((m) => ({ ...m, style: s })) : setStyleOverride(s))}>{s === "parchment" ? "Parchment" : "Atlas"}</button>)}
          </div>
        )}
        {gm && map && <>
          <button className="fm-btn icon" title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
          <button className="fm-btn icon" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}>↷</button>
          <button className={"fm-btn save " + status} onClick={() => save()} title={error || "Save (Ctrl+S)"}><i />{STATUS[status]}{status === "saved" && cur ? ` · v${cur.version}` : ""}</button>
        </>}
      </header>
      {(status === "conflict" || remote != null) && gm && (
        <div className="fm-banner">The map was changed elsewhere{status === "conflict" ? " — your save was not applied" : ""}.
          <button className="fm-btn" onClick={() => open(cur.id)}>Load theirs</button>
          <button className="fm-btn danger" onClick={() => save(true)}>Overwrite with mine</button></div>
      )}
      {error && <div className="fm-banner err">{error}<button className="fm-btn" onClick={() => setError("")}>×</button></div>}

      {!map ? (
        <div className="fm-empty">
          {gm ? <>
            <h2 className="fm-title">No region drawn yet</h2>
            <p>Generate a territory — coast, rivers, forests, mountains, towns and the roads between them — then edit everything by hand.</p>
            <button className="fm-btn primary" onClick={() => setDialog({ mode: "new" })}>Generate a map</button>
          </> : <><h2 className="fm-title">No maps yet</h2><p>The GM hasn't shared a map with the players.</p></>}
        </div>
      ) : (
        <div className="fm-body">
          <nav className="fm-tools">
            {tools.map((t) => (
              <button key={t.key} className={tool === t.key ? "on" : ""} onClick={() => setTool(t.key)} title={`${t.label} (${t.k.toUpperCase()})`}>
                <ToolIcon k={t.key} /><span>{t.label}</span>
              </button>
            ))}
          </nav>
          <main className="fm-main">
            {gm && tool !== "select" && tool !== "travel" && tool !== "event" && (
              <ToolBar tool={tool} o={toolOpts} set={(p) => setToolOpts((o) => ({ ...o, ...p }))} draft={draft} finish={finishDraft} cancel={() => setDraft(null)} style={style} />
            )}
            {terrain && world && (
              <MapView map={viewMap} world={world} terrain={terrain} terrainRev={terrainRev} gm={gm} tool={tool} toolOpts={toolOpts}
                sel={sel} onSelect={select} onMove={onMove} onMoveVertex={onMoveVertex} onDeleteVertex={onDeleteVertex} onPlace={onPlace}
                draft={draft} onDraftPoint={onDraftPoint} onFinishDraft={finishDraft} route={routeView} fitRev={fitRev}
                onWaypoint={(p, s) => setTrip((t) => ({ ...t, waypoints: [...t.waypoints, p], names: [...(t.names || []), s?.name || ""] }))}
                onPaintDab={onPaintDab} onPaintEnd={onPaintEnd} focus={focus} paused={!active} showEvents={showEvents} highlight={highlight} />
            )}
            <div className="fm-mapbtns"><button className="fm-btn icon" title="Fit the map" onClick={() => setFitRev((v) => v + 1)}>⤢</button></div>
            <div className="fm-hint">{pinFor ? "Click the map where the event happened · Esc cancels" : gm ? HINTS[tool] : tool === "travel" ? HINTS.travel : "Drag to pan · wheel to zoom · click a place to read about it"}</div>
            {toast && <div className="fm-toast">{toast}</div>}
          </main>
          <aside className="fm-side">
            <div className="fm-tabs">
              {[["details", "Details"], ["travel", "Travel"], ["timeline", "Timeline"], ["book", "Book"], ["coins", "Coins"], ["index", "Index"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            <div className="fm-panel">
              {tab === "details" && (sel
                ? <Inspector map={map} sel={sel} gm={gm} update={update} remove={remove} onClose={() => setSel(null)} unit={unit} currencies={treasury.currencies}
                    onLink={onLink} onCopyLink={copyLink} pinning={!!pinFor} onPinEvent={(id) => { if (pinFor) { setPinFor(null); setToolState("select"); } else { setPinFor(id); setToolState("event"); setDraft(null); } }} />
                : <MapProperties map={map} gm={gm} setMap={setMap} onRebuildRoads={rebuildRoads} onRegenerate={() => setDialog({ mode: "regen" })} onExport={exportJson} onDelete={deleteMap} onLink={onLink} onCopyLink={copyLink} />)}
              {tab === "timeline" && <TimelinePanel map={map} gm={gm} onNew={newEvent} onPick={pick} showEvents={showEvents} setShowEvents={setShowEvents} onLink={onLink} />}
              {tab === "book" && <BooksPanel map={map} gm={gm} setMap={setMap} openChapter={openChapter} setOpenChapter={setOpenChapter} onPick={pick} onLink={onLink} onCopyLink={copyLink} />}
              {tab === "travel" && <TravelPanel map={map} world={world} trip={trip} setTrip={setTrip} unit={unit} />}
              {tab === "coins" && <Treasury treasury={treasury} setTreasury={setTreasury} gm={gm} />}
              {tab === "index" && <IndexPanel map={map} gm={gm} onPick={pick} />}
            </div>
          </aside>
        </div>
      )}
      {dialog && (
        <GeneratorDialog busy={busy} title={dialog.mode === "new" ? "A new region" : "Regenerate this region"} initial={dialog.mode === "regen" ? map?.options : null}
          onCancel={() => setDialog(null)} onGenerate={dialog.mode === "new" ? createMap : regenerate} />
      )}
    </div>
  );
}

const HINTS = {
  select: "Drag to pan · wheel to zoom · click to select · drag places to move them · Del deletes · Ctrl+Z undo · Ctrl+S save",
  settlement: "Click to found a settlement of the chosen kind",
  poi: "Click to add a place: cave, ruin, tower, shrine…",
  road: "Click to lay points (auto-trace follows the terrain) · double-click or Enter to finish · Esc cancels",
  river: "Click to lay the course from source to mouth · double-click or Enter to finish",
  brush: "Paint terrain: forests, mountains, hills, marsh, water… · right-drag pans",
  label: "Click to name a region, forest, range, sea…",
  event: "Click the map where something happened: a battle, a founding, a plague… (Timeline tab lists them all)",
  travel: "Click stops on the map (snaps to settlements) · see the Travel tab for times",
};

function ToolBar({ tool, o, set, draft, finish, cancel, style }) {
  const th = THEMES[style] || THEMES.parchment;
  return (
    <div className="fm-toolbar">
      {tool === "settlement" && Object.entries(SETTLEMENT_TYPES).map(([k, t]) => (
        <button key={k} className={o.settlementType === k ? "on" : ""} onClick={() => set({ settlementType: k })}><Glyph draw={(c) => settlementIcon(c, k, 12, 12, k === "hamlet" ? 6 : 13, th, style)} />{t.name}</button>
      ))}
      {tool === "poi" && Object.entries(POI_TYPES).map(([k, t]) => (
        <button key={k} className={o.poiType === k ? "on" : ""} onClick={() => set({ poiType: k })}><Glyph draw={(c) => poiIcon(c, k, 12, 13, 12, th, style)} />{t}</button>
      ))}
      {tool === "road" && <>
        {Object.entries(ROAD_TYPES).map(([k, t]) => <button key={k} className={o.roadType === k ? "on" : ""} onClick={() => set({ roadType: k })} title={t.desc}><RoadSwatch type={k} th={th} />{t.name}</button>)}
        <label className="fm-check"><input type="checkbox" checked={o.autoTrace} onChange={(e) => set({ autoTrace: e.target.checked })} /> Auto-trace</label>
      </>}
      {tool === "river" && <label className="fm-inline">Width<input type="range" min={0.4} max={5} step={0.1} value={o.riverWidth} onChange={(e) => set({ riverWidth: Number(e.target.value) })} /></label>}
      {(tool === "road" || tool === "river") && draft?.pts?.length > 0 && <>
        <span className="fm-muted">{draft.pts.length} points</span>
        <button className="fm-btn primary" onClick={finish}>Finish</button><button className="fm-btn" onClick={cancel}>Cancel</button>
      </>}
      {tool === "brush" && <>
        {LAND_BRUSHES.map((k) => <button key={k} className={o.brush === k ? "on" : ""} onClick={() => set({ brush: k })}><i className="fm-sw" style={{ background: BIOMES[k].atlas }} />{BIOMES[k].name}</button>)}
        <label className="fm-inline">Size<input type="range" min={1} max={12} step={0.5} value={o.brushR} onChange={(e) => set({ brushR: Number(e.target.value) })} /></label>
      </>}
      {tool === "label" && Object.entries(LABEL_TYPES).map(([k, t]) => <button key={k} className={o.labelType === k ? "on" : ""} onClick={() => set({ labelType: k })}>{t}</button>)}
    </div>
  );
}

function Glyph({ draw }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, dpr = window.devicePixelRatio || 1;
    c.width = 24 * dpr; c.height = 24 * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr); draw(ctx);
  });
  return <canvas ref={ref} className="fm-glyph" />;
}
function RoadSwatch({ type, th }) {
  const c = th.roads[type];
  const dash = type === "track" ? "5 3" : type === "trail" ? "1.5 3" : undefined;
  return (
    <svg width="28" height="10" aria-hidden>
      {type === "royal" && <line x1="1" y1="5" x2="27" y2="5" stroke={c} strokeWidth="4" />}
      <line x1="1" y1="5" x2="27" y2="5" stroke={type === "royal" ? "#e9d6a8" : c} strokeWidth={type === "royal" ? 1.5 : type === "road" ? 2.2 : 1.6} strokeDasharray={dash} />
    </svg>
  );
}

const sv = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true };
function ToolIcon({ k }) {
  switch (k) {
    case "select": return <svg {...sv}><path d="M6 3l12 8-5.5 1.2L15 19l-2.3 1-2.6-6.6L6 17z" /></svg>;
    case "settlement": return <svg {...sv}><path d="M4 20V11l4-4 4 4v9M12 20v-6l4-4 4 4v6M2 20h20" /><path d="M8 7V3h2" /></svg>;
    case "poi": return <svg {...sv}><path d="M12 21s6-5.6 6-10.5a6 6 0 00-12 0C6 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2" /></svg>;
    case "road": return <svg {...sv}><path d="M8 21L11 3M16 21L13 3" /><path d="M12 6v2M12 11v2M12 16v2" strokeDasharray="1 0" /></svg>;
    case "river": return <svg {...sv}><path d="M4 4c4 2 0 6 4 8s6-2 8 2 0 6 4 6" /></svg>;
    case "brush": return <svg {...sv}><path d="M3 19l5-9 4 6 3-4 6 7z" /><circle cx="17" cy="6" r="2" /></svg>;
    case "label": return <svg {...sv}><path d="M5 6h14M12 6v13M9 19h6" /></svg>;
    case "event": return <svg {...sv}><path d="M6 21V4" /><path d="M6 4l11 4-11 4" /><path d="M3 21h6" /></svg>;
    case "travel": return <svg {...sv}><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M7 17c5-1 2-7 6-8s4-2 4-2" strokeDasharray="2 2" /></svg>;
    default: return null;
  }
}
