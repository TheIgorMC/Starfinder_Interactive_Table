import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import CharacterSheet from "./CharacterSheet.jsx";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";

const TYPES = [
  { key: "event", label: "Events" },
  { key: "location", label: "Locations" },
  { key: "npc", label: "Characters" },
  { key: "faction", label: "Factions" },
  { key: "object", label: "Objects" },
];

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

export default function Campaign() {
  const [type, setType] = useState("event");
  const [entries, setEntries] = useState([]);
  const [editing, setEditing] = useState(null);
  const [images, setImages] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [linkTargetId, setLinkTargetId] = useState("");
  const [relation, setRelation] = useState("");
  const [characters, setCharacters] = useState([]);
  const [viewingChar, setViewingChar] = useState(null);
  const { active, setFilterEnabled } = useActiveSession();

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
  useEffect(() => { load(); }, [type]);
  useEffect(() => {
    api("/media?category=portrait").then(setImages).catch(() => setImages([]));
    api("/campaign").then(setAllEntries).catch(() => setAllEntries([]));
  }, []);

  const loadCharacters = () => api("/characters").then(setCharacters);
  useEffect(() => { if (type === "npc") loadCharacters(); }, [type]);

  const openCharacter = (c) => api(`/characters/${c.id}`).then(setViewingChar);
  const patchCharacter = (fields) =>
    api(`/characters/${viewingChar.id}`, { method: "PATCH", body: fields }).then((c) => { setViewingChar(c); loadCharacters(); });

  const openEntry = async (entry) => {
    const full = entry.id ? await api(`/campaign/${entry.id}`) : entry;
    setEditing(full);
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
    setEditing(null);
    resetAiDraft();
    load();
    api("/campaign").then(setAllEntries);
  };

  const remove = async () => {
    await api(`/campaign/${editing.id}`, { method: "DELETE" });
    setEditing(null);
    resetAiDraft();
    load();
  };

  const addLink = async () => {
    if (!linkTargetId) return;
    await api(`/campaign/${editing.id}/links`, { method: "POST", body: { to_id: Number(linkTargetId), relation } });
    setLinkTargetId(""); setRelation("");
    reloadEditing();
  };

  const removeLink = async (linkId) => {
    await api(`/campaign/links/${linkId}`, { method: "DELETE" });
    reloadEditing();
  };

  const visibleEntries = filterToSession(entries, active, "entryIds");

  return (
    <div className="campaign">
      <div className="tab-row">
        {TYPES.map((t) => (
          <button key={t.key} className={type === t.key ? "active" : ""} onClick={() => { setType(t.key); setEditing(null); }}>
            {t.label}
          </button>
        ))}
      </div>

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
          <button onClick={() => { setEditing(blank(type)); resetAiDraft(); }}>+ New {TYPES.find((t) => t.key === type).label.replace(/s$/, "")}</button>
          <ul>
            {visibleEntries.map((e) => (
              <li key={e.id}>
                <button className="link" onClick={() => openEntry(e)}>
                  {e.name} {e.visible_to_players && <span className="pill ok">visible</span>}
                </button>
              </li>
            ))}
            {visibleEntries.length === 0 && <li className="muted">{active?.filter_enabled && entries.length > 0 ? "None linked to this session." : "Nothing here yet."}</li>}
          </ul>
        </div>

        {editing && (
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
              <button className="link" onClick={() => { setEditing(null); resetAiDraft(); }}>Cancel</button>
              {editing.id && <button className="link" onClick={remove}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
