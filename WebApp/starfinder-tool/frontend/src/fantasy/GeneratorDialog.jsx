import { useState } from "react";
import { DEFAULT_OPTIONS, SIZES, TEMPLATES, CLIMATES } from "./lib/generate.js";
import { CULTURES } from "./lib/names.js";

// Options for a new region (or a re-roll of the current one).
export default function GeneratorDialog({ initial, title, onGenerate, onCancel, busy }) {
  const [o, setO] = useState({ ...DEFAULT_OPTIONS, ...(initial || {}), seed: "" });
  const set = (k) => (e) => setO((x) => ({ ...x, [k]: e.target.type === "range" ? Number(e.target.value) : e.target.value }));
  return (
    <div className="fm-modal" onClick={onCancel}>
      <div className="fm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="fm-title">{title}</h2>
        <div className="fm-muted">A territory of a few hundred kilometres: coasts, rivers, forests and mountains, towns and the roads between them — in the spirit of Azgaar's Fantasy Map Generator, on parchment.</div>
        <div className="fm-grid2">
          <label>Name<input className="fm-in" value={o.name} placeholder="(generated)" onChange={set("name")} /></label>
          <label>Seed<input className="fm-in" value={o.seed} placeholder="(random)" onChange={set("seed")} /></label>
          <label>Land<select className="fm-in" value={o.template} onChange={set("template")}>{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Climate<select className="fm-in" value={o.climate} onChange={set("climate")}>{Object.entries(CLIMATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Detail<select className="fm-in" value={o.size} onChange={set("size")}>{Object.entries(SIZES).map(([k, [w, h]]) => <option key={k} value={k}>{k} ({w}×{h})</option>)}</select></label>
          <label>Width (km)<input className="fm-in" type="number" min={10} max={5000} value={o.widthKm} onChange={(e) => setO((x) => ({ ...x, widthKm: Number(e.target.value) || 300 }))} /></label>
          <label>Names<select className="fm-in" value={o.culture} onChange={set("culture")}>{Object.entries(CULTURES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}</select></label>
          <span />
          <label>Forests <small>{Math.round(o.forests * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.forests} onChange={set("forests")} /></label>
          <label>Mountains <small>{Math.round(o.mountains * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.mountains} onChange={set("mountains")} /></label>
          <label>Settlements <small>{Math.round(o.density * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.density} onChange={set("density")} /></label>
        </div>
        <div className="fm-row end">
          <button className="fm-btn" onClick={onCancel}>Cancel</button>
          <button className="fm-btn primary" disabled={busy} onClick={() => onGenerate(o)}>{busy ? "Drawing the map…" : "Generate"}</button>
        </div>
      </div>
    </div>
  );
}
