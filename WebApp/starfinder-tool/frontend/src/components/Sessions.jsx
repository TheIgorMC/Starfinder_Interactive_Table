import React, { useEffect, useState } from "react";
import { api } from "../api.js";

// Session planning: a GM prep container tying together which lore entries
// (events/locations/NPCs/factions/objects, from the Campaign tab), media
// (maps/mood images/tokens/portraits), and prebuilt battle-map encounters
// are relevant to a specific table night. Starting a session flips a
// `filter_enabled` flag the rest of the GM console reads (see
// frontend/src/lib/sessionFilter.js) to narrow Media Library, the battle
// map's pickers, and the Campaign NPC list down to just what's prepped —
// with a toggle to fall back to showing everything without ending the
// session outright.

const ENTRY_TYPE_LABELS = { event: "Event", location: "Location", npc: "NPC", faction: "Faction", object: "Object" };
const MEDIA_CATEGORIES = [
  { key: "map", label: "Maps" },
  { key: "mood", label: "Mood screens" },
  { key: "token", label: "Tokens" },
  { key: "portrait", label: "Portraits" },
];
const STATUS_LABEL = { planned: "Planned", active: "Active", completed: "Completed" };

const blank = () => ({ name: "", session_date: "", summary: "", notes: "" });

function EntryLinker({ linked, onLink, onUnlink }) {
  const [all, setAll] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => { api("/campaign").then(setAll).catch(() => setAll([])); }, []);

  const linkedIds = new Set(linked.map((e) => e.id));
  const matches = q
    ? all.filter((e) => !linkedIds.has(e.id) && e.name.toLowerCase().includes(q.toLowerCase())).slice(0, 20)
    : [];

  const grouped = Object.entries(ENTRY_TYPE_LABELS).map(([type, label]) => [
    type, label, linked.filter((e) => e.type === type),
  ]).filter(([, , items]) => items.length > 0);

  return (
    <div className="session-section">
      <h4>Linked lore</h4>
      {grouped.length === 0 && <p className="muted">Nothing linked yet — search below to add events, locations, NPCs, factions, or objects.</p>}
      {grouped.map(([type, label, items]) => (
        <div key={type} className="chips" style={{ marginBottom: 6 }}>
          {items.map((e) => (
            <button key={e.id} className="chip active" onClick={() => onUnlink(e.id)} title="Click to remove">
              {label}: {e.name} ✕
            </button>
          ))}
        </div>
      ))}
      <input placeholder="Search lore to add…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      {q && (
        <ul className="sheet-list wizard-picker-list">
          {matches.map((e) => (
            <li key={e.id} className="sheet-card wizard-pick-card" onClick={() => { onLink(e.id); setQ(""); }}>
              <span className="pill">{ENTRY_TYPE_LABELS[e.type] || e.type}</span> {e.name}
            </li>
          ))}
          {matches.length === 0 && <li className="muted">No matches.</li>}
        </ul>
      )}
    </div>
  );
}

function MediaLinker({ linked, onLink, onUnlink }) {
  const [cat, setCat] = useState("map");
  const [items, setItems] = useState([]);

  useEffect(() => { api(`/media?category=${cat}`).then(setItems).catch(() => setItems([])); }, [cat]);

  const linkedIds = new Set(linked.map((m) => m.id));

  return (
    <div className="session-section">
      <h4>Linked media</h4>
      {linked.length === 0 && <p className="muted">Nothing linked yet — pick maps, mood screens, tokens, or portraits to prep below.</p>}
      {linked.length > 0 && (
        <div className="media-grid" style={{ marginBottom: 10 }}>
          {linked.map((m) => (
            <div key={m.id} className="media-item">
              <img src={m.url} alt={m.label || m.original_name} />
              <div className="media-item-label">{m.label || m.original_name}</div>
              <div className="media-item-actions">
                <button className="link" onClick={() => onUnlink(m.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="tab-row">
        {MEDIA_CATEGORIES.map((c) => (
          <button key={c.key} className={cat === c.key ? "active" : ""} onClick={() => setCat(c.key)}>{c.label}</button>
        ))}
      </div>
      <div className="media-grid">
        {items.filter((m) => !linkedIds.has(m.id)).map((m) => (
          <div key={m.id} className="media-item" onClick={() => onLink(m.id)} style={{ cursor: "pointer" }}>
            <img src={m.url} alt={m.label || m.original_name} />
            <div className="media-item-label">{m.label || m.original_name}</div>
          </div>
        ))}
        {items.length === 0 && <p className="muted">No {cat} images uploaded yet.</p>}
      </div>
    </div>
  );
}

function EncounterLinker({ linked, onLink, onUnlink, onCreate }) {
  const [all, setAll] = useState([]);
  const load = () => api("/battlemap/sessions").then(setAll).catch(() => setAll([]));
  useEffect(() => { load(); }, []);

  const linkedIds = new Set(linked.map((e) => e.id));

  return (
    <div className="session-section">
      <h4>Linked encounters</h4>
      <ul className="sheet-list">
        {all.map((e) => (
          <li key={e.id} className="row">
            <label className="checkbox-inline">
              <input type="checkbox" checked={linkedIds.has(e.id)}
                onChange={() => (linkedIds.has(e.id) ? onUnlink(e.id) : onLink(e.id))} />
              {e.name}
            </label>
          </li>
        ))}
        {all.length === 0 && <li className="muted">No encounters created yet.</li>}
      </ul>
      <button onClick={async () => { await onCreate(); load(); }}>+ New encounter for this session</button>
    </div>
  );
}

export default function Sessions() {
  const [list, setList] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [session, setSession] = useState(null);
  const [form, setForm] = useState(blank());

  const load = () => api("/sessions").then(setList);
  useEffect(() => { load(); }, []);

  const open = async (id) => {
    const full = await api(`/sessions/${id}`);
    setEditingId(id);
    setSession(full);
    setForm({ name: full.name, session_date: full.session_date, summary: full.summary, notes: full.notes });
  };

  const startNew = () => { setEditingId("new"); setSession(null); setForm(blank()); };
  const cancel = () => { setEditingId(null); setSession(null); };

  const saveFields = async () => {
    if (!form.name) return;
    if (editingId === "new") {
      const created = await api("/sessions", { method: "POST", body: form });
      await load();
      open(created.id);
    } else {
      await api(`/sessions/${editingId}`, { method: "PATCH", body: form });
      await load();
      open(editingId);
    }
  };

  const remove = async () => {
    await api(`/sessions/${editingId}`, { method: "DELETE" });
    await load();
    cancel();
  };

  const start = async () => { await api(`/sessions/${editingId}/start`); await load(); open(editingId); };
  const end = async () => { await api(`/sessions/${editingId}/end`); await load(); open(editingId); };
  const setFilterEnabled = async (enabled) => { await api(`/sessions/${editingId}`, { method: "PATCH", body: { filter_enabled: enabled } }); open(editingId); };

  const linkEntry = (id) => api(`/sessions/${editingId}/entries`, { method: "POST", body: { entry_id: id } }).then(setSession);
  const unlinkEntry = (id) => api(`/sessions/${editingId}/entries/${id}`, { method: "DELETE" }).then(setSession);
  const linkMedia = (id) => api(`/sessions/${editingId}/media`, { method: "POST", body: { media_id: id } }).then(setSession);
  const unlinkMedia = (id) => api(`/sessions/${editingId}/media/${id}`, { method: "DELETE" }).then(setSession);
  const linkEncounter = (id) => api(`/sessions/${editingId}/encounters`, { method: "POST", body: { battle_session_id: id } }).then(setSession);
  const unlinkEncounter = (id) => api(`/sessions/${editingId}/encounters/${id}`, { method: "DELETE" }).then(setSession);
  const createEncounter = async () => {
    const created = await api("/battlemap/sessions", { method: "POST", body: { name: `${form.name || "Session"} — Encounter` } });
    await linkEncounter(created.id);
  };

  return (
    <div className="campaign">
      <div className="campaign-body">
        <div className="campaign-list">
          <button onClick={startNew}>+ New session</button>
          <ul>
            {list.map((s) => (
              <li key={s.id}>
                <button className="link" onClick={() => open(s.id)}>
                  {s.name} <span className={`pill${s.status === "active" ? " ok" : ""}`}>{STATUS_LABEL[s.status]}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="muted">No sessions planned yet.</li>}
          </ul>
        </div>

        {editingId && (
          <div className="campaign-editor">
            <input placeholder="Session name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Date (in-game or real-world, freeform)" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} />
            <input placeholder="One-line summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            <textarea rows={6} placeholder="GM prep notes, planned beats…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

            {session && (
              <>
                <div className="row" style={{ margin: "12px 0" }}>
                  <span className={`pill${session.status === "active" ? " ok" : ""}`}>{STATUS_LABEL[session.status]}</span>
                  {session.status !== "active" && session.status !== "completed" && <button onClick={start}>Start session</button>}
                  {session.status === "completed" && <button onClick={start}>Resume as active</button>}
                  {session.status === "active" && <button onClick={end}>End session</button>}
                  {session.status === "active" && (
                    <label className="checkbox-inline">
                      <input type="checkbox" checked={session.filter_enabled} onChange={(e) => setFilterEnabled(e.target.checked)} />
                      Apply session filter to GM console
                    </label>
                  )}
                </div>
                {session.status === "active" && (
                  <p className="muted">
                    {session.filter_enabled
                      ? "Media Library, the battle map's pickers, and Campaign's NPC list are narrowed to what's linked below."
                      : "Filtering is off — those views show everything, same as with no session active."}
                  </p>
                )}

                <EntryLinker linked={session.entries} onLink={linkEntry} onUnlink={unlinkEntry} />
                <MediaLinker linked={session.media} onLink={linkMedia} onUnlink={unlinkMedia} />
                <EncounterLinker linked={session.encounters} onLink={linkEncounter} onUnlink={unlinkEncounter} onCreate={createEncounter} />
              </>
            )}

            <div className="row">
              <button onClick={saveFields} disabled={!form.name}>Save</button>
              <button className="link" onClick={cancel}>Cancel</button>
              {editingId !== "new" && <button className="link" onClick={remove}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
