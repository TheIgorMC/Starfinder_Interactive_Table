import { useMemo, useState } from "react";
import { SECTOR_FOCI } from "@galaxy-core/lib/project.js";
import { keyTier } from "@galaxy-core/lib/planetGen.js";
import { POPL, sectorName, fmtPop, starColor } from "../../galaxy/common.js";
import { useSystemInfo, SysSections } from "../../galaxy/GalaxyMapPage.jsx";
import { EIcon } from "./icons.jsx";

// Panel header in the viewer's style (.gx-head), with an optional close.
export function Head({ kind, dot, title, sub, onClose, children, editable, onRename }) {
  return (
    <div className="gx-head">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div className="gx-kind">{dot && <span className="gx-dot" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />}{kind}</div>
        {onClose && <button className="gx-gbtn ge-x" aria-label="Close" onClick={onClose}>{EIcon.close()}</button>}
      </div>
      {editable ? <input className="ge-title-in" value={title} onChange={(e) => onRename(e.target.value)} aria-label="Name" /> : <h2>{title}</h2>}
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  );
}

function Flag({ on, onClick, icon, label, hint }) {
  return (
    <button className={"ge-flag" + (on ? " on" : "")} aria-pressed={on} onClick={onClick} title={hint}>
      {icon}{label}
    </button>
  );
}

const TIER_LABEL = { capital: "CAPITAL · 80–250 BN", key: "KEY SYSTEM · 40–120 BN", important: "IMPORTANT · 10–80 BN" };

// ---------------------------------------------------------------------------
// System inspector: the viewer's system panel + the curation controls.
export function SystemInspector({ D, system, actors, onUpdate, onClose, onOpenSystem, onPickSystem, onReroll, inWorkspace }) {
  const sel = D?.bySlug[system.slug]?.idx ?? -1;
  const info = useSystemInfo(D, sel);
  const up = (patch) => onUpdate(system.id, patch);
  const tier = keyTier(system);
  const here = actors.filter((a) => a.location === system.slug);
  const imp = Number(system.important) || 0;
  return (
    <>
      <Head kind={system.starType} dot={starColor(system.starType)} title={system.name} editable onRename={(name) => up({ name, locked: true })} onClose={onClose}
        sub={`${sectorName(system.sector)} · ${info?.inhabitants ? `${fmtPop(info.inhabitants)} inhabitants` : POPL[system.population] || system.population || "—"}`}>
        <div className="ge-flags">
          <Flag on={!!system.locked} onClick={() => up({ locked: !system.locked })} icon={EIcon.pin()} label="CURATED" hint="Kept by Generate systems / planets; the settlement pass only fills gaps (if asked)." />
          <Flag on={!!system.scriptLocked} onClick={() => up({ scriptLocked: !system.scriptLocked })} icon={EIcon.lock()} label="NO SCRIPTS" hint="No generator, settlement, faction, hyperlane or event pass ever changes it. Manual and MCP edits still work." />
          <Flag on={!!system.keySystem} onClick={() => up({ keySystem: !system.keySystem })} icon={EIcon.star()} label="KEY SYSTEM" hint="Organizational heart of the realm: the settlement pass gives it tens of billions of inhabitants." />
        </div>
        {(system.scriptLocked || tier) && (
          <div className="gx-lore">
            {system.scriptLocked ? "Scripts leave this system alone. " : ""}
            {tier ? `Headcount tier: ${TIER_LABEL[tier]}.` : ""}
          </div>
        )}
      </Head>
      <div className="gx-sec">
        <div className="gx-label"><span>IMPORTANCE</span><span style={{ color: "#ece6da" }}>{imp.toFixed(2)}</span></div>
        <input type="range" min="0" max="1" step="0.05" value={imp} onChange={(e) => up({ important: Number(e.target.value), locked: true })} />
        <div className="gx-lore">Higher shows the name from further out. 1.00 = landmark, always labelled.</div>
      </div>
      {!inWorkspace && (
        <div style={{ padding: "14px 22px", display: "flex", gap: 8 }}>
          <button className="gx-cta" onClick={onOpenSystem}>OPEN SYSTEM{EIcon.orrery()}</button>
        </div>
      )}
      {info && <SysSections info={info} onPick={(i) => onPickSystem(D.sys[i].s)} />}
      <div className="gx-sec">
        <div className="gx-label">NOTES</div>
        <textarea className="ge-in" rows={3} value={system.note || ""} placeholder="GM notes, shown in the viewer" onChange={(e) => up({ note: e.target.value })} />
      </div>
      {here.length > 0 && (
        <div className="gx-sec">
          <div className="gx-label">PEOPLE HERE · {here.length}</div>
          <div className="gx-chips-wrap">{here.map((a) => <span key={a.id} className="gx-chip-tag">{a.name}</span>)}</div>
        </div>
      )}
      <div className="gx-sec">
        <div className="gx-label">BODIES</div>
        <div className="gx-lore">{(system.bodies || []).length} bodies. {inWorkspace ? "Pick one on the left to edit it." : "Open the system to edit planets, cities and station layouts."}</div>
        <button className="ge-btn ghost" onClick={onReroll}>Reroll all bodies (random)</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
export function SectorInspector({ sector, project, onUpdate, onDelete, onClose, constrain, setConstrain }) {
  const systems = project.systems.filter((s) => s.sector === sector.slug);
  const colonized = systems.reduce((a, s) => a + (s.bodies || []).filter((b) => b.status === "colonized").length, 0);
  return (
    <>
      <Head kind="SECTOR" title={sector.name} editable onRename={(name) => onUpdate(sector.id, { name })} onClose={onClose} sub={`${sector.focus || "—"} · ${sector.points.length} vertices`} />
      <div className="gx-sec gx-grid" style={{ "--cols": 3 }}>
        <div className="gx-count"><div className="n">{systems.length}</div><div className="l">SYSTEMS</div></div>
        <div className="gx-count"><div className="n">{colonized}</div><div className="l">COLONIES</div></div>
        <div className="gx-count"><div className="n">{systems.filter((s) => s.locked).length}</div><div className="l">CURATED</div></div>
      </div>
      <div className="gx-sec">
        <div className="gx-label">FOCUS</div>
        <select className="ge-in" value={sector.focus} onChange={(e) => onUpdate(sector.id, { focus: e.target.value })}>
          {SECTOR_FOCI.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <label className="ge-check"><input type="checkbox" checked={constrain} onChange={(e) => setConstrain(e.target.checked)} /> Paint only inside this sector</label>
      </div>
      <div className="gx-sec">
        <button className="ge-btn danger" onClick={() => window.confirm(`Delete sector "${sector.name}" and its ${systems.length} systems?`) && onDelete(sector.id)}>Delete sector</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Systems list: search, flag filters, click to fly there.
const FILTERS = [["all", "ALL"], ["curated", "CURATED"], ["locked", "NO SCRIPTS"], ["key", "KEY"], ["empty", "NO COLONY"]];
export function SystemsPanel({ project, selectedId, onPick }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const [sector, setSector] = useState("");
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return project.systems.filter((s) => {
      if (qq && !s.name.toLowerCase().includes(qq)) return false;
      if (sector && s.sector !== sector) return false;
      if (f === "curated") return s.locked;
      if (f === "locked") return s.scriptLocked;
      if (f === "key") return s.keySystem || keyTier(s) === "key" || keyTier(s) === "capital";
      if (f === "empty") return !(s.bodies || []).some((b) => b.status === "colonized" || b.kind === "orbital station");
      return true;
    }).sort((a, b) => (b.important || 0) - (a.important || 0) || a.name.localeCompare(b.name));
  }, [project.systems, q, f, sector]);
  return (
    <div className="ge-list">
      <input className="ge-in" type="search" placeholder={`Search ${project.systems.length} systems…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ge-seg">
        {FILTERS.map(([k, l]) => <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>{l}</button>)}
      </div>
      <select className="ge-in" value={sector} onChange={(e) => setSector(e.target.value)}>
        <option value="">All sectors</option>
        {project.sectors.map((s) => <option key={s.id} value={s.slug}>{s.name} · {s.focus}</option>)}
      </select>
      <div className="gx-label sm" style={{ padding: "4px 2px" }}>{list.length} SHOWN</div>
      <div className="ge-rows">
        {list.slice(0, 300).map((s) => {
          const inh = (s.bodies || []).reduce((a, b) => a + (Number(b.inhabitants) || 0), 0);
          return (
            <button key={s.id} className={"gx-gbtn gx-row" + (s.id === selectedId ? " on" : "")} onClick={() => onPick(s.id)}>
              <span className="gx-dot" style={{ width: 8, height: 8, background: starColor(s.starType) }} />
              <span className="t"><span className="a">{s.name}</span><span className="b" style={{ color: "#9a958b" }}>{sectorName(s.sector)} · {inh ? fmtPop(inh) : POPL[s.population] || s.population}</span></span>
              <span className="r ge-flagicons">{s.locked && EIcon.pin()}{s.scriptLocked && EIcon.lock()}{(s.keySystem || (s.important || 0) >= 0.95) && EIcon.star()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
