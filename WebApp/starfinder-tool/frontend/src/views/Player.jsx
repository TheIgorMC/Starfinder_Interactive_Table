import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";
import { useAuth } from "../auth.jsx";
import CharacterSheet from "../components/CharacterSheet.jsx";

export default function Player() {
  const { user, logout, refresh } = useAuth();
  const [char, setChar] = useState(null);
  const [draft, setDraft] = useState({ name: "", race: "", theme: "", class: "", level: 1 });

  const load = () => {
    if (user?.characterId) api(`/characters/${user.characterId}`).then(setChar);
  };
  useEffect(() => { load(); }, [user?.characterId]);

  useWs((msg) => {
    if (msg.type === "character:updated" && msg.payload.id === user?.characterId) load();
  });

  const create = async () => {
    if (!draft.name) return;
    const c = await api("/characters", { method: "POST", body: draft });
    setChar(c);
    await refresh(); // picks up the newly-linked characterId
  };

  const patch = (fields) =>
    api(`/characters/${char.id}`, { method: "PATCH", body: fields }).then(setChar);

  // Player account not linked to a character yet — self-service creation.
  if (!user?.characterId) {
    return (
      <div className="player">
        <h2>Create your character</h2>
        <div className="card">
          <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input placeholder="Race" value={draft.race} onChange={(e) => setDraft({ ...draft, race: e.target.value })} />
          <input placeholder="Theme" value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value })} />
          <input placeholder="Class" value={draft.class} onChange={(e) => setDraft({ ...draft, class: e.target.value })} />
          <input type="number" min="1" max="20" value={draft.level} onChange={(e) => setDraft({ ...draft, level: +e.target.value })} />
          <button onClick={create} disabled={!draft.name}>Create</button>
        </div>
      </div>
    );
  }

  if (!char) return <div className="player">Loading…</div>;

  return (
    <div className="player">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted">{user.username}</span>
        <button className="link" onClick={logout}>Sign out</button>
      </div>
      <CharacterSheet character={char} patch={patch} />
    </div>
  );
}
