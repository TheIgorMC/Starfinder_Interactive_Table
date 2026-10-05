import { useState } from "react";
import { EVENT_TYPES, findChapter } from "@galaxy-core/fantasy/model.js";

// Events in order (by their "order" number, then as written). Events can be
// pinned on the map, tied to places and cite chapters of the book.
export default function TimelinePanel({ map, gm, onNew, onPick, showEvents, setShowEvents, onLink }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const list = (map.events || [])
    .filter((e) => (gm || !e.hidden) && (!type || e.type === type) && (!q || `${e.name} ${e.date} ${e.description}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity) || String(a.date || "").localeCompare(String(b.date || "")));
  const nameOf = (p) => map[p.kind]?.find((x) => x.id === p.id)?.name;
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div><div className="fm-kicker">Timeline</div><h2 className="fm-title">Events & happenings</h2></div></div>
      <div className="fm-row">
        <input className="fm-in" style={{ flex: 1 }} placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="fm-in" value={type} onChange={(e) => setType(e.target.value)}><option value="">all kinds</option>{Object.entries(EVENT_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      </div>
      <div className="fm-row between">
        <label className="fm-check"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} /> Show pins on the map</label>
        {gm && <button className="fm-btn primary" onClick={onNew}>+ Event</button>}
      </div>
      {gm && <div className="fm-muted">Or use the Event tool (E) to drop one straight onto the map.</div>}
      <div className="fm-timeline">
        {list.map((e) => (
          <div key={e.id} className={"fm-tl" + (e.hidden ? " hidden" : "")} onClick={() => onPick({ kind: "events", id: e.id })}>
            <div className="fm-tl-date">{e.date || "—"}</div>
            <div className="fm-tl-body">
              <div className="fm-tl-title">{e.name || "(untitled)"} <small>{EVENT_TYPES[e.type] || "Event"}{e.x != null ? " · ⚑" : ""}</small></div>
              {(e.places || []).length > 0 && <div className="fm-tl-places">{e.places.map(nameOf).filter(Boolean).join(" · ")}</div>}
              {(e.refs || []).length > 0 && (
                <div className="fm-tl-refs">{e.refs.map((r, i) => {
                  const f = findChapter(map, r.chapter);
                  return f ? <a key={i} href="#" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onLink({ kind: "chapter", id: r.chapter }); }}>{f.book.title} {f.chapter.n}</a> : null;
                })}</div>
              )}
            </div>
          </div>
        ))}
        {!list.length && <div className="fm-muted">No events yet.</div>}
      </div>
    </div>
  );
}
