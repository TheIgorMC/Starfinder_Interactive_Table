import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";

const CATEGORIES = [
  { key: "map", label: "Maps" },
  { key: "mood", label: "Mood screens" },
  { key: "token", label: "Tokens" },
  { key: "portrait", label: "Portraits" },
  { key: "music", label: "Music" },
  { key: "sfx", label: "SFX" },
];
const AUDIO_CATEGORIES = new Set(["music", "sfx"]);

// Raw fetch, not the api() helper — that one always JSON-encodes the body,
// which doesn't work for multipart file uploads.
async function upload(category, file, label) {
  const form = new FormData();
  form.append("file", file);
  if (label) form.append("label", label);
  const res = await fetch(`/api/media/${category}`, { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const isVideo = (m) => /\.(mp4|webm|mov|m4v)$/i.test(m.filename || m.url || "");

function youtubeId(url) {
  const m = /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/.exec(url || "");
  return m ? m[1] : null;
}

// A music/SFX track is either an uploaded audio file (plain <audio>) or a
// link (YouTube, Suno, a direct audio URL, ...). Links never autoplay and
// never chain into "up next" — a YouTube embed only avoids that entirely
// once looping is on (loop=1&playlist=<id> replays the same video instead
// of ending into suggestions); with looping off the GM presses play by hand
// and nothing queues automatically either way.
function TrackItem({ m, onToggleLoop, onDelete }) {
  const ytId = m.url && !m.filename ? youtubeId(m.url) : null;
  return (
    <div className="media-item track-item">
      <div className="media-item-label" title={m.label || m.original_name || m.url}>{m.label || m.original_name || m.url}</div>
      {ytId ? (
        <iframe
          key={`${ytId}-${m.loop}`}
          className="track-embed"
          src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1${m.loop ? `&loop=1&playlist=${ytId}` : ""}`}
          title={m.label || ytId}
          allow="autoplay; encrypted-media"
          frameBorder="0"
        />
      ) : (
        <audio src={m.url} controls loop={m.loop} preload="none" />
      )}
      <div className="media-item-actions">
        <label className="checkbox-inline">
          <input type="checkbox" checked={!!m.loop} onChange={(e) => onToggleLoop(m, e.target.checked)} />
          Loop
        </label>
        <span className="row" style={{ gap: 10 }}>
          {m.source_url && <a className="link" href={m.source_url} target="_blank" rel="noreferrer">Source</a>}
          <button className="link" onClick={() => onDelete(m.id)}>Delete</button>
        </span>
      </div>
    </div>
  );
}

export default function MediaLibrary() {
  const [category, setCategory] = useState("map");
  const [items, setItems] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [label, setLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);
  const { active, setFilterEnabled } = useActiveSession();

  const load = () => api(`/media?category=${category}`).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, [category]);
  useEffect(() => { if (category === "portrait") api("/characters").then(setCharacters).catch(() => {}); }, [category]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await upload(category, file, label);
      setLabel("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    await api(`/media/${id}`, { method: "DELETE" });
    load();
  };

  const addLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setBusy(true);
    setError("");
    try {
      await api(`/media/${category}/link`, { method: "POST", body: { url, label } });
      setLabel("");
      setLinkUrl("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleLoop = async (track, loop) => {
    setItems((cur) => cur.map((it) => (it.id === track.id ? { ...it, loop } : it)));
    await api(`/media/${track.id}`, { method: "PATCH", body: { loop } });
  };

  const copyUrl = (url) => {
    navigator.clipboard?.writeText(location.origin + url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const attachPortrait = async (characterId, url) => {
    await api(`/characters/${characterId}`, { method: "PATCH", body: { portrait_url: url } });
    setCharacters((cur) => cur.map((c) => (c.id === Number(characterId) ? { ...c, portrait_url: url } : c)));
  };

  const visibleItems = filterToSession(items, active, "mediaIds");

  return (
    <div className="media-library">
      <div className="tab-row">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={category === c.key ? "active" : ""} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {active?.status === "active" && (
        <label className="checkbox-inline" style={{ marginBottom: 12 }} title={`Session: ${active.name}`}>
          <input type="checkbox" checked={active.filter_enabled} onChange={(e) => setFilterEnabled(e.target.checked)} />
          Filter to "{active.name}" ({visibleItems.length}/{items.length} shown)
        </label>
      )}

      <div className="media-upload row">
        <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 220 }} />
        <label className="button-like">
          {busy ? "Uploading…" : AUDIO_CATEGORIES.has(category) ? "Upload audio" : "Upload image or video"}
          <input type="file" accept={AUDIO_CATEGORIES.has(category) ? "audio/*" : "image/*,video/*"} onChange={onFile} disabled={busy} hidden />
        </label>
        {AUDIO_CATEGORIES.has(category) && (
          <>
            <input
              placeholder="Or paste a YouTube / Suno / audio link…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <button onClick={addLink} disabled={busy || !linkUrl.trim()}>Add link</button>
          </>
        )}
        {error && <span className="pill bad">{error}</span>}
      </div>

      {AUDIO_CATEGORIES.has(category) ? (
        <div className="media-grid track-grid">
          {visibleItems.length === 0 && <p className="muted">No {category} tracks {active?.filter_enabled ? "linked to this session" : "yet"}.</p>}
          {visibleItems.map((m) => (
            <TrackItem key={m.id} m={m} onToggleLoop={toggleLoop} onDelete={remove} />
          ))}
        </div>
      ) : (
        <div className="media-grid">
          {visibleItems.length === 0 && <p className="muted">No {category} images {active?.filter_enabled ? "linked to this session" : "yet"}.</p>}
          {visibleItems.map((m) => (
            <div key={m.id} className="media-item">
              {isVideo(m) ? (
                <video src={m.url} muted loop autoPlay playsInline />
              ) : (
                <img src={m.url} alt={m.label || m.original_name} />
              )}
              <div className="media-item-label">{m.label || m.original_name}</div>
              <div className="media-item-actions">
                <button className="link" onClick={() => copyUrl(m.url)}>{copied === m.url ? "Copied!" : "Copy URL"}</button>
                <button className="link" onClick={() => remove(m.id)}>Delete</button>
              </div>
              {category === "portrait" && (
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && attachPortrait(e.target.value, m.url)}
                >
                  <option value="" disabled>Attach to character…</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.portrait_url === m.url ? " ✓" : ""}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
