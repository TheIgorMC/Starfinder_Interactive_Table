import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SETTLEMENT_TYPES, POI_TYPES, ROAD_TYPES, LABEL_TYPES, EVENT_TYPES, COLLECTIONS, polyLength, fmtDist, fmtPop, resolveName, findChapter, chapterLabel } from "./lib/model.js";

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

// Markdown with two kinds of links: ordinary URLs (open in a new tab) and
// [[Name]] — any place, event, book or chapter on this map by name.
export function Prose({ text, map, onLink }) {
  const src = (text || "").replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const [target, label] = name.split("|");
    const t = resolveName(map, target);
    return t ? `[${label || target}](#fm:${t.kind}:${t.id})` : `*${label || target}*`;
  });
  return (
    <div className="fm-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => (href?.startsWith("#fm:")
          ? <a href={href} className="fm-xref" onClick={(e) => { e.preventDefault(); const [, kind, id] = href.split(":"); onLink?.({ kind, id }); }}>{children}</a>
          : <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="fm-ext">↗</span></a>),
      }}>{src}</ReactMarkdown>
    </div>
  );
}

function LinksField({ links = [], set, gm }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  if (!gm && !links.length) return null;
  const add = () => {
    if (!url.trim()) return;
    const u = /^[a-z]+:|^\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    set({ links: [...links, { label: label.trim() || u.replace(/^https?:\/\//, ""), url: u }] });
    setLabel(""); setUrl("");
  };
  return (
    <div className="fm-sec">
      <div className="fm-label">Links</div>
      {links.map((l, i) => (
        <div key={i} className="fm-linkrow">
          <a href={l.url} target={l.url.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">{l.label}<span className="fm-ext">↗</span></a>
          {gm && <button className="fm-x inline" onClick={() => set({ links: links.filter((_, j) => j !== i) })}>×</button>}
        </div>
      ))}
      {gm && (
        <div className="fm-row">
          <input className="fm-in" style={{ flex: 1 }} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="fm-in" style={{ flex: 2 }} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="fm-btn" onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

// citations of book chapters
export function RefsField({ refs = [], set, gm, map, onLink }) {
  const books = map.books || [];
  const [book, setBook] = useState(books[0]?.id || "");
  const [chapter, setChapter] = useState("");
  const [note, setNote] = useState("");
  if (!gm && !refs.length) return null;
  const b = books.find((x) => x.id === book) || books[0];
  return (
    <div className="fm-sec">
      <div className="fm-label">In the book</div>
      <div className="fm-chips">
        {refs.map((r, i) => {
          const f = findChapter(map, r.chapter);
          if (!f) return null;
          return (
            <span key={i} className="fm-chip">
              <a href={`#fm:chapter:${r.chapter}`} onClick={(e) => { e.preventDefault(); onLink?.({ kind: "chapter", id: r.chapter }); }}>{chapterLabel(f.book, f.chapter)}</a>
              {r.note && <small> · {r.note}</small>}
              {gm && <button className="fm-x inline" onClick={() => set({ refs: refs.filter((_, j) => j !== i) })}>×</button>}
            </span>
          );
        })}
      </div>
      {gm && (books.length ? (
        <div className="fm-row">
          {books.length > 1 && <select className="fm-in" value={b?.id} onChange={(e) => { setBook(e.target.value); setChapter(""); }}>{books.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}
          <select className="fm-in" style={{ flex: 1 }} value={chapter} onChange={(e) => setChapter(e.target.value)}>
            <option value="">chapter…</option>
            {(b?.chapters || []).map((c) => <option key={c.id} value={c.id}>{c.n}. {c.title}</option>)}
          </select>
          <input className="fm-in" style={{ width: 90 }} placeholder="p. / note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="fm-btn" disabled={!chapter} onClick={() => { set({ refs: [...refs, { book: b.id, chapter, note: note.trim() }] }); setChapter(""); setNote(""); }}>Cite</button>
        </div>
      ) : <div className="fm-muted">Add a book and its chapters in the Book tab to cite them here.</div>)}
    </div>
  );
}

function Common({ item, set, gm, isMap, map, onLink }) {
  const [mode, setMode] = useState(item.description ? "read" : "write");
  return (
    <>
      <div className="fm-sec">
        <div className="fm-label"><span>Description</span>{gm && <span className="fm-seg tiny">{["write", "read"].map((m) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "write" ? "Write" : "Read"}</button>)}</span>}</div>
        {gm && mode === "write" ? (
          <>
            <textarea className="fm-in fm-area" rows={7} value={item.description || ""} placeholder="What travellers see and hear of it… Markdown; [[Name]] links to a place, event or chapter; [text](https://…) to the web." onChange={(e) => set({ description: e.target.value })} />
          </>
        ) : item.description ? <Prose text={item.description} map={map} onLink={onLink} /> : <div className="fm-muted">No description.</div>}
      </div>
      <RefsField refs={item.refs} set={set} gm={gm} map={map} onLink={onLink} />
      <LinksField links={item.links} set={set} gm={gm} />
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

export function Inspector({ map, sel, gm, update, remove, onClose, unit, currencies, onLink, onCopyLink, onPinEvent, pinning }) {
  const item = map[sel.kind]?.find((x) => x.id === sel.id);
  if (!item) return null;
  const set = (patch) => update(sel, patch);
  const kindName = COLLECTIONS[sel.kind];
  const sub = sel.kind === "settlements" ? SETTLEMENT_TYPES[item.type]?.name : sel.kind === "pois" ? POI_TYPES[item.type] : sel.kind === "roads" ? ROAD_TYPES[item.type]?.name : sel.kind === "labels" ? LABEL_TYPES[item.type] : sel.kind === "events" ? EVENT_TYPES[item.type] || "Event" : "River";
  const eventsHere = sel.kind === "events" ? [] : (map.events || []).filter((e) => (gm || !e.hidden) && (e.places || []).some((p) => p.id === item.id)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
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
        <div className="fm-headbtns">
          <button className="fm-close" onClick={() => onCopyLink(sel)} title="Copy a link that opens the map on this">🔗</button>
          <button className="fm-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>
      </div>

      {sel.kind === "events" && <EventFields item={item} set={set} gm={gm} map={map} onLink={onLink} onPin={() => onPinEvent(item.id)} pinning={pinning} />}
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
      <Common key={item.id} item={item} set={set} gm={gm} map={map} onLink={onLink} />
      {eventsHere.length > 0 && (
        <div className="fm-sec">
          <div className="fm-label">What happened here</div>
          {eventsHere.map((e) => <button key={e.id} className="fm-item" onClick={() => onLink({ kind: "events", id: e.id })}><span>{e.name}</span><small>{e.date}</small></button>)}
        </div>
      )}
      {gm && <div className="fm-sec"><button className="fm-btn danger" onClick={() => remove(sel)}>Delete {kindName.toLowerCase()} (Del)</button></div>}
    </div>
  );
}

// map-wide properties, shown when nothing is selected
export function MapProperties({ map, gm, setMap, onRebuildRoads, onRegenerate, onExport, onDelete, onLink, onCopyLink }) {
  const set = (patch) => setMap((m) => ({ ...m, ...patch }));
  const widthKm = Math.round(map.w * (map.kmPerCell || 1));
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div>
        <div className="fm-kicker">Region map · {map.w}×{map.h} cells · seed {map.seed}</div>
        {gm ? <input className="fm-title-in" value={map.name} onChange={(e) => set({ name: e.target.value })} /> : <h2 className="fm-title">{map.name}</h2>}
      </div>
      <div className="fm-headbtns"><button className="fm-close" onClick={() => onCopyLink({ kind: "map" })} title="Copy a link to this map">🔗</button></div></div>
      {gm && (
        <div className="fm-sec fm-grid2">
          <label>Width of the map (km)<input className="fm-in" type="number" min={5} value={widthKm} onChange={(e) => set({ kmPerCell: Math.max(0.01, Number(e.target.value) / map.w) })} /></label>
          <label>Units<select className="fm-in" value={map.travel?.unit || "km"} onChange={(e) => set({ travel: { ...(map.travel || {}), unit: e.target.value } })}><option value="km">Kilometres</option><option value="mi">Miles</option></select></label>
          <label className="fm-check"><input type="checkbox" checked={!!map.playerVisible} onChange={(e) => set({ playerVisible: e.target.checked })} /> Public — anyone with a link can view it (read-only, no login)</label>
        </div>
      )}
      <div className="fm-sec fm-stat">
        {map.settlements.length} settlements · {map.pois.length} places · {map.roads.length} roads · {map.rivers.length} rivers · 1 cell = {(map.kmPerCell || 1).toFixed(2)} km
      </div>
      <Common item={map} set={set} gm={gm} isMap map={map} onLink={onLink} />
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

function EventFields({ item, set, gm, map, onLink, onPin, pinning }) {
  const [add, setAdd] = useState("");
  const places = item.places || [];
  const nameOf = (p) => map[p.kind]?.find((x) => x.id === p.id)?.name || "(gone)";
  const options = ["settlements", "pois", "labels", "roads", "rivers"].flatMap((kind) => (map[kind] || []).filter((x) => x.name).map((x) => ({ kind, id: x.id, name: x.name, k: COLLECTIONS[kind] })))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="fm-sec fm-grid2">
        <label>When{gm ? <input className="fm-in" value={item.date || ""} placeholder="Spring of 1243 AR" onChange={(e) => set({ date: e.target.value })} /> : <b>{item.date || "—"}</b>}</label>
        {gm && <label title="Number used to put events in order (e.g. the year)">Order (year)<input className="fm-in" type="number" step="any" value={item.sort ?? ""} onChange={(e) => set({ sort: e.target.value === "" ? null : Number(e.target.value) })} /></label>}
        <label>Kind{gm ? <select className="fm-in" value={item.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(EVENT_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select> : <b>{EVENT_TYPES[item.type]}</b>}</label>
        {gm && <label>On the map
          <span className="fm-row" style={{ margin: 0 }}>
            <button className={"fm-btn" + (pinning ? " primary" : "")} onClick={onPin}>{pinning ? "Click the map…" : item.x != null ? "Move pin" : "Pin it"}</button>
            {item.x != null && <button className="fm-btn" onClick={() => set({ x: null, y: null })}>Unpin</button>}
          </span></label>}
      </div>
      <div className="fm-sec">
        <div className="fm-label">Where / involving</div>
        <div className="fm-chips">
          {places.map((p, i) => (
            <span key={i} className="fm-chip">
              <a href="#" onClick={(e) => { e.preventDefault(); onLink(p); }}>{nameOf(p)}</a>
              {gm && <button className="fm-x inline" onClick={() => set({ places: places.filter((_, j) => j !== i) })}>×</button>}
            </span>
          ))}
          {!places.length && <span className="fm-muted">{gm ? "Link the places this happened at." : "—"}</span>}
        </div>
        {gm && (
          <select className="fm-in" value={add} onChange={(e) => {
            const o = options.find((x) => `${x.kind}:${x.id}` === e.target.value);
            if (o && !places.some((p) => p.id === o.id)) set({ places: [...places, { kind: o.kind, id: o.id }] });
            setAdd("");
          }}>
            <option value="">+ link a place…</option>
            {options.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.name} ({o.k})</option>)}
          </select>
        )}
      </div>
    </>
  );
}
