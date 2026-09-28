import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SystemView } from "./system-view.js";
import { KCOL, KLAB, POPL, counts, short, cap, starColor, hasSurface, bodyPop, fmtPop, systemPop } from "./common.js";
import { useGalaxyData, useIsMobile, useRenderer, Status, NotFound, Icon, Sheet } from "./ui.jsx";

export function bodyTree(s) {
  const kids = {};
  s.b.forEach((b) => { if (b.p) (kids[b.p] = kids[b.p] || []).push(b); });
  const out = [];
  const node = (b, depth) => { out.push({ b, depth }); (kids[b.s] || []).forEach((m) => node(m, depth + 1)); };
  s.b.filter((b) => !b.p).sort((a, b) => (a.au || 0) - (b.au || 0)).forEach((b) => node(b, 1));
  return { out, kids };
}
export function BodyIcon({ b }) {
  const k = b.k, col = KCOL[k] || "#aaa";
  const st = (b.t || []).includes("ring-station") ? { width: 14, height: 14, border: "2px solid #e6d6bd", borderRadius: "50%", transform: "scaleY(.5)" }
    : k === "orbital station" ? { width: 9, height: 9, background: col, transform: "rotate(45deg)" }
    : k === "asteroid belt" ? { width: 14, height: 14, border: `2px dotted ${col}`, borderRadius: "50%" }
    : { width: k === "gas giant" ? 14 : k === "moon" ? 7 : 11, height: k === "gas giant" ? 14 : k === "moon" ? 7 : 11, background: col, borderRadius: "50%" };
  return <span style={{ width: 18, display: "flex", justifyContent: "center", flexShrink: 0 }}><span style={{ boxSizing: "border-box", ...st }} /></span>;
}

export function details(D, s, b, kids) {
  if (!b) {
    const lead = s.ow || (s.cb[0] && s.cb[0][0]), n = counts(s);
    return {
      kind: s.st.toUpperCase(), name: s.n,
      badges: [{ t: (POPL[s.pop] || "").toUpperCase(), bg: "rgba(255,154,60,.16)", fg: "#ffc58c" }]
        .concat(lead && D.fBySlug[lead] ? [{ t: (s.ow ? "CONTROLLED · " : "LEADING · ") + D.fBySlug[lead].n.toUpperCase(), bg: "rgba(95,211,243,.12)", fg: "#bfeefa" }] : []),
      stats: [["PLANETS", n.planet], ["MOONS", n.moon], ["BELTS", n.belt], ["STATIONS", n.station], ["SECURITY", Math.round(s.sd * 100) + "%"], ["WAR RISK", Math.round(s.war * 100) + "%"]]
        .concat(systemPop(s) ? [["INHABITANTS", fmtPop(systemPop(s))]] : []),
      lists: [["EXPORTS", s.ex.length ? s.ex : ["—"]], ["IMPORTS", s.im.length ? s.im : ["—"]]],
      surface: false,
    };
  }
  const stats = [], lists = [], badges = [{ t: KLAB[b.k], bg: "rgba(255,154,60,.16)", fg: "#ffc58c" }], t = b.t || [];
  if (b.st === "colonized") badges.push({ t: "SETTLED", bg: "rgba(95,211,243,.14)", fg: "#9fe6f8" });
  if (b.st === "extraction") badges.push({ t: "EXTRACTION", bg: "rgba(255,184,102,.14)", fg: "#ffc58c" });
  if (b.hab) badges.push({ t: "HABITABLE", bg: "rgba(95,176,138,.18)", fg: "#9fe3c0" });
  if (t.includes("capital")) badges.unshift({ t: "DOMINION CAPITAL", bg: "rgba(255,210,122,.2)", fg: "#ffd27a" });
  if (t.includes("capital-of-colonized-systems")) badges.unshift({ t: "CAPITAL OF THE COLONIZED SYSTEMS", bg: "rgba(255,210,122,.2)", fg: "#ffd27a" });
  const par = b.p && s.b.find((x) => x.s === b.p);
  const num = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v);
  if (b.k === "orbital station") {
    stats.push(["CLASS", cap(b.sz || "—")], ["LENGTH", b.lm ? b.lm + " m" : "—"], ["DOCKS", b.dk != null ? String(b.dk) : "—"], ["CREW", b.pp != null ? num(b.pp) : "—"]);
    if (b.dc) lists.push(["BERTHS", [b.dc]]); if (b.sv) lists.push(["SERVICES", b.sv]); if (b.gh) lists.push(["GOODS HANDLED", b.gh]);
    if (par) stats.push(["ORBITING", short(par.n, s.n)]);
  } else {
    stats.push(["SIZE CLASS", cap(b.sz || "—")], ["RADIUS", b.r ? num(b.r) + " km" : "—"]);
    if (b.au != null) stats.push(["ORBIT", b.au + (b.auo ? " – " + b.auo : "") + " AU"]);
    if (b.pd) stats.push(["YEAR", num(b.pd) + " days"]);
    if (par) stats.push(["ORBITING", short(par.n, s.n)]);
    if (b.pc != null || b.pp != null) stats.push(["POPULATION", bodyPop(b)]);
    if (b.res && b.res.length) lists.push(["RESOURCES", b.res]);
    if (b.sites) lists.push(["SURFACE SITES", b.sites.map((x) => x.name)]);
    const inOrbit = (kids[b.s] || []).filter((x) => x.k === "orbital station").map((x) => x.n);
    if (inOrbit.length) lists.push(["IN ORBIT", inOrbit]);
  }
  return { kind: KLAB[b.k], name: b.n, badges, stats, lists, surface: hasSurface(b) };
}

export function Details({ d, mobile, onSurface, slot }) {
  return (
    <>
      <div className="gx-head" style={mobile ? undefined : { gap: 6, padding: "20px 22px 16px" }}>
        <div className="gx-kind">{d.kind}</div>
        <h2 style={{ fontSize: mobile ? 26 : 24, lineHeight: 1.1 }}>{d.name}</h2>
        <div className="gx-chips-wrap" style={{ gap: 8, marginTop: 4 }}>
          {d.badges.map((b) => <span key={b.t} className="gx-badge" style={{ background: b.bg, color: b.fg }}>{b.t}</span>)}
        </div>
      </div>
      {slot}
      <div className="gx-sec gx-grid" style={{ padding: "14px 22px" }}>
        {d.stats.map(([k, v]) => <div key={k} className="gx-stat"><span className="gx-label sm">{k}</span><span className="v">{v}</span></div>)}
      </div>
      {d.lists.length > 0 && (
        <div className="gx-sec" style={{ padding: "14px 22px" }}>
          {d.lists.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="gx-label sm">{k}</span>
              <div className="gx-chips-wrap">{v.map((e) => <span key={e} className="gx-chip-im" style={{ background: "rgba(95,211,243,.1)", color: "#bfeefa" }}>{e}</span>)}</div>
            </div>
          ))}
        </div>
      )}
      {!mobile && d.surface && <div style={{ padding: "16px 22px 22px" }}><button className="gx-cta" onClick={onSurface}>SURFACE VIEW{Icon.arrowR()}</button></div>}
    </>
  );
}

export default function SystemPage() {
  const state = useGalaxyData(), D = state.data, mobile = useIsMobile(), nav = useNavigate();
  const { sys: slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState("real");
  const [playing, setPlaying] = useState(false);
  const [hov, setHov] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);
  const s = D?.bySlug[slug];
  const sel = params.get("body") || null;
  const setSel = (id) => { const n = new URLSearchParams(params); if (id) n.set("body", id); else n.delete("body"); setParams(n, { replace: true }); };
  const selRef = useRef(setSel); selRef.current = setSel;
  const cur = useRef({}); cur.current = { mode, playing, sel };

  const [cvRef, view] = useRenderer((cv) => {
    if (!s) return null;
    const v = new SystemView(cv, s, {
      mobile,
      onSelect: (id) => { selRef.current(id); if (mobile) setSheetFull(false); },
      onHover: setHov,
      layout: (W, H) => (mobile
        ? { cx: W / 2, cy: (120 + H - 196) / 2, extent: Math.min(W / 2 - 37, (H - 330) / 2) }
        : { cx: (340 + W - 392) / 2, cy: H / 2 + 20, extent: Math.max(160, Math.min((W - 740) / 2 + 20, H / 2 - 60)) }),
    });
    const c = cur.current; v.setMode(c.mode); v.setPlaying(c.playing); v.setSel(c.sel);
    return v;
  }, [s, mobile]);
  useEffect(() => { view.current?.setMode(mode); }, [mode]);
  useEffect(() => { view.current?.setPlaying(playing); }, [playing]);
  useEffect(() => { view.current?.setSel(sel); }, [sel]);

  const tree = useMemo(() => (s ? bodyTree(s) : null), [s]);
  const body = s && sel && sel !== "__star" ? s.b.find((x) => x.s === sel) : null;
  const d = useMemo(() => (s ? details(D, s, body, tree.kids) : null), [D, s, body, tree]);

  if (!D) return <div className="gx"><Status state={state} what="SYSTEM" /></div>;
  if (!s) return <div className="gx"><NotFound what="SYSTEM" back="/galaxy" /></div>;
  const toSurface = () => body && nav(`/galaxy/system/${s.s}/${body.s}`);
  const eyebrow = `SYSTEM${mobile ? "" : " MAP"} · ${s.sc === "core" ? "CORE SECTOR" : "SECTOR " + s.sc}`.toUpperCase();
  const back = <Link className={"gx-back" + (mobile ? " icon" : "")} to={`/galaxy?system=${s.s}`} aria-label="Galaxy map">{Icon.arrowL()}{!mobile && "GALAXY MAP"}</Link>;
  const viewToggle = (
    <div role="group" aria-label="View style" className="gx-group">
      <button className={"gx-tbtn" + (mode === "real" ? " on" : "")} aria-pressed={mode === "real"} onClick={() => setMode("real")}>REALISTIC</button>
      <button className={"gx-tbtn" + (mode === "schem" ? " on" : "")} aria-pressed={mode === "schem"} onClick={() => setMode("schem")}>SCHEMATIC</button>
    </div>
  );
  const zoom = (
    <div role="group" aria-label="Zoom" className="gx-group">
      <button className="gx-tbtn" style={{ width: 40, padding: 0 }} aria-label="Zoom out" onClick={() => view.current?.zoomOut()}>{Icon.minus()}</button>
      <button className="gx-tbtn" style={{ width: 40, padding: 0 }} aria-label="Zoom in" onClick={() => view.current?.zoomIn()}>{Icon.plus()}</button>
    </div>
  );
  const play = mode === "real" && (
    <button className="gx-tbtn gx-group" style={{ height: 44, padding: "0 14px" }} aria-label={playing ? "Pause orbits" : "Animate orbits"} onClick={() => setPlaying(!playing)}>
      {playing ? Icon.pause() : Icon.play()}{!mobile && (playing ? "PAUSE" : "ANIMATE")}
    </button>
  );
  const treeList = (
    <>
      <button className={"gx-tbtn gx-row" + (!sel || sel === "__star" ? " on" : "")} style={{ minHeight: 48, padding: "0 18px", height: "auto", fontFamily: "inherit", letterSpacing: 0 }} onClick={() => setSel("__star")}>
        <span className="gx-dot" style={{ width: 16, height: 16, background: starColor(s.st), boxShadow: `0 0 10px ${starColor(s.st)}` }} />
        <span className="t"><span className="a" style={{ color: "#fff4e6" }}>{s.n}</span><span className="b" style={{ color: "#9a958b" }}>{s.st}</span></span>
      </button>
      {tree.out.map(({ b, depth }) => (
        <button key={b.s} className={"gx-tbtn gx-row" + (sel === b.s ? " on" : "")} style={{ padding: `0 18px 0 ${18 + depth * 22}px`, height: "auto", fontFamily: "inherit", letterSpacing: 0 }}
          onClick={() => { setSel(b.s); if (mobile) setSheetFull(false); }}>
          <BodyIcon b={b} />
          <span className="t"><span className="a" style={{ fontSize: 14 }}>{short(b.n, s.n) || b.n}</span>
            <span className="b" style={{ color: b.st === "colonized" ? "#7fdcf2" : b.st === "extraction" ? "#ffb866" : "#9a958b" }}>{KLAB[b.k]}{b.st === "colonized" ? " · SETTLED" : b.st === "extraction" ? " · EXTRACTION" : ""}</span></span>
        </button>
      ))}
    </>
  );

  if (mobile) {
    return (
      <div className="gx m">
        <canvas ref={cvRef} className="gx-canvas" />
        <div className="gx-top">
          {back}
          <div className="gx-titleblock">
            <div className="gx-eyebrow">{eyebrow}</div>
            <h1 className="gx-title">{s.n}</h1>
          </div>
        </div>
        <div className="gx-chips gx-noscroll" style={{ top: 70 }}>
          {viewToggle}{zoom}{play}
        </div>
        <Sheet full={sheetFull} peekH={196} fullH={640} onToggle={() => setSheetFull(!sheetFull)} label="Body details">
          <Details d={d} mobile onSurface={toSurface}
            slot={(
              <div className="gx-mrow">
                {d.surface && <button className="gx-cta" onClick={toSurface}>SURFACE{Icon.arrowR()}</button>}
                <button className={"gx-outline" + (d.surface ? "" : " wide")} onClick={() => setSheetFull(!sheetFull)}>{sheetFull ? "LESS" : "BODIES & DETAILS"}</button>
              </div>
            )} />
          <div className="gx-sec" style={{ padding: "14px 0" }}>
            <div className="gx-label" style={{ padding: "0 20px" }}>BODIES · {s.b.length}</div>
            {treeList}
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="gx">
      <canvas ref={cvRef} className={"gx-canvas" + (hov ? " hov" : "")} />
      <div className="gx-top">
        {back}
        <div className="gx-titleblock">
          <div className="gx-eyebrow">{eyebrow}</div>
          <h1 className="gx-title">{s.n}</h1>
        </div>
        <div className="gx-grow" />
        <label htmlFor="gx-sys-pick" className="gx-ox gx-nowrap" style={{ fontSize: 11, letterSpacing: "0.18em", color: "#9a958b" }}>JUMP TO</label>
        <select id="gx-sys-pick" className="gx-select" value={s.s} onChange={(e) => nav(`/galaxy/system/${e.target.value}`)}>
          {[...D.sys].sort((a, b) => a.n.localeCompare(b.n)).map((x) => <option key={x.s} value={x.s}>{x.n}</option>)}
        </select>
        {viewToggle}{zoom}{play}
      </div>
      {mode === "real" && (
        <nav aria-label="Bodies" className="gx-left gx-scroll">
          <div className="gx-label" style={{ padding: "16px 18px 10px" }}>BODIES · {s.b.length}</div>
          {treeList}
        </nav>
      )}
      <aside aria-label="Body details" className="gx-panel narrow gx-scroll"><Details d={d} onSurface={toSurface} /></aside>
      <div className="gx-hint" style={{ right: 392 }}>{mode === "schem" ? "DRAG TO SCROLL · SCROLL TO ZOOM · CLICK A BODY" : "DRAG TO ORBIT · SCROLL TO ZOOM · ORBITS NOT TO SCALE"}</div>
    </div>
  );
}
