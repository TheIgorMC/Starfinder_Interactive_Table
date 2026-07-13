import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

const mod = (score) => Math.floor((score - 10) / 2);
const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

export default function Player() {
  const [chars, setChars] = useState([]);
  const [char, setChar] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", race: "", theme: "", class: "", level: 1 });

  const load = () => api("/characters").then(setChars);
  useEffect(() => { load(); }, []);

  useWs((msg) => {
    if (msg.type?.startsWith("character:")) {
      load();
      if (msg.type === "character:updated" && char?.id === msg.payload.id) setChar(msg.payload);
    }
  });

  const create = async () => {
    if (!draft.name) return;
    const c = await api("/characters", { method: "POST", body: draft });
    setCreating(false);
    setDraft({ name: "", race: "", theme: "", class: "", level: 1 });
    setChar(c);
    load();
  };

  const patch = (fields) =>
    api(`/characters/${char.id}`, { method: "PATCH", body: fields }).then(setChar);

  if (!char) {
    return (
      <div className="player">
        <h2>Characters</h2>
        <ul>
          {chars.map((c) => (
            <li key={c.id}>
              <button className="link" onClick={() => setChar(c)}>
                {c.name} — {c.race} {c.class} {c.level}
              </button>
            </li>
          ))}
        </ul>
        {creating ? (
          <div className="card">
            <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input placeholder="Race" value={draft.race} onChange={(e) => setDraft({ ...draft, race: e.target.value })} />
            <input placeholder="Theme" value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value })} />
            <input placeholder="Class" value={draft.class} onChange={(e) => setDraft({ ...draft, class: e.target.value })} />
            <input type="number" min="1" max="20" value={draft.level} onChange={(e) => setDraft({ ...draft, level: +e.target.value })} />
            <button onClick={create}>Create</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)}>+ New character</button>
        )}
      </div>
    );
  }

  const Pool = ({ label, cur, max, curKey }) => (
    <div className="pool">
      <span>{label}</span>
      <button onClick={() => patch({ [curKey]: Math.max(0, char[curKey] - 1) })}>−</button>
      <strong>{cur} / {max}</strong>
      <button onClick={() => patch({ [curKey]: Math.min(max, char[curKey] + 1) })}>+</button>
    </div>
  );

  return (
    <div className="player">
      <button className="link" onClick={() => setChar(null)}>← All characters</button>
      <h2>{char.name}</h2>
      <p className="muted">{char.race} {char.theme} {char.class} — level {char.level}</p>

      <section className="grid-6">
        {ABILITIES.map((a) => (
          <div key={a} className="stat">
            <label>{a.toUpperCase()}</label>
            <strong>{char[a]}</strong>
            <span>{fmt(mod(char[a]))}</span>
          </div>
        ))}
      </section>

      <section className="pools">
        <Pool label="SP" cur={char.sp_cur} max={char.sp_max} curKey="sp_cur" />
        <Pool label="HP" cur={char.hp_cur} max={char.hp_max} curKey="hp_cur" />
        <Pool label="RP" cur={char.rp_cur} max={char.rp_max} curKey="rp_cur" />
      </section>

      <section className="grid-6">
        <div className="stat"><label>EAC</label><strong>{char.eac}</strong></div>
        <div className="stat"><label>KAC</label><strong>{char.kac}</strong></div>
        <div className="stat"><label>BAB</label><strong>{fmt(char.bab)}</strong></div>
        <div className="stat"><label>Fort</label><strong>{fmt(char.save_fort)}</strong></div>
        <div className="stat"><label>Ref</label><strong>{fmt(char.save_ref)}</strong></div>
        <div className="stat"><label>Will</label><strong>{fmt(char.save_will)}</strong></div>
        <div className="stat"><label>Init</label><strong>{fmt(char.init_bonus)}</strong></div>
        <div className="stat"><label>Speed</label><strong>{char.speed} ft</strong></div>
      </section>
    </div>
  );
}
