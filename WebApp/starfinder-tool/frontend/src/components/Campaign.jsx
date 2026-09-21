import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api.js";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";
import { HIERARCHY_RELATIONS, buildChildrenIndex, descendantIds } from "../lib/campaignTree.js";

const TYPES = [
  { key: "event", label: "Events" },
  { key: "location", label: "Locations" },
  { key: "npc", label: "People" },
  { key: "faction", label: "Factions" },
  { key: "quest", label: "Quests" },
  { key: "object", label: "Objects" },
];

// Groups a flat list of same-type entries into a tree using `links`
// (id/from_id/to_id/relation, as returned by GET /api/campaign/links).
// Entries whose parent isn't in this type (or isn't present at all, e.g.
// filtered out by the session/visibility filter) become roots.
function buildTree(entries, links) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const childrenOf = new Map();
  const hasParent = new Set();
  for (const l of links) {
    if (!HIERARCHY_RELATIONS.has(l.relation)) continue;
    if (!byId.has(l.from_id) || !byId.has(l.to_id)) continue;
    if (!childrenOf.has(l.to_id)) childrenOf.set(l.to_id, []);
    childrenOf.get(l.to_id).push(byId.get(l.from_id));
    hasParent.add(l.from_id);
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => a.name.localeCompare(b.name));
  const roots = entries.filter((e) => !hasParent.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  return { roots, childrenOf };
}

const blank = (type) => ({ type, name: "", body: "", image_id: null, event_date: "", visible_to_players: false });

// "!!private note!!" inside a body is a GM-only aside (see the editor's
// hint under the body textarea) — never let one show up in a preview,
// mirrors backend/src/gm-notes.js's stripGmNotes(). The server already
// strips it from a non-GM API response too; this is what keeps the GM's
// own hover-preview tooltip in the tree from spoiling it for themselves
// at a glance while skimming.
function stripGmNotes(text) {
  return (text || "").replace(/!!([\s\S]*?)!!/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// A short preview of an entry, derived from its body on the spot — this
// used to be a separately hand-maintained "summary" field that routinely
// went stale after an edit (or, for tgn-imported entries, got mangled by a
// buggy auto-generator). Computing it fresh from `body` every render makes
// staleness impossible: there's nothing stored to drift out of sync.
function excerptOf(body) {
  const withoutImages = stripGmNotes(body).replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const paragraphs = withoutImages.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const plain = para
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/[*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain.length > 200 ? `${plain.slice(0, 197)}…` : plain;
  }
  return "";
}

// Raw fetch, not the api() helper — that one always JSON-encodes the body,
// which doesn't work for multipart file uploads (same reason as
// MediaLibrary.jsx's upload()).
async function uploadTgn(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/campaign/import-tgn", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function TgnImport({ onImported }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await uploadTgn(file);
      setResult(r);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tgn-import">
      <label className="button-like">
        {busy ? "Importing…" : "Import Tangent (.tgn) export…"}
        <input type="file" accept=".tgn" onChange={onFile} disabled={busy} hidden />
      </label>
      {error && <span className="pill bad">{error}</span>}
      {result && (
        <span className="pill ok">
          +{result.entriesInserted} new entries, +{result.linksInserted} new links
          {" "}({result.entriesSeen - result.entriesInserted} already imported, left untouched)
        </span>
      )}
    </div>
  );
}

// Groups of same-type/same-name entries — usually from re-creating
// (rather than editing) something in Tangent between exports, which gives
// it a fresh id there and so imports as a new duplicate entry instead of
// updating the old one. Picking a "keep" merges every link the others had
// onto it and deletes them (see POST /campaign/duplicates/merge).
function DuplicatesTool({ onMerged }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(null);
  const [keepChoice, setKeepChoice] = useState({});
  const [busyKey, setBusyKey] = useState(null);

  const load = () => api("/campaign/duplicates").then((rows) => {
    setGroups(rows);
    setKeepChoice((cur) => {
      const next = { ...cur };
      for (const g of rows) { const key = g.ids.join(","); if (next[key] === undefined) next[key] = g.ids[0]; }
      return next;
    });
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const merge = async (group) => {
    const key = group.ids.join(",");
    const keepId = keepChoice[key];
    const removeIds = group.ids.filter((id) => id !== keepId);
    setBusyKey(key);
    try {
      await api("/campaign/duplicates/merge", { method: "POST", body: { keep_id: keepId, remove_ids: removeIds } });
      await load();
      onMerged();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="tgn-import">
      <button className="link" onClick={toggle}>{open ? "✕ Close duplicates" : "Find duplicates"}</button>
      {open && (
        <div className="duplicates-panel">
          {groups === null && <p className="muted">Checking…</p>}
          {groups?.length === 0 && <p className="muted">No duplicates found.</p>}
          {groups?.map((g) => {
            const key = g.ids.join(",");
            return (
              <div key={key} className="duplicates-group">
                <p>
                  {g.type ? <span className="pill">{g.type}</span> : <span className="pill bad">mixed type</span>}
                  {" "}<strong>{g.name}</strong> — {g.ids.length} copies
                  {g.name_variants.length > 1 && <span className="muted"> (spelled: {g.name_variants.join(" / ")})</span>}
                  {g.confidence === "cross-type" && <span className="muted"> — same name, different types; check these are really the same thing before merging</span>}
                </p>
                <div className="row">
                  {g.ids.map((id, i) => (
                    <label key={id} className="checkbox-inline">
                      <input
                        type="radio" name={key} checked={keepChoice[key] === id}
                        onChange={() => setKeepChoice((cur) => ({ ...cur, [key]: id }))}
                      />
                      keep #{id} ({g.id_types[i]}){i === 0 ? " (oldest)" : ""}
                    </label>
                  ))}
                  <button onClick={() => merge(g)} disabled={busyKey === key}>
                    {busyKey === key ? "Merging…" : `Merge (delete ${g.ids.length - 1})`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Splits a body on "!!...!!" pairs and renders the note segments in a
// visibly distinct "GM only" box instead of feeding the literal "!!"
// markers through the markdown renderer — the GM console is the only
// place this ever runs (players never receive raw body text; the API
// itself strips notes for non-GM requests, see backend/src/gm-notes.js),
// so this is purely about making the marker's effect visible while
// editing/reading, not a second enforcement layer.
function MarkdownWithNotes({ body }) {
  const text = body || "*Nothing written yet — click Edit to add some.*";
  const parts = text.split(/(!![\s\S]*?!!)/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^!!([\s\S]*)!!$/);
        if (!m) return part ? <ReactMarkdown key={i}>{part}</ReactMarkdown> : null;
        return (
          <div key={i} className="campaign-gm-note">
            <span className="campaign-gm-note-label">GM only</span>
            <ReactMarkdown>{m[1]}</ReactMarkdown>
          </div>
        );
      })}
    </>
  );
}

// A chapter/hub entry can easily collect dozens of incoming links (every
// location "appare in" it, say) — one flat list makes the genuinely
// distinct relationships (e.g. a single "member of" faction link) just as
// hard to spot as the pile of same-relation entries. Grouped by
// direction+relation, with any group past a handful collapsed behind a
// "show all N" toggle instead of dumping the whole thing on-screen.
const RELATED_GROUP_COLLAPSE_AT = 6;

function RelatedEntries({ links, renderItem }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const groups = useMemo(() => {
    const map = new Map();
    for (const l of links || []) {
      const key = `${l.direction}::${l.relation || "related to"}`;
      if (!map.has(key)) map.set(key, { key, direction: l.direction, relation: l.relation || "related to", items: [] });
      map.get(key).items.push(l);
    }
    for (const g of map.values()) g.items.sort((a, b) => a.name.localeCompare(b.name));
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  }, [links]);

  const toggle = (key) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (!groups.length) return <p className="muted">No links yet.</p>;

  return (
    <div className="campaign-links-groups">
      {groups.map((g) => {
        const isLong = g.items.length > RELATED_GROUP_COLLAPSE_AT;
        const isOpen = !isLong || expanded.has(g.key);
        const shown = isOpen ? g.items : g.items.slice(0, RELATED_GROUP_COLLAPSE_AT);
        return (
          <div key={g.key} className="campaign-links-group">
            <div className="campaign-links-group-head">
              <span>{g.direction === "out" ? "→" : "←"} {g.relation}</span>
              <span className="pill">{g.items.length}</span>
            </div>
            <ul>{shown.map(renderItem)}</ul>
            {isLong && (
              <button className="link" onClick={() => toggle(g.key)}>
                {isOpen ? "Show less" : `Show all ${g.items.length}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TreeNode({ entry, depth, childrenOf, collapsed, toggleCollapsed, openEntry, activeId }) {
  const kids = childrenOf.get(entry.id) || [];
  const isCollapsed = collapsed.has(entry.id);
  return (
    <li>
      <div className={"campaign-tree-row" + (entry.id === activeId ? " active" : "")} style={{ paddingLeft: depth * 16 }}>
        {kids.length > 0 ? (
          <button className="campaign-tree-caret" onClick={() => toggleCollapsed(entry.id)}>{isCollapsed ? "▸" : "▾"}</button>
        ) : (
          <span className="campaign-tree-caret" />
        )}
        <button className="link" onClick={() => openEntry(entry)} title={excerptOf(entry.body)}>
          {entry.name} {entry.visible_to_players && <span className="pill ok">visible</span>}
        </button>
      </div>
      {kids.length > 0 && !isCollapsed && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} entry={k} depth={depth + 1} childrenOf={childrenOf} collapsed={collapsed} toggleCollapsed={toggleCollapsed} openEntry={openEntry} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Campaign({ onOpenCharacter }) {
  const [type, setType] = useState("event");
  const [entries, setEntries] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewMode, setViewMode] = useState("read"); // "read" (rendered markdown) or "edit" (the form)
  const [images, setImages] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [links, setLinks] = useState([]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [chapterFilter, setChapterFilter] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [relation, setRelation] = useState("");
  const { active, setFilterEnabled } = useActiveSession();

  const toggleCollapsed = (id) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // AI draft (Ollama, see backend/src/routes/campaign.js POST /ai-draft) —
  // fills the blank-entry form from a freeform note; suggested links are
  // held here (not yet written) and only applied once the entry itself is
  // saved, since a link needs a real entry id on both ends.
  const [aiDescription, setAiDescription] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiLinks, setAiLinks] = useState([]);
  const resetAiDraft = () => { setAiDescription(""); setAiBusy(false); setAiError(""); setAiLinks([]); };

  const load = () => api(`/campaign?type=${type}`).then(setEntries);
  useEffect(() => { load(); setQ(""); }, [type]); // chapterFilter deliberately persists across tabs — it's a campaign-wide filter, not per-type
  const loadLinks = () => api("/campaign/links").then(setLinks).catch(() => setLinks([]));
  useEffect(() => {
    api("/media?category=portrait").then(setImages).catch(() => setImages([]));
    api("/campaign").then(setAllEntries).catch(() => setAllEntries([]));
    loadLinks();
  }, []);

  const openEntry = async (entry) => {
    const full = entry.id ? await api(`/campaign/${entry.id}`) : entry;
    setEditing(full);
    setViewMode(full.id ? "read" : "edit");
    resetAiDraft();
  };

  const reloadEditing = async () => {
    if (editing?.id) setEditing(await api(`/campaign/${editing.id}`));
  };

  const generateAiDraft = async () => {
    if (!aiDescription.trim()) return;
    setAiBusy(true);
    setAiError("");
    try {
      const draft = await api("/campaign/ai-draft", { method: "POST", body: { description: aiDescription, hint_type: editing.type } });
      setEditing((cur) => ({
        ...cur, type: draft.type, name: draft.name, body: draft.body,
        event_date: draft.type === "event" ? draft.event_date : cur.event_date,
      }));
      setAiLinks(draft.links.map((l) => ({ ...l, accepted: true })));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!editing.name) return;
    const body = { ...editing };
    delete body.links;
    let saved;
    if (editing.id) saved = await api(`/campaign/${editing.id}`, { method: "PATCH", body });
    else saved = await api("/campaign", { method: "POST", body });
    const acceptedLinks = aiLinks.filter((l) => l.accepted);
    if (!editing.id && acceptedLinks.length) {
      await Promise.all(acceptedLinks.map((l) =>
        api(`/campaign/${saved.id}/links`, { method: "POST", body: { to_id: l.entry_id, relation: l.relation } })
      ));
    }
    resetAiDraft();
    load();
    api("/campaign").then(setAllEntries);
    loadLinks();
    openEntry(saved);
  };

  const remove = async () => {
    await api(`/campaign/${editing.id}`, { method: "DELETE" });
    setEditing(null);
    resetAiDraft();
    load();
    loadLinks();
  };

  const addLink = async () => {
    if (!linkTargetId) return;
    await api(`/campaign/${editing.id}/links`, { method: "POST", body: { to_id: Number(linkTargetId), relation } });
    setLinkTargetId(""); setRelation("");
    reloadEditing();
    loadLinks();
  };

  const removeLink = async (linkId) => {
    await api(`/campaign/links/${linkId}`, { method: "DELETE" });
    reloadEditing();
    loadLinks();
  };

  const refreshAll = () => { load(); api("/campaign").then(setAllEntries); loadLinks(); };

  // Chapters an entry "appears in" — the same links tgn-import.js writes
  // from each Tangent object to the chapters (timeline entries, type
  // "event") it was tagged with there. Lets a GM narrow a long list down
  // to "just what's relevant to Chapter 2" instead of scrolling everything.
  const chapters = useMemo(
    () => allEntries.filter((e) => e.type === "event").sort((a, b) => a.name.localeCompare(b.name)),
    [allEntries]
  );
  const chapterEntryIds = useMemo(() => {
    if (!chapterFilter) return null;
    const directIds = new Set();
    for (const l of links) if (l.relation === "appare in" && l.to_id === Number(chapterFilter)) directIds.add(l.from_id);
    // Tangent tagging is usually only set on the top-level entry a GM
    // dragged into a chapter (e.g. a sector), not every nested child — so
    // a direct-only match would show 2 top-level locations and hide the
    // 15 sub-locations underneath, looking broken. Pull in the whole
    // subtree of anything directly tagged, same cascade as session linking.
    const childrenOf = buildChildrenIndex(links);
    const ids = new Set(directIds);
    for (const id of directIds) for (const d of descendantIds(id, childrenOf)) ids.add(d);
    return ids;
  }, [links, chapterFilter]);

  const visibleEntries = filterToSession(entries, active, "entryIds");
  const chapterEntries = chapterEntryIds ? visibleEntries.filter((e) => chapterEntryIds.has(e.id)) : visibleEntries;
  const searchedEntries = q.trim()
    ? chapterEntries.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()))
    : chapterEntries;
  const tree = useMemo(() => buildTree(searchedEntries, links), [searchedEntries, links]);

  return (
    <div className="campaign">
      <div className="tab-row">
        {TYPES.map((t) => (
          <button key={t.key} className={type === t.key ? "active" : ""} onClick={() => { setType(t.key); setEditing(null); }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <TgnImport onImported={refreshAll} />
        <DuplicatesTool onMerged={refreshAll} />
      </div>

      {active?.status === "active" && (
        <label className="checkbox-inline" style={{ marginBottom: 12 }} title={`Session: ${active.name}`}>
          <input type="checkbox" checked={active.filter_enabled} onChange={(e) => setFilterEnabled(e.target.checked)} />
          Filter to "{active.name}" ({visibleEntries.length}/{entries.length} shown)
        </label>
      )}

      <div className="campaign-body">
        <div className="campaign-list">
          <button onClick={() => { setEditing(blank(type)); setViewMode("edit"); resetAiDraft(); }}>+ New {TYPES.find((t) => t.key === type).label.replace(/s$/, "")}</button>
          <input className="campaign-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {chapters.length > 0 && (
            <select className="campaign-search" value={chapterFilter} onChange={(e) => setChapterFilter(e.target.value)}>
              <option value="">All chapters</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <ul className="campaign-tree">
            {tree.roots.map((e) => (
              <TreeNode key={e.id} entry={e} depth={0} childrenOf={tree.childrenOf} collapsed={collapsed} toggleCollapsed={toggleCollapsed} openEntry={openEntry} activeId={editing?.id} />
            ))}
            {tree.roots.length === 0 && (
              <li className="muted">
                {q.trim() ? "No matches." : active?.filter_enabled && entries.length > 0 ? "None linked to this session." : "Nothing here yet."}
              </li>
            )}
          </ul>
        </div>

        {editing && viewMode === "read" && (
          <div className="campaign-reader">
            <div className="campaign-reader-head">
              <div>
                <h2>{editing.name}</h2>
                <p className="muted">
                  {TYPES.find((t) => t.key === editing.type)?.label.replace(/s$/, "")}
                  {editing.event_date && ` · ${editing.event_date}`}
                  {editing.visible_to_players && <span className="pill ok" style={{ marginLeft: 8 }}>visible to players</span>}
                </p>
              </div>
              <div className="row">
                <button onClick={() => setViewMode("edit")}>Edit</button>
                <button className="link" onClick={() => setEditing(null)}>Close</button>
              </div>
            </div>

            {images.find((m) => m.id === editing.image_id) && (
              <img className="campaign-reader-image" src={images.find((m) => m.id === editing.image_id).url} alt="" />
            )}
            <div className="campaign-markdown">
              <MarkdownWithNotes body={editing.body} />
            </div>

            {editing.type === "npc" && onOpenCharacter && (
              <div className="campaign-links">
                <h4>Character sheet</h4>
                {editing.linked_character ? (
                  <p>
                    <strong>{editing.linked_character.name}</strong>{" "}
                    <span className="muted">{editing.linked_character.race} {editing.linked_character.class} {editing.linked_character.level}</span>{" "}
                    <button className="link" onClick={() => onOpenCharacter(editing.linked_character.id)}>Open sheet →</button>
                  </p>
                ) : (
                  <p className="muted">
                    No linked statblock. Link one from the Characters tab if this person needs stats.
                  </p>
                )}
              </div>
            )}

            <div className="campaign-links">
              <h4>Related entries</h4>
              <RelatedEntries
                links={editing.links}
                renderItem={(l) => (
                  <li key={l.id}>
                    <span className="pill">{l.type}</span>{" "}
                    <button className="link" onClick={() => openEntry({ id: l.entry_id })}>{l.name}</button>
                  </li>
                )}
              />
            </div>
          </div>
        )}

        {editing && viewMode === "edit" && (
          <div className="campaign-editor">
            {!editing.id && (
              <div className="ai-draft">
                <label>✨ Describe it — let AI draft the entry</label>
                <textarea
                  rows={3}
                  placeholder="e.g. A grizzled Vesk mercenary captain found drinking alone at the Rust & Ration bar on Absalom Station. Used to run with the Vex Cartel before a falling out."
                  value={aiDescription} onChange={(e) => setAiDescription(e.target.value)}
                />
                <div className="row">
                  <button onClick={generateAiDraft} disabled={!aiDescription.trim() || aiBusy}>{aiBusy ? "Drafting…" : "Generate draft"}</button>
                  {aiError && <span className="pill bad">{aiError}</span>}
                </div>
              </div>
            )}
            <input placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            {editing.type === "event" && (
              <input placeholder="Date (in-game, freeform)" value={editing.event_date} onChange={(e) => setEditing({ ...editing, event_date: e.target.value })} />
            )}
            <select value={editing.image_id ?? ""} onChange={(e) => setEditing({ ...editing, image_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No image</option>
              {images.map((m) => <option key={m.id} value={m.id}>{m.label || m.original_name}</option>)}
            </select>
            <textarea rows={8} placeholder="Details, stat block, lore text…" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <p className="muted" style={{ marginTop: -4 }}>
              Wrap text in <code>!!like this!!</code> to keep it a GM-only note — hidden from players and the mood tablet, however this entry is shared.
            </p>
            <label className="checkbox-inline">
              <input type="checkbox" checked={editing.visible_to_players} onChange={(e) => setEditing({ ...editing, visible_to_players: e.target.checked })} />
              Visible to players
            </label>

            {!editing.id && aiLinks.length > 0 && (
              <div className="campaign-links">
                <h4>AI-suggested links</h4>
                <ul>
                  {aiLinks.map((l, i) => (
                    <li key={l.entry_id}>
                      <label className="checkbox-inline" style={{ flex: 1 }}>
                        <input
                          type="checkbox" checked={l.accepted}
                          onChange={() => setAiLinks((cur) => cur.map((x, j) => (j === i ? { ...x, accepted: !x.accepted } : x)))}
                        />
                        {l.relation || "related to"} <span className="pill">{l.type}</span> {l.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="muted">Applied automatically once you Save.</p>
              </div>
            )}

            {editing.id && (
              <div className="campaign-links">
                <h4>Related entries</h4>
                <RelatedEntries
                  links={editing.links}
                  renderItem={(l) => (
                    <li key={l.id}>
                      <span className="pill">{l.type}</span> {l.name}
                      <button className="link unlink-btn" onClick={() => removeLink(l.id)}>unlink</button>
                    </li>
                  )}
                />
                <div className="row">
                  <select value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                    <option value="">Link to…</option>
                    {allEntries.filter((e) => e.id !== editing.id).map((e) => (
                      <option key={e.id} value={e.id}>{e.type}: {e.name}</option>
                    ))}
                  </select>
                  <input placeholder="relation (e.g. member of)" value={relation} onChange={(e) => setRelation(e.target.value)} style={{ maxWidth: 160 }} />
                  <button onClick={addLink} disabled={!linkTargetId}>Link</button>
                </div>
              </div>
            )}

            <div className="row">
              <button onClick={save} disabled={!editing.name}>Save</button>
              <button className="link" onClick={() => { editing.id ? openEntry({ id: editing.id }) : setEditing(null); resetAiDraft(); }}>Cancel</button>
              {editing.id && <button className="link" onClick={remove}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
