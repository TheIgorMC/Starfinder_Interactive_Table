import { useEffect, useRef, useState } from "react";
import { DEFAULT_OPTIONS, SIZES, TEMPLATES, CLIMATES } from "@galaxy-core/fantasy/generate.js";
import { CULTURES, parseNameList, makeNamer, nameSetSize } from "@galaxy-core/fantasy/names.js";
import { rngFrom } from "@galaxy-core/fantasy/rng.js";
import { BIOMES } from "@galaxy-core/fantasy/model.js";
import { GUIDE_CHOICES, loadImage, analyze, toGuide } from "./draft.js";

const LEGEND_TO_BIOME = { "~": "O", o: "L", ".": "G", ",": "A", f: "F", F: "D", t: "T", h: "H", m: "M", M: "S", s: "W", d: "R" };

// A custom name set: one invented language in three lists (towns, places,
// people). New names are written "in the style of" the samples — or the
// samples are used first. `base` gives the wording of features ("Forest of
// X"…, or "plain": the bare name).
export const EMPTY_NAMES = { samples: "", places: "", people: "", mode: "inspire", base: "plain" };
export function NameSetField({ value, onChange }) {
  const v = { ...EMPTY_NAMES, ...(value || {}) };
  const size = nameSetSize(v);
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (size < 3) { setPreview(null); return; }
    const n = makeNamer(rngFrom(`${seed}:${v.samples}:${v.places}:${v.people}`), v.base, { ...v, mode: "inspire" });
    setPreview({ towns: Array.from({ length: 6 }, () => n.place("town")), places: Array.from({ length: 4 }, () => n.poi("landmark")), people: Array.from({ length: 10 }, () => n.person()) });
  }, [v.samples, v.places, v.people, v.base, seed, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = (key, label, ph) => (
    <label className="fm-namelist">{label} <small>{parseNameList(v[key]).length}</small>
      <textarea className="fm-in fm-area" rows={2} placeholder={ph} value={v[key]} onChange={(e) => onChange({ ...v, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="fm-nameset">
      <div className="fm-muted">One language, three lists — each learns its sounds from all of them, its own examples weighing most. Comma- or line-separated.</div>
      {area("samples", "Towns & cities", "Xeredon, Aprij, Quogyt…")}
      {area("places", "Places & features", "Glesh, Serety…")}
      {area("people", "People", "Selor, Idavar, Sezla…")}
      <div className="fm-row">
        <select className="fm-in" value={v.mode} onChange={(e) => onChange({ ...v, mode: e.target.value })}>
          <option value="inspire">Invent new names in this style</option>
          <option value="use">Use these names first, then invent</option>
        </select>
        <label className="fm-inline">Feature wording<select className="fm-in" value={v.base} onChange={(e) => onChange({ ...v, base: e.target.value })}>{Object.entries(CULTURES).map(([k, c]) => <option key={k} value={k}>{c.name.split(" (")[0]}</option>)}</select></label>
      </div>
      {preview ? (
        <div className="fm-namepreview">
          <div><b>Towns</b> {preview.towns.join(", ")}</div>
          <div><b>Places</b> {preview.places.join(", ")}</div>
          <div><b>People</b> {preview.people.join(", ")}</div>
          <button className="fm-link" onClick={() => setSeed((x) => x + 1)}>more ideas</button>
        </div>
      ) : <div className="fm-muted">Give at least 3 names in total.</div>}
    </div>
  );
}

export default function GeneratorDialog({ initial, title, onGenerate, onCancel, busy }) {
  const [o, setO] = useState({ ...DEFAULT_OPTIONS, ...(initial || {}), seed: "" });
  const [customNames, setCustomNames] = useState(initial?.names ? true : false);
  const [names, setNames] = useState(initial?.names || EMPTY_NAMES);
  const [draft, setDraft] = useState(null); // { file, img, a, picks }
  const [err, setErr] = useState("");
  const set = (k) => (e) => setO((x) => ({ ...x, [k]: e.target.type === "range" ? Number(e.target.value) : e.target.value }));
  const width = (SIZES[o.size] || SIZES.medium)[0];

  const onFile = async (file) => {
    setErr("");
    try {
      const img = await loadImage(file);
      const a = analyze(img, width);
      setDraft({ file, img, a, picks: a.clusters.map((c) => c.pick) });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { // re-sample when the detail level changes
    if (!draft) return;
    const a = analyze(draft.img, width);
    setDraft((d) => ({ ...d, a, picks: a.clusters.map((c, j) => d.picks[j] ?? c.pick) }));
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = () => {
    const out = { ...o };
    if (customNames && nameSetSize(names) >= 3) out.names = names;
    else delete out.names;
    if (draft) { out.guide = toGuide(draft.a, draft.picks); out.draftFile = draft.file; out.extraSettlements = o.extraSettlements !== false; }
    onGenerate(out);
  };

  return (
    <div className="fm-modal" onClick={onCancel}>
      <div className="fm-dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="fm-title">{title}</h2>
        <div className="fm-muted">A territory of a few hundred kilometres: coasts, rivers, forests and mountains, towns and the roads between them — in the spirit of Azgaar's Fantasy Map Generator, on parchment.</div>
        <div className="fm-grid2">
          <label>Name<input className="fm-in" value={o.name} placeholder="(generated)" onChange={set("name")} /></label>
          <label>Seed<input className="fm-in" value={o.seed} placeholder="(random)" onChange={set("seed")} /></label>
          {!draft && <label>Land<select className="fm-in" value={o.template} onChange={set("template")}>{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
          <label>Climate<select className="fm-in" value={o.climate} onChange={set("climate")}>{Object.entries(CLIMATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Detail<select className="fm-in" value={o.size} onChange={set("size")}>{Object.entries(SIZES).map(([k, [w, h]]) => <option key={k} value={k}>{k} ({w}×{h})</option>)}</select></label>
          <label>Width (km)<input className="fm-in" type="number" min={10} max={5000} value={o.widthKm} onChange={(e) => setO((x) => ({ ...x, widthKm: Number(e.target.value) || 300 }))} /></label>
          <label>Forests <small>{Math.round(o.forests * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.forests} onChange={set("forests")} /></label>
          {!draft && <label>Mountains <small>{Math.round(o.mountains * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.mountains} onChange={set("mountains")} /></label>}
          <label>Settlements <small>{Math.round(o.density * 100)}%</small><input type="range" min={0} max={1} step={0.05} value={o.density} onChange={set("density")} /></label>
        </div>

        <div className="fm-sec">
          <div className="fm-label">Names</div>
          <div className="fm-row">
            <select className="fm-in" value={customNames ? "custom" : o.culture} onChange={(e) => { if (e.target.value === "custom") setCustomNames(true); else { setCustomNames(false); setO((x) => ({ ...x, culture: e.target.value })); } }}>
              {Object.entries(CULTURES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
              <option value="custom">My own list of names…</option>
            </select>
          </div>
          {customNames && <NameSetField value={names} onChange={setNames} />}
        </div>

        <div className="fm-sec">
          <div className="fm-label"><span>From a draft</span><span className="fm-muted">optional</span></div>
          {!draft ? (
            <>
              <label className="fm-btn">Load a draft map image…<input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ""; }} /></label>
              <div className="fm-muted">A sketch, a scan or another tool's export: its colours become sea, land, forests, mountains… The picture stays on the map as a tracing layer.</div>
            </>
          ) : (
            <DraftMapper draft={draft} setPicks={(picks) => setDraft((d) => ({ ...d, picks }))} onClear={() => setDraft(null)} extra={o.extraSettlements !== false} setExtra={(v) => setO((x) => ({ ...x, extraSettlements: v }))} />
          )}
          {err && <div className="fm-err">{err}</div>}
        </div>

        <div className="fm-row end">
          <button className="fm-btn" onClick={onCancel}>Cancel</button>
          <button className="fm-btn primary" disabled={busy} onClick={go}>{busy ? "Drawing the map…" : "Generate"}</button>
        </div>
      </div>
    </div>
  );
}

function DraftMapper({ draft, setPicks, onClear, extra, setExtra }) {
  const ref = useRef(null);
  const { a, picks } = draft;
  useEffect(() => {
    const c = ref.current;
    c.width = a.w; c.height = a.h;
    const g = c.getContext("2d");
    const img = g.createImageData(a.w, a.h);
    const col = picks.map((p) => {
      if (p === "#") return [150, 140, 130];
      if (p === " ") return [236, 223, 186];
      const hex = BIOMES[LEGEND_TO_BIOME[p]]?.atlas || "#cccccc";
      const v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    for (let i = 0; i < a.w * a.h; i++) { const [r, gg, b] = col[a.label[i]]; img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, [a, picks]);
  const order = a.clusters.map((c, j) => ({ ...c, j })).filter((c) => c.count).sort((x, y) => y.count - x.count);
  return (
    <div className="fm-draft">
      <div className="fm-draft-previews">
        <img src={draft.img.src} alt="draft" />
        <canvas ref={ref} title="How it will be read" />
      </div>
      <div className="fm-draft-colors">
        {order.map((c) => (
          <label key={c.j}>
            <i style={{ background: `rgb(${c.rgb.join(",")})` }} />
            <small>{Math.round((c.count / (a.w * a.h)) * 100)}%</small>
            <select className="fm-in" value={picks[c.j]} onChange={(e) => setPicks(picks.map((p, k) => (k === c.j ? e.target.value : p)))}>
              {GUIDE_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="fm-row between">
        <label className="fm-check"><input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} /> Also generate towns and villages</label>
        <button className="fm-link" onClick={onClear}>use another image</button>
      </div>
      <div className="fm-muted">Water touching the edge of the picture becomes sea, enclosed water a lake. Place your own towns afterwards (Settlement tool) over the tracing layer.</div>
    </div>
  );
}
