import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";
import { useMusicPlayer } from "../lib/musicPlayer.jsx";

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

// A music/SFX track is either an uploaded audio file or a link (YouTube,
// Suno, a direct audio URL, ...). Playback itself lives in the shared
// MusicPlayerProvider (mounted once in GM.jsx, above the tab switch) so it
// survives navigating away from this tab — this just drives it. Links
// never autoplay: nothing plays until the GM presses Play here.
function TrackItem({ m, onToggleLoop, onDelete, onEditTags, onEditFolder, folders }) {
  const player = useMusicPlayer();
  const isCurrent = player.current?.id === m.id;
  const [tagInput, setTagInput] = useState(() => (m.tags || []).join(", "));
  const [folderInput, setFolderInput] = useState(m.folder || "");

  return (
    <div className={`media-item track-item${isCurrent ? " track-item-playing" : ""}`}>
      <div className="media-item-label" title={m.label || m.original_name || m.url}>{m.label || m.original_name || m.url}</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="icon-button" onClick={() => (isCurrent ? player.togglePlay() : player.play(m))}>
          {isCurrent && player.playing ? "⏸" : "▶"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{isCurrent && player.playing ? "Playing…" : isCurrent ? "Paused" : ""}</span>
      </div>

      <input
        className="track-folder-input"
        list="track-folders"
        placeholder="Folder (optional)"
        value={folderInput}
        onChange={(e) => setFolderInput(e.target.value)}
        onBlur={() => folderInput.trim() !== (m.folder || "") && onEditFolder(m, folderInput.trim())}
      />
      <datalist id="track-folders">
        {folders.map((f) => <option key={f} value={f} />)}
      </datalist>

      <input
        className="track-tags-input"
        placeholder="Tags, comma separated"
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onBlur={() => onEditTags(m, tagInput)}
      />
      {m.tags?.length > 0 && (
        <div className="tag-pills">
          {m.tags.map((t) => <span key={t} className="pill">{t}</span>)}
        </div>
      )}

      <div className="media-item-actions">
        <label className="checkbox-inline">
          <input type="checkbox" checked={!!m.loop} onChange={(e) => onToggleLoop(m, e.target.checked)} />
          Loop
        </label>
        <button className="link" onClick={() => onDelete(m.id)}>Delete</button>
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
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const { active, setFilterEnabled } = useActiveSession();
  const player = useMusicPlayer();

  const load = () => api(`/media?category=${category}`).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); setFolderFilter(""); setTagFilter(""); }, [category]);
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
    player.setLoop(track.id, loop);
    await api(`/media/${track.id}`, { method: "PATCH", body: { loop } });
  };

  const editTags = async (track, tagsCsv) => {
    const tags = [...new Set(tagsCsv.split(",").map((t) => t.trim()).filter(Boolean))];
    setItems((cur) => cur.map((it) => (it.id === track.id ? { ...it, tags } : it)));
    await api(`/media/${track.id}`, { method: "PATCH", body: { tags } });
  };

  const editFolder = async (track, folder) => {
    setItems((cur) => cur.map((it) => (it.id === track.id ? { ...it, folder } : it)));
    await api(`/media/${track.id}`, { method: "PATCH", body: { folder } });
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

  const sessionFilteredItems = filterToSession(items, active, "mediaIds");
  const folders = useMemo(() => [...new Set(items.map((m) => m.folder).filter(Boolean))].sort(), [items]);
  const allTags = useMemo(() => [...new Set(items.flatMap((m) => m.tags || []))].sort(), [items]);
  const visibleItems = sessionFilteredItems
    .filter((m) => !folderFilter || m.folder === folderFilter)
    .filter((m) => !tagFilter || (m.tags || []).includes(tagFilter));

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
        <>
          {(folders.length > 0 || allTags.length > 0) && (
            <div className="row track-filters">
              {folders.length > 0 && (
                <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
                  <option value="">All folders</option>
                  {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
              {allTags.map((t) => (
                <button
                  key={t}
                  className={`pill tag-filter-pill${tagFilter === t ? " active" : ""}`}
                  onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="media-grid track-grid">
            {visibleItems.length === 0 && <p className="muted">No {category} tracks {active?.filter_enabled ? "linked to this session" : "match these filters"}.</p>}
            {visibleItems.map((m) => (
              <TrackItem key={m.id} m={m} onToggleLoop={toggleLoop} onDelete={remove} onEditTags={editTags} onEditFolder={editFolder} folders={folders} />
            ))}
          </div>
        </>
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
