import { useMemo } from "react";
import { MODES, PACES, computeRoute, schedule, fmtDuration } from "@galaxy-core/fantasy/travel.js";
import { fmtDist } from "@galaxy-core/fantasy/model.js";

const BY_NAME = { royal: "Royal road", road: "Road", track: "Cart track", trail: "Footpath", offroad: "Off-road", water: "Water" };

// Travel estimator: waypoints are set by clicking the map with the TRAVEL
// tool (snapping to settlements) or picked here; every mode is routed on
// its own (a cart keeps to the roads, a rider cuts across country).
export default function TravelPanel({ map, world, trip, setTrip, unit }) {
  const results = useMemo(() => {
    if (!world || trip.waypoints.length < 2) return null;
    const out = {};
    for (const k of Object.keys(MODES)) out[k] = computeRoute(world, trip.waypoints, k, { crow: trip.crow });
    return out;
  }, [world, trip.waypoints, trip.crow]);
  const sel = results?.[trip.mode];
  const names = trip.names || [];
  const settlements = [...map.settlements].sort((a, b) => a.name.localeCompare(b.name));
  const addStop = (id) => {
    const s = map.settlements.find((x) => x.id === id);
    if (s) setTrip((t) => ({ ...t, waypoints: [...t.waypoints, [s.x, s.y]], names: [...(t.names || []), s.name] }));
  };
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div>
        <div className="fm-kicker">Travel</div>
        <h2 className="fm-title">How long does it take?</h2>
      </div></div>
      <div className="fm-sec">
        <div className="fm-muted">Click the map with the <b>Travel</b> tool (M) to set stops — clicks snap to settlements — or add them here.</div>
        <ol className="fm-stops">
          {trip.waypoints.map((_, i) => (
            <li key={i}>{names[i] || `Point ${i + 1}`}
              <button className="fm-x inline" onClick={() => setTrip((t) => ({ ...t, waypoints: t.waypoints.filter((_, j) => j !== i), names: (t.names || []).filter((_, j) => j !== i) }))}>×</button></li>
          ))}
        </ol>
        <div className="fm-row">
          <select className="fm-in" value="" onChange={(e) => addStop(e.target.value)}>
            <option value="">+ add a settlement…</option>
            {settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="fm-btn" onClick={() => setTrip((t) => ({ ...t, waypoints: [], names: [] }))}>Clear</button>
        </div>
        <label className="fm-check"><input type="checkbox" checked={trip.crow} onChange={(e) => setTrip((t) => ({ ...t, crow: e.target.checked }))} /> As the crow flies (straight line, no route finding)</label>
      </div>

      {results && (
        <>
          <div className="fm-sec">
            <div className="fm-label">Pace</div>
            <div className="fm-seg">{Object.entries(PACES).map(([k, p]) => <button key={k} className={trip.pace === k ? "on" : ""} onClick={() => setTrip((t) => ({ ...t, pace: k }))} title={p.note}>{p.name}</button>)}</div>
            {PACES[trip.pace].note && <div className="fm-muted">{PACES[trip.pace].note}</div>}
          </div>
          <table className="fm-table">
            <thead><tr><th>Mode</th><th>Distance</th><th>Time</th><th>Days</th></tr></thead>
            <tbody>
              {Object.entries(MODES).map(([k, m]) => {
                const r = results[k];
                const s = schedule(r.hours, k, trip.pace);
                const ok = r.ok && r.km > 0;
                return (
                  <tr key={k} className={(trip.mode === k ? "on " : "") + (ok ? "" : "na")} onClick={() => setTrip((t) => ({ ...t, mode: k }))} title={m.note}>
                    <td>{m.name}</td>
                    <td>{ok ? fmtDist(r.km, unit) : "—"}</td>
                    <td>{ok ? fmtDuration(s.moving, s.perDay) : "no route"}</td>
                    <td>{ok ? (s.days < 1 ? "<1" : s.days.toFixed(1)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sel && sel.ok && (
            <div className="fm-sec">
              <div className="fm-label">{MODES[trip.mode].name} — on the map</div>
              <div className="fm-muted">{MODES[trip.mode].note}. {MODES[trip.mode].hours + PACES[trip.pace].extra} h of travel a day.</div>
              <div className="fm-bars">
                {Object.entries(sel.by).sort((a, b) => b[1] - a[1]).map(([k, km]) => (
                  <div key={k} className="fm-barrow"><span>{BY_NAME[k] || k}</span><i style={{ width: `${(km / sel.km) * 100}%` }} className={"b-" + k} /><b>{fmtDist(km, unit)}</b></div>
                ))}
              </div>
              {trip.waypoints.length > 2 && (
                <div className="fm-legs">{sel.legs.map((l, i) => {
                  const s = schedule(l.hours, trip.mode, trip.pace);
                  return <div key={i}>{names[i] || `Stop ${i + 1}`} → {names[i + 1] || `Stop ${i + 2}`}: <b>{fmtDist(l.km, unit)}</b>, {fmtDuration(s.moving, s.perDay)}</div>;
                })}</div>
              )}
            </div>
          )}
          <div className="fm-muted fm-small">Speeds: on foot 4.8 km/h, horse 6.5, courier with relays 12, wagon 3.5, carriage 5.5, river boat 5, ship 8 (on a good road). Forest, hills and marsh slow everyone down; carts need roads; fords without a bridge cost time.</div>
        </>
      )}
    </div>
  );
}
