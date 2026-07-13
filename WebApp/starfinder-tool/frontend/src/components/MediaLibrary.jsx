import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const CATEGORIES = [
  { key: "map", label: "Maps" },
  { key: "mood", label: "Mood screens" },
  { key: "token", label: "Tokens" },
  { key: "portrait", label: "Portraits" },
];

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

export default function MediaLibrary() {
  const [category, setCategory] = useState("map");
  const [items, setItems] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);

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

  const copyUrl = (url) => {
    navigator.clipboard?.writeText(location.origin + url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const attachPortrait = async (characterId, url) => {
    await api(`/characters/${characterId}`, { method: "PATCH", body: { portrait_url: url } });
    setCharacters((cur) => cur.map((c) => (c.id === Number(characterId) ? { ...c, portrait_url: url } : c)));
  };

  return (
    <div className="media-library">
      <div className="tab-row">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={category === c.key ? "active" : ""} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="media-upload row">
        <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 220 }} />
        <label className="button-like">
          {busy ? "Uploading…" : "Upload image"}
          <input type="file" accept="image/*" onChange={onFile} disabled={busy} hidden />
        </label>
        {error && <span className="pill bad">{error}</span>}
      </div>

      <div className="media-grid">
        {items.length === 0 && <p className="muted">No {category} images yet.</p>}
        {items.map((m) => (
          <div key={m.id} className="media-item">
            <img src={m.url} alt={m.label || m.original_name} />
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
    </div>
  );
}
