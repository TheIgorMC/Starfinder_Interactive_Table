import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateStation, stationSpec, blockDetail, summarizeStation, BLOCK_TYPES, SHOP_KINDS, UNIT_M,
  updateBlock, addBlock, removeBlock, addShop, updateShop, removeShop,
} from "@galaxy-core/lib/stationGen.js";
import { blockInterior, stationWealth } from "@galaxy-core/lib/stationInterior.js";
import { libraryFor, ZONE_COLORS } from "@galaxy-core/lib/stationLibrary.js";
import KitPlan, { placeTransform } from "../kit/KitPlan.jsx";
import { Icon } from "../../galaxy/ui.jsx";
import { Head } from "../shell/Inspectors.jsx";

// STATIONS workspace (Docs/15-settlement-generators.md): generate and edit
// the block layout of a station body or a company's notable ship, in the
// viewer's look — plan on a blueprint ground in the middle, target and
// generator on the left, block / venue inspector on the right, deck
// section along the bottom. The layout is stored on the target itself
// (`body.layout` / `notableShips[i].layout`).
const TYPES = Object.keys(BLOCK_TYPES);
const ARCHETYPES = ["auto", "orbital", "vessel", "mining"];
const PURPOSES = ["auto", "cargo", "tourism", "diplomacy", "private", "research", "military", "colony", "trade", "logistics", "shipyard", "fortress", "waystation", "fuel", "metropolis", "mining"];
const VENUE = new Set(["dining", "commercial", "recreation"]);
const SHOP_KIND_LIST = [...new Set([...SHOP_KINDS.dining, ...SHOP_KINDS.commercial, ...SHOP_KINDS.recreation, ...SHOP_KINDS.mess])];

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const stationKey = (kind, owner, slug) => `${kind}|${owner}|${slug}`;

export default function StationGen({ project, setProject, initialTarget, active = true }) {
  const [mode, setMode] = useState(initialTarget?.startsWith("ship|") ? "ships" : "stations");
  const [targetKey, setTargetKey] = useState(initialTarget || null);
  const [ownerPick, setOwnerPick] = useState(() => initialTarget?.split("|")[1] || "");
  const [opts, setOpts] = useState({ archetype: "auto", purpose: "auto", seed: "" });
  const [deck, setDeck] = useState(0);
  const [sel, setSel] = useState(null);
  // extra blocks picked with Shift+click, on top of the primary `sel`
  const [extra, setExtra] = useState([]);
  const select = useCallback((id) => { setSel(id); setExtra([]); }, []);
  const pick = useCallback((id, add) => {
    if (!add || !id) { select(id); return; }
    if (id === sel) { setSel(extra[0] || null); setExtra(extra.slice(1)); return; }
    if (extra.includes(id)) { setExtra(extra.filter((x) => x !== id)); return; }
    if (!sel) setSel(id); else setExtra([...extra, id]);
  }, [sel, extra, select]);
  const [shopQuery, setShopQuery] = useState("");
  useEffect(() => { if (initialTarget) { setTargetKey(initialTarget); setOwnerPick(initialTarget.split("|")[1]); setMode(initialTarget.startsWith("ship|") ? "ships" : "stations"); } }, [initialTarget]);

  const stationSystems = useMemo(() => project.systems.filter((s) => (s.bodies || []).some((b) => b.kind === "orbital station")).sort((a, b) => a.name.localeCompare(b.name)), [project.systems]);
  const companies = useMemo(() => project.companies.filter((c) => (c.notableShips || []).length), [project.companies]);
  const models = useMemo(() => new Map((project.shipModels || []).map((m) => [m.slug, m])), [project.shipModels]);
  const withLayouts = useMemo(() => {
    const out = [];
    for (const s of project.systems) for (const b of s.bodies || []) if (b.layout) out.push({ key: stationKey("body", s.slug, b.slug), name: b.name });
    for (const c of project.companies) for (const sh of c.notableShips || []) if (sh.layout) out.push({ key: stationKey("ship", c.slug, sh.slug), name: `${sh.name} (${c.name})` });
    return out;
  }, [project.systems, project.companies]);

  const target = useMemo(() => {
    if (!targetKey) return null;
    const [kind, owner, slug] = targetKey.split("|");
    if (kind === "body") {
      const sys = project.systems.find((s) => s.slug === owner);
      const body = sys?.bodies?.find((b) => b.slug === slug);
      return body ? { kind, owner, slug, entity: body, label: body.name, where: sys.name, sub: `${body.sizeClass || "station"} · ${fmt(Number(body.population) || 0)} aboard · ${body.lengthM || "?"} m`, genInput: body } : null;
    }
    const co = project.companies.find((c) => c.slug === owner);
    const ship = co?.notableShips?.find((s) => s.slug === slug);
    if (!ship) return null;
    const model = models.get(ship.modelSlug);
    return { kind, owner, slug, entity: ship, label: ship.name, where: co.name, sub: model ? `${model.hullClass} · ${model.sizeCategory} · crew ${model.crew}` : "unknown model", genInput: { ...ship, model: model || { sizeCategory: "Medium", crew: 6, role: co.role } } };
  }, [targetKey, project.systems, project.companies, models]);

  const layout = target?.entity.layout || null;
  const lib = useMemo(() => libraryFor(project), [project.stationKit]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeLayout = useCallback((next) => {
    if (!target) return;
    const { kind, owner, slug } = target;
    const put = (x) => (next ? { ...x, layout: next } : (({ layout: _l, ...rest }) => rest)(x));
    setProject((p) => (kind === "body"
      ? { ...p, systems: p.systems.map((s) => (s.slug !== owner ? s : { ...s, locked: true, bodies: s.bodies.map((b) => (b.slug === slug ? put(b) : b)) })) }
      : { ...p, companies: p.companies.map((c) => (c.slug !== owner ? c : { ...c, notableShips: c.notableShips.map((s) => (s.slug === slug ? put(s) : s)) })) }));
  }, [target, setProject]);

  useEffect(() => { select(null); setDeck(layout ? Math.floor(layout.decks.length / 2) : 0); }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (layout && deck >= layout.decks.length) setDeck(0); }, [layout, deck]);

  const spec = useMemo(() => (target ? stationSpec(target.genInput, { archetype: opts.archetype, purpose: opts.purpose === "auto" ? undefined : opts.purpose, seed: opts.seed || `station:${target.slug}` }) : null), [target, opts]);

  const generate = (reroll) => {
    if (!target) return;
    if (layout && !window.confirm("Replace the current layout? Manual edits and venue names on it are lost.")) return;
    const seed = reroll ? `station:${target.slug}:${Math.random().toString(36).slice(2, 8)}` : opts.seed || `station:${target.slug}`;
    const l = generateStation(target.genInput, { archetype: opts.archetype, purpose: opts.purpose === "auto" ? undefined : opts.purpose, seed });
    if (!l) { window.alert("Colossal hulls (city-ships like the Gemini) are built by the City generator, not here."); return; }
    setOpts((o) => ({ ...o, seed }));
    writeLayout(l);
    setDeck(Math.floor(l.decks.length / 2));
    select(null);
  };

  const selBlock = layout?.blocks.find((b) => b.id === sel) || null;

  // Canc / Backspace deletes every selected block, Esc clears the selection
  useEffect(() => {
    const onKey = (e) => {
      if (!active || !layout || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.key === "Escape") { select(null); return; }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const ids = [sel, ...extra].filter(Boolean);
      if (!ids.length) return;
      e.preventDefault();
      writeLayout(ids.reduce((l, id) => removeBlock(l, id), layout));
      select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, layout, sel, extra, select, writeLayout]);
  const summary = useMemo(() => (layout ? summarizeStation(layout) : null), [layout]);
  const allShops = useMemo(() => {
    if (!summary) return [];
    const q = shopQuery.trim().toLowerCase();
    return layout.shops.map((s, i) => ({ ...s, where: summary.shops[i]?.where })).filter((s) => !q || `${s.name} ${s.kind}`.toLowerCase().includes(q));
  }, [layout, summary, shopQuery]);

  const ownerList = mode === "stations"
    ? (project.systems.find((s) => s.slug === ownerPick)?.bodies || []).filter((b) => b.kind === "orbital station").map((b) => ({ key: stationKey("body", ownerPick, b.slug), name: b.name, sub: b.sizeClass, has: !!b.layout }))
    : (project.companies.find((c) => c.slug === ownerPick)?.notableShips || []).map((s) => ({ key: stationKey("ship", ownerPick, s.slug), name: s.name, sub: models.get(s.modelSlug)?.hullClass || "?", has: !!s.layout }));

  return (
    <div className="ge-stws">
      {/* sub bar */}
      <div className="ge-subbar">
        <div className="gx-titleblock">
          <div className="gx-eyebrow">{target ? `${target.kind === "body" ? "STATION" : "SHIP"} LAYOUT · ${target.where}` : "STATION & SHIP LAYOUTS"}</div>
          <h1 className="gx-title">{target ? target.label : "Pick a station or ship"}</h1>
        </div>
        <div className="gx-grow" />
        {withLayouts.length > 0 && (
          <select className="gx-select" value={withLayouts.some((w) => w.key === targetKey) ? targetKey : ""} onChange={(e) => e.target.value && setTargetKey(e.target.value)} aria-label="Jump to a layout">
            <option value="">Layouts ({withLayouts.length})…</option>
            {withLayouts.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
          </select>
        )}
        {layout && layout.decks.length > 1 && (
          <div role="group" aria-label="Deck" className="gx-group ge-decks">
            {layout.decks.map((d) => <button key={d.z} className={"gx-tbtn" + (deck === d.z ? " on" : "")} onClick={() => setDeck(d.z)}>{d.name.toUpperCase()}</button>)}
          </div>
        )}
      </div>

      {/* left: target + generator */}
      <nav className="gx-left gx-scroll ge-left" aria-label="Target">
        <div className="gx-sec">
          <div className="gx-label">TARGET</div>
          <div className="ge-seg">
            <button className={mode === "stations" ? "on" : ""} onClick={() => { setMode("stations"); setOwnerPick(""); }}>STATIONS</button>
            <button className={mode === "ships" ? "on" : ""} onClick={() => { setMode("ships"); setOwnerPick(""); }}>SHIPS</button>
          </div>
          <select className="ge-in" value={ownerPick} onChange={(e) => setOwnerPick(e.target.value)}>
            <option value="">{mode === "stations" ? `System (${stationSystems.length} with stations)…` : `Company (${companies.length})…`}</option>
            {(mode === "stations" ? stationSystems : companies).map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
          </select>
          <div className="ge-rows">
            {ownerList.map((o) => (
              <button key={o.key} className={"gx-gbtn gx-row" + (targetKey === o.key ? " on" : "")} onClick={() => setTargetKey(o.key)}>
                <span className="ge-sq" style={{ background: o.has ? "#ff9a3c" : "transparent" }} />
                <span className="t"><span className="a">{o.name}</span><span className="b" style={{ color: "#9a958b" }}>{o.sub}{o.has ? " · layout" : ""}</span></span>
              </button>
            ))}
          </div>
          {mode === "ships" && <div className="gx-lore">Ship layouts live on their company: regenerating companies replaces generated ships.</div>}
        </div>

        {target && (
          <div className="gx-sec">
            <div className="gx-label">GENERATOR</div>
            <div className="gx-lore">{target.sub}</div>
            <div className="ge-row">
              <label className="ge-lbl">Shape
                <select className="ge-in" value={opts.archetype} onChange={(e) => setOpts({ ...opts, archetype: e.target.value })}>
                  {ARCHETYPES.map((a) => <option key={a} value={a}>{a === "auto" ? `auto · ${spec?.archetype}` : a}</option>)}
                </select>
              </label>
              <label className="ge-lbl">Purpose
                <select className="ge-in" value={opts.purpose} onChange={(e) => setOpts({ ...opts, purpose: e.target.value })}>
                  {PURPOSES.map((a) => <option key={a} value={a}>{a === "auto" ? `auto · ${spec?.purpose}` : a}</option>)}
                </select>
              </label>
            </div>
            {layout && (
              <label className="ge-lbl">Wealth (interiors)
                <select className="ge-in" value={layout.wealth || ""} onChange={(e) => writeLayout({ ...layout, wealth: e.target.value || undefined })}>
                  <option value="">auto · {stationWealth({ ...layout, wealth: undefined })}</option>
                  <option value="poor">poor</option><option value="std">standard</option><option value="rich">rich</option>
                </select>
              </label>
            )}
            {spec && <div className="gx-lore">{fmt(spec.lengthM)} m long · {fmt(spec.population)} aboard{spec.passengers ? ` (${fmt(spec.passengers)} passengers)` : ""}</div>}
            <button className="gx-cta" onClick={() => generate(false)}>{layout ? "REGENERATE" : "GENERATE LAYOUT"}</button>
            <div className="ge-row">
              <button className="ge-btn ghost" onClick={() => generate(true)} title="New random seed">Reroll</button>
              {layout && <button className="ge-btn ghost danger" onClick={() => window.confirm("Remove this layout?") && writeLayout(null)}>Remove</button>}
            </div>
          </div>
        )}

        {summary && (
          <div className="gx-sec gx-grid" style={{ "--cols": 3, gap: 10 }}>
            <div className="gx-count"><div className="n">{summary.decks}</div><div className="l">DECKS</div></div>
            <div className="gx-count"><div className="n">{summary.blocks}</div><div className="l">BLOCKS</div></div>
            <div className="gx-count"><div className="n">{layout.shops.length}</div><div className="l">VENUES</div></div>
            <div className="gx-count"><div className="n">{fmt(summary.footprintM.length)}</div><div className="l">LENGTH M</div></div>
            <div className="gx-count"><div className="n">{fmt(summary.population)}</div><div className="l">ABOARD</div></div>
            <div className="gx-count"><div className="n">{fmt(summary.capacity)}</div><div className="l">BUNKS</div></div>
          </div>
        )}
      </nav>

      {/* center */}
      <section className="ge-stmain">
        {!layout ? (
          <div className="gx-center-msg" style={{ left: 340, right: 412 }}>
            {target ? "NO LAYOUT YET" : "PICK A STATION OR A SHIP"}
            <span style={{ fontSize: 13, letterSpacing: "0.04em", color: "#9a958b", maxWidth: 420, fontFamily: "Barlow Semi Condensed, sans-serif" }}>
              Prefab blocks on a 2 m grid, deck by deck: habitation, dining, shops, hangars, cargo, engines… with named venues.
            </span>
            {target && <button className="gx-cta" style={{ width: 260 }} onClick={() => generate(false)}>GENERATE LAYOUT</button>}
          </div>
        ) : (
          <>
            <Plan
              key={`${targetKey}:${layout.seed}:${layout.footprint.w}`}
              layout={layout}
              lib={lib}
              deck={deck}
              sel={sel}
              extra={extra}
              onSelect={pick}
              onMove={(id, rect) => writeLayout(updateBlock(layout, id, rect))}
              onReroll={() => writeLayout({ ...layout, iseed: (layout.iseed || 0) + 1 })}
              onAdd={() => {
                const s = layout.module * 2;
                const { layout: next, block } = addBlock(layout, deck, { x: layout.footprint.w / 2 - s / 2, y: layout.footprint.h / 2 - s / 2, w: s, h: s }, "habitation");
                writeLayout(next); select(block.id);
              }}
            />
            <Section layout={layout} deck={deck} sel={selBlock} onPick={(b) => { setDeck(b.deck); select(b.id); }} onDeck={setDeck} />
          </>
        )}
      </section>

      {/* right: block inspector / venue directory */}
      {layout && (
        <aside className="gx-panel gx-scroll ge-rpanel" aria-label="Details">
          {selBlock ? (
            <BlockInspector
              layout={layout}
              block={selBlock}
              onClose={() => select(null)}
              onChange={(patch) => writeLayout(updateBlock(layout, selBlock.id, patch))}
              onDelete={() => { writeLayout(removeBlock(layout, selBlock.id)); select(null); }}
              onAddShop={() => writeLayout(addShop(layout, selBlock.id, selBlock.type === "dining" ? "bar" : selBlock.type === "recreation" ? "gym" : "general store"))}
              onShop={(id, patch) => writeLayout(updateShop(layout, id, patch))}
              onRemoveShop={(id) => writeLayout(removeShop(layout, id))}
            />
          ) : (
            <>
              <Head kind="DIRECTORY" title="Venues" sub={`${layout.shops.length} named places aboard — what the PCs see on the signs`} />
              <div className="gx-sec">
                <input className="ge-in" type="search" placeholder="Search: pub, bar, weapons…" value={shopQuery} onChange={(e) => setShopQuery(e.target.value)} />
                <div className="ge-rows" style={{ maxHeight: "none" }}>
                  {allShops.slice(0, 250).map((s) => (
                    <button key={s.id} className="gx-gbtn gx-row" onClick={() => { const b = layout.blocks.find((x) => x.id === s.blockId); if (b) { setDeck(b.deck); select(b.id); } }}>
                      <span className="gx-diamond" style={{ width: 8, height: 8, background: BLOCK_TYPES[layout.blocks.find((x) => x.id === s.blockId)?.type]?.color || "#888" }} />
                      <span className="t"><span className="a">{s.name}</span><span className="b" style={{ color: "#9a958b" }}>{s.kind} · {s.where}</span></span>
                    </button>
                  ))}
                  {!allShops.length && <div className="gx-lore">No venues{shopQuery ? " match" : ""}.</div>}
                </div>
              </div>
              <div className="gx-sec">
                <div className="gx-label">BLOCK TYPES</div>
                <div className="gx-lg-grid" style={{ maxHeight: "none" }}>
                  {TYPES.map((t) => <div key={t} className="gx-lg-item"><span style={{ width: 10, height: 10, background: BLOCK_TYPES[t].color, flexShrink: 0 }} /><span className="nm">{BLOCK_TYPES[t].label}</span></div>)}
                </div>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function BlockInspector({ layout, block, onClose, onChange, onDelete, onAddShop, onShop, onRemoveShop }) {
  const shops = layout.shops.filter((s) => s.blockId === block.id);
  const t = BLOCK_TYPES[block.type] || BLOCK_TYPES.technical;
  const num = (k, label) => (
    <label className="ge-lbl">{label}
      <input className="ge-in" type="number" min={k === "w" || k === "h" ? 1 : undefined} value={block[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <>
      <Head kind={t.label.toUpperCase()} dot={t.color} title={block.name} editable onRename={(name) => onChange({ name })} onClose={onClose}
        sub={`${block.zone ? `${block.zone} section · ` : ""}${layout.decks[block.deck]?.name}${(block.span || 1) > 1 ? ` (+${block.span - 1} below)` : ""} · ${block.w * UNIT_M} × ${block.h * UNIT_M} m · ${block.doors?.length || 0} door(s)`} />
      <div className="gx-sec">
        <div className="gx-label">PURPOSE</div>
        <div className="ge-types">
          {TYPES.map((k) => (
            <button key={k} className={"ge-type" + (block.type === k ? " on" : "")} onClick={() => onChange({ type: k })} title={BLOCK_TYPES[k].label}>
              <i style={{ background: BLOCK_TYPES[k].color }} />{BLOCK_TYPES[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="gx-sec">
        <div className="gx-label"><span>GEOMETRY</span><span style={{ color: "#9a958b" }}>UNITS · 1 U = 2 M</span></div>
        <div className="gx-grid" style={{ "--cols": 5, gap: 8 }}>{num("x", "X")}{num("y", "Y")}{num("w", "W")}{num("h", "H")}
          <label className="ge-lbl">Decks
            <input className="ge-in" type="number" min={1} max={3} value={block.span || 1} onChange={(e) => onChange({ span: Number(e.target.value) })} />
          </label>
        </div>
        <div className="gx-lore">Or drag the block on the plan; drag its corner handle to resize.</div>
      </div>
      <div className="gx-sec">
        <div className="gx-label">INTERIOR</div>
        <button className="gx-gbtn" onClick={() => onChange({ iseed: (block.iseed || 0) + 1 })}>REROLL INTERIOR</button>
        <div className="gx-lore">The fit-out follows the block's size and purpose on its own; this just draws a different one.</div>
      </div>
      {VENUE.has(block.type) && (
        <div className="gx-sec">
          <div className="gx-label"><span>VENUES</span><span style={{ color: "#ece6da" }}>{shops.length}</span></div>
          {shops.map((s) => (
            <div key={s.id} className="ge-shop">
              <input className="ge-in" value={s.name} onChange={(e) => onShop(s.id, { name: e.target.value })} />
              <select className="ge-in" value={s.kind} onChange={(e) => onShop(s.id, { kind: e.target.value })}>
                {SHOP_KIND_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button className="gx-gbtn ge-x" onClick={() => onRemoveShop(s.id)} aria-label="Remove venue">×</button>
            </div>
          ))}
          <button className="ge-btn ghost" onClick={onAddShop}>+ Add a venue</button>
        </div>
      )}
      <div className="gx-sec">
        <button className="ge-btn danger" onClick={onDelete}>Delete block</button>
      </div>
    </>
  );
}

// Plan view: SVG in unit coordinates on a blueprint ground. Wheel = zoom,
// drag background = pan, drag a block = move (grid snap), corner = resize,
// double-click = zoom onto a block. Blocks big enough on screen show their
// interior (blockDetail) — the dynamic level of detail.
function Plan({ layout, deck, sel, extra = [], onSelect, onMove, onAdd, onReroll, lib }) {
  const svgRef = useRef(null);
  const fit = useCallback(() => {
    const pad = Math.max(layout.footprint.w, layout.footprint.h) * 0.06;
    return { x: -pad, y: -pad, w: layout.footprint.w + pad * 2, h: layout.footprint.h + pad * 2 };
  }, [layout.footprint.w, layout.footprint.h]);
  const [vb, setVb] = useState(fit);
  const [px, setPx] = useState(800);
  const drag = useRef(null);
  const [ghost, setGhost] = useState(null);

  useEffect(() => {
    const el = svgRef.current;
    const ro = new ResizeObserver(() => { if (el.clientWidth) setPx(el.clientWidth); });
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

  const blocks = useMemo(() => layout.blocks.filter((b) => deck >= b.deck && deck < b.deck + (b.span || 1)), [layout.blocks, deck]);
  const lifts = (layout.lifts || []).filter((l) => l.decks.includes(deck));
  const r = svgRef.current?.getBoundingClientRect();
  // hidden (GM tab not shown) → 0-size box: fall back to the last known width
  const upp = r && r.width > 0 && r.height > 0 ? Math.max(vb.w / r.width, vb.h / r.height) : vb.w / Math.max(1, px);

  const down = (e, b, handle) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    // dragging pans, except on the block that is already selected (that one
    // moves); a click without dragging selects
    const moving = b && !e.shiftKey && (handle || b.id === sel) ? b : null;
    drag.current = { b: moving, tap: b, handle, add: e.shiftKey, start: toUnits(e), vb0: vb, cx: e.clientX, cy: e.clientY, k: upp, moved: false };
  };
  const raf = useRef(0);
  const panTo = (next) => {
    raf.pending = next;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; setVb(raf.pending); });
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    // screen-pixel deltas × the scale at drag start: the view moving under
    // the pointer never feeds back into the delta (that was the jitter)
    const dx = (e.clientX - d.cx) * d.k, dy = (e.clientY - d.cy) * d.k;
    if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 3) d.moved = true;
    if (!d.b) { if (d.moved) panTo({ ...d.vb0, x: d.vb0.x - dx, y: d.vb0.y - dy }); return; }
    const snap = (v) => Math.round(v);
    setGhost(d.handle
      ? { id: d.b.id, x: d.b.x, y: d.b.y, w: Math.max(1, snap(d.b.w + dx)), h: Math.max(1, snap(d.b.h + dy)) }
      : { id: d.b.id, x: snap(d.b.x + dx), y: snap(d.b.y + dy), w: d.b.w, h: d.b.h });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.b && d.moved && ghost) onMove(d.b.id, { x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h });
    if (d && !d.b && !d.moved) onSelect(d.tap ? d.tap.id : null, d.add);
    setGhost(null);
  };
  const zoomTo = (b) => {
    const pad = Math.max(b.w, b.h) * 0.3;
    setVb({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
  };
  const zoomBy = (f) => setVb((v) => { const w = Math.min(Math.max(v.w * f, 4), fit().w * 4), h = (w / v.w) * v.h; return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }; });

  // LOD: blocks on screen get their interior — kit modules (tinted rects
  // from ~7 px/U, full plan drawings from ~18 px/U), generated only for the
  // visible part; types without kit modules fall back to generic rooms.
  const pxPerU = 1 / upp;
  const view = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
  const inView = (b) => b.x < vb.x + vb.w && b.x + b.w > vb.x && b.y < vb.y + vb.h && b.y + b.h > vb.y;
  const detailed = blocks.filter((b) => b.type !== "transit" && inView(b) && (pxPerU >= 4 || b.w * pxPerU > 170)).slice(0, 40);
  const fs = 11 * upp;
  const gridStep = layout.module * Math.max(1, 2 ** Math.round(Math.log2(Math.max(1, (upp * 18) / layout.module))));
  const selB0 = blocks.find((b) => b.id === sel);
  const selB = selB0 && ghost?.id === selB0.id ? { ...selB0, ...ghost } : selB0;

  return (
    <div className="ge-plan">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={(e) => down(e, null)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          const p = toUnits(e);
          const hit = blocks.filter((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
          if (hit) zoomTo(hit);
        }}
      >
        <defs>
          <pattern id="ge-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="rgba(95,211,243,.07)" strokeWidth={upp} />
          </pattern>
          <pattern id="ge-tall" width={upp * 14} height={upp * 14} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d={`M 0 0 L 0 ${upp * 14}`} stroke="rgba(255,244,230,.16)" strokeWidth={upp * 2} />
          </pattern>
          <filter id="ge-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={upp * 6} /></filter>
        </defs>
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#ge-grid)" />
        {/* hull glow + outline: union of this deck's blocks */}
        <g opacity=".55" filter="url(#ge-glow)">
          {blocks.map((b) => <rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="rgba(255,154,60,.18)" />)}
        </g>
        {blocks.map((b0) => {
          const b = ghost?.id === b0.id ? { ...b0, ...ghost } : b0;
          const t = BLOCK_TYPES[b.type] || BLOCK_TYPES.technical;
          const tr = b.type === "transit";
          const big = b.w / upp > 64 && b.h / upp > 18;
          return (
            <g key={b.id} onPointerDown={(e) => down(e, b0, false)} style={{ cursor: "move" }}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={tr ? "#0d141f" : t.color} fillOpacity={tr ? 1 : 0.32} stroke={tr ? "rgba(95,211,243,.18)" : t.color} strokeOpacity={tr ? 1 : 0.85} strokeWidth={upp * 1.2} />
              {!tr && <rect x={b.x} y={b.y} width={b.w} height={Math.min(b.h, upp * 3)} fill={t.color} fillOpacity=".9" pointerEvents="none" />}
              {(b.span || 1) > 1 && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#ge-tall)" pointerEvents="none" />}
              {big && (
                <text x={b.x + upp * 6} y={b.y + upp * 16} fontSize={fs} fill={tr ? "rgba(159,230,248,.55)" : "#fff4e6"} pointerEvents="none" style={{ fontFamily: "Oxanium, sans-serif", letterSpacing: "0.08em" }}>
                  {b.name.toUpperCase()}{(b.span || 1) > 1 ? ` · ${b.span} DECKS${deck > b.deck ? " (UPPER LEVEL ABOVE)" : ""}` : ""}
                </text>
              )}
            </g>
          );
        })}
        {detailed.map((b) => <Interior key={`d${b.id}`} layout={layout} block={b} upp={upp} view={view} deck={deck} kit={pxPerU >= 4} lib={lib} />)}
        {blocks.flatMap((b) => (b.doors || []).filter((d) => d.deck == null || d.deck === deck).map((d, i) => {
          const s = Math.max(upp * 5, Math.min(2, b.w, b.h) * 0.5);
          const v = d.side === "e" || d.side === "w";
          return <rect key={`${b.id}d${i}`} x={d.x - (v ? upp * 1.5 : s / 2)} y={d.y - (v ? s / 2 : upp * 1.5)} width={v ? upp * 3 : s} height={v ? s : upp * 3} fill="#fff4e6" pointerEvents="none" />;
        }))}
        {lifts.map((l) => (
          <g key={l.id} pointerEvents="none">
            <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#03050a" stroke="#5fd3f3" strokeWidth={upp * 1.5} />
            <path d={`M ${l.x + l.w * 0.3} ${l.y + l.h * 0.42} L ${l.x + l.w / 2} ${l.y + l.h * 0.22} L ${l.x + l.w * 0.7} ${l.y + l.h * 0.42} M ${l.x + l.w * 0.3} ${l.y + l.h * 0.58} L ${l.x + l.w / 2} ${l.y + l.h * 0.78} L ${l.x + l.w * 0.7} ${l.y + l.h * 0.58}`} fill="none" stroke="#5fd3f3" strokeWidth={upp * 1.4} />
          </g>
        ))}
        {blocks.filter((b) => extra.includes(b.id)).map((b) => (
          <rect key={`x${b.id}`} x={b.x - upp * 3} y={b.y - upp * 3} width={b.w + upp * 6} height={b.h + upp * 6} fill="rgba(95,211,243,.08)" stroke="#5fd3f3" strokeWidth={upp * 2} strokeDasharray={`${upp * 6} ${upp * 4}`} pointerEvents="none" />
        ))}
        {selB && (() => {
          const b = selB, c = upp * 14, g = upp * 5;
          const corner = (x, y, dx, dy) => `M ${x + dx * c} ${y} L ${x} ${y} L ${x} ${y + dy * c}`;
          return (
            <g>
              <path d={[corner(b.x - g, b.y - g, 1, 1), corner(b.x + b.w + g, b.y - g, -1, 1), corner(b.x + b.w + g, b.y + b.h + g, -1, -1), corner(b.x - g, b.y + b.h + g, 1, -1)].join(" ")} fill="none" stroke="#5fd3f3" strokeWidth={upp * 2} pointerEvents="none" />
              <rect x={b.x + b.w - upp * 5} y={b.y + b.h - upp * 5} width={upp * 10} height={upp * 10} fill="#5fd3f3" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => down(e, selB0, true)} />
            </g>
          );
        })()}
      </svg>
      <div className="ge-plan-tools">
        <button className="gx-mbtn" aria-label="Zoom in" onClick={() => zoomBy(1 / 1.4)}>{Icon.plus()}</button>
        <button className="gx-mbtn" aria-label="Zoom out" onClick={() => zoomBy(1.4)}>{Icon.minus()}</button>
        <button className="gx-mbtn" aria-label="Fit" onClick={() => setVb(fit())}>{Icon.reset()}</button>
        <button className="gx-mbtn" aria-label="Add block" onClick={onAdd} title="Add a block on this deck">＋<span>BLOCK</span></button>
        <button className="gx-mbtn" aria-label="Reroll interiors" onClick={onReroll} title="Redraw every block's interior (blocks stay as they are)">↻<span>INTERIORS</span></button>
      </div>
      <div className="gx-hint" style={{ bottom: 12 }}>{layout.unitM} M GRID · DRAG TO PAN · CLICK TO SELECT · SHIFT+CLICK TO ADD · DEL TO DELETE · DRAG A SELECTED BLOCK TO MOVE · DOUBLE-CLICK TO ZOOM</div>
    </div>
  );
}

// library interior of one block (or generic rooms when no module fits its type)
const MOD_COLOR = new WeakMap();
function modColor(b) {
  if (!b) return "#262b30";
  if (MOD_COLOR.has(b)) return MOD_COLOR.get(b);
  let best = null, ba = -1;
  for (const z of b.zones || []) { const a = z.r[2] * z.r[3]; if (a > ba) { ba = a; best = z.z; } }
  const c = ZONE_COLORS[best] || "#262b30"; MOD_COLOR.set(b, c); return c;
}
function Interior({ layout, block, upp, view, deck, kit, lib }) {
  // clip snapped to 16U so panning doesn't regenerate every frame
  const q = 16, cx = Math.floor(view.x / q) * q, cy = Math.floor(view.y / q) * q;
  const cw = Math.ceil((view.x + view.w - cx) / q) * q, ch = Math.ceil((view.y + view.h - cy) / q) * q;
  const r = useMemo(() => (kit ? blockInterior(layout, block, { x: cx, y: cy, w: cw, h: ch }, lib) : null), [kit, layout, block, cx, cy, cw, ch, lib]);
  const plans = 1 / upp >= 14;
  const uppQ = 2 ** Math.round(Math.log2(upp)); // stroke/label scale, quantised so panning doesn't re-render
  const drawn = useMemo(() => (r ? <InteriorMarkup r={r} block={block} layout={layout} plans={plans} upp={uppQ} lib={lib} /> : null), [r, block, layout, plans, uppQ, lib]);
  if (!r) return <Detail layout={layout} block={block} upp={upp} />;
  if (deck > block.deck) {
    // lower level of a two-deck block: open to the level above (hangar floor, reactor pit, atrium)
    return <rect x={block.x} y={block.y} width={block.w} height={block.h} fill="url(#ge-tall)" pointerEvents="none" />;
  }
  return drawn;
}

const VENUE_FAMILIES = new Set(["F", "L"]);
function InteriorMarkup({ r, block, layout, plans, upp, lib }) {
  const shops = (layout.shops || []).filter((s) => s.blockId === block.id);
  let si = 0;
  return (
    <g pointerEvents="none">
      <rect x={block.x} y={block.y} width={block.w} height={block.h} fill="#0e1316" />
      {r.halls.map((h, i) => <rect key={`h${i}`} x={h.x} y={h.y} width={h.w} height={h.h} fill={ZONE_COLORS.CIRC} />)}
      {r.fillers.map((f, i) => <rect key={`f${i}`} x={f.x} y={f.y} width={f.w} height={f.h} fill={ZONE_COLORS[f.zone] || "#262b30"} opacity=".6" />)}
      {r.modules.map((m, i) => {
        const def = lib.byId.get(m.id);
        const venue = VENUE_FAMILIES.has(m.family) && !/^(F0|F3|F4|L0-CHAPEL)/.test(m.id) ? shops[si++] : null;
        if (!def) return null;
        return (
          <g key={i}>
            {plans ? <g transform={placeTransform(m.x, m.y, def.size[0], def.size[1], m.k)}><KitPlan block={def} labels={1 / upp >= 22} /></g>
              : <rect x={m.x + 0.05} y={m.y + 0.05} width={m.w - 0.1} height={m.h - 0.1} fill={modColor(def)} stroke="#e6ecef" strokeOpacity=".45" strokeWidth={upp} />}
            {!plans && m.height > 1 && m.w / upp > 26 && <text x={m.x + m.w - upp * 4} y={m.y + upp * 12} fontSize={upp * 10} textAnchor="end" fill="#ffb866" style={{ fontFamily: "Oxanium, sans-serif" }}>{m.height}U</text>}
            {venue && (
              <text x={m.x + m.w / 2} y={m.y + m.h / 2} fontSize={Math.max(upp * 12, 0.35)} textAnchor="middle" dominantBaseline="middle" fill="#ffb866" stroke="#0e1316" strokeWidth={upp * 3} paintOrder="stroke" style={{ fontFamily: "Oxanium, sans-serif" }}>{venue.name}</text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Detail({ layout, block, upp }) {
  const { rooms, hall } = useMemo(() => blockDetail(layout, block), [layout, block]);
  const fs = 10 * upp;
  const col = BLOCK_TYPES[block.type]?.color || "#888";
  return (
    <g pointerEvents="none">
      {hall && <rect x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill="#0d141f" stroke="rgba(95,211,243,.25)" strokeWidth={upp} />}
      {rooms.map((r, i) => (
        <g key={i}>
          <rect x={r.x + upp} y={r.y + upp} width={Math.max(0, r.w - upp * 2)} height={Math.max(0, r.h - upp * 2)} fill={col} fillOpacity={r.shopId ? 0.28 : 0.12} stroke={col} strokeOpacity=".7" strokeWidth={upp} />
          {r.w / upp > 50 && r.h / upp > 14 && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="middle" fill={r.shopId || r.kind ? "#ffb866" : "rgba(236,230,218,.8)"} style={{ fontFamily: "Barlow Semi Condensed, sans-serif" }}>{r.label}</text>
          )}
        </g>
      ))}
    </g>
  );
}

// Side section: decks stacked (first deck on top) along the long axis, cut
// through the selected block (or the least-corridor row near the middle).
function Section({ layout, deck, sel, onPick, onDeck }) {
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
  const W = layout.footprint.w;
  const rowH = W / 50;
  const H = rowH * layout.decks.length;
  return (
    <div className="ge-section">
      <div className="gx-label sm" style={{ padding: "0 4px 6px" }}><span>SECTION · CUT THROUGH {sel ? sel.name.toUpperCase() : "THE MIDDLE OF THE HULL"}</span><span>CLICK A DECK</span></div>
      <svg viewBox={`${-W * 0.01} ${-rowH * 0.2} ${W * 1.02} ${H + rowH * 0.4}`} preserveAspectRatio="none">
        {layout.decks.map((d) => {
          const y = d.z * rowH;
          return (
            <g key={d.z} onClick={() => onDeck(d.z)} style={{ cursor: "pointer" }}>
              <rect x={-W * 0.01} y={y} width={W * 1.02} height={rowH} fill={d.z === deck ? "rgba(255,154,60,.12)" : "transparent"} />
              {layout.blocks.filter((b) => b.deck === d.z && b.y <= cutY && b.y + b.h > cutY).map((b) => (
                <rect key={b.id} x={b.x} y={y + rowH * 0.1} width={b.w} height={rowH * ((b.span || 1) - 0.2)} fill={b.type === "transit" ? "#1a2230" : BLOCK_TYPES[b.type]?.color || "#777"} fillOpacity={b.type === "transit" ? 1 : 0.75} stroke={sel?.id === b.id ? "#5fd3f3" : "#03050a"} strokeWidth={W / 900} onClick={(e) => { e.stopPropagation(); onPick(b); }} />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
