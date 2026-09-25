import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

// GalaxyGen project browser (Docs/10-galaxy-mapgen.md) — a read-only view
// onto whatever project the GM last imported. Deliberately separate from
// the Campaign lore wiki: a galaxy has hundreds of systems and a thousand+
// background actors that were never meant to become GM-authored lore
// entries. The only bridge between the two is campaign_entries.galaxy_ref
// (migrations/020) — set here, per entity, either by hand or via the bulk
// "Suggest links" tool below. Nothing here ever writes into the imported
// project itself.

// Same normalize approach as MediaLibrary.jsx's bulk portrait matcher.
function normalizeForMatch(s) {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Word-overlap (Jaccard) only — no whole-string "contains" shortcut. A
// galaxy full of "<Name>'s Drift"/"<Name> Drift" systems will all share the
// generic word "Drift" with an unrelated lore entry literally named
// "Drift"; a containment shortcut scored that 0.8 and matched every one of
// them onto the same single entry. Plain word overlap scores that ~0.5,
// under the (raised) 0.6 threshold below, while still rewarding an exact
// or near-exact name match.
function nameMatchScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wa = a.split(" ").filter(Boolean), wb = b.split(" ").filter(Boolean);
  const sa = new Set(wa), sb = new Set(wb);
  const overlap = [...sa].filter((w) => sb.has(w)).length;
  const union = new Set([...sa, ...sb]).size;
  return union ? overlap / union : 0;
}
const MATCH_THRESHOLD = 0.6;

// Which campaign_entries types are plausible targets for each galaxy kind
// — narrows the link picker instead of showing every lore entry.
const KIND_ENTRY_TYPES = {
  system: ["location"],
  sector: ["location"],
  faction: ["faction"],
  organization: ["faction"],
  actor: ["npc"],
  company: ["faction", "object"],
};
const KIND_LABELS = {
  system: "System", sector: "Sector", faction: "Faction",
  organization: "Organization", actor: "Actor", company: "Company",
};

async function uploadGalaxy(file, name) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  const res = await fetch("/api/galaxy/import", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function ImportPanel({ project, onImported }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await uploadGalaxy(file);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="galaxy-import">
      {project ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{project.name}</strong> — seed {project.seed || "?"}, imported {new Date(project.imported_at).toLocaleString()}
            <div className="muted small">
              {Object.entries(project.counts).map(([k, n]) => `${n} ${k}`).join(" · ")}
            </div>
          </div>
          <span className="row" style={{ gap: 8 }}>
            <a className="button-like" href="/api/galaxy/export" download>Download…</a>
            <label className="button-like">
              {busy ? "Importing…" : "Re-import…"}
              <input type="file" accept=".json,application/json" onChange={onFile} disabled={busy} hidden />
            </label>
          </span>
        </div>
      ) : (
        <label className="button-like">
          {busy ? "Importing…" : "Import GalaxyGen project (.json)…"}
          <input type="file" accept=".json,application/json" onChange={onFile} disabled={busy} hidden />
        </label>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// Inline picker for one galaxy entity: link to an existing lore entry of a
// plausible type, or create a new one seeded with this entity's name.
function LinkCell({ item, linkedEntry, entries, onOpenCampaignEntry, onLinked }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const allowedTypes = KIND_ENTRY_TYPES[item.kind] || [];
  const candidates = useMemo(
    () => entries.filter((e) => allowedTypes.includes(e.type) && !e.galaxy_ref),
    [entries, allowedTypes]
  );

  if (linkedEntry) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <span className="pill">↔ {linkedEntry.name}</span>
        {onOpenCampaignEntry && (
          <button className="link" onClick={() => onOpenCampaignEntry(linkedEntry.id)}>open</button>
        )}
        <button className="link" onClick={async () => { await api(`/campaign/${linkedEntry.id}`, { method: "PATCH", body: { galaxy_ref: null } }); onLinked(); }}>
          unlink
        </button>
      </span>
    );
  }

  if (!picking) {
    return <button className="link" onClick={() => setPicking(true)}>Link…</button>;
  }

  const link = async (entryId) => {
    setBusy(true);
    try {
      await api(`/campaign/${entryId}`, { method: "PATCH", body: { galaxy_ref: item.ref } });
      onLinked();
    } finally {
      setBusy(false);
      setPicking(false);
    }
  };
  const createAndLink = async () => {
    setBusy(true);
    try {
      const created = await api("/campaign", { method: "POST", body: { type: allowedTypes[0], name: item.name } });
      await api(`/campaign/${created.id}`, { method: "PATCH", body: { galaxy_ref: item.ref } });
      onLinked();
    } finally {
      setBusy(false);
      setPicking(false);
    }
  };

  return (
    <span className="row" style={{ gap: 6 }}>
      <select disabled={busy} defaultValue="" onChange={(e) => e.target.value && link(e.target.value)}>
        <option value="">— pick lore entry —</option>
        {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
      </select>
      <button className="link" disabled={busy} onClick={createAndLink}>+ new {allowedTypes[0]}</button>
      <button className="link" onClick={() => setPicking(false)}>cancel</button>
    </span>
  );
}

function EntityRow({ item, linkedEntry, entries, onOpenCampaignEntry, onLinked }) {
  return (
    <div className="galaxy-row">
      <span className="galaxy-row-kind">{KIND_LABELS[item.kind]}</span>
      <span className="galaxy-row-name">{item.name}</span>
      <span className="muted small">{item.sector ? `sector ${item.sector}` : item.role || item.government || item.ideology || item.focus || ""}</span>
      <LinkCell item={item} linkedEntry={linkedEntry} entries={entries} onOpenCampaignEntry={onOpenCampaignEntry} onLinked={onLinked} />
    </div>
  );
}

// Proposes a lore entry for every unlinked galaxy entity whose name closely
// matches an unlinked lore entry of a plausible type. Each proposal is a
// checkbox the GM can uncheck individually rather than an all-or-nothing
// batch — "Link selected" only applies the checked rows. Greedy-assigned
// (highest score first, each lore entry used at most once) so two galaxy
// entities can never both be proposed against the same single-valued
// lore entry.
function computeProposals(index, entries, linksByRef) {
  const unlinkedEntries = entries.filter((e) => !e.galaxy_ref);
  const all = [];
  for (const item of index) {
    if (linksByRef[item.ref]) continue;
    const allowedTypes = KIND_ENTRY_TYPES[item.kind] || [];
    const norm = normalizeForMatch(item.name);
    for (const c of unlinkedEntries) {
      if (!allowedTypes.includes(c.type)) continue;
      const score = nameMatchScore(norm, normalizeForMatch(c.name));
      if (score >= MATCH_THRESHOLD) all.push({ item, entryId: c.id, entryName: c.name, score });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const usedItems = new Set(), usedEntries = new Set();
  const proposals = [];
  for (const p of all) {
    if (usedItems.has(p.item.ref) || usedEntries.has(p.entryId)) continue;
    usedItems.add(p.item.ref);
    usedEntries.add(p.entryId);
    proposals.push(p);
  }
  return proposals;
}

function SuggestLinksPanel({ proposals, onClose, onApplied }) {
  const [checked, setChecked] = useState(() => new Set(proposals.map((_, i) => i)));
  const [busy, setBusy] = useState(false);

  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const apply = async () => {
    const chosen = proposals.filter((_, i) => checked.has(i));
    if (!chosen.length) return;
    setBusy(true);
    try {
      await Promise.all(chosen.map((p) => api(`/campaign/${p.entryId}`, { method: "PATCH", body: { galaxy_ref: p.item.ref } })));
      onApplied();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="galaxy-suggest">
      {proposals.length === 0 ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">No confident name matches found.</span>
          <button className="link" onClick={onClose}>close</button>
        </div>
      ) : (
        <>
          <table>
            <tbody>
              {proposals.map((p, i) => (
                <tr key={p.item.ref}>
                  <td><input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} /></td>
                  <td>{KIND_LABELS[p.item.kind]} <strong>{p.item.name}</strong></td>
                  <td>→</td>
                  <td>{p.entryName}</td>
                  <td className="muted small">{Math.round(p.score * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={apply} disabled={busy || !checked.size}>Link selected ({checked.size})</button>
            <button className="link" onClick={onClose}>cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// Faction-colored system dots on a pan/zoom canvas, sector polygons as
// faint outlines, hyperlanes as thin lines — same drawing primitives
// GalaxyGen itself uses (Docs/10-galaxy-mapgen.md §2-3), restyled to this
// app's own look rather than borrowing GalaxyGen's toolbar/UI chrome.
function MapView({ onOpenCampaignEntry }) {
  const [map, setMap] = useState(null);
  const [selected, setSelected] = useState(null);
  const [entries, setEntries] = useState([]);
  const [links, setLinks] = useState([]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    api("/galaxy/map").then(setMap).catch(() => setMap(null));
    api("/campaign").then(setEntries).catch(() => setEntries([]));
    api("/galaxy/links").then(setLinks).catch(() => setLinks([]));
  }, []);

  const linksByRef = useMemo(() => Object.fromEntries(links.map((l) => [l.galaxy_ref, l])), [links]);
  const entriesById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries]);
  const factionColor = useMemo(() => Object.fromEntries((map?.factions || []).map((f) => [f.ref.slice(8), f.color])), [map]);
  const posBySlug = useMemo(() => {
    const out = {};
    for (const s of map?.systems || []) out[s.ref.slice(7)] = s;
    return out;
  }, [map]);

  if (!map) return <div className="muted">Loading map…</div>;

  const w = map.bounds?.width || 1000, h = map.bounds?.height || 1000;

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ ...v, scale: Math.min(8, Math.max(0.5, v.scale * factor)) }));
  };
  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / view.scale;
    const dy = (e.clientY - dragRef.current.startY) / view.scale;
    setView((v) => ({ ...v, x: dragRef.current.origX - dx, y: dragRef.current.origY - dy }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const vw = w / view.scale, vh = h / view.scale;
  const viewBox = `${view.x} ${view.y} ${vw} ${vh}`;

  const selectedEntry = selected && linksByRef[selected.ref] ? entriesById[linksByRef[selected.ref].id] : null;

  return (
    <div className="galaxy-map">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="galaxy-map-svg"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {map.sectors.map((s) => (
          <polygon key={s.ref} points={s.points.map((p) => p.join(",")).join(" ")} className="galaxy-map-sector" />
        ))}
        {map.hyperlanes.map((hl, i) => {
          const a = posBySlug[hl.a], b = posBySlug[hl.b];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="galaxy-map-lane" />;
        })}
        {map.systems.map((s) => (
          <circle
            key={s.ref}
            cx={s.x} cy={s.y}
            r={2 + s.important * 5}
            fill={s.owner ? factionColor[s.owner] || "var(--accent)" : "var(--text-muted)"}
            className={`galaxy-map-system${selected?.ref === s.ref ? " selected" : ""}`}
            onClick={() => setSelected({ ...s, kind: "system" })}
          >
            <title>{s.name}</title>
          </circle>
        ))}
      </svg>
      <div className="galaxy-map-legend">
        {map.factions.map((f) => (
          <span key={f.ref} className="row" style={{ gap: 5 }}>
            <span className="galaxy-map-swatch" style={{ background: f.color }} />
            {f.name}
          </span>
        ))}
      </div>
      {selected && (
        <div className="galaxy-map-info">
          <strong>{selected.name}</strong>
          {selected.sector && <span className="muted small"> · sector {selected.sector}</span>}
          <div style={{ marginTop: 6 }}>
            <LinkCell
              item={selected}
              linkedEntry={selectedEntry}
              entries={entries}
              onOpenCampaignEntry={onOpenCampaignEntry}
              onLinked={() => { api("/campaign").then(setEntries); api("/galaxy/links").then(setLinks); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Galaxy({ onOpenCampaignEntry }) {
  const [project, setProject] = useState(null);
  const [index, setIndex] = useState([]);
  const [links, setLinks] = useState([]);
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [showBackground, setShowBackground] = useState(false);
  const [view, setView] = useState("list");
  const [proposals, setProposals] = useState(null);

  const load = () => {
    api("/galaxy").then(setProject).catch(() => setProject(null));
    api("/galaxy/index").then(setIndex).catch(() => setIndex([]));
    api("/galaxy/links").then(setLinks).catch(() => setLinks([]));
    api("/campaign").then(setEntries).catch(() => setEntries([]));
  };
  useEffect(load, []);

  const linksByRef = useMemo(() => Object.fromEntries(links.map((l) => [l.galaxy_ref, l])), [links]);
  const entriesById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return index.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (item.kind === "actor" && item.origin === "generated" && !showBackground) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [index, kindFilter, showBackground, query]);

  if (!project) {
    return (
      <div className="galaxy-view">
        <h2>Galaxy</h2>
        <p className="muted">No GalaxyGen project imported yet.</p>
        <ImportPanel project={project} onImported={load} />
      </div>
    );
  }

  return (
    <div className="galaxy-view">
      <h2>Galaxy</h2>
      <ImportPanel project={project} onImported={load} />
      <div className="tab-row">
        <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
        <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map</button>
      </div>

      {view === "map" ? (
        <MapView onOpenCampaignEntry={onOpenCampaignEntry} />
      ) : (
        <>
          <div className="row galaxy-toolbar">
            <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="all">All kinds</option>
              {Object.keys(KIND_LABELS).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}s</option>)}
            </select>
            <label className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={showBackground} onChange={(e) => setShowBackground(e.target.checked)} />
              show background actors
            </label>
            <button
              className="link"
              onClick={() => setProposals(computeProposals(index, entries, linksByRef))}
            >
              Suggest links (name match)…
            </button>
          </div>

          {proposals && (
            <SuggestLinksPanel
              proposals={proposals}
              onClose={() => setProposals(null)}
              onApplied={() => { setProposals(null); load(); }}
            />
          )}

          <div className="galaxy-list">
            {visible.map((item) => (
              <EntityRow
                key={item.ref}
                item={item}
                linkedEntry={linksByRef[item.ref] ? entriesById[linksByRef[item.ref].id] || linksByRef[item.ref] : null}
                entries={entries}
                onOpenCampaignEntry={onOpenCampaignEntry}
                onLinked={load}
              />
            ))}
            {visible.length === 0 && <div className="muted">No entities match.</div>}
          </div>
        </>
      )}
    </div>
  );
}
