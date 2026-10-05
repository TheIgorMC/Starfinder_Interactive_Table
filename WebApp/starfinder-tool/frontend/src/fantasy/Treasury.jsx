import { useMemo, useState } from "react";
import { METALS, PRESETS, makeCurrency, toBase, breakdown, formatAmount, exchange } from "@galaxy-core/fantasy/currency.js";
import { newId } from "@galaxy-core/fantasy/model.js";

// Coinage of the map: currencies (one per realm if you like), their coins,
// exchange rates, a converter and a purse counter.
export default function Treasury({ treasury, setTreasury, gm }) {
  const { currencies, feePct = 0 } = treasury;
  const [edit, setEdit] = useState(null);
  const ref = currencies[0];
  const setCur = (id, patch) => setTreasury((t) => ({ ...t, currencies: t.currencies.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setDen = (cid, did, patch) => setTreasury((t) => ({ ...t, currencies: t.currencies.map((c) => (c.id !== cid ? c : { ...c, denominations: c.denominations.map((d) => (d.id === did ? { ...d, ...patch } : d)) })) }));

  // converter
  const [amount, setAmount] = useState(1);
  const [fromCur, setFromCur] = useState(ref?.id);
  const fc = currencies.find((c) => c.id === fromCur) || ref;
  const [fromDen, setFromDen] = useState(null);
  const fd = fc?.denominations.find((d) => d.id === fromDen) || [...(fc?.denominations || [])].sort((a, b) => b.value - a.value)[0];
  const base = (Number(amount) || 0) * (fd?.value || 0);

  // purse
  const [purseCur, setPurseCur] = useState(ref?.id);
  const pc = currencies.find((c) => c.id === purseCur) || ref;
  const [purse, setPurse] = useState({});
  const purseBase = useMemo(() => (pc ? toBase(pc, purse) : 0), [pc, purse]);

  if (!ref) return null;
  return (
    <div className="fm-inspector">
      <div className="fm-head"><div>
        <div className="fm-kicker">Treasury</div>
        <h2 className="fm-title">Coins & exchange</h2>
      </div></div>

      <div className="fm-sec">
        <div className="fm-label">Converter</div>
        <div className="fm-row">
          <input className="fm-in" style={{ width: 90 }} type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="fm-in" value={fd?.id || ""} onChange={(e) => setFromDen(e.target.value)}>{fc.denominations.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.abbr})</option>)}</select>
          {currencies.length > 1 && <select className="fm-in" value={fc.id} onChange={(e) => { setFromCur(e.target.value); setFromDen(null); }}>{currencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        </div>
        <div className="fm-conv">
          <div><span>in coins</span><b>{formatAmount(fc, base)}</b></div>
          {[...fc.denominations].sort((a, b) => b.value - a.value).map((d) => (
            <div key={d.id}><span><i className="fm-coin" style={{ background: METALS[d.metal] || METALS.other }} />{d.name}</span><b>{fmtNum(base / d.value)} {d.abbr}</b></div>
          ))}
          {currencies.filter((c) => c.id !== fc.id).map((c) => {
            const b = exchange(fc, c, base, feePct);
            return <div key={c.id} className="fx"><span>{c.name}{feePct ? ` (−${feePct}% fee)` : ""}</span><b>{formatAmount(c, b)}</b></div>;
          })}
        </div>
      </div>

      <div className="fm-sec">
        <div className="fm-label"><span>Purse</span>{currencies.length > 1 && <select className="fm-in sm" value={pc.id} onChange={(e) => { setPurseCur(e.target.value); setPurse({}); }}>{currencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
        <div className="fm-purse">
          {[...pc.denominations].sort((a, b) => b.value - a.value).map((d) => (
            <label key={d.id}><i className="fm-coin" style={{ background: METALS[d.metal] || METALS.other }} />{d.abbr}
              <input className="fm-in" type="number" min={0} value={purse[d.id] || ""} placeholder="0" onChange={(e) => setPurse((p) => ({ ...p, [d.id]: e.target.value }))} /></label>
          ))}
        </div>
        <div className="fm-conv">
          <div><span>Total, fewest coins</span><b>{formatAmount(pc, purseBase)}</b></div>
          {[...pc.denominations].sort((a, b) => b.value - a.value).slice(0, 2).map((d) => <div key={d.id}><span>as {d.name.toLowerCase()}s</span><b>{fmtNum(purseBase / d.value)} {d.abbr}</b></div>)}
          <button className="fm-link" onClick={() => setPurse({})}>empty the purse</button>
        </div>
      </div>

      <div className="fm-sec">
        <div className="fm-label"><span>Currencies</span>{gm && <span className="fm-muted">first one = reference for exchange rates</span>}</div>
        {currencies.map((c, ci) => (
          <div key={c.id} className="fm-currency">
            <div className="fm-row between">
              <b>{c.name}</b>
              <span className="fm-muted">{c.realm || ""}{ci > 0 ? ` · 1 ${smallest(c)?.abbr} = ${fmtNum(c.rate)} ${smallest(ref)?.abbr}` : " · reference"}</span>
              {gm && <button className="fm-link" onClick={() => setEdit(edit === c.id ? null : c.id)}>{edit === c.id ? "done" : "edit"}</button>}
            </div>
            <div className="fm-coins">{[...c.denominations].sort((a, b) => b.value - a.value).map((d) => (
              <span key={d.id} title={`${d.name} = ${fmtNum(d.value)} ${smallest(c)?.abbr}`}><i className="fm-coin" style={{ background: METALS[d.metal] || METALS.other }} />{d.abbr}</span>
            ))}</div>
            {gm && edit === c.id && (
              <div className="fm-curedit">
                <div className="fm-grid2">
                  <label>Name<input className="fm-in" value={c.name} onChange={(e) => setCur(c.id, { name: e.target.value })} /></label>
                  <label>Realm<input className="fm-in" value={c.realm || ""} onChange={(e) => setCur(c.id, { realm: e.target.value })} /></label>
                  {ci > 0 && <label>1 {smallest(c)?.abbr} is worth … {smallest(ref)?.abbr}<input className="fm-in" type="number" step="any" min={0} value={c.rate} onChange={(e) => setCur(c.id, { rate: Number(e.target.value) || 0 })} /></label>}
                </div>
                <table className="fm-table edit">
                  <thead><tr><th>Coin</th><th>Abbr.</th><th>Metal</th><th>Value</th><th /></tr></thead>
                  <tbody>{c.denominations.map((d) => (
                    <tr key={d.id}>
                      <td><input className="fm-in" value={d.name} onChange={(e) => setDen(c.id, d.id, { name: e.target.value })} /></td>
                      <td><input className="fm-in" style={{ width: 50 }} value={d.abbr} onChange={(e) => setDen(c.id, d.id, { abbr: e.target.value })} /></td>
                      <td><select className="fm-in" value={d.metal} onChange={(e) => setDen(c.id, d.id, { metal: e.target.value })}>{Object.keys(METALS).map((m) => <option key={m}>{m}</option>)}</select></td>
                      <td><input className="fm-in" style={{ width: 70 }} type="number" step="any" min={0} value={d.value} onChange={(e) => setDen(c.id, d.id, { value: Number(e.target.value) || 0 })} /></td>
                      <td><button className="fm-x inline" onClick={() => setCur(c.id, { denominations: c.denominations.filter((x) => x.id !== d.id) })}>×</button></td>
                    </tr>
                  ))}</tbody>
                </table>
                <div className="fm-row">
                  <button className="fm-btn" onClick={() => setCur(c.id, { denominations: [...c.denominations, { id: newId("d"), name: "New coin", abbr: "nc", metal: "silver", value: 1 }] })}>+ coin</button>
                  {ci > 0 && <button className="fm-btn danger" onClick={() => { setTreasury((t) => ({ ...t, currencies: t.currencies.filter((x) => x.id !== c.id) })); setEdit(null); }}>Delete currency</button>}
                </div>
                <div className="fm-muted">Values are in the smallest coin of this currency.</div>
              </div>
            )}
          </div>
        ))}
        {gm && (
          <div className="fm-row">
            <select className="fm-in" value="" onChange={(e) => { if (e.target.value) setTreasury((t) => ({ ...t, currencies: [...t.currencies, makeCurrency(e.target.value, undefined, 1)] })); }}>
              <option value="">+ add a currency from…</option>
              {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            </select>
            <label className="fm-inline">Exchange fee %<input className="fm-in" style={{ width: 60 }} type="number" min={0} max={50} value={feePct} onChange={(e) => setTreasury((t) => ({ ...t, feePct: Number(e.target.value) || 0 }))} /></label>
          </div>
        )}
      </div>
    </div>
  );
}

const smallest = (c) => [...(c?.denominations || [])].sort((a, b) => a.value - b.value)[0];
function fmtNum(v) {
  if (!isFinite(v)) return "—";
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 100) / 100).toLocaleString();
}
export { breakdown };
