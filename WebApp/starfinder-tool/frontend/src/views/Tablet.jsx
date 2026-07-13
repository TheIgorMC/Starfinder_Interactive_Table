import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

// GM tablet: mood board — scenario art, captions, featured characters.
// Driven entirely by the GM console via the scene module.
export default function Tablet() {
  const [channel, setChannel] = useState({ mode: "idle", mediaUrl: "", caption: "", characterIds: [] });
  const [mood, setMood] = useState({ color: "#202040", name: "" });
  const [featured, setFeatured] = useState([]);

  // Public, but deliberately scoped server-side to only the characters the
  // GM has chosen to feature, with only the fields this view shows — not
  // the full character list (that's GM-only, see /api/characters).
  const loadFeatured = () => api("/scene/tablet/characters").then(setFeatured);

  useEffect(() => {
    api("/scene/state").then((s) => { setChannel(s.tablet); setMood(s.mood); });
    loadFeatured();
  }, []);

  useWs((msg) => {
    if (msg.type === "scene:channel" && msg.payload.channel === "tablet") { setChannel(msg.payload.state); loadFeatured(); }
    if (msg.type === "scene:mood") setMood(msg.payload);
    if (msg.type?.startsWith("character:")) loadFeatured();
  });

  return (
    <div className="tablet-mood" style={{ "--mood": mood.color }}>
      {channel.mode === "idle" && (
        <div className="center">
          <h1>{mood.name || "Starfinder"}</h1>
        </div>
      )}

      {channel.mode === "media" && (
        <div className="center">
          {channel.mediaUrl && <img src={channel.mediaUrl} alt="" />}
          {channel.caption && <p className="caption">{channel.caption}</p>}
        </div>
      )}

      {channel.mode === "characters" && (
        <div className="char-strip">
          {featured.map((c) => (
            <div key={c.id} className="char-card">
              <h3>{c.name}</h3>
              <p className="muted">{c.race} {c.class} {c.level}</p>
              <p>HP {c.hp_cur}/{c.hp_max} · SP {c.sp_cur}/{c.sp_max} · RP {c.rp_cur}/{c.rp_max}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
