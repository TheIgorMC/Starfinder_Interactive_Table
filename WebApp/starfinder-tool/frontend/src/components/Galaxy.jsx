import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

// GalaxyGen project browser (Docs/10-galaxy-mapgen.md) — a read-only view
// onto whatever project the GM last imported. Deliberately separate from
// the Campaign lore wiki: a galaxy has hundreds of systems and a thousand+
// background actors that were never meant to become GM-authored lore
// entries. The only bridge between the two is campaign_entries.galaxy_ref
// (migrations/020) — set here, per entity, either by hand or via the bulk
// "Suggest links" tool below. Nothing here ever writes into the imported
// project itself.

// Same normalize/score approach as MediaLibrary.jsx's bulk portrait
// matcher — small enough, and specific enough to each caller's candidate
// shape, that sharing a module isn't worth it yet.
function normalizeForMatch(s) {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function nameMatchScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const wa = new Set(a.split(" ")), wb = new Set(b.split(" "));
  const overlap = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? overlap / union : 0;
}

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
          <label className="button-like">
            {busy ? "Importing…" : "Re-import…"}
            <input type="file" accept=".json,application/json" onChange={onFile} disabled={busy} hidden />
          </label>
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
// matches an unlinked lore entry of a plausible type — the GM reviews and
// applies, exactly like the bulk portrait matcher. Never invents new lore
// entries; only offers to link ones that already exist.
function SuggestLinksTool({ index, entries, linksByRef, onApplied }) {
  const [proposals, setProposals] = useState(null);
  const [busy, setBusy] = useState(false);

  const compute = () => {
    const unlinkedEntries = entries.filter((e) => !e.galaxy_ref);
    const props = [];
    for (const item of index) {
      if (linksByRef[item.ref]) continue;
      const allowedTypes = KIND_ENTRY_TYPES[item.kind] || [];
      const candidates = unlinkedEntries.filter((e) => allowedTypes.includes(e.type));
      const norm = normalizeForMatch(item.name);
      let best = null, bestScore = 0;
      for (const c of candidates) {
        const score = nameMatchScore(norm, normalizeForMatch(c.name));
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best && bestScore >= 0.5) props.push({ item, entryId: best.id, entryName: best.name, score: bestScore });
    }
    props.sort((a, b) => b.score - a.score);
    setProposals(props);
  };

  const apply = async () => {
    setBusy(true);
    try {
      await Promise.all(proposals.map((p) => api(`/campaign/${p.entryId}`, { method: "PATCH", body: { galaxy_ref: p.item.ref } })));
      setProposals(null);
      onApplied();
    } finally {
      setBusy(false);
    }
  };

  if (!proposals) {
    return <button onClick={compute}>Suggest links (name match)…</button>;
  }
  return (
    <div className="galaxy-suggest">
      {proposals.length === 0 ? (
        <div className="muted">No confident name matches found.</div>
      ) : (
        <>
          <table>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.item.ref}>
                  <td>{KIND_LABELS[p.item.kind]} <strong>{p.item.name}</strong></td>
                  <td>→</td>
                  <td>{p.entryName}</td>
                  <td className="muted small">{Math.round(p.score * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={apply} disabled={busy}>Link all {proposals.length}</button>
            <button className="link" onClick={() => setProposals(null)}>cancel</button>
          </div>
        </>
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
      <div className="row" style={{ margin: "10px 0", gap: 10, flexWrap: "wrap" }}>
        <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="all">All kinds</option>
          {Object.keys(KIND_LABELS).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}s</option>)}
        </select>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={showBackground} onChange={(e) => setShowBackground(e.target.checked)} />
          show background actors
        </label>
        <SuggestLinksTool index={index} entries={entries} linksByRef={linksByRef} onApplied={load} />
      </div>
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
    </div>
  );
}
