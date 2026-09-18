import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api.js";
import CharacterSheet from "./CharacterSheet.jsx";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";
import { HIERARCHY_RELATIONS } from "../lib/campaignTree.js";

const TYPES = [
  { key: "event", label: "Events" },
  { key: "location", label: "Locations" },
  { key: "npc", label: "Characters" },
  { key: "faction", label: "Factions" },
  { key: "quest", label: "Quests" },
  { key: "object", label: "Objects" },
];

// Groups a flat list of same-type entries into a tree using `links`
// (id/from_id/to_id/relation, as returned by GET /api/campaign/links).
// Entries whose parent isn't in this type (or isn't present at all, e.g.
// filtered out by the session/visibility filter) become roots.
function buildTree(entries, links) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const childrenOf = new Map();
  const hasParent = new Set();
  for (const l of links) {
    if (!HIERARCHY_RELATIONS.has(l.relation)) continue;
    if (!byId.has(l.from_id) || !byId.has(l.to_id)) continue;
    if (!childrenOf.has(l.to_id)) childrenOf.set(l.to_id, []);
    childrenOf.get(l.to_id).push(byId.get(l.from_id));
    hasParent.add(l.from_id);
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => a.name.localeCompare(b.name));
  const roots = entries.filter((e) => !hasParent.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  return { roots, childrenOf };
}

const blank = (type) => ({ type, name: "", summary: "", body: "", image_id: null, event_date: "", visible_to_players: false });

function HephaistosImport({ onImported }) {
  const [raw, setRaw] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/auth/users").then(setPlayers).catch(() => setPlayers([])); }, []);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.text().then(setRaw);
  };

  const doImport = async () => {
    setBusy(true);
    setError("");
    try {
      const hephaistos = JSON.parse(raw);
      await api("/characters/import/hephaistos", {
        method: "POST",
        body: { hephaistos, assignToUsername: assignTo || undefined },
      });
      setRaw("");
      setAssignTo("");
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hephaistos-import">
      <div className="row">
        <label className="button-like">
          Choose JSON file…
          <input type="file" accept=".json,application/json" onChange={onFile} hidden />
        </label>
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">Assign to player… (optional)</option>
          {players.map((p) => (
            <option key={p.username} value={p.username}>
              {p.username}{p.character_id != null ? " (already has a character)" : ""}
            </option>
          ))}
        </select>
        <button onClick={doImport} disabled={!raw || busy}>{busy ? "Importing…" : "Import"}</button>
      </div>
      {error && <p className="pill bad">{error}</p>}
      <textarea rows={4} placeholder="…or paste the exported Hephaistos JSON here" value={raw} onChange={(e) => setRaw(e.target.value)} />
    </div>
  );
}

// Raw fetch, not the api() helper — that one always JSON-encodes the body,
// which doesn't work for multipart file uploads (same reason as
// MediaLibrary.jsx's upload()).
async function uploadTgn(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/campaign/import-tgn", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function TgnImport({ onImported }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await uploadTgn(file);
      setResult(r);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tgn-import">
      <label className="button-like">
        {busy ? "Importing…" : "Import Tangent (.tgn) export…"}
        <input type="file" accept=".tgn" onChange={onFile} disabled={busy} hidden />
      </label>
      {error && <span className="pill bad">{error}</span>}
      {result && (
        <span className="pill ok">
          +{result.entriesInserted} new entries, +{result.linksInserted} new links
          {" "}({result.entriesSeen - result.entriesInserted} already imported, left untouched)
        </span>
      )}
    </div>
  );
}

function TreeNode({ entry, depth, childrenOf, collapsed, toggleCollapsed, openEntry, activeId }) {
  const kids = childrenOf.get(entry.id) || [];
  const isCollapsed = collapsed.has(entry.id);
  return (
    <li>
      <div className="campaign-tree-row" style={{ paddingLeft: depth * 16 }}>
        {kids.length > 0 ? (
          <button className="campaign-tree-caret" onClick={() => toggleCollapsed(entry.id)}>{isCollapsed ? "▸" : "▾"}</button>
        ) : (
          <span className="campaign-tree-caret" />
        )}
        <button className={"link" + (entry.id === activeId ? " active" : "")} onClick={() => openEntry(entry)}>
          {entry.name} {entry.visible_to_players && <span className="pill ok">visible</span>}
        </button>
      </div>
      {kids.length > 0 && !isCollapsed && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} entry={k} depth={depth + 1} childrenOf={childrenOf} collapsed={collapsed} toggleCollapsed={toggleCollapsed} openEntry={openEntry} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Campaign() {
  const [type, setType] = useState("event");
  const [entries, setEntries] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewMode, setViewMode] = useState("read"); // "read" (rendered markdown) or "edit" (the form)
  const [images, setImages] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [links, setLinks] = useState([]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [relation, setRelation] = useState("");
  const [characters, setCharacters] = useState([]);
  const [viewingChar, setViewingChar] = useState(null);
  const { active, setFilterEnabled } = useActiveSession();

  const toggleCollapsed = (id) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // AI draft (Ollama, see backend/src/routes/campaign.js POST /ai-draft) —
  // fills the blank-entry form from a freeform note; suggested links are
  // held here (not yet written) and only applied once the entry itself is
  // saved, since a link needs a real entry id on both ends.
  const [aiDescription, setAiDescription] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiLinks, setAiLinks] = useState([]);
  const resetAiDraft = () => { setAiDescription(""); setAiBusy(false); setAiError(""); setAiLinks([]); };

  const load = () => api(`/campaign?type=${type}`).then(setEntries);
  useEffect(() => { load(); setQ(""); }, [type]);
  const loadLinks = () => api("/campaign/links").then(setLinks).catch(() => setLinks([]));
  useEffect(() => {
    api("/media?category=portrait").then(setImages).catch(() => setImages([]));
    api("/campaign").then(setAllEntries).catch(() => setAllEntries([]));
    loadLinks();
  }, []);

  const loadCharacters = () => api("/characters").then(setCharacters);
  useEffect(() => { if (type === "npc") loadCharacters(); }, [type]);

  const openCharacter = (c) => api(`/characters/${c.id}`).then(setViewingChar);
  const patchCharacter = (fields) =>
    api(`/characters/${viewingChar.id}`, { method: "PATCH", body: fields }).then((c) => { setViewingChar(c); loadCharacters(); });

  const openEntry = async (entry) => {
    const full = entry.id ? await api(`/campaign/${entry.id}`) : entry;
    setEditing(full);
    setViewMode(full.id ? "read" : "edit");
    resetAiDraft();
  };

  const reloadEditing = async () => {
    if (editing?.id) setEditing(await api(`/campaign/${editing.id}`));
  };

  const generateAiDraft = async () => {
    if (!aiDescription.trim()) return;
    setAiBusy(true);
    setAiError("");
    try {
      const draft = await api("/campaign/ai-draft", { method: "POST", body: { description: aiDescription, hint_type: editing.type } });
      setEditing((cur) => ({
        ...cur, type: draft.type, name: draft.name, summary: draft.summary, body: draft.body,
        event_date: draft.type === "event" ? draft.event_date : cur.event_date,
      }));
      setAiLinks(draft.links.map((l) => ({ ...l, accepted: true })));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!editing.name) return;
    const body = { ...editing };
    delete body.links;
    let saved;
    if (editing.id) saved = await api(`/campaign/${editing.id}`, { method: "PATCH", body });
    else saved = await api("/campaign", { method: "POST", body });
    const acceptedLinks = aiLinks.filter((l) => l.accepted);
    if (!editing.id && acceptedLinks.length) {
      await Promise.all(acceptedLinks.map((l) =>
        api(`/campaign/${saved.id}/links`, { method: "POST", body: { to_id: l.entry_id, relation: l.relation } })
      ));
    }
    resetAiDraft();
    load();
    api("/campaign").then(setAllEntries);
    loadLinks();
    openEntry(saved);
  };

  const remove = async () => {
    await api(`/campaign/${editing.id}`, { method: "DELETE" });
    setEditing(null);
    resetAiDraft();
    load();
    loadLinks();
  };

  const addLink = async () => {
    if (!linkTargetId) return;
    await api(`/campaign/${editing.id}/links`, { method: "POST", body: { to_id: Number(linkTargetId), relation } });
    setLinkTargetId(""); setRelation("");
    reloadEditing();
    loadLinks();
  };

  const removeLink = async (linkId) => {
    await api(`/campaign/links/${linkId}`, { method: "DELETE" });
    reloadEditing();
    loadLinks();
  };

  const visibleEntries = filterToSession(entries, active, "entryIds");
  const searchedEntries = q.trim()
    ? visibleEntries.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()))
    : visibleEntries;
  const tree = useMemo(() => buildTree(searchedEntries, links), [searchedEntries, links]);

  return (
    <div className="campaign">
      <div className="tab-row">
        {TYPES.map((t) => (
          <button key={t.key} className={type === t.key ? "active" : ""} onClick={() => { setType(t.key); setEditing(null); }}>
            {t.label}
          </button>
        ))}
      </div>

      <TgnImport onImported={() => { load(); api("/campaign").then(setAllEntries); loadLinks(); }} />

      {active?.status === "active" && (
        <label className="checkbox-inline" style={{ marginBottom: 12 }} title={`Session: ${active.name}`}>
          <input type="checkbox" checked={active.filter_enabled} onChange={(e) => setFilterEnabled(e.target.checked)} />
          Filter to "{active.name}" ({visibleEntries.length}/{entries.length} shown)
        </label>
      )}

      {type === "npc" && (
        <div className="campaign-pcs">
          <h3>Player Characters</h3>
          <HephaistosImport onImported={loadCharacters} />
          <ul className="campaign-pc-list">
            {characters.map((c) => (
              <li key={c.id}>
                <button className="link campaign-pc-row" onClick={() => openCharacter(c)}>
                  {c.portrait_url && <img src={c.portrait_url} alt="" />}
                  <strong>{c.name}</strong> <span className="muted">{c.race} {c.class} {c.level}</span>
                </button>
              </li>
            ))}
            {characters.length === 0 && <li className="muted">No player characters yet.</li>}
          </ul>

          {viewingChar && (
            <div className="campaign-character-sheet">
              <button className="link" onClick={() => setViewingChar(null)}>✕ Close sheet</button>
              <CharacterSheet key={viewingChar.id} character={viewingChar} patch={patchCharacter} />
            </div>
          )}

          <h3>NPCs</h3>
        </div>
      )}

      <div className="campaign-body">
        <div className="campaign-list">
          <button onClick={() => { setEditing(blank(type)); setViewMode("edit"); resetAiDraft(); }}>+ New {TYPES.find((t) => t.key === type).label.replace(/s$/, "")}</button>
          <input className="campaign-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="campaign-tree">
            {tree.roots.map((e) => (
              <TreeNode key={e.id} entry={e} depth={0} childrenOf={tree.childrenOf} collapsed={collapsed} toggleCollapsed={toggleCollapsed} openEntry={openEntry} activeId={editing?.id} />
            ))}
            {tree.roots.length === 0 && (
              <li className="muted">
                {q.trim() ? "No matches." : active?.filter_enabled && entries.length > 0 ? "None linked to this session." : "Nothing here yet."}
              </li>
            )}
          </ul>
        </div>

        {editing && viewMode === "read" && (
          <div className="campaign-reader">
            <div className="campaign-reader-head">
              <div>
                <h2>{editing.name}</h2>
                <p className="muted">
                  {TYPES.find((t) => t.key === editing.type)?.label.replace(/s$/, "")}
                  {editing.event_date && ` · ${editing.event_date}`}
                  {editing.visible_to_players && <span className="pill ok" style={{ marginLeft: 8 }}>visible to players</span>}
                </p>
              </div>
              <div className="row">
                <button onClick={() => setViewMode("edit")}>Edit</button>
                <button className="link" onClick={() => setEditing(null)}>Close</button>
              </div>
            </div>

            {images.find((m) => m.id === editing.image_id) && (
              <img className="campaign-reader-image" src={images.find((m) => m.id === editing.image_id).url} alt="" />
            )}
            {editing.summary && <p className="campaign-reader-summary">{editing.summary}</p>}
            <div className="campaign-markdown">
              <ReactMarkdown>{editing.body || "*Nothing written yet — click Edit to add some.*"}</ReactMarkdown>
            </div>

            <div className="campaign-links">
              <h4>Related entries</h4>
              <ul>
                {(editing.links || []).map((l) => (
                  <li key={l.id}>
                    {l.direction === "out" ? `→ ${l.relation || "related to"}` : `← ${l.relation || "related to"}`}{" "}
                    <span className="pill">{l.type}</span>{" "}
                    <button className="link" onClick={() => openEntry({ id: l.entry_id })}>{l.name}</button>
                  </li>
                ))}
                {(!editing.links || editing.links.length === 0) && <li className="muted">No links yet.</li>}
              </ul>
            </div>
          </div>
        )}

        {editing && viewMode === "edit" && (
          <div className="campaign-editor">
            {!editing.id && (
              <div className="ai-draft">
                <label>✨ Describe it — let AI draft the entry</label>
                <textarea
                  rows={3}
                  placeholder="e.g. A grizzled Vesk mercenary captain found drinking alone at the Rust & Ration bar on Absalom Station. Used to run with the Vex Cartel before a falling out."
                  value={aiDescription} onChange={(e) => setAiDescription(e.target.value)}
                />
                <div className="row">
                  <button onClick={generateAiDraft} disabled={!aiDescription.trim() || aiBusy}>{aiBusy ? "Drafting…" : "Generate draft"}</button>
                  {aiError && <span className="pill bad">{aiError}</span>}
                </div>
              </div>
            )}
            <input placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            {editing.type === "event" && (
              <input placeholder="Date (in-game, freeform)" value={editing.event_date} onChange={(e) => setEditing({ ...editing, event_date: e.target.value })} />
            )}
            <input placeholder="One-line summary" value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
            <select value={editing.image_id ?? ""} onChange={(e) => setEditing({ ...editing, image_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No image</option>
              {images.map((m) => <option key={m.id} value={m.id}>{m.label || m.original_name}</option>)}
            </select>
            <textarea rows={8} placeholder="Details, stat block, lore text…" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <label className="checkbox-inline">
              <input type="checkbox" checked={editing.visible_to_players} onChange={(e) => setEditing({ ...editing, visible_to_players: e.target.checked })} />
              Visible to players
            </label>

            {!editing.id && aiLinks.length > 0 && (
              <div className="campaign-links">
                <h4>AI-suggested links</h4>
                <ul>
                  {aiLinks.map((l, i) => (
                    <li key={l.entry_id}>
                      <label className="checkbox-inline" style={{ flex: 1 }}>
                        <input
                          type="checkbox" checked={l.accepted}
                          onChange={() => setAiLinks((cur) => cur.map((x, j) => (j === i ? { ...x, accepted: !x.accepted } : x)))}
                        />
                        {l.relation || "related to"} <span className="pill">{l.type}</span> {l.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="muted">Applied automatically once you Save.</p>
              </div>
            )}

            {editing.id && (
              <div className="campaign-links">
                <h4>Related entries</h4>
                <ul>
                  {(editing.links || []).map((l) => (
                    <li key={l.id}>
                      {l.direction === "out" ? `→ ${l.relation || "related to"}` : `← ${l.relation || "related to"}`}{" "}
                      <span className="pill">{l.type}</span> {l.name}
                      <button className="link" onClick={() => removeLink(l.id)}>unlink</button>
                    </li>
                  ))}
                  {(!editing.links || editing.links.length === 0) && <li className="muted">No links yet.</li>}
                </ul>
                <div className="row">
                  <select value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                    <option value="">Link to…</option>
                    {allEntries.filter((e) => e.id !== editing.id).map((e) => (
                      <option key={e.id} value={e.id}>{e.type}: {e.name}</option>
                    ))}
                  </select>
                  <input placeholder="relation (e.g. member of)" value={relation} onChange={(e) => setRelation(e.target.value)} style={{ maxWidth: 160 }} />
                  <button onClick={addLink} disabled={!linkTargetId}>Link</button>
                </div>
              </div>
            )}

            <div className="row">
              <button onClick={save} disabled={!editing.name}>Save</button>
              <button className="link" onClick={() => { editing.id ? openEntry({ id: editing.id }) : setEditing(null); resetAiDraft(); }}>Cancel</button>
              {editing.id && <button className="link" onClick={remove}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
