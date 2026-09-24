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

const FIELD_LABELS = { race: "Race", theme: "Theme", class: "Class", feats: "Feat", spells: "Spell", equipment: "Equipment" };

// Mirrors backend/src/hephaistos-match.js's own traversal of the raw
// Hephaistos export exactly — same fields, same order — so a correction
// keyed by "field::lowercased original name" lands on every occurrence of
// that name (a repeated feat, a spell known by two classes, a stack of the
// same item) rather than just the first one.
function applyCorrections(hephaistos, corrections) {
  const doc = JSON.parse(JSON.stringify(hephaistos));
  const pick = (field, name) => corrections[`${field}::${(name || "").toLowerCase()}`];

  if (doc.race?.name) doc.race.name = pick("race", doc.race.name) || doc.race.name;
  if (doc.theme?.name) doc.theme.name = pick("theme", doc.theme.name) || doc.theme.name;
  for (const c of doc.classes ?? []) {
    if (c?.name) c.name = pick("class", c.name) || c.name;
  }
  if (Array.isArray(doc.feats?.acquiredFeats)) {
    doc.feats.acquiredFeats = doc.feats.acquiredFeats.map((f) => {
      const name = typeof f === "string" ? f : f?.name;
      const corrected = pick("feats", name);
      if (!corrected) return f;
      return typeof f === "string" ? corrected : { ...f, name: corrected };
    });
  }
  const renameSpell = (s) => {
    const name = typeof s === "string" ? s : s?.name;
    const corrected = pick("spells", name);
    if (!corrected) return s;
    return typeof s === "string" ? corrected : { ...s, name: corrected };
  };
  for (const c of doc.classes ?? []) {
    if (Array.isArray(c.spells)) c.spells = c.spells.map(renameSpell);
  }
  if (Array.isArray(doc.additionalSpells)) doc.additionalSpells = doc.additionalSpells.map(renameSpell);
  for (const it of doc.inventory ?? []) {
    if (it?.name) it.name = pick("equipment", it.name) || it.name;
  }
  return doc;
}

function MatchReview({ items, corrections, setCorrections }) {
  const setChoice = (field, name, value) => {
    const key = `${field}::${name.toLowerCase()}`;
    setCorrections((cur) => {
      const next = { ...cur };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  };

  const needsAttention = items.filter((it) => !it.exact);
  const confirmed = items.filter((it) => it.exact);

  return (
    <div className="hephaistos-review">
      <p className="muted">
        {confirmed.length} matched the compendium exactly.
        {needsAttention.length > 0 && ` ${needsAttention.length} need a look — pick the right entry, or leave as typed.`}
      </p>
      {needsAttention.length > 0 && (
        <ul className="hephaistos-match-list">
          {needsAttention.map((it) => {
            const key = `${it.field}::${it.name.toLowerCase()}`;
            const top = it.candidates[0];
            return (
              <li key={key} className="hephaistos-match-row">
                <span className="pill">{FIELD_LABELS[it.field] || it.field}</span>
                <span className="hephaistos-match-name">{it.name}</span>
                {it.candidates.length > 0 ? (
                  <select value={corrections[key] || ""} onChange={(e) => setChoice(it.field, it.name, e.target.value)}>
                    <option value="">Keep as typed: "{it.name}"</option>
                    {it.candidates.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}{c === top ? " (best match)" : ""} — {Math.round(c.score * 100)}% · {c.source}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="pill bad">no compendium match found</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HephaistosImport({ onImported }) {
  const [raw, setRaw] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [corrections, setCorrections] = useState({});

  useEffect(() => { api("/auth/users").then(setPlayers).catch(() => setPlayers([])); }, []);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((text) => { setRaw(text); setPreview(null); setCorrections({}); });
  };

  const review = async () => {
    setBusy(true);
    setError("");
    try {
      const hephaistos = JSON.parse(raw);
      const { items } = await api("/characters/import/hephaistos/preview", { method: "POST", body: { hephaistos } });
      setPreview(items);
      setCorrections({});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError("");
    try {
      const hephaistos = applyCorrections(JSON.parse(raw), corrections);
      await api("/characters/import/hephaistos", {
        method: "POST",
        body: { hephaistos, assignToUsername: assignTo || undefined },
      });
      setRaw("");
      setAssignTo("");
      setPreview(null);
      setCorrections({});
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
        {!preview ? (
          <button onClick={review} disabled={!raw || busy}>{busy ? "Checking…" : "Review matches"}</button>
        ) : (
          <>
            <button onClick={doImport} disabled={busy}>{busy ? "Importing…" : "Confirm & import"}</button>
            <button className="link" onClick={() => { setPreview(null); setCorrections({}); }}>✕ Back</button>
          </>
        )}
      </div>
      {error && <p className="pill bad">{error}</p>}
      {!preview && (
        <textarea
          rows={4} placeholder="…or paste the exported Hephaistos JSON here"
          value={raw} onChange={(e) => { setRaw(e.target.value); setPreview(null); }}
        />
      )}
      {preview && <MatchReview items={preview} corrections={corrections} setCorrections={setCorrections} />}
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

// Lets the GM fix a character filed under the wrong section — a PC that
// should be an NPC (a retired/dead PC, a one-off the GM statted for a
// player who never claimed it) or an NPC that should be a PC (missed
// during a Hephaistos import, or handed to a new player). Switching is just
// moving which player account's users.character_id points here.
function OwnerPicker({ character, owner, players, onChanged }) {
  const [assignTo, setAssignTo] = useState("");

  const assign = async () => {
    if (!assignTo) return;
    const target = players.find((p) => p.username === assignTo);
    if (target?.character_id != null && target.character_id !== character.id) {
      if (!confirm(`${assignTo} already has a character. Replace it with ${character.name}?`)) return;
    }
    await api(`/auth/users/${assignTo}/character`, { method: "PATCH", body: { character_id: character.id } });
    setAssignTo("");
    onChanged();
  };

  const unassign = async () => {
    await api(`/auth/users/${owner.username}/character`, { method: "PATCH", body: { character_id: null } });
    onChanged();
  };

  if (owner) {
    return (
      <p className="muted">
        Player character — owned by <strong>{owner.username}</strong>{" "}
        <button className="link" onClick={unassign}>make NPC</button>
      </p>
    );
  }

  return (
    <div className="row" style={{ alignItems: "center" }}>
      <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
        <option value="">Make PC — assign to player…</option>
        {players.map((p) => (
          <option key={p.username} value={p.username}>
            {p.username}{p.character_id != null ? " (already has a character)" : ""}
          </option>
        ))}
      </select>
      <button onClick={assign} disabled={!assignTo}>Assign</button>
    </div>
  );
}

export default function Characters({ focusCharacterId, onFocusHandled, onOpenCampaignEntry }) {
  const [characters, setCharacters] = useState([]);
  const [players, setPlayers] = useState([]);
  const [viewingChar, setViewingChar] = useState(null);
  const [showPcImport, setShowPcImport] = useState(false);

  const loadCharacters = () => api("/characters").then(setCharacters);
  const loadPlayers = () => api("/auth/users").then(setPlayers).catch(() => setPlayers([]));
  useEffect(() => { loadCharacters(); loadPlayers(); }, []);
  const reload = () => { loadCharacters(); loadPlayers(); };

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

  // Not every NPC needs a statblock — most never fight. This skips the
  // characters table entirely and creates a lore-only People entry
  // instead (campaign_entries type='npc', same as Campaign's own "+ New
  // People"), then jumps over to it so the GM can start writing it up
  // right away instead of hunting for it in the Campaign tab afterward.
  const newPassiveNpc = async () => {
    const e = await api("/campaign", { method: "POST", body: { type: "npc", name: "New NPC" } });
    onOpenCampaignEntry?.(e.id);
  };

  const linkedCharacterIds = new Set(players.filter((p) => p.character_id != null).map((p) => p.character_id));
  const pcs = characters.filter((c) => linkedCharacterIds.has(c.id));
  const npcs = characters.filter((c) => !linkedCharacterIds.has(c.id));
  const ownerOf = (id) => players.find((p) => p.character_id === id);

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
              <strong>{c.name}</strong> <span className="muted">{c.race} {c.class} {c.level} — {ownerOf(c.id)?.username}</span>
            </button>
          </li>
        ))}
        {pcs.length === 0 && <li className="muted">No player characters yet.</li>}
      </ul>

      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>NPCs</h3>
        <span className="row" style={{ gap: 14 }}>
          <button className="link" onClick={newNpc} title="Creates a full stat sheet — HP, abilities, etc.">+ New NPC (statted)</button>
          <button className="link" onClick={newPassiveNpc} title="Creates a lore-only People entry, no statblock">+ New passive NPC…</button>
        </span>
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
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <button className="link" onClick={() => setViewingChar(null)}>✕ Close sheet</button>
            <OwnerPicker
              character={viewingChar}
              owner={ownerOf(viewingChar.id)}
              players={players}
              onChanged={() => { reload(); openCharacter(viewingChar); }}
            />
            <LoreLinkPicker character={viewingChar} onLinked={() => openCharacter(viewingChar)} />
            {!linkedCharacterIds.has(viewingChar.id) && (
              <button
                className="link"
                onClick={async () => {
                  if (!window.confirm(`Delete "${viewingChar.name}"? This can't be undone.`)) return;
                  await api(`/characters/${viewingChar.id}`, { method: "DELETE" });
                  setViewingChar(null);
                  reload();
                }}
              >
                Delete NPC
              </button>
            )}
          </div>
          <CharacterSheet key={viewingChar.id} character={viewingChar} patch={patchCharacter} />
        </div>
      )}
    </div>
  );
}
