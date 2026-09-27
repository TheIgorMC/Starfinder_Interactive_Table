import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SettlementView, layoutSettlement, SETTLEMENT_TRANSIT, SETTLEMENT_NOTE, SETTLEMENT_STYLES } from "./settlement.js";
import { planetSites } from "./planet-view.js";
import { fmtDeg, hasSurface } from "./common.js";
import { useGalaxyData, useIsMobile, useRenderer, Status, NotFound, Icon, Sheet, Toggle } from "./ui.jsx";

const KLAB = { "gas giant": "Gas giant", "rocky planet": "Rocky planet", "ice world": "Ice world", "terrestrial world": "Terrestrial world", moon: "Moon" };

export default function SettlementPage() {
  const state = useGalaxyData(), D = state.data, mobile = useIsMobile();
  const { sys: sysSlug, body: bodySlug, site: siteId } = useParams();
  const [flags, setFlags] = useState({ transit: true, labels: true });
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);
  const s = D?.bySlug[sysSlug];
  const b = s?.b.find((x) => x.s === bodySlug && hasSurface(x));
  const site = useMemo(() => (b ? planetSites(b).find((x) => x.id === siteId) : null), [b, siteId]);
  const L = useMemo(() => (b && site ? layoutSettlement(b, site) : null), [b, site]);
  const cur = useRef({}); cur.current = { flags, sel };

  const [cvRef, view] = useRenderer((cv) => {
    if (!site) return null;
    const v = new SettlementView(cv, b, site, {
      mobile,
      onSelect: (i) => setSel(i),
      onHover: setHov,
      center: (W, H) => (mobile ? [W / 2, (130 + H - 250) / 2] : [(100 + W - 400) / 2, H / 2 + 40]),
      area: (W, H) => (mobile ? [W - 16, H - 250 - 140] : [W - 520, H - 260]),
    });
    Object.entries(cur.current.flags).forEach(([k, val]) => v.setFlag(k, val));
    return v;
  }, [site, mobile]);
  useEffect(() => { Object.entries(flags).forEach(([k, val]) => view.current?.setFlag(k, val)); }, [flags]);
  useEffect(() => { view.current?.setSel(sel); }, [sel]);

  if (!D) return <div className="gx"><Status state={state} what="SETTLEMENT" /></div>;
  if (!site) return <div className="gx"><NotFound what="SETTLEMENT" back={b ? `/galaxy/system/${s.s}/${b.s}` : "/galaxy"} /></div>;

  const gas = b.k === "gas giant";
  const env = gas ? "Upper cloud deck · floating" : b.k === "terrestrial world" ? (b.hab ? "Open air" : "Sealed blocks · thin air") : b.k === "ice world" ? "Frozen crust · insulated domes" : "Airless · pressurised domes";
  const stats = [
    ["BODY", ((b.t || []).includes("ecumenopolis") ? "City-planet" : KLAB[b.k] || b.k) + " · " + b.n],
    ["ENVIRONMENT", env],
    ["LOCATION", site.lat != null ? `${fmtDeg(site.lat, "lat")} ${fmtDeg(site.lon, "lon")}` : "—"],
    ["POPULATION", (site.id === "cap" || site.def) && b.pp ? String(b.pp) : "Not recorded"],
    ["LAYOUT", SETTLEMENT_STYLES[L.style].n + (SETTLEMENT_STYLES[L.style].final ? "" : " · provisional")],
  ];
  const links = L.ds.map(() => 0);
  L.edges.forEach((e) => { if (!e.secret) { links[e.a]++; links[e.b]++; } });
  const cnt = {}; L.edges.forEach((e) => { if (!e.secret) cnt[e.mode] = (cnt[e.mode] || 0) + 1; });
  const modes = Object.keys(SETTLEMENT_TRANSIT).filter((m) => cnt[m]);
  const pick = (i) => { setSel(i); view.current?.focus(i); if (mobile) setSheetFull(false); };
  const back = <Link className={"gx-back" + (mobile ? " icon" : "")} to={`/galaxy/system/${s.s}/${b.s}?site=${encodeURIComponent(site.id)}`} aria-label="Planet view">{Icon.arrowL()}{!mobile && "PLANET VIEW"}</Link>;
  const title = (
    <div className="gx-titleblock">
      <div className="gx-eyebrow">SETTLEMENT · {b.n}</div>
      <h1 className="gx-title">{site.name}</h1>
    </div>
  );
  const districtRows = L.ds.map((d, i) => (
    <button key={i} className={"gx-tbtn gx-row" + (sel === i ? " on" : "")} style={{ minHeight: 48, height: "auto", padding: "0 12px", fontFamily: "inherit", letterSpacing: 0 }} onClick={() => pick(i)}>
      <span className="gx-dot" style={{ background: d.hidden ? "#8f8a80" : d.color }} />
      <span className="t"><span className="a">{d.name}</span></span>
      <span className="r">{d.hidden ? "HIDDEN · SECRET TUNNEL" : `${links[i]} ${links[i] === 1 ? "LINK" : "LINKS"}`}</span>
    </button>
  ));
  const sections = (
    <>
      <div className="gx-sec" style={{ gap: 4 }}>
        <div className="gx-label">DISTRICTS · {L.ds.length}</div>
        {districtRows}
      </div>
      <div className="gx-sec">
        <div className="gx-label">LOCAL TRANSIT</div>
        <div className="gx-note" style={{ fontSize: 14 }}>{site.def?.transitNote || SETTLEMENT_NOTE[b.k] || ""}</div>
        {modes.map((m) => (
          <div key={m} className="gx-tr-row">
            <span className="ln" style={{ borderTopStyle: SETTLEMENT_TRANSIT[m].dash, borderTopColor: SETTLEMENT_TRANSIT[m].c }} />
            <span className="t"><span className="a">{SETTLEMENT_TRANSIT[m].n}</span><span className="b">{SETTLEMENT_TRANSIT[m].d}</span></span>
            <span className="n" style={{ color: SETTLEMENT_TRANSIT[m].c }}>{cnt[m]} {cnt[m] === 1 ? "line" : "lines"}</span>
          </div>
        ))}
      </div>
    </>
  );
  const statGrid = <div className="gx-grid">{stats.map(([k, v]) => <div key={k} className="gx-stat"><span className="gx-label sm">{k}</span><span className="v">{v}</span></div>)}</div>;

  if (mobile) {
    return (
      <div className="gx m">
        <canvas ref={cvRef} className="gx-canvas" />
        <div className="gx-top">{back}{title}</div>
        <div className="gx-chips gx-noscroll" style={{ top: 70 }}>
          <Toggle mobile on={flags.transit} label="TRANSIT" onClick={() => setFlags({ ...flags, transit: !flags.transit })} />
          <Toggle mobile on={flags.labels} label="NAMES" onClick={() => setFlags({ ...flags, labels: !flags.labels })} />
          <button className="gx-chip" aria-label="Reset view" onClick={() => view.current?.reset()}>RESET</button>
        </div>
        <Sheet full={sheetFull} peekH={250} fullH={640} onToggle={() => setSheetFull(!sheetFull)} label="Settlement details">
          <div className="gx-head">
            <div className="gx-kind">{(site.type || "").toUpperCase()}</div>
            {statGrid}
          </div>
          <div className="gx-mrow"><button className="gx-outline wide" onClick={() => setSheetFull(!sheetFull)}>{sheetFull ? "LESS" : "DISTRICTS & TRANSIT"}</button></div>
          {sections}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="gx">
      <canvas ref={cvRef} className={"gx-canvas" + (hov ? " hov" : "")} />
      <div className="gx-top">{back}{title}</div>
      <div className="gx-hint" style={{ top: 98, bottom: "auto", right: 400 }}>DRAG TO PAN · SCROLL TO ZOOM · CLICK A DISTRICT</div>
      <nav aria-label="Layers" className="gx-rail">
        <Toggle on={flags.transit} label="TRANSIT" icon={Icon.transit()} onClick={() => setFlags({ ...flags, transit: !flags.transit })} />
        <Toggle on={flags.labels} label="NAMES" icon={Icon.labels()} onClick={() => setFlags({ ...flags, labels: !flags.labels })} />
        <button className="gx-mbtn sq" aria-label="Zoom in" onClick={() => view.current?.zoomIn()}>{Icon.plus()}</button>
        <button className="gx-mbtn sq" aria-label="Zoom out" onClick={() => view.current?.zoomOut()}>{Icon.minus()}</button>
        <button className="gx-mbtn sq" aria-label="Reset view" onClick={() => view.current?.reset()}>{Icon.reset()}</button>
      </nav>
      {modes.length > 0 && (
        <div className="gx-hudbar">
          {modes.map((m) => <span key={m} className="it"><span style={{ width: 28, borderTop: `2px ${SETTLEMENT_TRANSIT[m].dash} ${SETTLEMENT_TRANSIT[m].c}` }} />{SETTLEMENT_TRANSIT[m].n}</span>)}
          <span className="it"><span className="gx-dot" style={{ width: 12, height: 12, border: "1.5px solid #ffb866" }} />Station / pad</span>
        </div>
      )}
      <aside aria-label="Settlement details" className="gx-panel gx-scroll" style={{ width: 380 }}>
        <div className="gx-head" style={{ gap: 10, padding: "20px 22px 16px" }}>
          <div className="gx-kind">{(site.type || "").toUpperCase()}</div>
          {statGrid}
        </div>
        {sections}
      </aside>
    </div>
  );
}
