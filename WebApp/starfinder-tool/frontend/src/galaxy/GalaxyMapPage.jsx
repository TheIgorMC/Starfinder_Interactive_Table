import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GalaxyMap } from "./galaxy-map.js";
import { MODES, POPL, counts, secRGB, css, secLabel, sectorName } from "./common.js";
import { useGalaxyData, useIsMobile, useRenderer, Status, Icon, Sheet, Toggle } from "./ui.jsx";

const MODE_KEYS = ["factions", "security", "conflict", "sectors", "population", "trade"];

function Legend({ mode, D }) {
  if (mode === "factions") {
    const list = D.f.filter((f) => f.count > 0).sort((a, b) => b.count - a.count);
    return (
      <div className="gx-lg-grid gx-scroll">
        {list.map((f) => (
          <div key={f.s} className="gx-lg-item"><span className="gx-diamond" style={{ width: 9, height: 9, background: f.c }} /><span className="nm">{f.n}</span><span className="ct">{f.count}</span></div>
        ))}
      </div>
    );
  }
  if (mode === "security") return (<><div className="gx-ramp" style={{ background: "linear-gradient(90deg,#ff5a36,#d9a75f,#3f8cff)" }} /><div className="gx-ramp-l"><span>ANARCHY</span><span>LOW</span><span>MEDIUM</span><span>HIGH</span></div><div className="gx-lore">Lawless space is where crime thrives. Hover a system for its rating.</div></>);
  if (mode === "conflict") return (<><div className="gx-ramp" style={{ background: "linear-gradient(90deg,rgba(255,61,61,.08),#ff3d3d)" }} /><div className="gx-ramp-l"><span>STABLE</span><span>WAR LIKELY</span></div></>);
  if (mode === "sectors") return (
    <div className="gx-lg-grid gx-scroll">
      {D.sec.map((s, i) => <div key={i} className="gx-lg-item"><span className="gx-ox" style={{ color: "#ff9a3c", minWidth: 34 }}>{s.n}</span><span className="nm" style={{ color: "#9a958b" }}>{s.fo}</span></div>)}
    </div>
  );
  if (mode === "population") return (
    <div className="gx-lg-list">
      <div><span className="gx-dot" style={{ width: 14, height: 14, background: "#ffc27a", boxShadow: "0 0 10px #ff9a3c" }} />Core world · 50M+</div>
      <div><span className="gx-dot" style={{ margin: "0 2px", background: "#ffc27a" }} />Colony · 50k – 50M</div>
      <div><span className="gx-dot" style={{ width: 6, height: 6, margin: "0 4px", background: "#c9a67a" }} />Outpost · under 50k</div>
      <div><span style={{ width: 8, height: 8, margin: "0 3px", border: "1px solid #9a958b", transform: "rotate(45deg)" }} />Station-only system</div>
    </div>
  );
  return (
    <div className="gx-lg-list">
      <div><span style={{ width: 34, height: 3, background: "#5fd3f3" }} />Major trade route</div>
      <div><span style={{ width: 34, height: 1, background: "#5fd3f3" }} />Standard lane</div>
      <div><span style={{ width: 34, borderTop: "1px dashed #5fd3f3" }} />Backwater spur</div>
      <div><span style={{ width: 34, height: 3, background: "linear-gradient(90deg,#5fd3f3,#ff6a2b)" }} />Pirate risk, low → high</div>
    </div>
  );
}

function useSystemInfo(D, sel) {
  return useMemo(() => {
    if (!D || sel < 0) return null;
    const s = D.sys[sel], sc = secRGB(s.sd), n = counts(s);
    return {
      s, sc: css(sc, 1),
      control: s.ow ? "CONTROLLED" : s.cb.length ? "CONTESTED" : "UNCLAIMED",
      shares: s.cb.map(([f, share]) => ({ name: D.fBySlug[f]?.n || f, color: D.fBySlug[f]?.c || "#888", pct: Math.round(share * 100) + "%" })),
      counts: [[n.planet, "PLANETS"], [n.moon, "MOONS"], [n.belt, "BELTS"], [n.station, "STATIONS"]],
      neighbors: s.nb.map((j) => D.sys[j]).sort((a, b) => b.prio - a.prio),
    };
  }, [D, sel]);
}

function SysSections({ info, onPick, mobile }) {
  const { s } = info;
  return (
    <>
      <div className="gx-sec">
        <div className="gx-label"><span>CONTROL</span>{!mobile && <span style={{ color: "#ece6da" }}>{info.control}</span>}</div>
        {info.shares.length === 0 && <div className="gx-lore">No faction holds any claim here.</div>}
        {info.shares.map((c) => (
          <div key={c.name} className="gx-share">
            <div className="gx-share-row"><span>{c.name}</span><span className="p">{c.pct}</span></div>
            <div className="gx-bar"><div style={{ width: c.pct, background: c.color }} /></div>
          </div>
        ))}
      </div>
      <div className="gx-sec gx-grid" style={{ "--cols": 3 }}>
        <div className="gx-stat"><span className="gx-label sm">SECURITY</span><span className="v ox" style={{ color: info.sc }}>{secLabel(s.sd)}</span></div>
        <div className="gx-stat"><span className="gx-label sm">POLICING</span><span className="v ox">{Math.round(s.sf * 100)}%</span></div>
        <div className="gx-stat"><span className="gx-label sm">WAR RISK</span><span className="v ox" style={{ color: s.war >= 0.5 ? "#ff6b5a" : undefined }}>{Math.round(s.war * 100)}%</span></div>
      </div>
      {mobile && (
        <div className="gx-sec gx-grid" style={{ "--cols": 4, gap: 8 }}>
          {info.counts.map(([v, l]) => <div key={l} className="gx-count"><div className="n">{v}</div><div className="l">{l}</div></div>)}
        </div>
      )}
      <div className="gx-sec">
        <div className="gx-label">ECONOMY</div>
        {mobile ? (
          <div className="gx-chips-wrap">
            {s.ex.map((e) => <span key={"x" + e} className="gx-chip-ex">↑ {e}</span>)}
            {s.im.map((e) => <span key={"i" + e} className="gx-chip-im">↓ {e}</span>)}
          </div>
        ) : (
          <>
            <div className="gx-econ"><span>Exports</span><div className="gx-chips-wrap">{(s.ex.length ? s.ex : ["—"]).map((e) => <span key={e} className="gx-chip-ex">{e}</span>)}</div></div>
            <div className="gx-econ"><span>Imports</span><div className="gx-chips-wrap">{(s.im.length ? s.im : ["—"]).map((e) => <span key={e} className="gx-chip-im">{e}</span>)}</div></div>
          </>
        )}
        {s.t.length > 0 && <div className="gx-chips-wrap">{s.t.map((t) => <span key={t} className="gx-chip-tag">{t.replace(/-/g, " ").toUpperCase()}</span>)}</div>}
        {s.note && <div className="gx-lore">{s.note}</div>}
      </div>
      {!mobile && (
        <div className="gx-sec gx-grid" style={{ "--cols": 4, gap: 8 }}>
          {info.counts.map(([v, l]) => <div key={l} className="gx-count"><div className="n">{v}</div><div className="l">{l}</div></div>)}
        </div>
      )}
      <div className="gx-sec">
        <div className="gx-label">HYPERLANES · {s.nb.length}</div>
        <div className={mobile ? "" : "gx-neigh"}>
          {info.neighbors.map((n) => (
            <button key={n.s} className="gx-gbtn gx-row" onClick={() => onPick(n.idx)} style={mobile ? { fontSize: 16 } : undefined}>
              <span className="gx-dot" style={{ width: 6, height: 6, background: n.col }} /><span>{n.n}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function GalaxyMapPage() {
  const state = useGalaxyData(), D = state.data, mobile = useIsMobile(), nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState("factions");
  const [lanes, setLanes] = useState(true);
  const [labels, setLabels] = useState(true);
  const [q, setQ] = useState("");
  const [hov, setHov] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const slug = params.get("system");
  const sel = D && slug && D.bySlug[slug] ? D.bySlug[slug].idx : -1;
  const layoutRef = useRef({});
  layoutRef.current = { mobile, sel, sheetFull, legendOpen };

  const select = (i, focus) => {
    const next = new URLSearchParams(params);
    if (i >= 0) next.set("system", D.sys[i].s); else next.delete("system");
    setParams(next, { replace: true });
    setSheetFull(false);
    if (focus && i >= 0) setTimeout(() => map.current?.focus(i), 0);
  };
  const selectRef = useRef(select); selectRef.current = select;

  const cur = useRef({}); cur.current = { mode, lanes, labels, sel };
  const flown = useRef(false);
  const [cvRef, map] = useRenderer((cv) => {
    if (!D) return null;
    const m = new GalaxyMap(cv, D, {
    mobile,
    onSelect: (i) => selectRef.current(i),
    onHover: setHov,
    focusOffsetY: () => (layoutRef.current.mobile ? 65 : 0),
    scaleY: (H) => (layoutRef.current.mobile ? H - (layoutRef.current.sel >= 0 ? 210 : layoutRef.current.legendOpen ? 300 : 76) - 30 : H - 44),
    keepOut: (W, H, s) => {
      const l = layoutRef.current;
      if (l.mobile) return [[0, 0, W, 124], [W - 64, 124, W, 300], [0, H - (s >= 0 ? 210 : l.legendOpen ? 300 : 76), W, H]];
      return [[0, 0, W, 84], [0, 84, 100, H], [100, H - 240, 410, H], ...(s >= 0 ? [[W - 400, 84, W, H]] : [])];
    },
    });
    const c = cur.current;
    m.setMode(c.mode); m.setLanes(c.lanes); m.setLabels(c.labels); m.setSel(c.sel);
    // deep link (?system=slug) → fly there once on load
    if (c.sel >= 0 && !flown.current) { flown.current = true; m.focus(c.sel); }
    return m;
  }, [D, mobile]);

  useEffect(() => { map.current?.setMode(mode); }, [mode]);
  useEffect(() => { map.current?.setLanes(lanes); }, [lanes]);
  useEffect(() => { map.current?.setLabels(labels); }, [labels]);
  useEffect(() => { map.current?.setSel(sel); }, [sel]);

  const info = useSystemInfo(D, sel);
  const matches = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!D || !qq) return [];
    return D.sys.filter((s) => s.n.toLowerCase().includes(qq))
      .sort((a, b) => (Number(b.n.toLowerCase().startsWith(qq)) - Number(a.n.toLowerCase().startsWith(qq))) || b.prio - a.prio)
      .slice(0, 6);
  }, [D, q]);

  if (!D) return <div className="gx"><Status state={state} /></div>;

  const pickMatch = (s) => { setQ(""); select(s.idx, true); };
  const search = (
    <div className="gx-search">
      <label htmlFor="gx-search" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Search systems</label>
      {mobile ? <svg width="22" height="22" viewBox="0 0 34 34" fill="none" stroke="#ff9a3c" strokeWidth="1.8" style={{ position: "absolute", left: 14, top: 13 }} aria-hidden><circle cx="17" cy="17" r="15" strokeOpacity=".45" /><ellipse cx="17" cy="17" rx="15" ry="5.5" transform="rotate(-28 17 17)" /><circle cx="17" cy="17" r="3" fill="#ff9a3c" /></svg> : Icon.search()}
      <input id="gx-search" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && matches.length) pickMatch(matches[0]); if (e.key === "Escape") setQ(""); }}
        placeholder={mobile ? `Search ${D.sys.length} systems` : "Search systems…"} />
      {matches.length > 0 && (
        <div className="gx-matches">
          {matches.map((s) => (
            <button key={s.s} className="gx-gbtn" onClick={() => pickMatch(s)}>
              <span className="n">{s.n}</span>
              <span className="m">{(s.sc === "core" ? "CORE" : "SECTOR " + s.sc).toUpperCase()} · {(POPL[s.pop] || "").toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const openSystem = () => nav(`/galaxy/system/${D.sys[sel].s}`);

  if (mobile) {
    return (
      <div className="gx m">
        <canvas ref={cvRef} className="gx-canvas" />
        <div className="gx-top">{search}</div>
        <nav aria-label="Map layers" className="gx-chips gx-noscroll" style={{ top: 70 }}>
          {MODE_KEYS.map((m) => <Toggle key={m} mobile on={mode === m} onClick={() => setMode(m)} label={MODES[m].t} />)}
        </nav>
        <div className="gx-fabs" style={{ top: 128 }}>
          <button className={"gx-fab" + (lanes ? " on" : "")} aria-label="Toggle hyperlanes" aria-pressed={lanes} onClick={() => setLanes(!lanes)}>{Icon.lanes()}</button>
          <button className={"gx-fab" + (labels ? " on" : "")} aria-label="Toggle names" aria-pressed={labels} onClick={() => setLabels(!labels)}>{Icon.labels()}</button>
          <button className="gx-fab" aria-label="Reset view" onClick={() => map.current?.reset()}>{Icon.reset()}</button>
          <Link className="gx-fab" aria-label="Home" to="/" style={{ color: "#ece6da" }}>{Icon.arrowL()}</Link>
        </div>
        {!info && (
          <div className="gx-mlegend">
            <button className="gx-gbtn" onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>
              <span className="gx-ox" style={{ fontWeight: 600, fontSize: 12, letterSpacing: "0.2em", color: "#ff9a3c" }}>{MODES[mode].t}</span>
              <span style={{ fontSize: 14, color: "#9a958b", flexGrow: 1 }}>{MODES[mode].sub}</span>
              <span className="gx-ox" style={{ fontSize: 11, letterSpacing: "0.12em", color: "#b8b2a6" }}>{legendOpen ? "HIDE" : "LEGEND"}</span>
            </button>
            {legendOpen && <div className="body"><Legend mode={mode} D={D} /></div>}
          </div>
        )}
        {info && (
          <Sheet full={sheetFull} peekH={210} fullH={620} onToggle={() => setSheetFull(!sheetFull)} label="System details">
            <div className="gx-head">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="gx-kind"><span className="gx-dot" style={{ background: info.s.col, boxShadow: `0 0 8px ${info.s.col}` }} />{info.s.st}</div>
                <button className="gx-gbtn" aria-label="Close details" onClick={() => select(-1)} style={{ width: 44, height: 44, margin: "-10px -12px -10px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>{Icon.close()}</button>
              </div>
              <h2>{info.s.n}</h2>
              <div className="sub">{sectorName(info.s.sc)} · {POPL[info.s.pop] || "Unknown population"} · {info.control}</div>
            </div>
            <div className="gx-mrow">
              <button className="gx-cta" onClick={openSystem}>OPEN SYSTEM{Icon.arrowR()}</button>
              <button className="gx-outline" onClick={() => setSheetFull(!sheetFull)}>{sheetFull ? "LESS" : "DETAILS"}</button>
            </div>
            <SysSections info={info} mobile onPick={(i) => select(i, true)} />
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <div className="gx">
      <canvas ref={cvRef} className={"gx-canvas" + (hov ? " hov" : "")} />
      <div className="gx-top">
        <Link to="/" className="gx-brand" style={{ textDecoration: "none", width: 300 }} aria-label="Home">
          {Icon.logo()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="gx-brand-t">GALACTIC CARTOGRAPHY</div>
            <div className="gx-brand-s">{(D.name || "GALAXY").toUpperCase()} · SEED {String(D.seed).toUpperCase()}</div>
          </div>
        </Link>
        {search}
        <div className="gx-grow" style={{ pointerEvents: "none" }} />
        <div className="gx-stats"><span><b>{D.sys.length}</b> SYSTEMS</span><span><b>{D.ln.length}</b> HYPERLANES</span><span><b>{D.f.length}</b> FACTIONS</span></div>
      </div>
      <nav aria-label="Map layers" className="gx-rail">
        {MODE_KEYS.map((m) => (
          <button key={m} className={"gx-mbtn" + (mode === m ? " on" : "")} aria-pressed={mode === m} onClick={() => setMode(m)}>{Icon[m]()}<span>{MODES[m].t}</span></button>
        ))}
        <div className="gx-rail-sep" />
        <Toggle on={lanes} onClick={() => setLanes(!lanes)} icon={Icon.lanes()} label="LANES" />
        <Toggle on={labels} onClick={() => setLabels(!labels)} icon={Icon.labels()} label="NAMES" />
      </nav>
      <div className="gx-zoom">
        <button className="gx-mbtn" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>{Icon.plus()}</button>
        <button className="gx-mbtn" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>{Icon.minus()}</button>
        <button className="gx-mbtn" aria-label="Reset view" onClick={() => map.current?.reset()}>{Icon.reset()}</button>
      </div>
      <div className="gx-legend">
        <div className="gx-legend-h"><span className="t">{MODES[mode].t}</span><span className="s">{MODES[mode].sub}</span></div>
        <Legend mode={mode} D={D} />
      </div>
      <div className="gx-hint">DRAG TO PAN · SCROLL TO ZOOM · CLICK A STAR</div>
      {info && (
        <aside aria-label="System details" className="gx-panel gx-scroll">
          <div className="gx-head">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div className="gx-kind"><span className="gx-dot" style={{ background: info.s.col, boxShadow: `0 0 8px ${info.s.col}` }} />{info.s.st}</div>
              <button className="gx-gbtn" aria-label="Close details" onClick={() => select(-1)} style={{ width: 44, height: 44, margin: "-12px -12px -12px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>{Icon.close()}</button>
            </div>
            <h2>{info.s.n}</h2>
            <div className="sub">{sectorName(info.s.sc)} · {POPL[info.s.pop] || "Unknown population"}</div>
          </div>
          <SysSections info={info} onPick={(i) => select(i, true)} />
          <div style={{ padding: "4px 22px 22px" }}>
            <button className="gx-cta" onClick={openSystem}>OPEN SYSTEM MAP{Icon.arrowR()}</button>
          </div>
        </aside>
      )}
    </div>
  );
}
