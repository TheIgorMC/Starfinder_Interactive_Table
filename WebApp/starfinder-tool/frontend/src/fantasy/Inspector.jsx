import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SETTLEMENT_TYPES, POI_TYPES, ROAD_TYPES, LABEL_TYPES, COLLECTIONS, polyLength, fmtDist, fmtPop } from "./lib/model.js";

// Photos: upload into the media library (category "fantasy") or link a URL.
export function ImageField({ images = [], onChange, readOnly }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const upload = async (files) => {
    setBusy(true); setErr("");
    try {
      const urls = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("label", f.name);
        fd.append("folder", "fantasy");
        const res = await fetch("/api/media/fantasy", { method: "POST", body: fd });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        urls.push(body.url);
      }
      onChange([...images, ...urls]);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  if (readOnly && !images.length) return null;
  return (
    <div className="fm-images">
      <div className="fm-thumbs">
        {images.map((u, i) => (
          <div key={u + i} className="fm-thumb">
            <img src={u} alt="" onClick={() => setOpen(i)} />
            {!readOnly && <button className="fm-x" title="Remove" onClick={() => onChange(images.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        {!readOnly && (
          <label className={"fm-thumb add" + (busy ? " busy" : "")} title="Upload pictures">
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ""; }} />
            {busy ? "…" : "+ PHOTO"}
          </label>
        )}
      </div>
      {!readOnly && <button className="fm-link" onClick={() => { const u = window.prompt("Image URL"); if (u) onChange([...images, u.trim()]); }}>or link an image URL</button>}
      {err && <div className="fm-err">{err}</div>}
      {open != null && (
        <div className="fm-lightbox" onClick={() => setOpen(null)}>
          <img src={images[open]} alt="" />
          {images.length > 1 && <div className="fm-lb-nav">
            <button onClick={(e) => { e.stopPropagation(); setOpen((open + images.length - 1) % images.length); }}>‹</button>
            <span>{open + 1} / {images.length}</span>
            <button onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % images.length); }}>›</button>
          </div>}
        </div>
      )}
    </div>
  );
}

function Common({ item, set, gm, isMap }) {
  return (
    <>
      <div className="fm-sec">
        <div className="fm-label">Description</div>
        {gm ? <textarea className="fm-in fm-area" rows={6} value={item.description || ""} placeholder="What travellers see and hear of it… (Markdown)" onChange={(e) => set({ description: e.target.value })} />
          : item.description ? <div className="fm-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.description}</ReactMarkdown></div> : <div className="fm-muted">No description.</div>}
      </div>
      <div className="fm-sec">
        <div className="fm-label">Pictures</div>
        <ImageField images={item.images || []} onChange={(images) => set({ images })} readOnly={!gm} />
        {!gm && !(item.images || []).length && <div className="fm-muted">No pictures.</div>}
      </div>
      {gm && (
        <div className="fm-sec">
          <div className="fm-label">GM notes <span className="fm-muted">(never shown to players)</span></div>
          <textarea className="fm-in fm-area" rows={3} value={item.gmNotes || ""} onChange={(e) => set({ gmNotes: e.target.value })} />
          {!isMap && <label className="fm-check"><input type="checkbox" checked={!!item.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> Hidden from players</label>}
        </div>
      )}
    </>
  );
}

export function Inspector({ map, sel, gm, update, remove, onClose, unit, currencies }) {
  const item = map[sel.kind]?.find((x) => x.id === sel.id);
  if (!item) return null;
  const set = (patch) => update(sel, patch);
  const kindName = COLLECTIONS[sel.kind];
  const sub = sel.kind === "settlements" ? SETTLEMENT_TYPES[item.type]?.name : sel.kind === "pois" ? POI_TYPES[item.type] : sel.kind === "roads" ? ROAD_TYPES[item.type]?.name : sel.kind === "labels" ? LABEL_TYPES[item.type] : "River";
  const km = item.pts ? polyLength(item.pts) * (map.kmPerCell || 1) : 0;
  const cur = currencies.find((c) => c.id === item.currencyId);
  return (
    <div className="fm-inspector">
      <div className="fm-head">
        <div>
          <div className="fm-kicker">{kindName} · {sub}</div>
          {gm ? <input className="fm-title-in" value={item.name || ""} placeholder={`Unnamed ${kindName.toLowerCase()}`} onChange={(e) => set({ name: e.target.value })} />
            : <h2 className="fm-title">{item.name || `Unnamed ${kindName.toLowerCase()}`}</h2>}
        </div>
        <button className="fm-close" onClick={onClose} title="Close (Esc)">×</button>
      </div>

      {sel.kind === "settlements" && (
        <div className="fm-sec fm-grid2">
          <label>Type{gm ? <select className="fm-in" value={item.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(SETTLEMENT_TYPES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select> : <b>{sub}</b>}</label>
          <label>Population{gm ? <input className="fm-in" type="number" min={0} value={item.population || 0} onChange={(e) => set({ population: Number(e.target.value) })} /> : <b>{fmtPop(item.population || 0)}</b>}</label>
          <label>Coinage{gm ? (
            <select className="fm-in" value={item.currencyId || ""} onChange={(e) => set({ currencyId: e.target.value || null })}>
              <option value="">(default)</option>
              {currencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>) : <b>{cur?.name || currencies[0]?.name || "—"}</b>}</label>
          <label className="fm-check">{gm ? <input type="checkbox" checked={!!item.port} onChange={(e) => set({ port: e.target.checked })} /> : null} {gm || item.port ? "Harbour" : ""}</label>
        </div>
      )}
      {sel.kind === "pois" && gm && (
        <div className="fm-sec"><label>Type<select className="fm-in" value={item.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(POI_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label></div>
      )}
      {sel.kind === "roads" && (
        <div className="fm-sec">
          {gm && <div className="fm-seg">{Object.entries(ROAD_TYPES).map(([k, t]) => <button key={k} className={item.type === k ? "on" : ""} onClick={() => set({ type: k })} title={t.desc}>{t.name}</button>)}</div>}
          <div className="fm-stat">Length <b>{fmtDist(km, unit)}</b> · {ROAD_TYPES[item.type]?.desc}</div>
          {gm && <div className="fm-muted">Drag the red points to reshape; Alt+click a point to remove it.</div>}
        </div>
      )}
      {sel.kind === "rivers" && (
        <div className="fm-sec">
          <div className="fm-stat">Length <b>{fmtDist(km, unit)}</b></div>
          {gm && <label>Width<input type="range" min={0.4} max={5} step={0.1} value={item.width || 1} onChange={(e) => set({ width: Number(e.target.value) })} /></label>}
        </div>
      )}
      {sel.kind === "labels" && gm && (
        <div className="fm-sec fm-grid2">
          <label>Type<select className="fm-in" value={item.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(LABEL_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label>Size<input type="range" min={0.8} max={10} step={0.1} value={item.size || 2} onChange={(e) => set({ size: Number(e.target.value) })} /></label>
          <label>Angle<input type="range" min={-60} max={60} step={1} value={item.angle || 0} onChange={(e) => set({ angle: Number(e.target.value) })} /></label>
        </div>
      )}
      <Common item={item} set={set} gm={gm} />
      {gm && <div className="fm-sec"><button className="fm-btn danger" onClick={() => remove(sel)}>Delete {kindName.toLowerCase()} (Del)</button></div>}
    </div>
  );
}

// map-wide properties, shown when nothing is selected
export function MapProperties({ map, gm, setMap, onRebuildRoads, onRegenerate, onExport, onDelete }) {
  const set = (patch) => setMap((m) => ({ ...m, ...patch }));
  const widthKm = Math.round(map.w * (map.kmPerCell || 1));
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div>
        <div className="fm-kicker">Region map · {map.w}×{map.h} cells · seed {map.seed}</div>
        {gm ? <input className="fm-title-in" value={map.name} onChange={(e) => set({ name: e.target.value })} /> : <h2 className="fm-title">{map.name}</h2>}
      </div></div>
      {gm && (
        <div className="fm-sec fm-grid2">
          <label>Width of the map (km)<input className="fm-in" type="number" min={5} value={widthKm} onChange={(e) => set({ kmPerCell: Math.max(0.01, Number(e.target.value) / map.w) })} /></label>
          <label>Units<select className="fm-in" value={map.travel?.unit || "km"} onChange={(e) => set({ travel: { ...(map.travel || {}), unit: e.target.value } })}><option value="km">Kilometres</option><option value="mi">Miles</option></select></label>
          <label className="fm-check"><input type="checkbox" checked={!!map.playerVisible} onChange={(e) => set({ playerVisible: e.target.checked })} /> Players can open this map</label>
        </div>
      )}
      <div className="fm-sec fm-stat">
        {map.settlements.length} settlements · {map.pois.length} places · {map.roads.length} roads · {map.rivers.length} rivers · 1 cell = {(map.kmPerCell || 1).toFixed(2)} km
      </div>
      <Common item={map} set={set} gm={gm} isMap />
      {gm && (
        <div className="fm-sec fm-actions">
          <button className="fm-btn" onClick={onRebuildRoads} title="Re-trace the generated road network between the current settlements; roads you drew stay">Rebuild roads</button>
          <button className="fm-btn" onClick={onRegenerate}>Regenerate…</button>
          <button className="fm-btn" onClick={onExport}>Export JSON</button>
          <button className="fm-btn danger" onClick={onDelete}>Delete map</button>
        </div>
      )}
    </div>
  );
}
