import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateStation, stationSpec, blockDetail, summarizeStation, BLOCK_TYPES, SHOP_KINDS, UNIT_M,
  updateBlock, addBlock, removeBlock, addShop, updateShop, removeShop,
} from "@galaxy-core/lib/stationGen.js";

// Station Gen tab (Docs/15-settlement-generators.md): generate and edit the
// block layout of an orbital/mining station body or a company's notable
// ship. The layout is stored on the target itself (`body.layout` /
// `notableShips[i].layout`) and saved with the project like any other edit.
// Graphics are deliberately plain (flat colored blocks) — the look comes later.
const TYPES = Object.keys(BLOCK_TYPES);
const ARCHETYPES = ["auto", "orbital", "vessel", "mining"];
const PURPOSES = ["auto", "cargo", "tourism", "diplomacy", "private", "research", "military", "colony", "trade", "logistics", "shipyard", "fortress", "waystation", "fuel", "metropolis", "mining"];
const VENUE = new Set(["dining", "commercial", "recreation"]);
const SHOP_KIND_LIST = [...new Set([...SHOP_KINDS.dining, ...SHOP_KINDS.commercial, ...SHOP_KINDS.recreation, ...SHOP_KINDS.mess])];

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

export default function StationGen({ project, setProject }) {
  const [mode, setMode] = useState("stations");
  const [systemSlug, setSystemSlug] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [targetKey, setTargetKey] = useState(null); // "body:<sys>:<slug>" | "ship:<company>:<slug>"
  const [opts, setOpts] = useState({ archetype: "auto", purpose: "auto", seed: "" });
  const [deck, setDeck] = useState(0);
  const [sel, setSel] = useState(null);
  const [shopQuery, setShopQuery] = useState("");

  const stationSystems = useMemo(() => project.systems.filter((s) => (s.bodies || []).some((b) => b.kind === "orbital station")), [project.systems]);
  const companies = useMemo(() => project.companies.filter((c) => (c.notableShips || []).length), [project.companies]);
  const models = useMemo(() => new Map((project.shipModels || []).map((m) => [m.slug, m])), [project.shipModels]);

  // resolve the current target from the live project
  const target = useMemo(() => {
    if (!targetKey) return null;
    const [kind, owner, slug] = targetKey.split("|");
    if (kind === "body") {
      const sys = project.systems.find((s) => s.slug === owner);
      const body = sys?.bodies?.find((b) => b.slug === slug);
      return body ? { kind, owner, slug, entity: body, label: body.name, sub: `${body.sizeClass || "station"} · ${fmt(Number(body.population) || 0)} aboard · ${body.lengthM || "?"} m`, genInput: body } : null;
    }
    const co = project.companies.find((c) => c.slug === owner);
    const ship = co?.notableShips?.find((s) => s.slug === slug);
    if (!ship) return null;
    const model = models.get(ship.modelSlug);
    return { kind, owner, slug, entity: ship, label: ship.name, sub: model ? `${model.hullClass} · ${model.sizeCategory} · crew ${model.crew}` : "unknown model", genInput: { ...ship, model: model || { sizeCategory: "Medium", crew: 6, role: co.role } } };
  }, [targetKey, project.systems, project.companies, models]);

  const layout = target?.entity.layout || null;

  const writeLayout = useCallback((next) => {
    if (!target) return;
    const { kind, owner, slug } = target;
    setProject((p) => {
      if (kind === "body") {
        return {
          ...p,
          systems: p.systems.map((s) => (s.slug !== owner ? s : {
            ...s,
            locked: true, // a hand-made layout is curation: keep it through "Generate planets"
            bodies: s.bodies.map((b) => (b.slug === slug ? (next ? { ...b, layout: next } : (({ layout: _l, ...rest }) => rest)(b)) : b)),
          })),
        };
      }
      return {
        ...p,
        companies: p.companies.map((c) => (c.slug !== owner ? c : {
          ...c,
          notableShips: c.notableShips.map((s) => (s.slug === slug ? (next ? { ...s, layout: next } : (({ layout: _l, ...rest }) => rest)(s)) : s)),
        })),
      };
    });
  }, [target, setProject]);

  useEffect(() => { setSel(null); setDeck(0); }, [targetKey]);
  useEffect(() => { if (layout && deck >= layout.decks.length) setDeck(0); }, [layout, deck]);

  const spec = useMemo(() => (target ? stationSpec(target.genInput, { archetype: opts.archetype, purpose: opts.purpose === "auto" ? undefined : opts.purpose, seed: opts.seed || `station:${target.slug}` }) : null), [target, opts]);

  const generate = (reroll) => {
    if (!target) return;
    if (layout && !window.confirm("Replace the current layout? Manual edits and shop names on it are lost.")) return;
    const seed = reroll ? `station:${target.slug}:${Math.random().toString(36).slice(2, 8)}` : opts.seed || `station:${target.slug}`;
    const l = generateStation(target.genInput, { archetype: opts.archetype, purpose: opts.purpose === "auto" ? undefined : opts.purpose, seed });
    if (!l) { window.alert("Colossal hulls (city-ships like the Gemini) are built by the City generator, not here."); return; }
    setOpts((o) => ({ ...o, seed }));
    writeLayout(l);
    setDeck(Math.floor(l.decks.length / 2));
    setSel(null);
  };

  const selBlock = layout?.blocks.find((b) => b.id === sel) || null;
  const summary = useMemo(() => (layout ? summarizeStation(layout) : null), [layout]);

  const allShops = useMemo(() => {
    if (!summary) return [];
    const q = shopQuery.trim().toLowerCase();
    return layout.shops.map((s, i) => ({ ...s, where: summary.shops[i]?.where })).filter((s) => !q || `${s.name} ${s.kind}`.toLowerCase().includes(q));
  }, [layout, summary, shopQuery]);

  return (
    <div className="gg-station">
      <aside className="gg-station-side">
        <div className="gg-tool-row">
          <button className={mode === "stations" ? "active" : ""} onClick={() => setMode("stations")}>Stations</button>
          <button className={mode === "ships" ? "active" : ""} onClick={() => setMode("ships")}>Ships</button>
        </div>
        {mode === "stations" ? (
          <>
            <label className="small muted">System ({stationSystems.length} with stations)</label>
            <select value={systemSlug} onChange={(e) => setSystemSlug(e.target.value)}>
              <option value="">— pick a system —</option>
              {stationSystems.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </select>
            <div className="gg-station-list">
              {(project.systems.find((s) => s.slug === systemSlug)?.bodies || []).filter((b) => b.kind === "orbital station").map((b) => {
                const k = `body|${systemSlug}|${b.slug}`;
                return (
                  <button key={k} className={targetKey === k ? "active" : ""} onClick={() => setTargetKey(k)}>
                    {b.layout ? "▣ " : "□ "}{b.name}<span className="muted"> · {b.sizeClass}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <label className="small muted">Company</label>
            <select value={companySlug} onChange={(e) => setCompanySlug(e.target.value)}>
              <option value="">— pick a company —</option>
              {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
            <div className="gg-station-list">
              {(project.companies.find((c) => c.slug === companySlug)?.notableShips || []).map((s) => {
                const k = `ship|${companySlug}|${s.slug}`;
                const m = models.get(s.modelSlug);
                return (
                  <button key={k} className={targetKey === k ? "active" : ""} onClick={() => setTargetKey(k)}>
                    {s.layout ? "▣ " : "□ "}{s.name}<span className="muted"> · {m?.hullClass || "?"}</span>
                  </button>
                );
              })}
            </div>
            <p className="small muted">Ships live on companies: regenerating companies (Generate tab) replaces generated ships and their layouts.</p>
          </>
        )}

        {target && (
          <>
            <h3 className="gg-station-title">{target.label}</h3>
            <p className="small muted">{target.sub}</p>
            <div className="gg-city-row">
              <label className="small muted">Shape
                <select value={opts.archetype} onChange={(e) => setOpts({ ...opts, archetype: e.target.value })}>
                  {ARCHETYPES.map((a) => <option key={a} value={a}>{a === "auto" ? `auto (${spec?.archetype})` : a}</option>)}
                </select>
              </label>
              <label className="small muted">Purpose
                <select value={opts.purpose} onChange={(e) => setOpts({ ...opts, purpose: e.target.value })}>
                  {PURPOSES.map((a) => <option key={a} value={a}>{a === "auto" ? `auto (${spec?.purpose})` : a}</option>)}
                </select>
              </label>
            </div>
            <p className="small muted">
              {spec && <>{fmt(spec.lengthM)} m long · {fmt(spec.population)} aboard{spec.passengers ? ` (${fmt(spec.passengers)} passengers)` : ""}</>}
            </p>
            <div className="gg-tool-row">
              <button onClick={() => generate(false)}>{layout ? "Regenerate" : "Generate"}</button>
              <button onClick={() => generate(true)} title="New random seed">Reroll</button>
              {layout && <button onClick={() => window.confirm("Remove this layout?") && writeLayout(null)}>Remove</button>}
            </div>
          </>
        )}

        {summary && (
          <div className="gg-station-summary small">
            <div>{summary.archetype} · {summary.purpose} · {fmt(summary.footprintM.length)}×{fmt(summary.footprintM.width)} m · {summary.decks} decks{summary.decks !== summary.drawnDecks ? ` (drawn as ${summary.drawnDecks}, ${layout.decks[0].levels} each)` : ""}</div>
            <div>{summary.blocks} blocks · {summary.lifts} lifts · {layout.shops.length} named venues</div>
            <div>Bunks for ~{fmt(summary.capacity)} · aboard {fmt(summary.population)}</div>
          </div>
        )}

        {selBlock && (
          <BlockInspector
            layout={layout}
            block={selBlock}
            onChange={(patch) => writeLayout(updateBlock(layout, selBlock.id, patch))}
            onDelete={() => { writeLayout(removeBlock(layout, selBlock.id)); setSel(null); }}
            onAddShop={() => writeLayout(addShop(layout, selBlock.id, selBlock.type === "dining" ? "bar" : selBlock.type === "recreation" ? "gym" : "general store"))}
            onShop={(id, patch) => writeLayout(updateShop(layout, id, patch))}
            onRemoveShop={(id) => writeLayout(removeShop(layout, id))}
          />
        )}

        {layout && (
          <>
            <h4>Venues</h4>
            <input placeholder="Search: pub, bar, weapons…" value={shopQuery} onChange={(e) => setShopQuery(e.target.value)} />
            <div className="gg-station-shops">
              {allShops.slice(0, 200).map((s) => (
                <button key={s.id} onClick={() => { const b = layout.blocks.find((x) => x.id === s.blockId); if (b) { setDeck(b.deck); setSel(b.id); } }}>
                  <b>{s.name}</b> <span className="muted">· {s.kind}</span><br /><span className="muted small">{s.where}</span>
                </button>
              ))}
              {!allShops.length && <p className="small muted">No venues{shopQuery ? " match" : ""}.</p>}
            </div>
          </>
        )}
      </aside>

      <section className="gg-station-main">
        {!layout ? (
          <div className="gg-empty">
            <h1>STATION GEN</h1>
            <p>Pick a station or a ship on the left and generate its layout: prefab blocks on a 2 m grid, deck by deck, with named venues.</p>
          </div>
        ) : (
          <>
            <div className="gg-deckbar">
              {layout.decks.map((d) => (
                <button key={d.z} className={deck === d.z ? "active" : ""} onClick={() => setDeck(d.z)}>{d.name}</button>
              ))}
              <span style={{ flexGrow: 1 }} />
              <button onClick={() => {
                const s = layout.module * 2;
                const { layout: next, block } = addBlock(layout, deck, { x: layout.footprint.w / 2 - s / 2, y: layout.footprint.h / 2 - s / 2, w: s, h: s }, "habitation");
                writeLayout(next); setSel(block.id);
              }}>+ Block</button>
            </div>
            <Plan
              key={`${targetKey}:${layout.seed}:${layout.footprint.w}`}
              layout={layout}
              deck={deck}
              sel={sel}
              onSelect={setSel}
              onMove={(id, rect) => writeLayout(updateBlock(layout, id, rect))}
            />
            <Section layout={layout} deck={deck} sel={selBlock} onPick={(b) => { setDeck(b.deck); setSel(b.id); }} />
            <Legend />
          </>
        )}
      </section>
    </div>
  );
}

function BlockInspector({ layout, block, onChange, onDelete, onAddShop, onShop, onRemoveShop }) {
  const shops = layout.shops.filter((s) => s.blockId === block.id);
  const num = (k) => (
    <label className="small muted">{k} (u)
      <input type="number" min={k === "w" || k === "h" ? 1 : undefined} value={block[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="gg-district active">
      <input value={block.name} onChange={(e) => onChange({ name: e.target.value })} />
      <label className="small muted">Purpose
        <select value={block.type} onChange={(e) => onChange({ type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{BLOCK_TYPES[t].label}</option>)}
        </select>
      </label>
      <div className="gg-city-row">{num("x")}{num("y")}{num("w")}{num("h")}</div>
      <p className="small muted">{block.w * UNIT_M} × {block.h * UNIT_M} m · {block.doors?.length || 0} door(s) · {layout.decks[block.deck]?.name}</p>
      {VENUE.has(block.type) && (
        <>
          {shops.map((s) => (
            <div key={s.id} className="gg-shop-row">
              <input value={s.name} onChange={(e) => onShop(s.id, { name: e.target.value })} />
              <select value={s.kind} onChange={(e) => onShop(s.id, { kind: e.target.value })}>
                {SHOP_KIND_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button onClick={() => onRemoveShop(s.id)} title="Remove venue">✕</button>
            </div>
          ))}
          <button onClick={onAddShop}>+ Venue</button>
        </>
      )}
      <div className="gg-tool-row" style={{ marginTop: 8 }}>
        <button onClick={onDelete}>Delete block</button>
      </div>
    </div>
  );
}

// Plan view: SVG in unit coordinates, wheel = zoom, drag background = pan,
// drag a block = move it (snapped to the grid), drag its corner = resize.
// Double-click a block to zoom onto it. Blocks big enough on screen show
// their interior (blockDetail) — the dynamic level of detail.
function Plan({ layout, deck, sel, onSelect, onMove }) {
  const svgRef = useRef(null);
  const fit = useCallback(() => {
    const pad = Math.max(layout.footprint.w, layout.footprint.h) * 0.04;
    return { x: -pad, y: -pad, w: layout.footprint.w + pad * 2, h: layout.footprint.h + pad * 2 };
  }, [layout.footprint.w, layout.footprint.h]);
  const [vb, setVb] = useState(fit);
  const [px, setPx] = useState(800);
  const drag = useRef(null);
  const [ghost, setGhost] = useState(null); // live rect while dragging a block

  useEffect(() => {
    const el = svgRef.current;
    const ro = new ResizeObserver(() => setPx(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toUnits = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const k = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x + (vb.w - r.width * k) / 2, oy = vb.y + (vb.h - r.height * k) / 2;
    return { x: ox + (e.clientX - r.left) * k, y: oy + (e.clientY - r.top) * k, k };
  };

  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const p = toUnits(e);
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      setVb((v) => {
        const w = Math.min(Math.max(v.w * f, 4), fit().w * 4), h = (w / v.w) * v.h;
        return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const blocks = layout.blocks.filter((b) => b.deck === deck);
  const lifts = (layout.lifts || []).filter((l) => l.decks.includes(deck));
  const upp = vb.w / px; // units per pixel (approx.)

  const down = (e, b, handle) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const p = toUnits(e);
    if (b) onSelect(b.id);
    drag.current = { b, handle, start: p, vb0: vb, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = toUnits(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > upp * 3) d.moved = true;
    if (!d.b) { setVb({ ...d.vb0, x: d.vb0.x - dx, y: d.vb0.y - dy }); return; }
    const snap = (v) => Math.round(v);
    setGhost(d.handle
      ? { id: d.b.id, x: d.b.x, y: d.b.y, w: Math.max(1, snap(d.b.w + dx)), h: Math.max(1, snap(d.b.h + dy)) }
      : { id: d.b.id, x: snap(d.b.x + dx), y: snap(d.b.y + dy), w: d.b.w, h: d.b.h });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.b && d.moved && ghost) onMove(d.b.id, { x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h });
    if (d && !d.b && !d.moved) onSelect(null);
    setGhost(null);
  };
  const zoomTo = (b) => {
    const pad = Math.max(b.w, b.h) * 0.25;
    setVb({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
  };

  // LOD: interior for the (few) blocks that are large on screen
  const detailed = blocks
    .filter((b) => b.type !== "transit" && b.w / upp > 180 && b.x < vb.x + vb.w && b.x + b.w > vb.x && b.y < vb.y + vb.h && b.y + b.h > vb.y)
    .slice(0, 8);
  const fs = 11 * upp; // 11px text

  return (
    <div className="gg-plan">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={(e) => down(e, null)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          // pointer capture retargets events to the svg, so hit-test here
          const p = toUnits(e);
          const hit = blocks.filter((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
          if (hit) zoomTo(hit);
        }}
      >
        <rect x={0} y={0} width={layout.footprint.w} height={layout.footprint.h} fill="none" stroke="rgba(255,154,60,.15)" strokeWidth={upp} strokeDasharray={`${upp * 4} ${upp * 4}`} />
        {blocks.map((b0) => {
          const b = ghost?.id === b0.id ? { ...b0, ...ghost } : b0;
          const t = BLOCK_TYPES[b.type] || BLOCK_TYPES.technical;
          const big = b.w / upp > 60 && b.h / upp > 18;
          return (
            <g key={b.id} onPointerDown={(e) => down(e, b0, false)} style={{ cursor: "move" }}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={t.color} fillOpacity={b.type === "transit" ? 0.35 : 0.55} stroke={sel === b.id ? "#5fd3f3" : "#03050a"} strokeWidth={sel === b.id ? upp * 2.5 : upp} />
              {big && <text x={b.x + b.w / 2} y={b.y + b.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="middle" fill="#ece6da" pointerEvents="none">{b.name}</text>}
            </g>
          );
        })}
        {detailed.map((b) => <Detail key={`d${b.id}`} layout={layout} block={b} upp={upp} />)}
        {blocks.flatMap((b) => (b.doors || []).map((d, i) => {
          const s = Math.max(upp * 3, Math.min(1, b.w, b.h) * 0.5);
          const v = d.side === "e" || d.side === "w";
          return <rect key={`${b.id}d${i}`} x={d.x - (v ? upp : s / 2)} y={d.y - (v ? s / 2 : upp)} width={v ? upp * 2 : s} height={v ? s : upp * 2} fill="#ece6da" pointerEvents="none" />;
        }))}
        {lifts.map((l) => (
          <g key={l.id} pointerEvents="none">
            <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#03050a" stroke="#5fd3f3" strokeWidth={upp * 1.5} />
            <text x={l.x + l.w / 2} y={l.y + l.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="middle" fill="#5fd3f3">⇅</text>
          </g>
        ))}
        {sel && (() => {
          const b0 = blocks.find((b) => b.id === sel);
          if (!b0) return null;
          const b = ghost?.id === b0.id ? { ...b0, ...ghost } : b0;
          const s = upp * 10;
          return <rect x={b.x + b.w - s / 2} y={b.y + b.h - s / 2} width={s} height={s} fill="#5fd3f3" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => down(e, b0, true)} />;
        })()}
      </svg>
      <div className="gg-plan-hint">
        {layout.unitM} m grid · wheel zoom · drag to pan / move · corner to resize · double-click a block to zoom in
        <button onClick={() => setVb(fit())}>Fit</button>
      </div>
    </div>
  );
}

function Detail({ layout, block, upp }) {
  const { rooms, hall } = useMemo(() => blockDetail(layout, block), [layout, block]);
  const fs = 10 * upp;
  return (
    <g pointerEvents="none">
      {hall && <rect x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill="#5b6270" fillOpacity={0.5} />}
      {rooms.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#03050a" strokeOpacity={0.8} strokeWidth={upp} />
          {r.w / upp > 50 && r.h / upp > 14 && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="middle" fill={r.shopId || r.kind ? "#ffb866" : "#ece6da"}>{r.label}</text>
          )}
        </g>
      ))}
    </g>
  );
}

// Side section: decks stacked (top deck on top) along the long axis, cut
// through the selected block (or the middle of the hull). Click to jump.
function Section({ layout, deck, sel, onPick }) {
  // default cut: the row near the middle crossing the fewest corridors
  const cutY = useMemo(() => {
    if (sel) return sel.y + sel.h / 2;
    const h = layout.footprint.h, m = layout.module || 1;
    let best = h / 2, bestT = Infinity;
    for (let k = -3; k <= 3; k++) {
      const y = h / 2 + k * m * 0.5 + 0.01;
      const t = layout.blocks.filter((b) => b.type === "transit" && b.y <= y && b.y + b.h > y).reduce((a, b) => a + b.w, 0);
      if (t < bestT) { bestT = t; best = y; }
    }
    return best;
  }, [layout, sel]);
  const n = layout.decks.length;
  const W = layout.footprint.w;
  const rowH = W / 40; // flat strip
  const H = rowH * n;
  return (
    <div className="gg-section">
      <svg viewBox={`${-W * 0.01} ${-rowH * 0.2} ${W * 1.02} ${H + rowH * 0.4}`} preserveAspectRatio="none">
        {layout.decks.map((d) => {
          const y = d.z * rowH; // deck 0 on top
          return (
            <g key={d.z}>
              <rect x={0} y={y} width={W} height={rowH} fill={d.z === deck ? "rgba(255,154,60,.08)" : "none"} />
              {layout.blocks.filter((b) => b.deck === d.z && b.y <= cutY && b.y + b.h > cutY).map((b) => (
                <rect key={b.id} x={b.x} y={y + rowH * 0.08} width={b.w} height={rowH * 0.84} fill={BLOCK_TYPES[b.type]?.color || "#777"} fillOpacity={b.type === "transit" ? 0.3 : 0.65} stroke={sel?.id === b.id ? "#5fd3f3" : "#03050a"} strokeWidth={W / 800} onClick={() => onPick(b)} style={{ cursor: "pointer" }} />
              ))}
            </g>
          );
        })}
      </svg>
      <span className="gg-plan-hint">SECTION · cut through {sel ? sel.name : "the middle of the hull"}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="gg-legend">
      {TYPES.map((t) => <span key={t}><i style={{ background: BLOCK_TYPES[t].color }} />{BLOCK_TYPES[t].label}</span>)}
    </div>
  );
}
