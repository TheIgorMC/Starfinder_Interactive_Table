import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";
import { useAuth } from "../auth.jsx";
import CharacterSheet from "../components/CharacterSheet.jsx";
import CharacterCreationWizard from "../components/CharacterCreationWizard.jsx";

export default function Player() {
  const { user, logout, refresh } = useAuth();
  const [char, setChar] = useState(null);

  const load = () => {
    if (user?.characterId) api(`/characters/${user.characterId}`).then(setChar);
  };
  useEffect(() => { load(); }, [user?.characterId]);

  useWs((msg) => {
    if (msg.type === "character:updated" && msg.payload.id === user?.characterId) load();
  });

  const patch = (fields) =>
    api(`/characters/${char.id}`, { method: "PATCH", body: fields }).then(setChar);

  // Player account not linked to a character yet — self-service creation via
  // the guided wizard (see docs/09-character-creation-flow.md).
  if (!user?.characterId) {
    return (
      <div className="player">
        <h2>Create your character</h2>
        <CharacterCreationWizard onCreated={async (c) => { setChar(c); await refresh(); }} />
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
