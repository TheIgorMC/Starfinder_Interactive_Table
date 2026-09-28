import { useState } from "react";
import { FIELD_DEFS } from "@galaxy-core/lib/project.js";
import { EIcon } from "./icons.jsx";

// BUILD — the whole generation pipeline as one guided checklist, in order.
// Each step says what it does, whether it's done, what it needs first, and
// has one primary action; the knobs stay folded under "Options".
function Step({ n, title, status, done, blocked, children, options, open: open0 }) {
  const [open, setOpen] = useState(!!open0);
  return (
    <div className={"ge-step" + (done ? " done" : "") + (blocked ? " blocked" : "")}>
      <div className="ge-step-h">
        <span className="ge-step-n">{done ? EIcon.check() : n}</span>
        <span className="ge-step-t">{title}</span>
        <span className="ge-step-s">{status}</span>
      </div>
      <div className="ge-step-b">
        {blocked ? <div className="gx-lore">{blocked}</div> : children}
        {options && !blocked && (
          <>
            <button className="ge-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "▾ Options" : "▸ Options"}</button>
            {open && <div className="ge-step-opt">{options}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default function BuildPanel({ p, act, tool, setTool, field, setField, showField, setShowField, spacing, setSpacing, settleStatus }) {
  const [integrate, setIntegrate] = useState(true);
  const nSys = p.systems.length, nSec = p.sectors.length;
  const painted = FIELD_DEFS.filter((f) => (p.fields[f.key] || []).some((v) => v > 0.01)).length;
  const colonized = p.systems.reduce((a, s) => a + (s.bodies || []).filter((b) => b.status === "colonized").length, 0);
  const authoredF = p.factions.filter((f) => f.origin !== "generated").length;
  const resolved = p.systems.some((s) => s.control);
  const genActors = p.actors.filter((a) => a.origin === "generated").length;
  const needSys = nSys === 0 ? "Generate systems first (step 3)." : null;

  return (
    <div className="ge-build">
      <div className="gx-lore" style={{ padding: "0 2px 6px" }}>
        Work top to bottom. Every step can be re-run; curated systems are kept, script-locked ones are never touched.
      </div>

      <Step n="1" title="Sectors" status={nSec ? `${nSec} drawn` : "none"} done={nSec > 0}>
        <div className="gx-lore">Outline the settled regions: systems are only placed inside sectors.</div>
        <button className={"ge-btn" + (tool === "sector" ? " on" : "")} onClick={() => setTool("sector")}>{EIcon.sector()} Draw a sector</button>
      </Step>

      <Step n="2" title="Density fields" status={`${painted}/${FIELD_DEFS.length} painted`} done={painted > 0}>
        <div className="gx-lore">Paint where people, trade and security concentrate. Shift-drag erases.</div>
        <div className="ge-fields">
          {FIELD_DEFS.map((f) => (
            <button key={f.key} className={"ge-field" + (tool === "paint" && field === f.key ? " on" : "")} onClick={() => { setField(f.key); setTool("paint"); setShowField(true); }}>
              <i style={{ background: `rgb(${f.color})` }} />{f.label}
            </button>
          ))}
        </div>
        <label className="ge-check"><input type="checkbox" checked={showField} onChange={(e) => setShowField(e.target.checked)} /> Show the selected field on the map</label>
      </Step>

      <Step n="3" title="Systems" status={nSys ? `${nSys} systems` : "none"} done={nSys > 0}
        blocked={nSec === 0 ? "Draw at least one sector first." : null}
        options={(
          <>
            <label className="ge-lbl">Min spacing <b>{spacing.min}</b></label>
            <input type="range" min="5" max="80" value={spacing.min} onChange={(e) => setSpacing({ ...spacing, min: Math.min(Number(e.target.value), spacing.max) })} />
            <label className="ge-lbl">Max spacing <b>{spacing.max}</b></label>
            <input type="range" min="20" max="200" value={spacing.max} onChange={(e) => setSpacing({ ...spacing, max: Math.max(Number(e.target.value), spacing.min) })} />
            <button className="ge-btn ghost" disabled={!nSys} onClick={act.redistribute}>Redistribute positions only</button>
            <button className={"ge-btn ghost" + (tool === "system" ? " on" : "")} onClick={() => setTool("system")}>{EIcon.system()} Place one by hand</button>
          </>
        )}>
        <div className="gx-lore">Scatters systems inside the sectors following the population field. Curated systems stay where they are.</div>
        <button className="ge-btn primary" onClick={act.systems}>{nSys ? "Regenerate systems" : "Generate systems"}</button>
      </Step>

      <Step n="4" title="Planets & settlements" status={nSys ? `${colonized} colonized worlds` : "—"} done={colonized > 0} blocked={needSys}
        options={(
          <>
            <button className="ge-btn ghost" onClick={act.planets}>Reroll all planets (unlocked systems)</button>
          </>
        )}>
        <div className="gx-lore">Colonizes the golden zone, sets real headcounts (key systems: tens of billions), stations and outposts. Additive and repeatable.</div>
        <label className="ge-check"><input type="checkbox" checked={integrate} onChange={(e) => setIntegrate(e.target.checked)} /> Integrate curated systems too (fills gaps only)</label>
        <button className="ge-btn primary" onClick={() => act.settle(integrate)}>Apply settlement rules</button>
        {settleStatus && <div className="gx-lore">{settleStatus}</div>}
      </Step>

      <Step n="5" title="Hyperlanes" status={p.hyperlanes.length ? `${p.hyperlanes.length} lanes` : "none"} done={p.hyperlanes.length > 0} blocked={needSys}
        options={<button className={"ge-btn ghost" + (tool === "lane" ? " on" : "")} onClick={() => setTool("lane")}>{EIcon.lane()} Add / remove a lane by hand</button>}>
        <div className="gx-lore">Connects the systems (denser where the hyperlane field is high).</div>
        <button className="ge-btn primary" onClick={act.lanes}>{p.hyperlanes.length ? "Regenerate hyperlanes" : "Generate hyperlanes"}</button>
      </Step>

      <Step n="6" title="Factions & territory" status={resolved ? `${p.factions.length} factions` : authoredF ? `${authoredF} placed` : "none"} done={resolved} blocked={needSys}>
        <div className="gx-lore">Place the major powers on the map, then resolve control, security and war risk. Border factions are added automatically.</div>
        <div className="ge-row">
          <button className={"ge-btn" + (tool === "faction" ? " on" : "")} onClick={() => setTool("faction")}>{EIcon.faction()} Place a faction</button>
          <button className="ge-btn primary" onClick={act.factions}>Resolve territory</button>
        </div>
      </Step>

      <Step n="7" title="Fleets" status={p.companies.length ? `${p.companies.length} companies` : p.shipModels.length ? `${p.shipModels.length} models` : "none"} done={p.companies.length > 0} blocked={needSys}>
        <div className="gx-lore">A catalog of ship models, then shipping companies per sector with named ships.</div>
        <div className="ge-row">
          <button className="ge-btn" onClick={act.shipModels}>{p.shipModels.length ? "Reroll models" : "Ship models"}</button>
          <button className="ge-btn primary" disabled={!p.shipModels.length} onClick={act.companies}>Companies</button>
        </div>
      </Step>

      <Step n="8" title="Background people" status={genActors ? `${genActors} actors` : "none"} done={genActors > 0} blocked={needSys}>
        <div className="gx-lore">Governors, captains, local fixers: cheap background cast. Hand-made actors are never replaced.</div>
        <button className="ge-btn primary" onClick={act.actors}>{genActors ? "Reroll background actors" : "Generate background actors"}</button>
      </Step>
    </div>
  );
}
