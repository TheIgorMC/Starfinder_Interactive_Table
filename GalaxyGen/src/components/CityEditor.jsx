import { useEffect, useMemo, useRef, useState } from "react";
import { SettlementView, DISTRICT_TYPES, SETTLEMENT_TRANSIT, SETTLEMENT_STYLES, settlementStyle } from "../lib/settlement.js";
import { slugify } from "../lib/slug.js";

// City layout editor — authors a body's surface `sites` and each site's
// districts/transit, i.e. exactly what the SIT galaxy viewer's planet and
// settlement views render (WebApp/starfinder-tool/frontend/src/galaxy/).
// The preview IS the viewer's renderer (lib/settlement.js, a verbatim copy):
// drag a district to pin it where the concept sketch has it (stored as x/y
// on the district); unpinned districts keep the seeded auto-layout.
const SITE_KINDS = ["city", "government", "outpost", "port", "extraction", "military", "research", "other"];
const TYPES = Object.keys(DISTRICT_TYPES);
const MODES = Object.keys(SETTLEMENT_TRANSIT);
const hasSurface = (b) => b.kind !== "orbital station" && b.kind !== "asteroid belt";

function uniqueSiteSlug(base, sites, except) {
  const taken = new Set(sites.filter((s) => s !== except).map((s) => s.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function blankSite(sites) {
  return {
    slug: uniqueSiteSlug("new-site", sites),
    name: "New Site",
    kind: "city",
    type: "Settlement",
    lat: 0,
    lon: 0,
    transit: ["rail", "underground"],
    transitNote: "",
    districts: [
      { name: "Spaceport", type: "port" },
      { name: "Civic Centre", type: "administration" },
      { name: "Habitation", type: "habitation" },
    ],
  };
}

// Viewer-shaped (compact) body + site for the shared renderer.
const toViewBody = (b) => ({ s: b.slug, k: b.kind, t: b.tags || [] });
const toViewSite = (site) => ({ id: site.slug, type: site.type || "", def: site });

function Preview({ body, site, selected, onSelect, onMove }) {
  const cvRef = useRef(null);
  const viewRef = useRef(null);
  const cb = useRef({}); cb.current = { onSelect, onMove };
  useEffect(() => {
    const v = new SettlementView(cvRef.current, toViewBody(body), toViewSite(site), {
      editable: true,
      onSelect: (i) => cb.current.onSelect(i),
      onMove: (i, x, y) => cb.current.onMove(i, x, y),
      area: (W, H) => [W - 40, H - 40],
    });
    viewRef.current = v;
    return () => v.destroy();
    // re-create only when switching body/site; edits re-layout in place below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.slug, site.slug]);
  useEffect(() => { viewRef.current?.setSite(toViewBody(body), toViewSite(site), true); }, [body, site]);
  useEffect(() => { viewRef.current?.setSel(selected); }, [selected]);
  return (
    <div className="gg-city-preview">
      <canvas ref={cvRef} />
      <div className="gg-city-hint">DRAG A DISTRICT TO PIN IT · DRAG EMPTY SPACE TO PAN · SCROLL TO ZOOM</div>
      <div style={{ position: "absolute", right: 6, top: 6, display: "flex", gap: 4 }}>
        <button onClick={() => viewRef.current?.zoomIn()} aria-label="Zoom in">+</button>
        <button onClick={() => viewRef.current?.zoomOut()} aria-label="Zoom out">−</button>
        <button onClick={() => { const v = viewRef.current; if (v) { v.home = null; } }} aria-label="Fit">FIT</button>
      </div>
    </div>
  );
}

export default function CityEditor({ systems, selectedSystem, onSelectSystem, onUpdateSystem }) {
  const bodies = (selectedSystem?.bodies || []).filter(hasSurface);
  const [bodySlug, setBodySlug] = useState(null);
  const [siteSlug, setSiteSlug] = useState(null);
  const [selDistrict, setSelDistrict] = useState(null);

  const body = bodies.find((b) => b.slug === bodySlug) || bodies.find((b) => b.sites?.length) || bodies[0] || null;
  const sites = body?.sites || [];
  const site = sites.find((s) => s.slug === siteSlug) || sites[0] || null;
  useEffect(() => { setSelDistrict(null); }, [body?.slug, site?.slug]);

  const hiddenHosts = useMemo(() => (site?.districts || []).filter((d) => !d.hidden).map((d) => d.name), [site]);

  if (!selectedSystem) {
    return (
      <div className="gg-city">
        <h3>Cities</h3>
        <SystemPicker systems={systems} value="" onChange={onSelectSystem} />
        <p className="muted small">Pick a system, or click one on the map (Select tool).</p>
      </div>
    );
  }

  const writeBody = (patch) => {
    const next = (selectedSystem.bodies || []).map((b) => (b.slug === body.slug ? { ...b, ...patch } : b));
    onUpdateSystem(selectedSystem.id, { bodies: next, locked: true });
  };
  const writeSites = (nextSites) => writeBody({ sites: nextSites.length ? nextSites : undefined });
  const writeSite = (patch) => writeSites(sites.map((s) => (s === site ? { ...s, ...patch } : s)));
  const writeDistrict = (i, patch) => writeSite({ districts: site.districts.map((d, j) => (j === i ? clean({ ...d, ...patch }) : d)) });
  const clean = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== "" && v !== false && v !== null));

  const addSite = () => { const s = blankSite(sites); writeSites([...sites, s]); setSiteSlug(s.slug); };
  const removeSite = () => { if (confirm(`Delete site "${site.name}" and its city layout?`)) { writeSites(sites.filter((s) => s !== site)); setSiteSlug(null); } };
  // The slug is the site's URL id in the viewer and seeds its auto-layout,
  // so it only changes when the GM edits it explicitly.
  const setSlug = (raw) => {
    const slug = uniqueSiteSlug(slugify(raw) || "site", sites, site);
    writeSite({ slug });
    setSiteSlug(slug);
  };
  const toggleMode = (m) => {
    const cur = site.transit || [];
    writeSite({ transit: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] });
  };
  const addDistrict = () => writeSite({ districts: [...(site.districts || []), { name: `District ${(site.districts || []).length + 1}`, type: "habitation" }] });
  const removeDistrict = (i) => { writeSite({ districts: site.districts.filter((_, j) => j !== i) }); setSelDistrict(null); };
  const moveDistrict = (i, dir) => {
    const ds = [...site.districts], j = i + dir;
    if (j < 0 || j >= ds.length) return;
    [ds[i], ds[j]] = [ds[j], ds[i]];
    writeSite({ districts: ds });
    setSelDistrict(j);
  };
  const unpinAll = () => writeSite({ districts: site.districts.map((d) => clean({ ...d, x: undefined, y: undefined })) });

  return (
    <div className="gg-city">
      <h3>Cities</h3>
      <SystemPicker systems={systems} value={selectedSystem.id} onChange={onSelectSystem} />
      {bodies.length === 0 ? (
        <p className="muted small">This system has no body with a surface (only stations/belts).</p>
      ) : (
        <>
          <label className="small muted">Body</label>
          <select value={body.slug} onChange={(e) => { setBodySlug(e.target.value); setSiteSlug(null); }}>
            {bodies.map((b) => <option key={b.slug} value={b.slug}>{b.name} — {b.kind}{b.sites?.length ? ` · ${b.sites.length} site(s)` : ""}</option>)}
          </select>

          <h4>Surface sites</h4>
          <div className="gg-tool-row">
            {sites.map((s) => (
              <button key={s.slug} className={s === site ? "active" : ""} onClick={() => setSiteSlug(s.slug)}>{s.name}</button>
            ))}
            <button onClick={addSite}>+ Site</button>
          </div>
          {!site && <p className="muted small">No authored sites — the viewer generates them for settled/extraction bodies. Add one to place a real city.</p>}

          {site && (
            <>
              <div className="gg-city-row">
                <div><label className="small muted">Name</label><input value={site.name} onChange={(e) => writeSite({ name: e.target.value })} /></div>
                <div><label className="small muted">Kind</label>
                  <select value={site.kind || "city"} onChange={(e) => writeSite({ kind: e.target.value })}>{SITE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                </div>
              </div>
              <label className="small muted">Layout style</label>
              <select value={site.style || ""} onChange={(e) => writeSite({ style: e.target.value || undefined })}>
                <option value="">auto ({SETTLEMENT_STYLES[settlementStyle(toViewBody(body), { id: site.slug, def: { ...site, style: undefined } })].n.toLowerCase()})</option>
                {Object.entries(SETTLEMENT_STYLES).map(([k, v]) => <option key={k} value={k}>{v.n.toLowerCase()}{v.final ? "" : " (provisional — generator not built yet)"}</option>)}
              </select>
              <label className="small muted">Slug (viewer URL id)</label>
              <input defaultValue={site.slug} key={site.slug} onBlur={(e) => e.target.value !== site.slug && setSlug(e.target.value)} />
              <label className="small muted">Description (shown under the name)</label>
              <input value={site.type || ""} onChange={(e) => writeSite({ type: e.target.value })} />
              <div className="gg-city-row">
                <div><label className="small muted">Latitude ° (−90…90)</label><input type="number" min={-90} max={90} step={0.5} value={site.lat ?? 0} onChange={(e) => writeSite({ lat: Math.max(-90, Math.min(90, Number(e.target.value) || 0)) })} /></div>
                <div><label className="small muted">Longitude ° (−180…180)</label><input type="number" min={-180} max={180} step={0.5} value={site.lon ?? 0} onChange={(e) => writeSite({ lon: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })} /></div>
              </div>
              <label className="small muted">Local transit</label>
              <div className="gg-transit-row">
                {MODES.map((m) => (
                  <label key={m} className="gg-checkbox" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={(site.transit || []).includes(m)} onChange={() => toggleMode(m)} />
                    <span style={{ color: SETTLEMENT_TRANSIT[m].c }}>{SETTLEMENT_TRANSIT[m].n}</span>
                  </label>
                ))}
              </div>
              <label className="small muted">Transit note</label>
              <textarea rows={2} value={site.transitNote || ""} onChange={(e) => writeSite({ transitNote: e.target.value })} />

              <h4>Layout</h4>
              <Preview body={body} site={site} selected={selDistrict}
                onSelect={setSelDistrict}
                onMove={(i, x, y) => { writeDistrict(i, { x, y }); setSelDistrict(i); }} />
              <div className="gg-tool-row">
                <button onClick={addDistrict}>+ District</button>
                <button onClick={unpinAll} title="Forget every hand-placed position and use the seeded auto-layout">Auto-layout (unpin all)</button>
              </div>
              <p className="muted small">The first district is the city centre. Hidden districts (GM-only) sit beside their host with a secret tunnel and are never sent to players.</p>

              {(site.districts || []).map((d, i) => (
                <div key={i} className={"gg-district" + (selDistrict === i ? " active" : "")} onClick={() => setSelDistrict(i)}>
                  <div className="gg-district-head">
                    <span className="gg-swatch" style={{ background: d.hidden ? "#8f8a80" : DISTRICT_TYPES[d.type] || "#c9c1ff" }} />
                    <input value={d.name} onChange={(e) => writeDistrict(i, { name: e.target.value })} />
                    <button onClick={() => moveDistrict(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button onClick={() => moveDistrict(i, 1)} disabled={i === site.districts.length - 1} aria-label="Move down">↓</button>
                    <button className="gg-danger" onClick={() => removeDistrict(i)} aria-label="Delete district">×</button>
                  </div>
                  <div className="gg-city-row">
                    <select value={d.type || "habitation"} onChange={(e) => writeDistrict(i, { type: e.target.value })}>
                      {TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <label className="gg-checkbox">
                      <input type="checkbox" checked={!!d.hidden} onChange={(e) => writeDistrict(i, { hidden: e.target.checked, host: e.target.checked ? d.host : undefined })} />
                      Hidden (GM only)
                    </label>
                  </div>
                  {d.hidden && (
                    <>
                      <label className="small muted">Hides beside</label>
                      <select value={d.host || ""} onChange={(e) => writeDistrict(i, { host: e.target.value || undefined })}>
                        <option value="">— nearest district —</option>
                        {hiddenHosts.map((n) => <option key={n}>{n}</option>)}
                      </select>
                    </>
                  )}
                  <div className="gg-city-row" style={{ alignItems: "center" }}>
                    <input placeholder="SIT campaign ref (optional)" value={d.sitRef || ""} onChange={(e) => writeDistrict(i, { sitRef: e.target.value })} />
                    {typeof d.x === "number" ? (
                      <span className="gg-pin">◆ PINNED {d.x}, {d.y} <button className="gg-link" onClick={(e) => { e.stopPropagation(); writeDistrict(i, { x: undefined, y: undefined }); }}>unpin</button></span>
                    ) : <span className="muted small">auto-placed</span>}
                  </div>
                </div>
              ))}
              <button className="gg-danger" onClick={removeSite}>Delete site</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SystemPicker({ systems, value, onChange }) {
  return (
    <>
      <label className="small muted">System</label>
      <select value={value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— pick a system —</option>
        {[...systems].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </>
  );
}
