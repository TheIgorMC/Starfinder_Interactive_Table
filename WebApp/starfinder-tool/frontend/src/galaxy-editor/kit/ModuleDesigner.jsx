import { useEffect, useMemo, useRef, useState } from "react";
import {
  libraryFor, libraryBlock, isLibraryBlock, blankBlock, validateBlock,
  ZONE_COLORS, ITEM_KINDS, CONN_TYPES, SCALES, WEALTHS, FACES, FAMILY_NAMES,
} from "@galaxy-core/lib/stationLibrary.js";
import { KIT_BLOCKS } from "@galaxy-core/lib/stationKitBlocks.js";
import KitPlan from "./KitPlan.jsx";
import { Head } from "../shell/Inspectors.jsx";

// MODULES workspace: the Station Interiors block library (blocks v0.2) as an
// editable catalogue. Library blocks are read-only until edited — the first
// edit stores a copy in the project (project.stationKit.blocks[id]) that
// replaces the library version for the generator; "Reset" drops it. New
// designs (from scratch or duplicated) are project blocks too. Everything
// is in U on the kit's grid (1U = 2 m; interior sub-grid 0.5U).
const FAMS = Object.keys(FAMILY_NAMES);
const ZONES = Object.keys(ZONE_COLORS);
const SNAPS = [0.5, 0.25, 0.05];
const round = (v) => Math.round(v * 1000) / 1000;

export default function ModuleDesigner({ project, setProject }) {
  const lib = useMemo(() => libraryFor(project), [project.stationKit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fam, setFam] = useState("");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(lib.blocks[0]?.id);
  const [part, setPart] = useState(null); // {kind: zone|item|part|conn, i}
  const [snap, setSnap] = useState(0.25);
  const block = lib.byId.get(selId) || null;
  useEffect(() => setPart(null), [selId]);

  const kit = project.stationKit || { blocks: {}, disabled: [] };
  const writeKit = (next) => setProject((p) => ({ ...p, stationKit: { blocks: {}, disabled: [], ...(p.stationKit || {}), ...next } }));
  const writeBlock = (b) => { const { custom, ...clean } = b; writeKit({ blocks: { ...(kit.blocks || {}), [clean.id]: clean } }); };
  const patch = (p) => writeBlock({ ...block, ...p });
  const edited = block && (kit.blocks || {})[block.id];
  const disabled = block && lib.disabled.has(block.id);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return lib.blocks.filter((b) => (!fam || b.family === fam) && (!qq || `${b.id} ${b.name} ${b.desc}`.toLowerCase().includes(qq)));
  }, [lib, fam, q]);

  const newId = (base) => { let i = 1, id = base; while (lib.byId.has(id)) id = `${base}-${++i}`; return id; };
  const createNew = () => { const b = blankBlock(newId(`${fam || "H"}X-NEW`), fam || "H"); writeBlock(b); setSelId(b.id); };
  const duplicate = () => { if (!block) return; const { custom, ...src } = block; const b = { ...JSON.parse(JSON.stringify(src)), id: newId(`${block.id}-COPY`), name: `${block.name} (copy)`, base: block.base || block.id }; writeBlock(b); setSelId(b.id); };
  const reset = () => { if (!edited) return; const { [block.id]: _, ...rest } = kit.blocks; writeKit({ blocks: rest }); if (!isLibraryBlock(block.id)) setSelId(lib.blocks[0]?.id); };
  const toggleDisabled = () => { const d = new Set(kit.disabled || []); if (d.has(block.id)) d.delete(block.id); else d.add(block.id); writeKit({ disabled: [...d] }); };
  const renameId = (id) => {
    if (!id || lib.byId.has(id) || isLibraryBlock(block.id)) return;
    const { [block.id]: old, ...rest } = kit.blocks;
    writeKit({ blocks: { ...rest, [id]: { ...old, id } } }); setSelId(id);
  };
  const exportJson = () => {
    const out = { ...KIT_BLOCKS, blocks: lib.blocks.map(({ custom, ...b }) => b), disabled: [...lib.disabled] };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
    a.download = "blocks.json"; a.click();
  };
  const importRef = useRef(null);
  const importJson = async (file) => {
    try {
      const d = JSON.parse(await file.text());
      const incoming = Array.isArray(d) ? d : d.blocks || [];
      const blocks = { ...(kit.blocks || {}) };
      let n = 0;
      for (const b of incoming) {
        if (!b?.id || !b.size) continue;
        const base = libraryBlock(b.id);
        if (base && JSON.stringify(base) === JSON.stringify(b)) continue; // unchanged library block
        blocks[b.id] = b; n++;
      }
      writeKit({ blocks, disabled: d.disabled || kit.disabled || [] });
      window.alert(`Imported ${n} changed/new module(s).`);
    } catch (e) { window.alert(`Could not import: ${e.message}`); }
  };

  return (
    <div className="ge-stws ge-mdws">
      <div className="ge-subbar">
        <div className="gx-titleblock">
          <div className="gx-eyebrow">MODULE LIBRARY · {lib.blocks.length} DESIGNS · {Object.keys(kit.blocks || {}).length} EDITED/NEW</div>
          <h1 className="gx-title">{block ? block.name : "Modules"}</h1>
        </div>
        <div className="gx-grow" />
        <div role="group" aria-label="Snap" className="gx-group">
          {SNAPS.map((s) => <button key={s} className={"gx-tbtn" + (snap === s ? " on" : "")} onClick={() => setSnap(s)}>SNAP {s}U</button>)}
        </div>
        <button className="gx-tbtn gx-group" style={{ height: 44 }} onClick={exportJson}>EXPORT JSON</button>
        <button className="gx-tbtn gx-group" style={{ height: 44 }} onClick={() => importRef.current?.click()}>IMPORT</button>
        <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
      </div>

      <nav className="gx-left gx-scroll ge-left" aria-label="Library">
        <div className="gx-sec">
          <input className="ge-in" type="search" placeholder="Search modules…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ge-seg">
            <button className={!fam ? "on" : ""} onClick={() => setFam("")}>ALL</button>
            {FAMS.map((f) => <button key={f} className={fam === f ? "on" : ""} title={FAMILY_NAMES[f]} onClick={() => setFam(f)}>{f}</button>)}
          </div>
          <div className="ge-row">
            <button className="ge-btn ghost" onClick={createNew}>+ New</button>
            <button className="ge-btn ghost" disabled={!block} onClick={duplicate}>Duplicate</button>
          </div>
        </div>
        <div className="ge-rows" style={{ maxHeight: "none", padding: "0 6px 12px" }}>
          {list.map((b) => (
            <button key={b.id} className={"gx-gbtn gx-row" + (b.id === selId ? " on" : "")} onClick={() => setSelId(b.id)}>
              <span className="ge-mthumb"><svg viewBox={`-0.1 -0.1 ${b.size[0] + 0.2} ${b.size[1] + 0.2}`}><KitPlan block={b} labels={false} detail={false} /></svg></span>
              <span className="t"><span className="a">{b.name}</span>
                <span className="b" style={{ color: "#9a958b" }}>{b.id} · {b.size[0]}×{b.size[1]}×{b.height || 1}U{b.custom ? ` · ${b.custom.toUpperCase()}` : ""}{lib.disabled.has(b.id) ? " · OFF" : ""}</span></span>
            </button>
          ))}
        </div>
      </nav>

      <section className="ge-stmain">
        {block ? <Canvas block={block} part={part} setPart={setPart} snap={snap} onChange={patch} /> : <div className="gx-center-msg">PICK A MODULE</div>}
      </section>

      {block && (
        <aside className="gx-panel gx-scroll ge-rpanel" aria-label="Module">
          <Head kind={`${FAMILY_NAMES[block.family] || block.family} · ${block.custom ? block.custom : "library"}`} title={block.name} editable onRename={(name) => patch({ name })}
            sub={`${block.size[0] * 2} × ${block.size[1] * 2} m · ${(block.height || 1) * 2} m tall · ${block.capacity || "—"}`} />
          <Props block={block} patch={patch} renameId={renameId} />
          {part && <PartProps block={block} part={part} setPart={setPart} patch={patch} />}
          <AddBar block={block} patch={patch} setPart={setPart} />
          <Checks block={block} />
          <div className="gx-sec">
            <div className="ge-row">
              <button className="ge-btn ghost" onClick={toggleDisabled}>{disabled ? "Enable in generator" : "Disable in generator"}</button>
              {edited && <button className="ge-btn ghost danger" onClick={() => window.confirm(isLibraryBlock(block.id) ? "Drop your edits and go back to the library design?" : "Delete this module?") && reset()}>{isLibraryBlock(block.id) ? "Reset to library" : "Delete"}</button>}
            </div>
            {!edited && <div className="gx-lore">Library design: your first edit saves a copy in this galaxy that replaces it for the generator.</div>}
          </div>
        </aside>
      )}
    </div>
  );
}

function Props({ block, patch, renameId }) {
  const [W, D] = block.size;
  const toggle = (key, v) => { const s = new Set(block[key] || []); if (s.has(v)) s.delete(v); else s.add(v); patch({ [key]: [...s] }); };
  return (
    <div className="gx-sec">
      <div className="gx-label">MODULE</div>
      <div className="gx-grid" style={{ "--cols": 2, gap: 8 }}>
        <label className="ge-lbl">Id
          <input className="ge-in" defaultValue={block.id} key={block.id} disabled={isLibraryBlock(block.id)} onBlur={(e) => e.target.value !== block.id && renameId(e.target.value.trim())} />
        </label>
        <label className="ge-lbl">Family
          <select className="ge-in" value={block.family} onChange={(e) => patch({ family: e.target.value })}>{FAMS.map((f) => <option key={f} value={f}>{f} · {FAMILY_NAMES[f]}</option>)}</select>
        </label>
      </div>
      <div className="gx-grid" style={{ "--cols": 3, gap: 8 }}>
        <label className="ge-lbl">Width U<input className="ge-in" type="number" min={1} value={W} onChange={(e) => patch({ size: [Math.max(1, Math.round(Number(e.target.value))), D] })} /></label>
        <label className="ge-lbl">Depth U<input className="ge-in" type="number" min={1} value={D} onChange={(e) => patch({ size: [W, Math.max(1, Math.round(Number(e.target.value)))] })} /></label>
        <label className="ge-lbl">Height U<input className="ge-in" type="number" min={1} value={block.height || 1} onChange={(e) => patch({ height: Math.max(1, Math.round(Number(e.target.value))) })} /></label>
      </div>
      <label className="ge-lbl">Capacity<input className="ge-in" value={block.capacity || ""} placeholder="e.g. 10 berths / 56 seats" onChange={(e) => patch({ capacity: e.target.value })} /></label>
      <div className="gx-grid" style={{ "--cols": 2, gap: 8 }}>
        <label className="ge-lbl">Utility spine
          <select className="ge-in" value={block.spine || ""} onChange={(e) => patch({ spine: e.target.value || null })}>
            <option value="">none</option>{[...FACES, "RISER", "MID"].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="ge-lbl">Hull face
          <select className="ge-in" value={block.hull || ""} onChange={(e) => patch({ hull: e.target.value || null })}>
            <option value="">none</option>{FACES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      </div>
      <div className="ge-lbl">Scale</div>
      <div className="ge-flags">{SCALES.map((s) => <button key={s} className={"ge-flag" + ((block.scale || []).includes(s) ? " on" : "")} onClick={() => toggle("scale", s)}>{s.toUpperCase()}</button>)}</div>
      <div className="ge-lbl">Wealth</div>
      <div className="ge-flags">{WEALTHS.map((s) => <button key={s} className={"ge-flag" + ((block.wealth || []).includes(s) ? " on" : "")} onClick={() => toggle("wealth", s)}>{s.toUpperCase()}</button>)}</div>
      <label className="ge-lbl">Description<textarea className="ge-in" rows={2} value={block.desc || ""} onChange={(e) => patch({ desc: e.target.value })} /></label>
      <label className="ge-lbl">Tags (comma separated)<input className="ge-in" value={(block.tags || []).join(", ")} onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
    </div>
  );
}

function AddBar({ block, patch, setPart }) {
  const [W, D] = block.size;
  const add = (kind) => {
    if (kind === "zone") { patch({ zones: [...(block.zones || []), { z: "LIVE", r: [0, 0, Math.min(2, W), Math.min(2, D)] }] }); setPart({ kind, i: (block.zones || []).length }); }
    if (kind === "item") { patch({ items: [...(block.items || []), { k: "box", r: [0.25, 0.25, 0.5, 0.5], l: "" }] }); setPart({ kind, i: (block.items || []).length }); }
    if (kind === "part") { patch({ parts: [...(block.parts || []), [0, D / 2, W / 2, D / 2]] }); setPart({ kind, i: (block.parts || []).length }); }
    if (kind === "conn") { const n = (block.conns || []).length + 1; patch({ conns: [...(block.conns || []), { id: `S${n}`, face: "S", at: 0.25, w: 0.5, type: "personnel", opt: false }] }); setPart({ kind, i: n - 1 }); }
  };
  return (
    <div className="gx-sec">
      <div className="gx-label">ADD</div>
      <div className="ge-row">
        <button className="ge-btn ghost" onClick={() => add("zone")}>+ Zone</button>
        <button className="ge-btn ghost" onClick={() => add("item")}>+ Item</button>
        <button className="ge-btn ghost" onClick={() => add("part")}>+ Wall</button>
        <button className="ge-btn ghost" onClick={() => add("conn")}>+ Door</button>
      </div>
      <div className="gx-lore">Click a zone, item, wall or door on the plan to edit it; drag to move, drag the cyan corner to resize. Del removes it.</div>
    </div>
  );
}

function PartProps({ block, part, setPart, patch }) {
  const key = { zone: "zones", item: "items", part: "parts", conn: "conns" }[part.kind];
  const arr = block[key] || [];
  const el = arr[part.i];
  if (el == null) return null;
  const set = (v) => patch({ [key]: arr.map((x, j) => (j === part.i ? v : x)) });
  const del = () => { patch({ [key]: arr.filter((_, j) => j !== part.i) }); setPart(null); };
  const num = (label, value, onChange, step = 0.05) => (
    <label className="ge-lbl">{label}<input className="ge-in" type="number" step={step} value={value} onChange={(e) => onChange(round(Number(e.target.value)))} /></label>
  );
  const rectFields = (r, onR) => (
    <div className="gx-grid" style={{ "--cols": 4, gap: 6 }}>
      {num("X", r[0], (v) => onR([v, r[1], r[2], r[3]]))}{num("Y", r[1], (v) => onR([r[0], v, r[2], r[3]]))}
      {num("W", r[2], (v) => onR([r[0], r[1], Math.max(0.05, v), r[3]]))}{num("H", r[3], (v) => onR([r[0], r[1], r[2], Math.max(0.05, v)]))}
    </div>
  );
  return (
    <div className="gx-sec ge-partbox">
      <div className="gx-label"><span>{part.kind === "part" ? "WALL" : part.kind === "conn" ? "DOOR / CONNECTOR" : part.kind.toUpperCase()} #{part.i + 1}</span>
        <button className="ge-link" onClick={del}>DELETE</button></div>
      {part.kind === "zone" && (
        <>
          <label className="ge-lbl">Zone<select className="ge-in" value={el.z} onChange={(e) => set({ ...el, z: e.target.value })}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label>
          {rectFields(el.r, (r) => set({ ...el, r }))}
        </>
      )}
      {part.kind === "item" && (
        <>
          <div className="gx-grid" style={{ "--cols": 2, gap: 8 }}>
            <label className="ge-lbl">Kind<select className="ge-in" value={el.k} onChange={(e) => set({ ...el, k: e.target.value })}>{ITEM_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="ge-lbl">Label<input className="ge-in" value={el.l || ""} onChange={(e) => set({ ...el, l: e.target.value || undefined })} /></label>
          </div>
          {rectFields(el.r, (r) => set({ ...el, r }))}
        </>
      )}
      {part.kind === "part" && (
        <div className="gx-grid" style={{ "--cols": 4, gap: 6 }}>
          {["X1", "Y1", "X2", "Y2"].map((l, j) => num(l, el[j], (v) => set(el.map((x, k) => (k === j ? v : x)))))}
        </div>
      )}
      {part.kind === "conn" && (
        <>
          <div className="gx-grid" style={{ "--cols": 3, gap: 6 }}>
            <label className="ge-lbl">Id<input className="ge-in" value={el.id} onChange={(e) => set({ ...el, id: e.target.value })} /></label>
            <label className="ge-lbl">Face<select className="ge-in" value={el.face} onChange={(e) => set({ ...el, face: e.target.value })}>{FACES.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className="ge-lbl">Type<select className="ge-in" value={el.type} onChange={(e) => set({ ...el, type: e.target.value })}>{CONN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className="gx-grid" style={{ "--cols": 2, gap: 6 }}>
            {num("At (U along face)", el.at, (v) => set({ ...el, at: v }))}{num("Width U", el.w, (v) => set({ ...el, w: Math.max(0.1, v) }))}
          </div>
          <label className="ge-check"><input type="checkbox" checked={!!el.opt} onChange={(e) => set({ ...el, opt: e.target.checked })} /> Optional connector</label>
        </>
      )}
    </div>
  );
}

function Checks({ block }) {
  const errs = validateBlock(block);
  return (
    <div className="gx-sec">
      <div className="gx-label"><span>CHECKS</span><span style={{ color: errs.length ? "#ff8a70" : "#7fd09a" }}>{errs.length ? `${errs.length} ISSUE(S)` : "OK"}</span></div>
      {errs.map((e, i) => <div key={i} className="gx-lore" style={{ color: "#ff9a86" }}>{e}</div>)}
      {!errs.length && <div className="gx-lore">Everything inside the footprint. Tall modules ({block.height || 1}U) only go into station blocks at least that tall (one deck ≈ 2U).</div>}
    </div>
  );
}

// drawing canvas: grid, rulers, the plan; drag to move, corner to resize
function Canvas({ block, part, setPart, snap, onChange }) {
  const svgRef = useRef(null);
  const [W, D] = block.size;
  const pad = 1;
  const drag = useRef(null);
  const [ghost, setGhost] = useState(null); // a modified copy of the block while dragging
  const shown = ghost || block;
  const toU = (e) => {
    const svg = svgRef.current, pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  };
  const sn = (v) => round(Math.round(v / snap) * snap);
  const start = (kind, i, e, handle = false) => {
    setPart({ kind, i });
    svgRef.current.setPointerCapture(e.pointerId);
    drag.current = { kind, i, handle, p0: toU(e), orig: JSON.parse(JSON.stringify(block)), moved: false };
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const [x, y] = toU(e), dx = x - d.p0[0], dy = y - d.p0[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.02) d.moved = true;
    if (!d.moved) return;
    const b = JSON.parse(JSON.stringify(d.orig));
    if (d.kind === "zone" || d.kind === "item") {
      const arr = d.kind === "zone" ? b.zones : b.items, r = arr[d.i].r, o = d.orig[d.kind === "zone" ? "zones" : "items"][d.i].r;
      if (d.handle) { r[2] = Math.max(snap, sn(o[2] + dx)); r[3] = Math.max(snap, sn(o[3] + dy)); }
      else { r[0] = Math.max(0, Math.min(W - r[2], sn(o[0] + dx))); r[1] = Math.max(0, Math.min(D - r[3], sn(o[1] + dy))); }
    } else if (d.kind === "part") {
      const p = b.parts[d.i], o = d.orig.parts[d.i];
      b.parts[d.i] = [sn(o[0] + dx), sn(o[1] + dy), sn(o[2] + dx), sn(o[3] + dy)]; void p;
    } else if (d.kind === "conn") {
      const c = b.conns[d.i], o = d.orig.conns[d.i];
      const along = c.face === "N" || c.face === "S" ? dx : dy, L = c.face === "N" || c.face === "S" ? W : D;
      c.at = Math.max(0, Math.min(L - c.w, sn(o.at + along)));
    }
    setGhost(b);
  };
  const up = () => { const d = drag.current; drag.current = null; if (d?.moved && ghost) onChange(ghost); setGhost(null); };
  useEffect(() => {
    const onKey = (e) => {
      if (!part || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const key = { zone: "zones", item: "items", part: "parts", conn: "conns" }[part.kind];
      onChange({ ...block, [key]: (block[key] || []).filter((_, j) => j !== part.i) }); setPart(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [part, block, onChange, setPart]);

  const selRect = part && (part.kind === "zone" || part.kind === "item") ? shown[part.kind === "zone" ? "zones" : "items"][part.i]?.r : null;
  const cols = [...Array(W).keys()], rows = [...Array(D).keys()];
  return (
    <div className="ge-plan ge-mdcanvas">
      <svg ref={svgRef} viewBox={`${-pad} ${-pad} ${W + pad * 2} ${D + pad * 2}`} preserveAspectRatio="xMidYMid meet"
        onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setPart(null)}>
        {/* grid: 0.5U sub-grid, 1U grid, rulers A.. / 1.. */}
        {[...Array(W * 2 + 1).keys()].map((i) => <line key={`gx${i}`} x1={i / 2} y1={0} x2={i / 2} y2={D} stroke={i % 2 ? "#1f2c34" : "#2f414d"} strokeWidth={0.012} />)}
        {[...Array(D * 2 + 1).keys()].map((i) => <line key={`gy${i}`} x1={0} y1={i / 2} x2={W} y2={i / 2} stroke={i % 2 ? "#1f2c34" : "#2f414d"} strokeWidth={0.012} />)}
        <KitPlan block={shown} selected={part} onPart={(kind, i, e) => start(kind, i, e)} />
        {/* keep the grid visible over zones */}
        {cols.map((i) => <text key={`c${i}`} x={i + 0.5} y={-0.25} fontSize={0.2} textAnchor="middle" fill="#93a6b1" style={{ fontFamily: "Oxanium, monospace" }}>{String.fromCharCode(65 + (i % 26))}</text>)}
        {rows.map((i) => <text key={`r${i}`} x={-0.3} y={i + 0.57} fontSize={0.2} textAnchor="middle" fill="#93a6b1" style={{ fontFamily: "Oxanium, monospace" }}>{i + 1}</text>)}
        {selRect && <rect x={selRect[0] + selRect[2] - 0.09} y={selRect[1] + selRect[3] - 0.09} width={0.18} height={0.18} fill="#5fd3f3" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => { e.stopPropagation(); start(part.kind, part.i, e, true); }} />}
      </svg>
      <div className="gx-hint" style={{ bottom: 10 }}>{W} × {D} U · {W * 2} × {D * 2} M · {block.height || 1}U TALL · SNAP {snap}U · CLICK TO SELECT · DRAG TO MOVE · DEL TO REMOVE</div>
    </div>
  );
}
