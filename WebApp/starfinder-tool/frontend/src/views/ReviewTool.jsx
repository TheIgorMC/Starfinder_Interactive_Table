import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

// Manual hand-validation workbench over aon_entries. The AI import pipeline
// (Foundry import / AoN scrape / mechanics-parser.js) gets most entries
// right but not all — this is where a GM works through every entry one by
// one against its live AoN page, corrects `data`/`mechanics` JSON in place,
// and records a verdict (see backend/migrations/010_aon_review.sql +
// backend/src/routes/review.js). Not meant for players.

const STATUS_LABEL = { unreviewed: "Unreviewed", approved: "Approved", flagged: "Flagged" };
const STATUS_PILL = { unreviewed: "", approved: "ok", flagged: "bad" };

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

export default function ReviewTool() {
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState({});
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("unreviewed");
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [entry, setEntry] = useState(null); // full row from GET /:id
  const [dataText, setDataText] = useState("");
  const [mechanicsText, setMechanicsText] = useState("");
  const [notes, setNotes] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadStats = () => {
    api("/review/stats").then((rows) => {
      const byCat = {};
      for (const r of rows) byCat[r.category] = r;
      setStats(byCat);
      setCategories(rows.map((r) => r.category));
    }).catch(() => {});
  };

  useEffect(() => { loadStats(); }, []);

  const loadList = () => {
    setListLoading(true); setListError("");
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    params.set("limit", "500");
    api(`/review?${params}`)
      .then((rows) => { setList(rows); setListLoading(false); })
      .catch((e) => { setListError(e.message); setListLoading(false); });
  };

  useEffect(loadList, [category, status, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEntry = (id) => {
    setSelectedId(id);
    setSaveMsg(""); setJsonError("");
    api(`/review/${id}`).then((row) => {
      setEntry(row);
      setDataText(JSON.stringify(row.data ?? {}, null, 2));
      setMechanicsText(JSON.stringify(row.mechanics ?? {}, null, 2));
      setNotes(row.review_notes || "");
    }).catch((e) => setListError(e.message));
  };

  const currentIndex = useMemo(() => list.findIndex((r) => r.id === selectedId), [list, selectedId]);

  const selectRelative = (delta) => {
    if (!list.length) return;
    const next = currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex + delta, 0), list.length - 1);
    loadEntry(list[next].id);
  };

  const parseOrNull = (text, label) => {
    try { return JSON.parse(text); }
    catch (e) { setJsonError(`${label}: ${e.message}`); return undefined; }
  };

  const save = async (status_override) => {
    setJsonError(""); setSaveMsg("");
    const data = parseOrNull(dataText, "Data");
    if (data === undefined) return;
    const mechanics = parseOrNull(mechanicsText, "Mechanics");
    if (mechanics === undefined) return;

    setSaving(true);
    try {
      const body = { data, mechanics, review_notes: notes };
      if (status_override) body.review_status = status_override;
      const updated = await api(`/review/${selectedId}`, { method: "PATCH", body });
      setEntry(updated);
      setSaveMsg(status_override ? `Saved — marked ${STATUS_LABEL[status_override]}.` : "Saved.");
      loadStats();
      if (status_override) {
        // Drop out of the current filtered list if it no longer matches,
        // and jump to the next unreviewed entry — that's the common loop.
        const remaining = list.filter((r) => r.id !== selectedId);
        setList(remaining);
        if (remaining.length) loadEntry(remaining[Math.min(currentIndex, remaining.length - 1)].id);
        else setEntry(null);
      }
    } catch (e) {
      setJsonError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    const t = { total: 0, approved: 0, flagged: 0, unreviewed: 0 };
    for (const c of Object.values(stats)) {
      t.total += c.total; t.approved += c.approved; t.flagged += c.flagged; t.unreviewed += c.unreviewed;
    }
    return t;
  }, [stats]);

  return (
    <div className="review-tool">
      <header>
        <Link className="link" to="/">← Home</Link>
        <h2>Data Review</h2>
        <span className="muted">
          {totals.approved}/{totals.total} approved · {totals.flagged} flagged · {totals.unreviewed} unreviewed
        </span>
      </header>

      <div className="review-layout">
        <aside className="review-sidebar">
          <div className="review-filters">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => {
                const s = stats[c];
                return <option key={c} value={c}>{c} ({s ? `${s.approved}/${s.total}` : "?"})</option>;
              })}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="approved">Approved</option>
              <option value="flagged">Flagged</option>
            </select>
            <input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {listLoading && <p className="muted">Loading…</p>}
          {listError && <p className="pill bad">{listError}</p>}
          <ul className="review-list">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  className={"review-list-item" + (r.id === selectedId ? " active" : "")}
                  onClick={() => loadEntry(r.id)}
                >
                  <span className={"pill" + (STATUS_PILL[r.review_status] ? ` ${STATUS_PILL[r.review_status]}` : "")}>
                    {STATUS_LABEL[r.review_status] || r.review_status}
                  </span>
                  <span className="review-list-name">{r.name}</span>
                  <span className="muted review-list-source">{r.source}</span>
                </button>
              </li>
            ))}
            {!listLoading && !listError && list.length === 0 && <li className="muted">No entries match.</li>}
          </ul>
        </aside>

        <main className="review-detail">
          {!entry && <p className="muted">Select an entry from the list to review it.</p>}
          {entry && (
            <>
              <div className="review-detail-head">
                <div>
                  <h3>{entry.name}</h3>
                  <p className="muted">
                    {entry.category} · {entry.source}
                    {" · "}
                    <span className={"pill" + (STATUS_PILL[entry.review_status] ? ` ${STATUS_PILL[entry.review_status]}` : "")}>
                      {STATUS_LABEL[entry.review_status] || entry.review_status}
                    </span>
                    {entry.reviewed_by && ` — last reviewed by ${entry.reviewed_by} at ${fmtDate(entry.reviewed_at)}`}
                  </p>
                </div>
                <div className="review-nav">
                  <button onClick={() => selectRelative(-1)} disabled={currentIndex <= 0}>‹ Prev</button>
                  <span className="muted">{currentIndex >= 0 ? currentIndex + 1 : "–"} / {list.length}</span>
                  <button onClick={() => selectRelative(1)} disabled={currentIndex < 0 || currentIndex >= list.length - 1}>Next ›</button>
                </div>
              </div>

              {entry.url ? (
                <a className="review-aon-link" href={entry.url} target="_blank" rel="noreferrer">
                  Open on Archives of Nethys ↗
                </a>
              ) : (
                <p className="pill bad">No AoN source URL on this entry — nothing to compare against.</p>
              )}

              <div className="review-editors">
                <div className="review-editor">
                  <label>data</label>
                  <textarea
                    spellCheck={false}
                    value={dataText}
                    onChange={(e) => setDataText(e.target.value)}
                    rows={16}
                  />
                </div>
                <div className="review-editor">
                  <label>mechanics</label>
                  <textarea
                    spellCheck={false}
                    value={mechanicsText}
                    onChange={(e) => setMechanicsText(e.target.value)}
                    rows={16}
                  />
                </div>
              </div>

              <div className="review-notes">
                <label>Review notes</label>
                <textarea
                  rows={3}
                  placeholder="What was wrong, what you fixed, anything still unsure about…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {jsonError && <p className="pill bad">{jsonError}</p>}
              {saveMsg && <p className="pill ok">{saveMsg}</p>}

              <div className="review-actions">
                <button onClick={() => save(null)} disabled={saving}>Save (no status change)</button>
                <button className="primary" onClick={() => save("approved")} disabled={saving}>Approve & Next</button>
                <button className="danger" onClick={() => save("flagged")} disabled={saving}>Flag & Next</button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
