import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

// Fields already shown elsewhere (header, source line) — don't repeat them
// in the generic "everything else in data" dump.
const HIDDEN_DATA_FIELDS = new Set(["sourceUrl", "sourcePage", "description", "prerequisite"]);
// Shown big and first, if present, ahead of the rest of the fields.
const HEADLINE_FIELD = "effect";

function fieldLabel(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export default function Compendium() {
  const [categories, setCategories] = useState([]);
  const [sources, setSources] = useState([]);
  const [ownedSources, setOwnedSources] = useState([]);
  const [onlyOwned, setOnlyOwned] = useState(true);
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/aon/categories").then(setCategories).catch(() => setCategories([]));
    api("/settings/owned_sources").then((s) => {
      const owned = s.value || [];
      setOwnedSources(owned);
      setOnlyOwned(owned.length > 0);
    });
  }, []);

  useEffect(() => {
    setSource("");
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    api(`/aon/sources${qs}`).then(setSources).catch(() => setSources([]));
  }, [category]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (source) {
      params.set("source", source);
    } else if (onlyOwned && ownedSources.length > 0) {
      params.set("sources", ownedSources.join(","));
    }
    if (q) params.set("q", q);

    setLoading(true);
    setError("");
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/aon?${params}`)
        .then((rows) => { if (!cancelled) { setResults(rows); setLoading(false); } })
        .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    }, q ? 250 : 0); // debounce free-text search only

    // guards against a slower, now-stale request (e.g. the pre-owned-sources
    // initial fetch) overwriting a faster, newer one
    return () => { cancelled = true; clearTimeout(timer); };
  }, [category, source, onlyOwned, ownedSources, q]);

  const detailFields = useMemo(() => {
    if (!selected) return [];
    return Object.entries(selected.data || {}).filter(
      ([k, v]) => k !== HEADLINE_FIELD && !HIDDEN_DATA_FIELDS.has(k) && v !== null && v !== "" && v !== undefined
    );
  }, [selected]);

  return (
    <div className="compendium">
      <header>
        <Link className="link" to="/">← Home</Link>
        <h2>Compendium</h2>
        <span className="muted">{results.length} shown</span>
      </header>

      <div className="compendium-filters">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories ({categories.reduce((n, c) => n + c.count, 0)})</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {fieldLabel(c.category)} ({c.count})
            </option>
          ))}
        </select>

        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">
            {onlyOwned && ownedSources.length > 0 ? "My sources" : "All sources"}
          </option>
          {sources.map((s) => (
            <option key={s.source || "(none)"} value={s.source}>
              {s.source || "(unknown source)"} ({s.count})
            </option>
          ))}
        </select>

        {ownedSources.length > 0 && (
          <label className="checkbox-inline" title="Uncheck to see entries from every imported source">
            <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} disabled={!!source} />
            Only my sources
          </label>
        )}

        <input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="compendium-body">
        <ul className="compendium-list">
          {loading && <li className="muted">Loading…</li>}
          {error && <li className="pill bad">{error}</li>}
          {!loading && !error && results.length === 0 && (
            <li className="muted">
              No results.{" "}
              {onlyOwned && ownedSources.length > 0 && (
                <button className="link" onClick={() => setOnlyOwned(false)}>Try showing all sources.</button>
              )}
            </li>
          )}
          {!loading && results.map((r) => (
            <li key={`${r.category}-${r.id}`}>
              <button
                className={"compendium-row" + (selected?.id === r.id && selected?.category === r.category ? " active" : "")}
                onClick={() => setSelected(r)}
              >
                <span className={`pill cat-${r.category}`}>{r.category}</span>
                <span className="compendium-row-name">{r.name}</span>
                {r.source && <span className="muted compendium-row-source">{r.source}</span>}
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <aside className="compendium-detail">
            <button className="link compendium-detail-close" onClick={() => setSelected(null)}>✕</button>
            <span className={`pill cat-${selected.category}`}>{selected.category}</span>
            <h3>{selected.name}</h3>
            <p className="muted compendium-detail-source">
              {selected.source}
              {selected.data?.sourcePage != null && ` pg. ${selected.data.sourcePage}`}
            </p>

            {selected.data?.[HEADLINE_FIELD] && (
              <p className="compendium-effect">{selected.data[HEADLINE_FIELD]}</p>
            )}

            {detailFields.length > 0 && (
              <dl className="compendium-fields">
                {detailFields.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{fieldLabel(k)}</dt>
                    <dd>{String(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}

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
