import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import CharacterSheet from "./CharacterSheet.jsx";

// PCs (statted characters) and GM-made NPCs (also statted — a stat block
// someone might actually roll dice against) live in the same `characters`
// table; a PC is just one a player account points at via users.character_id.
// This is the dedicated "statblocks" home, distinct from Campaign.jsx's
// lore-only "People" wiki entries (campaign_entries, type='npc') — a
// statted character may optionally point at one of those as its lore page
// (characters.lore_entry_id), but neither side requires the other.

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

function LoreLinkPicker({ character, onLinked }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [picked, setPicked] = useState("");

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) api("/campaign?type=npc").then(setEntries).catch(() => setEntries([]));
  };

  const link = async () => {
    if (!picked) return;
    await api(`/characters/${character.id}`, { method: "PATCH", body: { lore_entry_id: Number(picked) } });
    setOpen(false);
    setPicked("");
    onLinked();
  };

  const unlink = async () => {
    await api(`/characters/${character.id}`, { method: "PATCH", body: { lore_entry_id: null } });
    onLinked();
  };

  if (character.lore_entry_name) {
    return (
      <p className="muted">
        Linked lore entry: <strong>{character.lore_entry_name}</strong>{" "}
        <button className="link" onClick={unlink}>unlink</button>
      </p>
    );
  }

  return (
    <div className="row" style={{ alignItems: "center" }}>
      <button className="link" onClick={toggle}>{open ? "✕ Cancel" : "Link to a lore entry…"}</button>
      {open && (
        <>
          <select value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Pick a Person entry…</option>
            {entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button onClick={link} disabled={!picked}>Link</button>
        </>
      )}
    </div>
  );
}

export default function Characters({ focusCharacterId, onFocusHandled }) {
  const [characters, setCharacters] = useState([]);
  const [players, setPlayers] = useState([]);
  const [viewingChar, setViewingChar] = useState(null);
  const [showPcImport, setShowPcImport] = useState(false);

  const loadCharacters = () => api("/characters").then(setCharacters);
  useEffect(() => {
    loadCharacters();
    api("/auth/users").then(setPlayers).catch(() => setPlayers([]));
  }, []);

  const openCharacter = (c) => api(`/characters/${c.id}`).then(setViewingChar);
  const patchCharacter = (fields) =>
    api(`/characters/${viewingChar.id}`, { method: "PATCH", body: fields }).then((c) => { setViewingChar(c); loadCharacters(); });

  useEffect(() => {
    if (focusCharacterId == null) return;
    openCharacter({ id: focusCharacterId });
    onFocusHandled?.();
  }, [focusCharacterId]);

  const newNpc = async () => {
    const c = await api("/characters", { method: "POST", body: { name: "New NPC" } });
    await loadCharacters();
    openCharacter(c);
  };

  const linkedCharacterIds = new Set(players.filter((p) => p.character_id != null).map((p) => p.character_id));
  const pcs = characters.filter((c) => linkedCharacterIds.has(c.id));
  const npcs = characters.filter((c) => !linkedCharacterIds.has(c.id));
  const ownerOf = (id) => players.find((p) => p.character_id === id)?.username;

  return (
    <div className="campaign">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Player Characters</h3>
        <button className="link" onClick={() => setShowPcImport((v) => !v)}>
          {showPcImport ? "✕ Close import" : "+ Import from Hephaistos"}
        </button>
      </div>
      {showPcImport && <HephaistosImport onImported={() => { loadCharacters(); setShowPcImport(false); }} />}
      <ul className="campaign-pc-list">
        {pcs.map((c) => (
          <li key={c.id}>
            <button className="link campaign-pc-row" onClick={() => openCharacter(c)}>
              {c.portrait_url && <img src={c.portrait_url} alt="" />}
              <strong>{c.name}</strong> <span className="muted">{c.race} {c.class} {c.level} — {ownerOf(c.id)}</span>
            </button>
          </li>
        ))}
        {pcs.length === 0 && <li className="muted">No player characters yet.</li>}
      </ul>

      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>NPCs</h3>
        <button className="link" onClick={newNpc}>+ New NPC</button>
      </div>
      <ul className="campaign-pc-list">
        {npcs.map((c) => (
          <li key={c.id}>
            <button className="link campaign-pc-row" onClick={() => openCharacter(c)}>
              {c.portrait_url && <img src={c.portrait_url} alt="" />}
              <strong>{c.name}</strong> <span className="muted">{c.race} {c.class} {c.level}</span>
              {c.lore_entry_name && <span className="pill">linked: {c.lore_entry_name}</span>}
            </button>
          </li>
        ))}
        {npcs.length === 0 && <li className="muted">No NPCs yet.</li>}
      </ul>

      {viewingChar && (
        <div className="campaign-character-sheet">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="link" onClick={() => setViewingChar(null)}>✕ Close sheet</button>
            {!linkedCharacterIds.has(viewingChar.id) && (
              <LoreLinkPicker character={viewingChar} onLinked={() => openCharacter(viewingChar)} />
            )}
          </div>
          <CharacterSheet key={viewingChar.id} character={viewingChar} patch={patchCharacter} />
        </div>
      )}
    </div>
  );
}
