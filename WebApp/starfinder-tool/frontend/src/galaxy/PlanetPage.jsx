import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlanetView, planetSites, planetNet } from "./planet-view.js";
import { TRANSIT, cap, fmtDeg, hasSurface } from "./common.js";
import { useGalaxyData, useIsMobile, useRenderer, Status, NotFound, Icon, Sheet, Toggle } from "./ui.jsx";

const KLAB = { "gas giant": "GAS GIANT", "rocky planet": "ROCKY PLANET", "ice world": "ICE WORLD", "terrestrial world": "TERRESTRIAL WORLD", moon: "MOON" };
const MODE_DESC = { rail: "Surface lines between sites", underground: "Pressurised tunnels below the crust", shuttle: "Point-to-point flights between pads" };
const MIX_TXT = {
  moon: "Moons build down: most links run through pressurised tunnels.",
  "rocky planet": "Airless rock favours tunnels, with surface rail on stable ground.",
  "ice world": "Tunnels under the ice sheet plus surface rail on the flats.",
  "terrestrial world": "A mix of surface rail, metro tunnels and aerial shuttles.",
  "gas giant": "No surface: floating platforms are linked by shuttles only.",
};
const TOGGLES = [["grid", "GRID"], ["clouds", "CLOUDS"], ["sites", "SITES"], ["transit", "TRANSIT"], ["spin", "ROTATE"]];
const TOGGLE_ICON = { grid: "grid", clouds: "clouds", sites: "sites", transit: "transit", spin: "rotate" };

export default function PlanetPage() {
  const state = useGalaxyData(), D = state.data, mobile = useIsMobile(), nav = useNavigate();
  const { sys: sysSlug, body: bodySlug } = useParams();
  const [params, setParams] = useSearchParams();
  const [flags, setFlags] = useState({ grid: true, clouds: true, sites: true, transit: true, spin: true });
  const [hov, setHov] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);
  const [hud, setHud] = useState({ lat: 0.25, lon: 0 });
  const s = D?.bySlug[sysSlug];
  const b = s?.b.find((x) => x.s === bodySlug && hasSurface(x));
  const site = params.get("site");
  const setSite = (id) => { const n = new URLSearchParams(params); if (id) n.set("site", id); else n.delete("site"); setParams(n, { replace: true }); };
  const siteRef = useRef(setSite); siteRef.current = setSite;
  const cur = useRef({}); cur.current = { flags, site };
  const sites = useMemo(() => (b ? planetSites(b) : []), [b]);
  const net = useMemo(() => (b ? planetNet(b, sites) : []), [b, sites]);

  const [cvRef, view] = useRenderer((cv) => {
    if (!b) return null;
    const v = new PlanetView(cv, s, b, {
      mobile,
      onSite: (id) => siteRef.current(id),
      onHover: setHov,
      layout: (W, H) => (mobile
        ? { cx: W / 2, cy: (130 + H - 270) / 2, R: Math.max(80, Math.min(W / 2 - 47, (H - 400) / 2 - 20)) }
        : { cx: (100 + W - 400) / 2, cy: H / 2 + 30, R: Math.max(120, Math.min(290, (W - 500) / 2 - 70, H / 2 - 110)) }),
    });
    Object.entries(cur.current.flags).forEach(([k, val]) => v.setFlag(k, val));
    if (cur.current.site) v.focusSite(cur.current.site);
    return v;
  }, [b, mobile]);
  useEffect(() => { Object.entries(flags).forEach(([k, val]) => view.current?.setFlag(k, val)); }, [flags]);
  useEffect(() => { if (view.current && view.current.site !== site) view.current.focusSite(site); }, [site]);
  useEffect(() => { const id = setInterval(() => view.current && setHud({ ...view.current.rot }), 250); return () => clearInterval(id); }, []);

  if (!D) return <div className="gx"><Status state={state} what="SURFACE" /></div>;
  if (!s || !b) return <div className="gx"><NotFound what="BODY" back={s ? `/galaxy/system/${s.s}` : "/galaxy"} /></div>;

  const cnt = {}; net.forEach((e) => { cnt[e.mode] = (cnt[e.mode] || 0) + 1; });
  const transit = Object.keys(TRANSIT).filter((m) => cnt[m]);
  const orbit = s.b.filter((x) => x.p === b.s && x.k === "orbital station");
  const selSite = sites.find((x) => x.id === site);
  const enter = () => selSite && nav(`/galaxy/system/${s.s}/${b.s}/${encodeURIComponent(selSite.id)}`);
  const kind = (KLAB[b.k] || b.k.toUpperCase()) + (b.hab ? " · HABITABLE" : "");
  const stats = [["SIZE CLASS", cap(b.sz || "—")], ["STATUS", b.st === "colonized" ? "Settled" : b.st === "extraction" ? "Extraction" : "Untouched"],
    ["POPULATION", b.pp != null ? (typeof b.pp === "number" ? b.pp.toLocaleString("en-US") : b.pp) : "—"], ["RESOURCES", b.res && b.res.length ? b.res.map(cap).join(", ") : "None surveyed"]];
  const back = <Link className={"gx-back" + (mobile ? " icon" : "")} to={`/galaxy/system/${s.s}?body=${b.s}`} aria-label="System map">{Icon.arrowL()}{!mobile && "SYSTEM MAP"}</Link>;
  const title = (
    <div className="gx-titleblock">
      <div className="gx-eyebrow">SURFACE · {s.n}</div>
      <h1 className="gx-title">{b.n}</h1>
    </div>
  );
  const siteRows = sites.map((x) => (
    <button key={x.id} className={"gx-tbtn gx-row" + (site === x.id ? " on" : "")} style={{ minHeight: 52, height: "auto", padding: "0 12px", fontFamily: "inherit", letterSpacing: 0 }} onClick={() => setSite(x.id)}>
      <span className="gx-diamond" style={{ background: x.color }} />
      <span className="t"><span className="a">{x.name}</span><span className="b" style={{ color: "#9a958b" }}>{x.type}</span></span>
      <span className="r">{fmtDeg(x.lat, "lat")} {fmtDeg(x.lon, "lon")}</span>
    </button>
  ));
  const enterCta = selSite && <button className="gx-cta" onClick={enter}>ENTER {selSite.name.toUpperCase()}{Icon.arrowR()}</button>;
  const sections = (
    <>
      <div className="gx-sec" style={{ gap: 6 }}>
        <div className="gx-label">SURFACE SITES · {sites.length}</div>
        {sites.length === 0 && <div className="gx-lore" style={{ fontSize: 14, padding: "6px 0" }}>No surface installations recorded.</div>}
        {siteRows}
      </div>
      {!mobile && selSite && <div className="gx-sec" style={{ padding: "14px 22px" }}>{enterCta}</div>}
      <div className="gx-sec">
        <div className="gx-label">TRANSIT NETWORK</div>
        <div className="gx-note" style={{ fontSize: 14 }}>{MIX_TXT[b.k] || ""}</div>
        {transit.map((m) => (
          <div key={m} className="gx-tr-row">
            <span className="ln" style={{ borderTopStyle: TRANSIT[m].dash, borderTopColor: TRANSIT[m].c }} />
            <span className="t"><span className="a">{TRANSIT[m].n}</span><span className="b">{MODE_DESC[m]}</span></span>
            <span className="n" style={{ color: TRANSIT[m].c }}>{cnt[m]} {cnt[m] === 1 ? "link" : "links"}</span>
          </div>
        ))}
        {!transit.length && sites.length > 0 && <div className="gx-lore" style={{ fontSize: 14 }}>Single site: no links between sites. Local transit is shown in the settlement view.</div>}
      </div>
      {orbit.length > 0 && (
        <div className="gx-sec" style={{ gap: 12 }}>
          <div className="gx-label">IN ORBIT</div>
          {orbit.map((o) => (
            <div key={o.s} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", border: "1px solid rgba(255,154,60,.22)", background: "rgba(255,154,60,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}><span style={{ fontSize: 15, color: "#fff4e6" }}>{o.n}</span><span className="gx-ox" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#ffb866" }}>{(o.sz || "station").toUpperCase()}</span></div>
              <div className="gx-lore">{[o.dc, o.dk != null ? o.dk + " docks" : null, o.pp != null ? Number(o.pp).toLocaleString("en-US") + " crew" : null].filter(Boolean).join(" · ")}</div>
              {o.sv && <div className="gx-chips-wrap">{o.sv.map((e) => <span key={e} className="gx-chip-im" style={{ background: "rgba(95,211,243,.1)", color: "#bfeefa" }}>{e}</span>)}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
  const statGrid = <div className="gx-grid">{stats.map(([k, v]) => <div key={k} className="gx-stat"><span className="gx-label sm">{k}</span><span className="v">{v}</span></div>)}</div>;

  if (mobile) {
    return (
      <div className="gx m">
        <canvas ref={cvRef} className="gx-canvas" />
        <div className="gx-top">{back}{title}</div>
        <div className="gx-chips gx-noscroll" style={{ top: 70 }}>
          {TOGGLES.map(([k, l]) => <Toggle key={k} mobile on={flags[k]} label={l} onClick={() => setFlags({ ...flags, [k]: !flags[k] })} />)}
        </div>
        <Sheet full={sheetFull} peekH={270} fullH={640} onToggle={() => setSheetFull(!sheetFull)} label="Surface details">
          <div className="gx-head">
            <div className="gx-kind">{kind}</div>
            <div style={{ fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cap(b.sz || "")}{b.r ? ` · ${b.r.toLocaleString("en-US")} km` : ""}{b.pp ? ` · ${b.pp}` : ""}</div>
          </div>
          {sites.length > 0 && (
            <div className="gx-pills gx-noscroll">
              {sites.map((x) => <button key={x.id} className={"gx-pill" + (site === x.id ? " on" : "")} onClick={() => setSite(x.id)}><span className="gx-diamond" style={{ background: x.color }} />{x.name}</button>)}
            </div>
          )}
          <div className="gx-mrow">
            {enterCta || <button className="gx-outline wide" onClick={() => setSheetFull(!sheetFull)}>{sheetFull ? "LESS" : "DETAILS"}</button>}
          </div>
          <div className="gx-sec">{statGrid}</div>
          {sections}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="gx">
      <canvas ref={cvRef} className={"gx-canvas" + (hov ? " hov" : "")} />
      <div className="gx-top">
        {back}{title}
        <div className="gx-grow" />
        <label htmlFor="gx-body-pick" className="gx-ox gx-nowrap" style={{ fontSize: 11, letterSpacing: "0.18em", color: "#9a958b" }}>BODY</label>
        <select id="gx-body-pick" className="gx-select" style={{ minWidth: 240 }} value={b.s} onChange={(e) => nav(`/galaxy/system/${s.s}/${e.target.value}`)}>
          {s.b.filter(hasSurface).map((x) => <option key={x.s} value={x.s}>{x.n}</option>)}
        </select>
      </div>
      <nav aria-label="Layers" className="gx-rail">
        {TOGGLES.map(([k, l]) => <Toggle key={k} on={flags[k]} label={l} icon={Icon[TOGGLE_ICON[k]]()} onClick={() => setFlags({ ...flags, [k]: !flags[k] })} />)}
      </nav>
      <div className="gx-hudbar">
        <span>LAT <b>{fmtDeg(hud.lat, "lat")}</b></span>
        <span>LON <b>{fmtDeg(hud.lon, "lon")}</b></span>
        <span>RADIUS <b>{b.r ? b.r.toLocaleString("en-US") + " KM" : "—"}</b></span>
      </div>
      <aside aria-label="Surface details" className="gx-panel gx-scroll" style={{ width: 380 }}>
        <div className="gx-head" style={{ gap: 10, padding: "20px 22px 16px" }}>
          <div className="gx-kind">{kind}</div>
          {statGrid}
        </div>
        {sections}
      </aside>
    </div>
  );
}
