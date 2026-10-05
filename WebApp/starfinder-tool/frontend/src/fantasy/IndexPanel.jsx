import { useState } from "react";
import { SETTLEMENT_TYPES, POI_TYPES, LABEL_TYPES, ROAD_TYPES, EVENT_TYPES, fmtPop } from "./lib/model.js";

// Everything on the map, searchable; a click selects it and centres the map.
export default function IndexPanel({ map, gm, onPick }) {
  const [q, setQ] = useState("");
  const m = (e) => (gm || !e.hidden) && (!q || (e.name || "").toLowerCase().includes(q.toLowerCase()) || (e.description || "").toLowerCase().includes(q.toLowerCase()));
  const order = Object.keys(SETTLEMENT_TYPES);
  const groups = [
    ["Settlements", "settlements", [...map.settlements].filter(m).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name)), (s) => `${SETTLEMENT_TYPES[s.type]?.name} · ${fmtPop(s.population || 0)}`],
    ["Places", "pois", [...map.pois].filter(m).sort((a, b) => a.name.localeCompare(b.name)), (p) => POI_TYPES[p.type]],
    ["Events", "events", [...(map.events || [])].filter(m).sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity)), (e) => `${EVENT_TYPES[e.type] || "Event"}${e.date ? ` · ${e.date}` : ""}`],
    ["Regions & features", "labels", [...map.labels].filter(m).sort((a, b) => a.name.localeCompare(b.name)), (l) => LABEL_TYPES[l.type]],
    ["Rivers", "rivers", map.rivers.filter((r) => r.name && m(r)), () => "River"],
    ["Roads", "roads", map.roads.filter((r) => r.name && m(r)), (r) => ROAD_TYPES[r.type]?.name],
  ];
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div><div className="fm-kicker">Index</div><h2 className="fm-title">Gazetteer</h2></div></div>
      <input className="fm-in" placeholder="Search names and descriptions…" value={q} onChange={(e) => setQ(e.target.value)} />
      {groups.map(([title, kind, list, sub]) => list.length > 0 && (
        <div key={kind} className="fm-sec">
          <div className="fm-label"><span>{title}</span><span className="fm-muted">{list.length}</span></div>
          {list.map((e) => (
            <button key={e.id} className={"fm-item" + (e.hidden ? " hidden" : "")} onClick={() => onPick({ kind, id: e.id })}>
              <span>{e.name || "(unnamed)"}{(e.images || []).length ? " ▣" : ""}</span><small>{sub(e)}</small>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
