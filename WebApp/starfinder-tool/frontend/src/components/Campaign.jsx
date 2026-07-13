import React, { useEffect, useState } from "react";
import { api } from "../api.js";

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

  const load = () => api(`/campaign?type=${type}`).then(setEntries);
  useEffect(() => { load(); }, [type]);
  useEffect(() => {
    api("/media?category=portrait").then(setImages).catch(() => setImages([]));
    api("/campaign").then(setAllEntries).catch(() => setAllEntries([]));
  }, []);

  const loadCharacters = () => api("/characters").then(setCharacters);
  useEffect(() => { if (type === "npc") loadCharacters(); }, [type]);

  const openEntry = async (entry) => {
    const full = entry.id ? await api(`/campaign/${entry.id}`) : entry;
    setEditing(full);
  };

  const reloadEditing = async () => {
    if (editing?.id) setEditing(await api(`/campaign/${editing.id}`));
  };

  const save = async () => {
    if (!editing.name) return;
    const body = { ...editing };
    delete body.links;
    if (editing.id) await api(`/campaign/${editing.id}`, { method: "PATCH", body });
    else await api("/campaign", { method: "POST", body });
    setEditing(null);
    load();
    api("/campaign").then(setAllEntries);
  };

  const remove = async () => {
    await api(`/campaign/${editing.id}`, { method: "DELETE" });
    setEditing(null);
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

  return (
    <div className="campaign">
      <div className="tab-row">
        {TYPES.map((t) => (
          <button key={t.key} className={type === t.key ? "active" : ""} onClick={() => { setType(t.key); setEditing(null); }}>
            {t.label}
          </button>
        ))}
      </div>

      {type === "npc" && (
        <div className="campaign-pcs">
          <h3>Player Characters</h3>
          <HephaistosImport onImported={loadCharacters} />
          <ul className="campaign-pc-list">
            {characters.map((c) => (
              <li key={c.id}>
                {c.portrait_url && <img src={c.portrait_url} alt="" />}
                <strong>{c.name}</strong> <span className="muted">{c.race} {c.class} {c.level}</span>
              </li>
            ))}
            {characters.length === 0 && <li className="muted">No player characters yet.</li>}
          </ul>
          <h3>NPCs</h3>
        </div>
      )}

      <div className="campaign-body">
        <div className="campaign-list">
          <button onClick={() => setEditing(blank(type))}>+ New {TYPES.find((t) => t.key === type).label.replace(/s$/, "")}</button>
          <ul>
            {entries.map((e) => (
              <li key={e.id}>
                <button className="link" onClick={() => openEntry(e)}>
                  {e.name} {e.visible_to_players && <span className="pill ok">visible</span>}
                </button>
              </li>
            ))}
            {entries.length === 0 && <li className="muted">Nothing here yet.</li>}
          </ul>
        </div>

        {editing && (
          <div className="campaign-editor">
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
              <button className="link" onClick={() => setEditing(null)}>Cancel</button>
              {editing.id && <button className="link" onClick={remove}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
