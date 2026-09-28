import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { prepGalaxy } from "./common.js";

// One fetch per page load, shared by every galaxy view (navigating between
// map/system/planet/settlement never re-downloads the ~600 KB payload).
let cache = null;
export function useGalaxyData() {
  const [state, setState] = useState(() => (cache && cache.data ? { data: cache.data } : { loading: true }));
  useEffect(() => {
    if (cache?.data) return;
    if (!cache) {
      cache = {};
      cache.promise = fetch("/api/galaxy/compact")
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => { cache.data = d ? prepGalaxy(d) : null; return cache.data; })
        .catch((e) => { cache = null; throw e; });
    }
    let alive = true;
    cache.promise.then((d) => alive && setState(d ? { data: d } : { empty: true }), (e) => alive && setState({ error: e.message }));
    return () => { alive = false; };
  }, []);
  return state;
}

// Mobile layout (bottom sheet, chip row, vertical schematic) below 768px —
// switches live when a tablet rotates or a desktop window is narrowed.
const MQ = "(max-width: 767px)";
export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MQ), on = () => setM(mq.matches);
    mq.addEventListener("change", on); on();
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

// Mount a canvas renderer class once per `deps`, destroy on change/unmount.
export function useRenderer(make, deps) {
  const cvRef = useRef(null), inst = useRef(null);
  useEffect(() => {
    if (!cvRef.current) return undefined;
    inst.current = make(cvRef.current);
    return () => { inst.current?.destroy(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [cvRef, inst];
}

export function Status({ state, what = "GALAXY" }) {
  if (state.error) return <div className="gx-center-msg">COULD NOT LOAD {what} DATA<Link to="/">BACK TO HOME</Link></div>;
  if (state.empty) return <div className="gx-center-msg">NO GALAXY YET<span style={{ fontSize: 12, letterSpacing: "0.12em", color: "#9a958b" }}>The GM creates it in the Galaxy Editor (GM console → Galaxy Editor tab).</span><Link to="/">BACK TO HOME</Link></div>;
  return <div className="gx-center-msg">PLOTTING {what}…</div>;
}
export function NotFound({ what, back }) {
  return <div className="gx-center-msg">{what} NOT FOUND<Link to={back}>BACK</Link></div>;
}

const sv = (p) => ({ width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true, ...p });
export const Icon = {
  logo: (s = 34) => <svg width={s} height={s} viewBox="0 0 34 34" fill="none" stroke="#ff9a3c" strokeWidth="1.4" aria-hidden><circle cx="17" cy="17" r="15" strokeOpacity=".45" /><ellipse cx="17" cy="17" rx="15" ry="5.5" transform="rotate(-28 17 17)" /><circle cx="17" cy="17" r="3" fill="#ff9a3c" /></svg>,
  search: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ff9a3c" strokeWidth="1.5" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>,
  factions: () => <svg {...sv()}><path d="M4 18V3" /><path d="M4 4h11l-2.5 3.5L15 11H4" /></svg>,
  security: () => <svg {...sv()}><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z" /><path d="M7 10l2 2 4-4" /></svg>,
  conflict: () => <svg {...sv()}><circle cx="10" cy="10" r="6" /><path d="M10 1v5M10 14v5M1 10h5M14 10h5" /></svg>,
  sectors: () => <svg {...sv()}><path d="M10 2l7 4v8l-7 4-7-4V6z" /><path d="M10 2v16M3 6l14 8M17 6L3 14" strokeOpacity=".5" /></svg>,
  population: () => <svg {...sv()}><circle cx="7" cy="7" r="3" /><circle cx="14" cy="8" r="2.2" /><path d="M2 17c0-3 2.2-5 5-5s5 2 5 5M12 17c0-2 1-3.5 2.5-3.5S18 15 18 17" /></svg>,
  trade: () => <svg {...sv()}><path d="M3 7h13l-3-3M17 13H4l3 3" /></svg>,
  lanes: () => <svg {...sv()}><circle cx="4" cy="15" r="2" /><circle cx="10" cy="5" r="2" /><circle cx="16" cy="13" r="2" /><path d="M5.2 13.3L8.8 6.7M11.6 6.2l3.3 5.3M6 15l8-1.7" /></svg>,
  labels: () => <svg {...sv()}><path d="M3 16L7.5 4h1L13 16M4.8 12h6.4M14 9h4M14 13h4" /></svg>,
  plus: () => <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M9 3v12M3 9h12" /></svg>,
  minus: () => <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 9h12" /></svg>,
  reset: () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" /></svg>,
  close: () => <svg width="14" height="14" viewBox="0 0 14 14" stroke="#b8b2a6" strokeWidth="1.6" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>,
  arrowR: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 8h10M9 4l4 4-4 4" /></svg>,
  arrowL: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M13 8H3M7 4L3 8l4 4" /></svg>,
  play: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="#ff9a3c" aria-hidden><path d="M2 1l11 6-11 6z" /></svg>,
  pause: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="#ff9a3c" aria-hidden><rect x="2" y="1" width="3.5" height="12" /><rect x="8.5" y="1" width="3.5" height="12" /></svg>,
  grid: () => <svg {...sv()}><circle cx="10" cy="10" r="7.5" /><ellipse cx="10" cy="10" rx="3.2" ry="7.5" /><path d="M2.5 10h15M4 6h12M4 14h12" /></svg>,
  clouds: () => <svg {...sv()}><path d="M6 15h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-.8A3.4 3.4 0 0 0 6 15z" /></svg>,
  sites: () => <svg {...sv()}><path d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z" /><circle cx="10" cy="8.5" r="2" /></svg>,
  transit: () => <svg {...sv()}><rect x="5" y="3" width="10" height="10" rx="2" /><path d="M5 9h10M8 13l-2 4M12 13l2 4M7.5 16h5" /><circle cx="7.5" cy="11" r=".6" fill="currentColor" /><circle cx="12.5" cy="11" r=".6" fill="currentColor" /></svg>,
  rotate: () => <svg {...sv()}><path d="M16 10a6 6 0 1 1-2-4.5" /><path d="M16 3v4h-4" /></svg>,
};

// Mobile bottom sheet: peek (fixed height) ↔ full (scrolls).
export function Sheet({ full, peekH, fullH, onToggle, children, label = "details" }) {
  return (
    <aside aria-label={label} className="gx-sheet" style={{ height: full ? fullH : peekH }}>
      <button className="gx-sheet-grip" onClick={onToggle} aria-label={full ? "Collapse details" : "Expand details"} aria-expanded={full}><span /></button>
      <div className={"gx-sheet-body" + (full ? " full" : "")}>{children}</div>
    </aside>
  );
}

export function Toggle({ on, onClick, icon, label, mobile, ...rest }) {
  if (mobile) return <button className={"gx-chip" + (on ? " on" : "")} aria-pressed={on} onClick={onClick} {...rest}>{label}</button>;
  return (
    <button className={"gx-mbtn short" + (on ? " on" : "")} aria-pressed={on} onClick={onClick} {...rest}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
