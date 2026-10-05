import { useState } from "react";
import { emptyBook, emptyChapter, citing, COLLECTIONS } from "./lib/model.js";
import { Prose } from "./Inspector.jsx";

// The GM's book(s): chapters with a link to the text and a summary; every
// place or event citing a chapter is listed under it and glows on the map.
export default function BooksPanel({ map, gm, setMap, openChapter, setOpenChapter, onPick, onLink, onCopyLink }) {
  const books = (map.books || []).filter((b) => gm || !b.hidden);
  const [editBook, setEditBook] = useState(null);
  const setBooks = (fn) => setMap((m) => ({ ...m, books: fn(m.books || []) }));
  const setBook = (id, patch) => setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const setChapter = (bid, cid, patch) => setBooks((bs) => bs.map((b) => (b.id !== bid ? b : { ...b, chapters: b.chapters.map((c) => (c.id === cid ? { ...c, ...patch } : c)) })));
  const moveChapter = (bid, cid, d) => setBooks((bs) => bs.map((b) => {
    if (b.id !== bid) return b;
    const cs = [...b.chapters], i = cs.findIndex((c) => c.id === cid), j = i + d;
    if (j < 0 || j >= cs.length) return b;
    [cs[i], cs[j]] = [cs[j], cs[i]];
    return { ...b, chapters: cs.map((c, k) => ({ ...c, n: k + 1 })) };
  }));

  // one chapter open
  const open = openChapter && books.flatMap((b) => (b.chapters || []).filter((c) => gm || !c.hidden).map((c) => ({ b, c }))).find((x) => x.c.id === openChapter);
  if (open) {
    const { b, c } = open;
    const cites = citing(map, c.id).filter(({ item }) => gm || !item.hidden);
    return (
      <div className="fm-inspector">
        <div className="fm-head">
          <div>
            <button className="fm-link" onClick={() => setOpenChapter(null)}>‹ {b.title}</button>
            <div className="fm-kicker">Chapter {c.n}</div>
            {gm ? <input className="fm-title-in" value={c.title} onChange={(e) => setChapter(b.id, c.id, { title: e.target.value })} /> : <h2 className="fm-title">{c.title}</h2>}
          </div>
          <div className="fm-headbtns"><button className="fm-close" title="Copy a link to this chapter on the map" onClick={() => onCopyLink({ kind: "chapter", id: c.id })}>🔗</button></div>
        </div>
        {gm ? (
          <div className="fm-sec fm-grid2">
            <label style={{ gridColumn: "1 / -1" }}>Link to the text<input className="fm-in" placeholder="https://… (Google Doc, wiki, PDF page…)" value={c.url || ""} onChange={(e) => setChapter(b.id, c.id, { url: e.target.value })} /></label>
            <label className="fm-check"><input type="checkbox" checked={!!c.hidden} onChange={(e) => setChapter(b.id, c.id, { hidden: e.target.checked })} /> Hidden from players</label>
          </div>
        ) : null}
        {c.url && <div className="fm-sec"><a className="fm-readlink" href={c.url} target="_blank" rel="noopener noreferrer">Read the chapter ↗</a></div>}
        <div className="fm-sec">
          <div className="fm-label">Summary</div>
          {gm ? <textarea className="fm-in fm-area" rows={5} value={c.summary || ""} placeholder="What happens… [[Name]] links to places and events." onChange={(e) => setChapter(b.id, c.id, { summary: e.target.value })} />
            : c.summary ? <Prose text={c.summary} map={map} onLink={onLink} /> : <div className="fm-muted">No summary.</div>}
          {gm && c.summary && <Prose text={c.summary} map={map} onLink={onLink} />}
        </div>
        <div className="fm-sec">
          <div className="fm-label"><span>In this chapter</span><span className="fm-muted">{cites.length ? "glowing on the map" : ""}</span></div>
          {cites.map(({ kind, item }) => {
            const r = (item.refs || []).find((x) => x.chapter === c.id);
            return <button key={item.id} className="fm-item" onClick={() => onPick({ kind, id: item.id })}><span>{item.name || "(unnamed)"}{r?.note ? ` · ${r.note}` : ""}</span><small>{COLLECTIONS[kind]}{item.date ? ` · ${item.date}` : ""}</small></button>;
          })}
          {!cites.length && <div className="fm-muted">Nothing cites this chapter yet — open a place or event and use “Cite”.</div>}
        </div>
        {gm && <div className="fm-sec"><button className="fm-btn danger" onClick={() => { if (window.confirm("Delete this chapter? Citations of it disappear.")) { setBooks((bs) => bs.map((x) => (x.id !== b.id ? x : { ...x, chapters: x.chapters.filter((y) => y.id !== c.id).map((y, k) => ({ ...y, n: k + 1 })) }))); setOpenChapter(null); } }}>Delete chapter</button></div>}
      </div>
    );
  }

  return (
    <div className="fm-inspector">
      <div className="fm-head"><div><div className="fm-kicker">The book</div><h2 className="fm-title">Chapters & references</h2></div></div>
      {!books.length && <div className="fm-muted">{gm ? "Add the book you are writing: its chapters can then be cited by places and events, and link to the text." : "No book shared yet."}</div>}
      {books.map((b) => (
        <div key={b.id} className="fm-book">
          {gm && editBook === b.id ? (
            <div className="fm-grid2">
              <label>Title<input className="fm-in" value={b.title} onChange={(e) => setBook(b.id, { title: e.target.value })} /></label>
              <label>Author<input className="fm-in" value={b.author || ""} onChange={(e) => setBook(b.id, { author: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Link<input className="fm-in" placeholder="https://…" value={b.url || ""} onChange={(e) => setBook(b.id, { url: e.target.value })} /></label>
              <label className="fm-check"><input type="checkbox" checked={!!b.hidden} onChange={(e) => setBook(b.id, { hidden: e.target.checked })} /> Hidden from players</label>
              <span className="fm-row end" style={{ margin: 0 }}>
                <button className="fm-btn danger" onClick={() => { if (window.confirm(`Delete "${b.title}" and its chapters?`)) setBooks((bs) => bs.filter((x) => x.id !== b.id)); }}>Delete</button>
                <button className="fm-btn" onClick={() => setEditBook(null)}>Done</button>
              </span>
            </div>
          ) : (
            <div className="fm-row between">
              <div><b className="fm-booktitle">{b.title}</b>{b.author && <span className="fm-muted"> — {b.author}</span>}{b.url && <a className="fm-ext" href={b.url} target="_blank" rel="noopener noreferrer"> ↗</a>}</div>
              {gm && <button className="fm-link" onClick={() => setEditBook(b.id)}>edit</button>}
            </div>
          )}
          <ol className="fm-chapters">
            {(b.chapters || []).filter((c) => gm || !c.hidden).map((c) => {
              const n = citing(map, c.id).length;
              return (
                <li key={c.id} className={c.hidden ? "hidden" : ""}>
                  <button className="fm-item" onClick={() => setOpenChapter(c.id)}><span>{c.n}. {c.title}{c.url ? " ↗" : ""}</span><small>{n ? `${n} on the map` : ""}</small></button>
                  {gm && <span className="fm-updown"><button onClick={() => moveChapter(b.id, c.id, -1)}>▲</button><button onClick={() => moveChapter(b.id, c.id, 1)}>▼</button></span>}
                </li>
              );
            })}
          </ol>
          {gm && <button className="fm-btn" onClick={() => setBooks((bs) => bs.map((x) => (x.id === b.id ? { ...x, chapters: [...x.chapters, emptyChapter(x)] } : x)))}>+ Chapter</button>}
        </div>
      ))}
      {gm && <div className="fm-row"><button className="fm-btn primary" onClick={() => { const nb = emptyBook((map.books || []).length + 1); setBooks((bs) => [...bs, nb]); setEditBook(nb.id); }}>+ Book</button></div>}
      <div className="fm-muted fm-small">In any description, <b>[[Name]]</b> links to a place, event, book or chapter by name (<b>[[Name|shown text]]</b> to change the words). Use 🔗 to copy a link that opens this map on a place or a chapter — paste it in your manuscript.</div>
    </div>
  );
}
