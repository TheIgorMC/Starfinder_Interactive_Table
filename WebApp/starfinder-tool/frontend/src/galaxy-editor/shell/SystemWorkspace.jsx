import { useEffect, useMemo, useRef, useState } from "react";
import { compactSystem } from "@galaxy-core/lib/compact.js";
import { STATION_CLASSES } from "@galaxy-core/lib/planetGen.js";
import { summarizeStation } from "@galaxy-core/lib/stationGen.js";
import { SystemView } from "../../galaxy/system-view.js";
import { KLAB, short, starColor, hasSurface, fmtPop, sectorName } from "../../galaxy/common.js";
import { bodyTree, BodyIcon } from "../../galaxy/SystemPage.jsx";
import { Icon } from "../../galaxy/ui.jsx";
import { BodyEditor, blankBody } from "../components/OrreryView.jsx";
import CityEditor from "../components/CityEditor.jsx";
import { Head } from "./Inspectors.jsx";
import { EIcon } from "./icons.jsx";

// SYSTEM workspace: the viewer's system view (realistic orrery / Elite
// schematic) of the live system, the viewer's body tree on the left, and
// the body editor on the right — planets, headcounts, surface sites and
// city layouts, station data and a jump into the station generator.
export default function SystemWorkspace({ project, system, onPickSystem, onUpdateSystem, onOpenStation, systemInspector }) {
  const cvRef = useRef(null), viewRef = useRef(null);
  const [mode, setMode] = useState("real");
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(false);
  const cs = useMemo(() => (system ? compactSystem(system) : null), [system]);
  const selRef = useRef(setSel); selRef.current = setSel;

  useEffect(() => {
    if (!cs || !cvRef.current) return undefined;
    const v = new SystemView(cvRef.current, cs, {
      onSelect: (id) => selRef.current(id),
      onHover: setHov,
      layout: (W, H) => ({ cx: (340 + W - 412) / 2, cy: H / 2 + 50, extent: Math.max(150, Math.min((W - 760) / 2 + 20, H / 2 - 110)) }),
    });
    v.setMode(mode); v.setPlaying(playing);
    viewRef.current = v;
    return () => { v.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system?.id]);
  // live edits: swap the data in place (keeps the camera)
  useEffect(() => { if (viewRef.current && cs) { const v = viewRef.current, keep = { sx: v.sx, sz: v.sz, goalSZ: v.goalSZ }; v.setSystem(cs); Object.assign(v, keep); } }, [cs]);
  useEffect(() => { viewRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { viewRef.current?.setPlaying(playing); }, [playing]);
  useEffect(() => { viewRef.current?.setSel(sel); }, [sel]);
  useEffect(() => { setSel(null); }, [system?.id]);

  if (!system) {
    return (
      <div className="ge-ws-empty">
        <div className="gx-center-msg" style={{ position: "static" }}>PICK A SYSTEM
          <select className="gx-select" value="" onChange={(e) => onPickSystem(e.target.value)}>
            <option value="">— choose —</option>
            {[...project.systems].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
    );
  }

  const bodies = system.bodies || [];
  const tree = bodyTree(cs);
  const body = sel && sel !== "__star" ? bodies.find((b) => b.slug === sel) : null;
  const writeBodies = (next) => onUpdateSystem(system.id, { bodies: next, locked: true });
  const updateBody = (slug, patch) => writeBodies(bodies.map((b) => (b.slug === slug ? { ...b, ...patch } : b)));
  const deleteBody = (slug) => {
    const gone = new Set([slug, ...bodies.filter((b) => b.parent === slug).map((b) => b.slug)]);
    if (!window.confirm(`Delete ${bodies.find((b) => b.slug === slug)?.name}${gone.size > 1 ? ` and ${gone.size - 1} satellite(s)` : ""}?`)) return;
    writeBodies(bodies.filter((b) => !gone.has(b.slug))); setSel(null);
  };
  const maxAU = Math.max(1, ...bodies.filter((b) => !b.parent).map((b) => b.orbitAUOuter || b.orbitAU || 0));
  const add = (kind) => {
    const host = kind === "moon" || kind === "orbital station" ? (body ? body.parent || body.slug : null) : null;
    if ((kind === "moon" || kind === "orbital station") && !host) { window.alert("Select the planet it should orbit first."); return; }
    const b = blankBody(system, bodies, kind, host, maxAU * 1.25);
    writeBodies([...bodies, b]); setSel(b.slug);
  };

  return (
    <div className="ge-sysws">
      <canvas ref={cvRef} className={"gx-canvas" + (hov ? " hov" : "")} />
      <div className="ge-subbar">
        <div className="gx-titleblock">
          <div className="gx-eyebrow">SYSTEM · {sectorName(system.sector).toUpperCase()}</div>
          <h1 className="gx-title">{system.name}</h1>
        </div>
        <div className="gx-grow" />
        <label htmlFor="ge-jump" className="gx-ox gx-nowrap" style={{ fontSize: 11, letterSpacing: "0.18em", color: "#9a958b" }}>JUMP TO</label>
        <select id="ge-jump" className="gx-select" value={system.id} onChange={(e) => onPickSystem(e.target.value)}>
          {[...project.systems].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div role="group" aria-label="View style" className="gx-group">
          <button className={"gx-tbtn" + (mode === "real" ? " on" : "")} onClick={() => setMode("real")}>REALISTIC</button>
          <button className={"gx-tbtn" + (mode === "schem" ? " on" : "")} onClick={() => setMode("schem")}>SCHEMATIC</button>
        </div>
        <div role="group" aria-label="Zoom" className="gx-group">
          <button className="gx-tbtn" style={{ width: 40, padding: 0 }} aria-label="Zoom out" onClick={() => viewRef.current?.zoomOut()}>{Icon.minus()}</button>
          <button className="gx-tbtn" style={{ width: 40, padding: 0 }} aria-label="Zoom in" onClick={() => viewRef.current?.zoomIn()}>{Icon.plus()}</button>
        </div>
        {mode === "real" && (
          <button className="gx-tbtn gx-group" style={{ height: 44, padding: "0 14px" }} onClick={() => setPlaying(!playing)}>{playing ? Icon.pause() : Icon.play()}{playing ? "PAUSE" : "ANIMATE"}</button>
        )}
      </div>

      <nav aria-label="Bodies" className="gx-left gx-scroll ge-left">
        <div className="gx-label" style={{ padding: "16px 18px 10px" }}>BODIES · {bodies.length}</div>
        <button className={"gx-tbtn gx-row" + (!body ? " on" : "")} style={{ minHeight: 48, padding: "0 18px", height: "auto", fontFamily: "inherit", letterSpacing: 0 }} onClick={() => setSel("__star")}>
          <span className="gx-dot" style={{ width: 16, height: 16, background: starColor(system.starType), boxShadow: `0 0 10px ${starColor(system.starType)}` }} />
          <span className="t"><span className="a" style={{ color: "#fff4e6" }}>{system.name}</span><span className="b" style={{ color: "#9a958b" }}>{system.starType}</span></span>
        </button>
        {tree.out.map(({ b, depth }) => (
          <button key={b.s} className={"gx-tbtn gx-row" + (sel === b.s ? " on" : "")} style={{ padding: `0 18px 0 ${18 + depth * 22}px`, height: "auto", fontFamily: "inherit", letterSpacing: 0 }} onClick={() => setSel(b.s)}>
            <BodyIcon b={b} />
            <span className="t"><span className="a" style={{ fontSize: 14 }}>{short(b.n, cs.n) || b.n}</span>
              <span className="b" style={{ color: b.st === "colonized" ? "#7fdcf2" : b.st === "extraction" ? "#ffb866" : "#9a958b" }}>{KLAB[b.k]}{b.st === "colonized" ? " · SETTLED" : b.st === "extraction" ? " · EXTRACTION" : ""}{b.pc ? ` · ${fmtPop(b.pc)}` : ""}</span></span>
          </button>
        ))}
        <div className="ge-addbar">
          <div className="gx-label sm">ADD</div>
          <div className="ge-row">
            <button className="ge-btn ghost" onClick={() => add("rocky planet")}>+ Planet</button>
            <button className="ge-btn ghost" onClick={() => add("asteroid belt")}>+ Belt</button>
          </div>
          <div className="ge-row">
            <button className="ge-btn ghost" disabled={!body} onClick={() => add("moon")}>+ Moon</button>
            <button className="ge-btn ghost" disabled={!body} onClick={() => add("orbital station")}>+ Station</button>
          </div>
          {!body && <div className="gx-lore">Select a planet to attach moons or stations.</div>}
        </div>
      </nav>

      <aside aria-label="Details" className="gx-panel gx-scroll ge-rpanel">
        {body ? (
          <BodyPanel system={system} body={body} bodies={bodies}
            onChange={(patch) => updateBody(body.slug, patch)}
            onDelete={() => deleteBody(body.slug)}
            onUpdateSystem={onUpdateSystem}
            onOpenStation={() => onOpenStation(system, body)}
            onSelectBody={setSel} />
        ) : systemInspector}
      </aside>
      <div className="gx-hint" style={{ left: 340, right: 412 }}>{mode === "schem" ? "DRAG TO SCROLL · SCROLL TO ZOOM · CLICK A BODY" : "DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A BODY"}</div>
    </div>
  );
}

function BodyPanel({ system, body, bodies, onChange, onDelete, onUpdateSystem, onOpenStation, onSelectBody }) {
  const isStation = body.kind === "orbital station";
  const layout = body.layout ? summarizeStation(body.layout) : null;
  const parent = body.parent && bodies.find((b) => b.slug === body.parent);
  const kids = bodies.filter((b) => b.parent === body.slug);
  const cls = isStation && STATION_CLASSES.find((c) => c.value === body.sizeClass);
  return (
    <>
      <Head kind={KLAB[body.kind] || body.kind} title={body.name} editable onRename={(name) => onChange({ name })}
        sub={[parent ? `orbits ${parent.name}` : body.orbitAU != null ? `${body.orbitAU} AU` : null, body.status === "colonized" ? "settled" : body.status, body.inhabitants ? `${fmtPop(body.inhabitants)} people` : null].filter(Boolean).join(" · ")}>
        <div className="gx-chips-wrap" style={{ gap: 6, marginTop: 4 }}>
          {body.habitable && <span className="gx-badge" style={{ background: "rgba(95,176,138,.18)", color: "#9fe3c0" }}>HABITABLE</span>}
          {(body.tags || []).filter((t) => ["ecumenopolis", "capital", "seat-of-government", "capital-of-colonized-systems", "ring-station"].includes(t)).map((t) => <span key={t} className="gx-badge" style={{ background: "rgba(255,210,122,.2)", color: "#ffd27a" }}>{t.replace(/-/g, " ").toUpperCase()}</span>)}
          {cls && <span className="gx-badge" style={{ background: "rgba(255,154,60,.16)", color: "#ffc58c" }}>{cls.value.toUpperCase()}</span>}
        </div>
      </Head>

      {isStation && (
        <div className="gx-sec">
          <div className="gx-label"><span>LAYOUT</span><span style={{ color: "#ece6da" }}>{layout ? `${layout.blocks} BLOCKS · ${layout.shops.length} VENUES` : "NOT GENERATED"}</span></div>
          {layout && <div className="gx-lore">{layout.archetype} · {layout.footprintM.length}×{layout.footprintM.width} m · {layout.decks} decks · bunks for ~{fmtPop(layout.capacity)}</div>}
          <button className="gx-cta" onClick={onOpenStation}>{layout ? "OPEN STATION LAYOUT" : "GENERATE LAYOUT"}{EIcon.station()}</button>
        </div>
      )}

      {kids.length > 0 && (
        <div className="gx-sec">
          <div className="gx-label">IN ORBIT · {kids.length}</div>
          <div className="gx-chips-wrap">{kids.map((k) => <button key={k.slug} className="gx-chip-tag ge-chipbtn" onClick={() => onSelectBody(k.slug)}>{k.name}</button>)}</div>
        </div>
      )}

      <div className="gx-sec ge-form">
        <div className="gx-label">PROPERTIES</div>
        <BodyEditor key={body.slug} body={body} bodies={bodies} onChange={onChange} onDelete={onDelete} bare />
      </div>

      {hasSurface({ k: body.kind }) && (
        <div className="gx-sec ge-form">
          <div className="gx-label"><span>SURFACE SITES</span><span style={{ color: "#ece6da" }}>{(body.sites || []).length || "AUTO"}</span></div>
          <CityEditor systems={[system]} selectedSystem={system} onSelectSystem={() => {}} onUpdateSystem={onUpdateSystem} fixedBodySlug={body.slug} />
        </div>
      )}
    </>
  );
}
