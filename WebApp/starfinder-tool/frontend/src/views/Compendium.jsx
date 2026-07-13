import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

// Skip fields already shown elsewhere (name/category/source/url) when
// rendering the rest of an entry's `data` blob generically.
const HIDDEN_DATA_FIELDS = new Set(["sourceUrl", "sourcePage"]);

function fieldLabel(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export default function Compendium() {
  const [categories, setCategories] = useState([]);
  const [sources, setSources] = useState([]);
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/aon/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setSource("");
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    api(`/aon/sources${qs}`).then(setSources).catch(() => setSources([]));
  }, [category]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (source) params.set("source", source);
    if (q) params.set("q", q);

    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api(`/aon?${params}`)
        .then((rows) => { setResults(rows); setLoading(false); })
        .catch((e) => { setError(e.message); setLoading(false); });
    }, q ? 250 : 0); // debounce free-text search only

    return () => clearTimeout(timer);
  }, [category, source, q]);

  return (
    <div className="compendium">
      <header>
        <Link className="link" to="/">← Home</Link>
        <h2>Compendium</h2>
      </header>

      <div className="compendium-filters">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories ({categories.reduce((n, c) => n + c.count, 0)})</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>

        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.source || "(none)"} value={s.source}>
              {s.source || "(unknown source)"} ({s.count})
            </option>
          ))}
        </select>

        <input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="compendium-body">
        <ul className="compendium-list">
          {loading && <li className="muted">Loading…</li>}
          {error && <li className="pill bad">{error}</li>}
          {!loading && !error && results.length === 0 && <li className="muted">No results.</li>}
          {!loading && results.map((r) => (
            <li key={`${r.category}-${r.id}`}>
              <button
                className={"link" + (selected?.id === r.id && selected?.category === r.category ? " active" : "")}
                onClick={() => setSelected(r)}
              >
                <span className="pill">{r.category}</span> {r.name}
              </button>
              {r.source && <span className="muted"> — {r.source}</span>}
            </li>
          ))}
        </ul>

        {selected && (
          <aside className="compendium-detail">
            <button className="link" onClick={() => setSelected(null)}>✕ Close</button>
            <h3>{selected.name}</h3>
            <p className="muted">
              {selected.category}
              {selected.source && ` — ${selected.source}`}
              {selected.data?.sourcePage != null && ` pg. ${selected.data.sourcePage}`}
            </p>
            {Object.entries(selected.data || {})
              .filter(([k, v]) => !HIDDEN_DATA_FIELDS.has(k) && v !== null && v !== "" && v !== undefined)
              .map(([k, v]) => (
                <p key={k}>
                  <strong>{fieldLabel(k)}:</strong> {String(v)}
                </p>
              ))}
            {selected.url && (
              <p>
                <a href={selected.url} target="_blank" rel="noreferrer">
                  View on Archives of Nethys ↗
                </a>
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
