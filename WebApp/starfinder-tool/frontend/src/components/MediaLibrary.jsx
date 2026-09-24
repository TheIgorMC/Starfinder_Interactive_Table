import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";
import { useMusicPlayer } from "../lib/musicPlayer.jsx";
import { youtubeId } from "../lib/youtube.js";

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

// "kaeth_vor_final_v2.png" vs character name "Kaeth Vor" — strip the
// extension/punctuation/versioning noise a real batch of portrait exports
// always carries, then score by how much of one normalized string the
// other covers (word-overlap), not just exact equality. Good enough for
// "propose a match, let the GM confirm/correct it" — never auto-applies
// anything on its own.
function normalizeForMatch(s) {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function nameMatchScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const wa = new Set(a.split(" ")), wb = new Set(b.split(" "));
  const overlap = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? overlap / union : 0;
}
// A portrait might belong to a statted character (PC or NPC, in the
// `characters` table — gets portrait_url, the tablet's own art) just as
// easily as a lore-only "People" wiki entry that never got a statblock
// (campaign_entries type='npc' — gets image_id, the Campaign reader's
// picture). Both are fair targets, so both are candidates.
function bestTargetMatch(filename, candidates) {
  const norm = normalizeForMatch(filename);
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const score = nameMatchScore(norm, normalizeForMatch(c.name));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.3 ? best : null;
}

// Upload many portrait files at once, then propose a match per file from
// its filename, against characters AND lore-only People entries alike —
// a GM correction/skip is one dropdown away rather than a whole separate
// upload-then-attach round trip per image.
function BulkPortraitImport({ characters, onDone }) {
  const [busy, setBusy] = useState(false);
  const [loreEntries, setLoreEntries] = useState([]);
  const [proposals, setProposals] = useState(null);
  const [error, setError] = useState("");

  const candidates = useMemo(() => [
    ...characters.map((c) => ({ key: `character:${c.id}`, kind: "character", id: c.id, name: c.name })),
    ...loreEntries.map((e) => ({ key: `lore:${e.id}`, kind: "lore", id: e.id, name: e.name })),
  ], [characters, loreEntries]);

  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const lore = await api("/campaign?type=npc").catch(() => []);
      setLoreEntries(lore);
      const allCandidates = [
        ...characters.map((c) => ({ key: `character:${c.id}`, kind: "character", id: c.id, name: c.name })),
        ...lore.map((e) => ({ key: `lore:${e.id}`, kind: "lore", id: e.id, name: e.name })),
      ];
      const uploaded = [];
      for (const file of files) uploaded.push(await upload("portrait", file, ""));
      setProposals(uploaded.map((media) => ({ media, targetKey: bestTargetMatch(media.original_name, allCandidates)?.key || "" })));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await Promise.all(
        proposals.filter((p) => p.targetKey).map((p) => {
          const target = candidates.find((c) => c.key === p.targetKey);
          if (!target) return null;
          return target.kind === "character"
            ? api(`/characters/${target.id}`, { method: "PATCH", body: { portrait_url: p.media.url } })
            : api(`/campaign/${target.id}`, { method: "PATCH", body: { image_id: p.media.id } });
        })
      );
      setProposals(null);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (!proposals) {
    return (
      <div className="row" style={{ alignItems: "center" }}>
        <label className="button-like">
          {busy ? "Uploading…" : "Bulk import & match…"}
          <input type="file" accept="image/*" multiple onChange={onFiles} disabled={busy} hidden />
        </label>
        {error && <span className="pill bad">{error}</span>}
      </div>
    );
  }

  return (
    <div className="bulk-portrait-review">
      <h4>Match each upload to a character or a People entry</h4>
      <ul className="sheet-list">
        {proposals.map((p, i) => (
          <li key={p.media.id} className="row" style={{ alignItems: "center", gap: 10 }}>
            <img src={p.media.url} alt="" className="bulk-portrait-thumb" />
            <span className="muted" style={{ minWidth: 180 }}>{p.media.original_name}</span>
            <select
              value={p.targetKey}
              onChange={(e) => setProposals((cur) => cur.map((x, j) => (j === i ? { ...x, targetKey: e.target.value } : x)))}
            >
              <option value="">— skip —</option>
              {characters.length > 0 && (
                <optgroup label="Characters (statted — tablet portrait)">
                  {characters.map((c) => <option key={`character:${c.id}`} value={`character:${c.id}`}>{c.name}</option>)}
                </optgroup>
              )}
              {loreEntries.length > 0 && (
                <optgroup label="People (lore only — Campaign image)">
                  {loreEntries.map((e) => <option key={`lore:${e.id}`} value={`lore:${e.id}`}>{e.name}</option>)}
                </optgroup>
              )}
            </select>
          </li>
        ))}
      </ul>
      <div className="row">
        <button onClick={apply} disabled={busy}>Apply</button>
        <button className="link" onClick={() => setProposals(null)} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

const UNFILED = "\0unfiled";

const formatDuration = (secs) => {
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

// Reads a track's length client-side (an <audio preload="metadata"> reads
// just the header, not the whole file) instead of anything server-side —
// no ffprobe/transcoding step needed for an uploaded file or a direct
// audio URL. Not attempted for a YouTube link: an <audio> element can't
// play a video page URL at all, and the (already-integrated) YouTube
// IFrame Player API only exposes getDuration() once that video is loaded
// into the shared player, not for every row in a list up front.
function useTrackDuration(m) {
  const [duration, setDuration] = useState(null);
  useEffect(() => {
    setDuration(null);
    if (!m.url || (!m.filename && youtubeId(m.url))) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.src = m.url;
    return () => { audio.removeAttribute("src"); audio.load(); };
  }, [m.url, m.filename]);
  return duration;
}

// One compact row per track — with "decine o centinaia" of them, the old
// card grid (one ~260px box per track) was the wrong shape entirely.
// Playback lives in the shared MusicPlayerProvider (mounted once in
// GM.jsx, above the tab switch) so it survives navigating away from this
// tab — this just drives it. Draggable (by track id) so it can be dropped
// on a folder in the sidebar; its tag zone accepts a dropped tag chip
// (dragged from the bar above the list) as a faster alternative to the
// "+" input.
function TrackRow({ m, onToggleLoop, onDelete, onAddTag, onRemoveTag, onEditFolder, folders }) {
  const player = useMusicPlayer();
  const isCurrent = player.current?.id === m.id;
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const duration = useTrackDuration(m);

  const commitTag = () => {
    if (newTag.trim()) onAddTag(m, newTag.trim());
    setNewTag("");
    setAddingTag(false);
  };

  return (
    <div
      className={`track-row${isCurrent ? " track-row-playing" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("application/x-track-id", String(m.id))}
    >
      <button className="icon-button track-row-play" onClick={() => (isCurrent ? player.togglePlay() : player.play(m))}>
        {isCurrent && player.playing ? "⏸" : "▶"}
      </button>
      <span className="track-row-label" title={m.label || m.original_name || m.url}>{m.label || m.original_name || m.url}</span>
      {duration != null && <span className="track-row-duration muted">{formatDuration(duration)}</span>}

      <select
        className="track-row-folder"
        value={m.folder || ""}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            const name = window.prompt("New folder name:");
            if (name?.trim()) onEditFolder(m, name.trim());
          } else onEditFolder(m, e.target.value);
        }}
      >
        <option value="">— no folder —</option>
        {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        <option value="__new__">+ New folder…</option>
      </select>

      <div
        className="track-row-tags"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { const t = e.dataTransfer.getData("application/x-tag"); if (t) onAddTag(m, t); }}
      >
        {(m.tags || []).map((t) => (
          <span key={t} className="pill track-tag-pill">
            {t}<button className="tag-remove" onClick={() => onRemoveTag(m, t)}>×</button>
          </span>
        ))}
        {addingTag ? (
          <input
            autoFocus
            className="track-tag-add-input"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitTag(); if (e.key === "Escape") { setNewTag(""); setAddingTag(false); } }}
            onBlur={commitTag}
          />
        ) : (
          <button className="track-tag-add-btn" title="Add tag" onClick={() => setAddingTag(true)}>+</button>
        )}
      </div>

      <button className={`icon-button track-row-loop${m.loop ? " active" : ""}`} title="Loop" onClick={() => onToggleLoop(m, !m.loop)}>🔁</button>
      <button className="icon-button" title="Delete" onClick={() => onDelete(m.id)}>🗑</button>
    </div>
  );
}

// File-explorer-style folder list: click to filter, drag a track row onto
// a folder to move it there (faster than the per-row dropdown for bulk
// sorting). Folders are just a string on each track (see migrations/018)
// — there's no "create an empty folder" action, only "assign this name to
// a track", so the "+ New folder…" entry is a drop target + a hint, not a
// standalone create button.
function FolderSidebar({ folders, folderFilter, setFolderFilter, counts, onDropTrack }) {
  const dropOn = (folder) => ({
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      const id = e.dataTransfer.getData("application/x-track-id");
      if (id) onDropTrack(Number(id), folder);
    },
  });
  return (
    <div className="track-folder-sidebar">
      <button className={`track-folder-row${!folderFilter ? " active" : ""}`} onClick={() => setFolderFilter("")}>
        All tracks <span className="muted">{counts.all}</span>
      </button>
      <button
        className={`track-folder-row${folderFilter === UNFILED ? " active" : ""}`}
        onClick={() => setFolderFilter(UNFILED)}
        {...dropOn("")}
      >
        Unfiled <span className="muted">{counts.unfiled}</span>
      </button>
      {folders.map((f) => (
        <button
          key={f}
          className={`track-folder-row${folderFilter === f ? " active" : ""}`}
          onClick={() => setFolderFilter(f)}
          {...dropOn(f)}
        >
          📁 {f} <span className="muted">{counts[f] || 0}</span>
        </button>
      ))}
      <div
        className="track-folder-row track-folder-new"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("application/x-track-id");
          if (!id) return;
          const name = window.prompt("New folder name:");
          if (name?.trim()) onDropTrack(Number(id), name.trim());
        }}
      >
        Drag here for a new folder…
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
  const loadCharacters = () => api("/characters").then(setCharacters).catch(() => {});
  useEffect(() => { load(); setFolderFilter(""); setTagFilter(""); }, [category]);
  useEffect(() => { if (category === "portrait") loadCharacters(); }, [category]);

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

  const addTag = async (track, tag) => {
    const current = items.find((it) => it.id === track.id)?.tags || [];
    if (current.includes(tag)) return;
    const tags = [...current, tag];
    setItems((cur) => cur.map((it) => (it.id === track.id ? { ...it, tags } : it)));
    await api(`/media/${track.id}`, { method: "PATCH", body: { tags } });
  };

  const removeTag = async (track, tag) => {
    const tags = (items.find((it) => it.id === track.id)?.tags || []).filter((t) => t !== tag);
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
  const folderCounts = useMemo(() => {
    const c = { all: items.length, unfiled: 0 };
    for (const m of items) {
      if (!m.folder) c.unfiled++;
      else c[m.folder] = (c[m.folder] || 0) + 1;
    }
    return c;
  }, [items]);
  const visibleItems = sessionFilteredItems
    .filter((m) => !folderFilter || (folderFilter === UNFILED ? !m.folder : m.folder === folderFilter))
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

      {category === "portrait" && (
        <BulkPortraitImport characters={characters} onDone={() => { load(); loadCharacters(); }} />
      )}

      {AUDIO_CATEGORIES.has(category) ? (
        <div className="track-explorer">
          <FolderSidebar
            folders={folders}
            folderFilter={folderFilter}
            setFolderFilter={setFolderFilter}
            counts={folderCounts}
            onDropTrack={(id, folder) => editFolder({ id }, folder)}
          />
          <div className="track-main">
            {allTags.length > 0 && (
              <div className="tag-chip-bar">
                {allTags.map((t) => (
                  <span
                    key={t}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/x-tag", t)}
                    className={`pill tag-filter-pill${tagFilter === t ? " active" : ""}`}
                    onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                    title="Click to filter, or drag onto a track to tag it"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="track-list">
              {visibleItems.length === 0 && <p className="muted">No {category} tracks {active?.filter_enabled ? "linked to this session" : "match these filters"}.</p>}
              {visibleItems.map((m) => (
                <TrackRow key={m.id} m={m} onToggleLoop={toggleLoop} onDelete={remove} onAddTag={addTag} onRemoveTag={removeTag} onEditFolder={editFolder} folders={folders} />
              ))}
            </div>
          </div>
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
