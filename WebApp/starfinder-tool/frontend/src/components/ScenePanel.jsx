import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";

const MOOD_PRESETS = [
  { name: "Neutral", color: "#202040", brightness: 128, effect: "static" },
  { name: "Combat", color: "#801515", brightness: 200, effect: "pulse" },
  { name: "Derelict", color: "#153a2a", brightness: 60, effect: "flicker" },
  { name: "Storm", color: "#2a2a80", brightness: 160, effect: "storm" },
];
const MEDIA_CATEGORIES = [
  { key: "mood", label: "Mood screens" },
  { key: "map", label: "Maps" },
  { key: "portrait", label: "Portraits" },
  { key: "token", label: "Tokens" },
];

export default function ScenePanel({ session, characters }) {
  const [scene, setScene] = useState(null);
  const [mediaCategory, setMediaCategory] = useState("mood");
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const { active } = useActiveSession();

  useEffect(() => { api("/scene/state").then(setScene); }, []);
  useWs((msg) => {
    if (msg.type === "scene:channel" || msg.type === "scene:mood") api("/scene/state").then(setScene);
  });
  // Pick media by name, not by pasting a URL — the media library already
  // has both, this just picks from it instead of asking the GM to copy one
  // over manually (see MediaLibrary.jsx's "Copy URL" button, which this
  // used to require).
  useEffect(() => {
    api(`/media?category=${mediaCategory}`).then(setMediaItems).catch(() => setMediaItems([]));
  }, [mediaCategory]);
  const pickableMedia = filterToSession(mediaItems, active, "mediaIds");

  if (!scene) return null;

  const setChannel = (name, body) => api(`/scene/channel/${name}`, { method: "POST", body });
  const setMood = (body) => api("/scene/mood", { method: "POST", body });

  const toggleFeatured = (id) => {
    const cur = scene.tablet.characterIds || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setChannel("tablet", { mode: "characters", characterIds: next });
  };

  return (
    <div className="scene-panel">
      <h3>Projector</h3>
      <div className="row">
        <button
          className={scene.projector.mode === "battlemap" ? "active" : ""}
          onClick={() => setChannel("projector", { mode: "battlemap", sessionId: session?.id ?? null })}
        >Battle map</button>
        <button
          className={scene.projector.mode === "scenic" ? "active" : ""}
          onClick={() => setChannel("projector", { mode: "scenic", mediaUrl, caption })}
        >Scenic</button>
      </div>
      <div className="row">
        <select value={mediaCategory} onChange={(e) => { setMediaCategory(e.target.value); setMediaUrl(""); }}>
          {MEDIA_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)}>
          <option value="">Pick an image…</option>
          {pickableMedia.map((m) => <option key={m.id} value={m.url}>{m.label || m.original_name}</option>)}
        </select>
      </div>
      {active?.status === "active" && active.filter_enabled && pickableMedia.length < mediaItems.length && (
        <p className="muted">Filtered to "{active.name}" — {mediaItems.length - pickableMedia.length} more {mediaCategory} image(s) hidden.</p>
      )}
      <input placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
      <button onClick={() => setChannel("projector", { mediaUrl, caption })} disabled={!mediaUrl}>Push to projector</button>
      <button onClick={() => setChannel("tablet", { mode: "media", mediaUrl, caption })} disabled={!mediaUrl}>Push to tablet</button>

      <h3>Tablet — featured characters</h3>
      <div className="chips">
        {characters.map((c) => (
          <button
            key={c.id}
            className={scene.tablet.characterIds?.includes(c.id) ? "chip active" : "chip"}
            onClick={() => toggleFeatured(c.id)}
          >{c.name}</button>
        ))}
      </div>

      <h3>Mood / lights</h3>
      <div className="chips">
        {MOOD_PRESETS.map((m) => (
          <button
            key={m.name}
            className={scene.mood.name === m.name ? "chip active" : "chip"}
            onClick={() => setMood({ ...m })}
          >{m.name}</button>
        ))}
      </div>
      <div className="row">
        <input
          type="color"
          value={scene.mood.color}
          onChange={(e) => setMood({ color: e.target.value, name: "" })}
        />
        <input
          type="range" min="0" max="255"
          value={scene.mood.brightness}
          onChange={(e) => setMood({ brightness: +e.target.value })}
        />
      </div>
      <p className="muted">
        Light nodes: {scene.lightNodes.length
          ? scene.lightNodes.map((n) => n.name).join(", ")
          : "none registered"}
      </p>
    </div>
  );
}
