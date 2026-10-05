// Fantasy Atlas MCP tools (Docs/16-fantasy-maps.md → "MCP tools").
// Definitions are shared code; the SIT backend runs them against the stored
// map (POST /api/fantasy/tool/:name) and saves it when they change it, and
// the MCP server exposes them as `fantasy_<name>`.
//
// Coordinates in and out are KILOMETRES from the map's north-west corner
// (x east, y south); the map stores cells (kmPerCell). Anything can be
// referred to by id or by (case-insensitive) name.
//
// Every tool is { name, description, scope: "global" | "map", shape(z), run }.
//   global: run(input, host)   host = { listMaps(), createMap(data) → {id}, link(mapId, params) }
//   map:    run(input, ctx)    ctx  = { map, id, link(params) } → { result, map? } (map = changed copy)
import { z } from "../tools/zod.js";
import {
  BIOMES, SETTLEMENT_TYPES, POI_TYPES, ROAD_TYPES, LABEL_TYPES, EVENT_TYPES, COLLECTIONS,
  newId, buildWorld, encodeTerrain, paintBiome, polyLength, fmtDist, citing, findChapter, emptyBook, emptyChapter,
} from "./model.js";
import { generateMap, traceRoad, TEMPLATES, CLIMATES, SIZES } from "./generate.js";
import { CULTURES } from "./names.js";
import { computeRoute, schedule, fmtDuration, MODES, PACES } from "./travel.js";
import { defaultTreasury, toBase, formatAmount, exchange } from "./currency.js";

const KINDS = Object.keys(COLLECTIONS); // settlements, pois, roads, rivers, labels, events
const BIOME_BY_NAME = Object.fromEntries(Object.entries(BIOMES).map(([k, b]) => [b.name.toLowerCase(), k]));
const blank = () => ({ description: "", images: [], links: [], refs: [], gmNotes: "", hidden: false });
const r2 = (v) => Math.round(v * 100) / 100;

// ---- helpers --------------------------------------------------------------
const km = (map, cells) => r2(cells * (map.kmPerCell || 1));
const cells = (map, kms) => kms / (map.kmPerCell || 1);

function resolve(map, ref, kinds = KINDS) {
  if (!ref) throw new Error("Missing reference (id or name).");
  const q = String(ref).trim().toLowerCase();
  for (const kind of kinds) { const e = (map[kind] || []).find((x) => x.id === ref); if (e) return { kind, item: e }; }
  for (const kind of kinds) { const e = (map[kind] || []).find((x) => (x.name || "").toLowerCase() === q); if (e) return { kind, item: e }; }
  for (const kind of kinds) { const e = (map[kind] || []).find((x) => (x.name || "").toLowerCase().includes(q)); if (e) return { kind, item: e }; }
  throw new Error(`Nothing called "${ref}" on this map${kinds.length < KINDS.length ? ` (${kinds.join(", ")})` : ""}.`);
}
function anchor(it) {
  if (it.x != null) return [it.x, it.y];
  if (it.pts?.length) return it.pts[Math.floor(it.pts.length / 2)];
  return null;
}
// position from {x_km, y_km} or {near, dx_km, dy_km} → cells
function position(map, i, required = true) {
  if (i.x_km != null && i.y_km != null) return clampPos(map, [cells(map, i.x_km), cells(map, i.y_km)]);
  if (i.near) {
    const { item } = resolve(map, i.near);
    const a = anchor(item);
    if (!a) throw new Error(`"${i.near}" has no position on the map.`);
    return clampPos(map, [a[0] + cells(map, i.dx_km || 0), a[1] + cells(map, i.dy_km || 0)]);
  }
  if (required) throw new Error("Give x_km + y_km, or near (a place name) with optional dx_km / dy_km.");
  return null;
}
const clampPos = (map, [x, y]) => [r2(Math.max(0, Math.min(map.w, x))), r2(Math.max(0, Math.min(map.h, y)))];

function findChapterRef(map, ref, bookRef) {
  if (!ref) throw new Error("Missing chapter.");
  const direct = findChapter(map, ref);
  if (direct) return direct;
  const books = map.books || [];
  let bk = bookRef ? books.find((b) => b.id === bookRef || b.title.toLowerCase() === String(bookRef).toLowerCase()) : null;
  let n = ref;
  const m = String(ref).match(/^(.*?)[\s:#]+(\d+)$/);
  if (m && !bk) { bk = books.find((b) => b.title.toLowerCase() === m[1].trim().toLowerCase()); n = m[2]; }
  const pool = bk ? [bk] : books;
  for (const b of pool) {
    const c = (b.chapters || []).find((x) => String(x.n) === String(n) || (x.title || "").toLowerCase() === String(ref).toLowerCase());
    if (c) return { book: b, chapter: c };
  }
  throw new Error(`No chapter "${ref}"${bk ? ` in "${bk.title}"` : ""}.`);
}
function findBook(map, ref) {
  const q = String(ref).toLowerCase();
  const b = (map.books || []).find((x) => x.id === ref || (x.title || "").toLowerCase() === q);
  if (!b) throw new Error(`No book "${ref}".`);
  return b;
}

function brief(map, kind, it, ctx) {
  const a = anchor(it);
  const out = { id: it.id, kind, name: it.name || "", type: it.type };
  if (a) { out.x_km = km(map, a[0]); out.y_km = km(map, a[1]); }
  if (kind === "settlements") { out.population = it.population; if (it.port) out.port = true; }
  if (kind === "events") { out.date = it.date || ""; if (it.sort != null) out.order = it.sort; }
  if (kind === "roads" || kind === "rivers") out.length_km = r2(polyLength(it.pts) * (map.kmPerCell || 1));
  if (it.hidden) out.hidden = true;
  out.link = ctx.link({ sel: `${kind}:${it.id}` });
  return out;
}
function full(map, kind, it, ctx, world) {
  const out = { ...brief(map, kind, it, ctx), description: it.description || "", gmNotes: it.gmNotes || "", images: it.images || [], links: it.links || [] };
  out.cites = (it.refs || []).map((r) => { const f = findChapter(map, r.chapter); return f ? { book: f.book.title, chapter: f.chapter.n, title: f.chapter.title, note: r.note || "", chapterId: f.chapter.id } : null; }).filter(Boolean);
  if (kind === "events") out.places = (it.places || []).map((p) => { const e = map[p.kind]?.find((x) => x.id === p.id); return e ? brief(map, p.kind, e, ctx) : null; }).filter(Boolean);
  else out.events = (map.events || []).filter((e) => (e.places || []).some((p) => p.id === it.id)).map((e) => brief(map, "events", e, ctx));
  const a = anchor(it);
  if (a && world) {
    const i = Math.min(world.h - 1, Math.floor(a[1])) * world.w + Math.min(world.w - 1, Math.floor(a[0]));
    out.terrain = BIOMES[String.fromCharCode(world.biome[i])]?.name;
    const near = (map.settlements || []).filter((s) => s.id !== it.id).map((s) => ({ s, d: Math.hypot(s.x - a[0], s.y - a[1]) })).sort((p, q) => p.d - q.d).slice(0, 3);
    out.nearest_settlements = near.map(({ s, d }) => ({ name: s.name, type: s.type, distance_km: km(map, d) }));
  }
  if (kind === "settlements" && it.currencyId) out.currency = (map.currency?.currencies || []).find((c) => c.id === it.currencyId)?.name;
  return out;
}
const placesFrom = (map, refs = []) => refs.map((r) => { const { kind, item } = resolve(map, r); return { kind, id: item.id }; });
const refsFrom = (map, cites = []) => cites.map((c) => { const f = findChapterRef(map, c.chapter, c.book); return { book: f.book.id, chapter: f.chapter.id, note: c.note || "" }; });
const clone = (m) => JSON.parse(JSON.stringify(m));

// ---- definitions ----------------------------------------------------------
export function fantasyTools() {
  const mapId = z.number().int().optional().describe("Map id (fantasy_list_maps). Default: the most recently edited map.");
  const ref = z.string().describe("Id or name of the item");
  const kind = z.enum(KINDS).optional().describe("Limit the lookup to one collection");
  const where = {
    x_km: z.number().optional().describe("km east of the map's west edge"),
    y_km: z.number().optional().describe("km south of the map's north edge"),
    near: z.string().optional().describe("…or a place name/id to put it next to"),
    dx_km: z.number().optional().describe("offset east from `near` (km, negative = west)"),
    dy_km: z.number().optional().describe("offset south from `near` (km, negative = north)"),
  };
  const common = {
    description: z.string().optional().describe("Markdown. [[Name]] links to another item, [text](https://…) to the web"),
    gmNotes: z.string().optional().describe("Never shown to readers"),
    hidden: z.boolean().optional().describe("Hidden from public readers"),
    links: z.array(z.object({ label: z.string(), url: z.string() })).optional().describe("External links shown on the item"),
    images: z.array(z.string()).optional().describe("Picture URLs"),
    cites: z.array(z.object({ chapter: z.string().describe("Chapter id, number, title or 'Book title 3'"), book: z.string().optional(), note: z.string().optional() })).optional().describe("Book chapters this item appears in"),
  };
  const applyCommon = (map, it, i, replace) => {
    for (const k of ["description", "gmNotes", "hidden", "images"]) if (i[k] !== undefined) it[k] = i[k];
    if (i.links !== undefined) it.links = replace ? i.links : [...(it.links || []), ...i.links];
    if (i.cites !== undefined) it.refs = replace ? refsFrom(map, i.cites) : [...(it.refs || []), ...refsFrom(map, i.cites)];
  };

  return [
    // ---------------------------------------------------------- global
    {
      name: "list_maps", scope: "global",
      description: "List the fantasy region maps (id, name, public, size, counts, link).",
      shape: () => ({}),
      run: async (_i, host) => host.listMaps(),
    },
    {
      name: "generate_map", scope: "global",
      description: "Generate a new fantasy region map (terrain, rivers, settlements, roads, places, labels) and store it. Returns its id, overview and link.",
      shape: () => ({
        name: z.string().optional(), seed: z.string().optional(),
        template: z.enum(Object.keys(TEMPLATES)).optional().describe(Object.entries(TEMPLATES).map(([k, v]) => `${k}: ${v}`).join("; ")),
        climate: z.enum(Object.keys(CLIMATES)).optional(),
        size: z.enum(Object.keys(SIZES)).optional().describe("grid detail: small 180×120, medium 240×160, large 320×214"),
        widthKm: z.number().min(10).max(5000).optional().describe("width of the region in km (default 300)"),
        forests: z.number().min(0).max(1).optional(), mountains: z.number().min(0).max(1).optional(), density: z.number().min(0).max(1).optional().describe("settlement density"),
        culture: z.enum(Object.keys(CULTURES)).optional().describe("naming style: anglo, italic, nordic, elvish"),
        public: z.boolean().optional().describe("readable by link without login (default true)"),
      }),
      run: async (i, host) => {
        const { public: pub = true, ...opts } = i;
        const data = generateMap(opts);
        data.currency = defaultTreasury();
        data.playerVisible = pub;
        const { id } = await host.createMap(data);
        return { id, name: data.name, seed: data.seed, width_km: Math.round(data.w * data.kmPerCell), height_km: Math.round(data.h * data.kmPerCell), settlements: data.settlements.length, roads: data.roads.length, link: host.link(id, {}) };
      },
    },

    // ---------------------------------------------------------- reading
    {
      name: "get_map", scope: "map",
      description: "Overview of a map: size, description, every settlement (with population), places, region labels, events, books and chapters, coinage, link. Positions in km from the NW corner.",
      shape: () => ({ mapId }),
      run: (_i, ctx) => {
        const m = ctx.map;
        return {
          result: {
            id: ctx.id, name: m.name, public: !!m.playerVisible, width_km: Math.round(m.w * m.kmPerCell), height_km: Math.round(m.h * m.kmPerCell), km_per_cell: m.kmPerCell,
            description: m.description || "", link: ctx.link({}),
            settlements: m.settlements.map((s) => brief(m, "settlements", s, ctx)),
            places: m.pois.map((p) => brief(m, "pois", p, ctx)),
            labels: m.labels.map((l) => ({ id: l.id, name: l.name, type: l.type })),
            roads: { count: m.roads.length, named: m.roads.filter((r) => r.name).map((r) => brief(m, "roads", r, ctx)) },
            rivers: m.rivers.filter((r) => r.name).map((r) => ({ id: r.id, name: r.name })),
            events: (m.events || []).map((e) => brief(m, "events", e, ctx)),
            books: (m.books || []).map((b) => ({ id: b.id, title: b.title, author: b.author, url: b.url, link: ctx.link({ book: b.id }), chapters: (b.chapters || []).map((c) => ({ id: c.id, n: c.n, title: c.title, url: c.url, cited_by: citing(m, c.id).length, link: ctx.link({ ch: c.id }) })) })),
            currencies: (m.currency?.currencies || defaultTreasury().currencies).map((c) => ({ name: c.name, realm: c.realm, coins: c.denominations.map((d) => `${d.name} (${d.abbr}) = ${d.value}`) })),
          },
        };
      },
    },
    {
      name: "search", scope: "map",
      description: "Search names, descriptions and GM notes of everything on a map (settlements, places, roads, rivers, labels, events) and the book's chapters.",
      shape: () => ({ mapId, query: z.string(), kinds: z.array(z.enum(KINDS)).optional(), limit: z.number().int().min(1).max(200).optional() }),
      run: (i, ctx) => {
        const m = ctx.map, q = i.query.toLowerCase(), out = [];
        for (const k of i.kinds || KINDS) for (const e of m[k] || []) {
          const hay = `${e.name || ""}\n${e.description || ""}\n${e.gmNotes || ""}\n${e.date || ""}`.toLowerCase();
          if (hay.includes(q)) out.push({ ...brief(m, k, e, ctx), match: (e.name || "").toLowerCase().includes(q) ? "name" : "text" });
        }
        if (!i.kinds) for (const b of m.books || []) for (const c of b.chapters || []) {
          if (`${c.title}\n${c.summary || ""}`.toLowerCase().includes(q)) out.push({ id: c.id, kind: "chapter", name: `${b.title} · ${c.n}. ${c.title}`, link: ctx.link({ ch: c.id }) });
        }
        out.sort((a, b) => (a.match === "name" ? 0 : 1) - (b.match === "name" ? 0 : 1));
        return { result: out.slice(0, i.limit || 50) };
      },
    },
    {
      name: "get_item", scope: "map",
      description: "Everything about one item: description, GM notes, pictures, links, cited chapters, events that happened there (or places of an event), terrain, nearest settlements and its public link.",
      shape: () => ({ mapId, ref, kind }),
      run: (i, ctx) => {
        const { kind: k, item } = resolve(ctx.map, i.ref, i.kind ? [i.kind] : KINDS);
        return { result: full(ctx.map, k, item, ctx, buildWorld(ctx.map)) };
      },
    },
    {
      name: "travel_time", scope: "map",
      description: "Distance and travel time between places (via optional stops) for every mode — on foot, horse, courier, wagon, carriage, river boat, ship — at a pace. Routes follow roads and terrain per mode unless crow=true.",
      shape: () => ({
        mapId, from: z.string(), to: z.string(), via: z.array(z.string()).optional(),
        pace: z.enum(Object.keys(PACES)).optional().describe("slow, normal (default), fast, forced"),
        crow: z.boolean().optional().describe("straight line instead of route finding"),
      }),
      run: (i, ctx) => {
        const m = ctx.map, world = buildWorld(m);
        const stops = [i.from, ...(i.via || []), i.to].map((r) => { const { item } = resolve(m, r); const a = anchor(item); if (!a) throw new Error(`"${r}" has no position.`); return { name: item.name, a }; });
        const pace = i.pace || "normal";
        const modes = {};
        for (const k of Object.keys(MODES)) {
          const r = computeRoute(world, stops.map((s) => s.a), k, { crow: !!i.crow });
          if (!r.ok || !r.km) { modes[k] = { possible: false }; continue; }
          const s = schedule(r.hours, k, pace);
          modes[k] = { possible: true, distance_km: r2(r.km), moving_hours: r2(s.moving), travel_hours_per_day: s.perDay, days: r2(s.days), as_text: fmtDuration(s.moving, s.perDay), km_by_way: Object.fromEntries(Object.entries(r.by).map(([w, v]) => [w, r2(v)])) };
        }
        return { result: { route: stops.map((s) => s.name), pace, crow: !!i.crow, modes } };
      },
    },
    {
      name: "convert_currency", scope: "map",
      description: "Convert an amount of coins on this map's coinage: shows it as fewest coins, in each denomination, and in the other currencies (after the exchange fee).",
      shape: () => ({ mapId, amount: z.number().min(0), coin: z.string().describe("coin abbreviation or name, e.g. gp, 'Fiorino d'oro'"), currency: z.string().optional().describe("currency name, if several") }),
      run: (i, ctx) => {
        const t = ctx.map.currency || defaultTreasury();
        const q = i.coin.toLowerCase();
        const curs = i.currency ? t.currencies.filter((c) => c.name.toLowerCase() === i.currency.toLowerCase()) : t.currencies;
        let cur, den;
        for (const c of curs) { den = c.denominations.find((d) => d.abbr.toLowerCase() === q || d.name.toLowerCase() === q); if (den) { cur = c; break; } }
        if (!den) throw new Error(`No coin "${i.coin}". Coins: ${t.currencies.flatMap((c) => c.denominations.map((d) => d.abbr)).join(", ")}`);
        const base = i.amount * den.value;
        return { result: {
          amount: `${i.amount} ${den.abbr} (${cur.name})`, fewest_coins: formatAmount(cur, base),
          in_each_coin: Object.fromEntries(cur.denominations.map((d) => [d.abbr, r2(base / d.value)])),
          other_currencies: Object.fromEntries(t.currencies.filter((c) => c.id !== cur.id).map((c) => [c.name, formatAmount(c, exchange(cur, c, base, t.feePct || 0))])),
          fee_pct: t.feePct || 0,
        } };
      },
    },

    // ---------------------------------------------------------- writing
    {
      name: "set_map_info", scope: "map",
      description: "Rename a map, set its description, make it public/private, change its width in km or its style.",
      shape: () => ({ mapId, name: z.string().optional(), description: z.string().optional(), public: z.boolean().optional(), widthKm: z.number().min(5).optional(), style: z.enum(["parchment", "atlas"]).optional(), unit: z.enum(["km", "mi"]).optional() }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        if (i.name !== undefined) m.name = i.name;
        if (i.description !== undefined) m.description = i.description;
        if (i.public !== undefined) m.playerVisible = i.public;
        if (i.widthKm !== undefined) m.kmPerCell = i.widthKm / m.w;
        if (i.style) m.style = i.style;
        if (i.unit) m.travel = { ...(m.travel || {}), unit: i.unit };
        return { result: { ok: true, name: m.name, public: !!m.playerVisible, width_km: Math.round(m.w * m.kmPerCell), link: ctx.link({}) }, map: m };
      },
    },
    {
      name: "add_settlement", scope: "map",
      description: "Found a settlement (capital, city, town, village, hamlet, castle) at a position or next to a named place.",
      shape: () => ({ mapId, name: z.string(), type: z.enum(Object.keys(SETTLEMENT_TYPES)), population: z.number().int().min(0).optional(), port: z.boolean().optional(), currency: z.string().optional().describe("currency name used here"), ...where, ...common }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const [x, y] = position(m, i);
        const [p0, p1] = SETTLEMENT_TYPES[i.type].pop;
        const it = { id: newId("s"), type: i.type, name: i.name, x, y, population: i.population ?? Math.round((p0 + p1) / 20) * 10, port: !!i.port, ...blank() };
        if (i.currency) it.currencyId = (m.currency?.currencies || []).find((c) => c.name.toLowerCase() === i.currency.toLowerCase())?.id || null;
        applyCommon(m, it, i);
        m.settlements.push(it);
        return { result: brief(m, "settlements", it, ctx), map: m };
      },
    },
    {
      name: "add_place", scope: "map",
      description: `Add a point of interest (${Object.keys(POI_TYPES).join(", ")}) at a position or next to a named place.`,
      shape: () => ({ mapId, name: z.string(), type: z.enum(Object.keys(POI_TYPES)), ...where, ...common }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const [x, y] = position(m, i);
        const it = { id: newId("p"), type: i.type, name: i.name, x, y, ...blank() };
        applyCommon(m, it, i);
        m.pois.push(it);
        return { result: brief(m, "pois", it, ctx), map: m };
      },
    },
    {
      name: "add_label", scope: "map",
      description: `Write a name on the map: ${Object.keys(LABEL_TYPES).join(", ")} (a realm, a forest, a mountain range, a sea…).`,
      shape: () => ({ mapId, name: z.string(), type: z.enum(Object.keys(LABEL_TYPES)), size: z.number().min(0.8).max(10).optional().describe("letter height in cells (default 2.5)"), angle: z.number().min(-60).max(60).optional(), ...where, ...common }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const [x, y] = position(m, i);
        const it = { id: newId("l"), type: i.type, name: i.name, x, y, size: i.size ?? 2.5, angle: i.angle ?? 0, ...blank() };
        applyCommon(m, it, i);
        m.labels.push(it);
        return { result: brief(m, "labels", it, ctx), map: m };
      },
    },
    {
      name: "add_event", scope: "map",
      description: `Record an event in the timeline (${Object.keys(EVENT_TYPES).join(", ")}): when, where (linked places), optionally pinned on the map, with description and book citations.`,
      shape: () => ({
        mapId, name: z.string(), type: z.enum(Object.keys(EVENT_TYPES)).optional(),
        date: z.string().optional().describe("free text in the campaign calendar, e.g. 'Spring of 1243 AR'"),
        order: z.number().optional().describe("number to sort the timeline by (e.g. the year)"),
        places: z.array(z.string()).optional().describe("names/ids of the places involved"),
        pin: z.boolean().optional().describe("pin it on the map: at x_km/y_km or near, else at the first place"),
        ...where, ...common,
      }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const places = placesFrom(m, i.places);
        let pos = position(m, i, false);
        if (!pos && i.pin && places.length) { const a = anchor(m[places[0].kind].find((x) => x.id === places[0].id)); if (a) pos = clampPos(m, [a[0] + 0.8, a[1] - 0.8]); }
        const it = { id: newId("e"), type: i.type || "other", name: i.name, date: i.date || "", sort: i.order ?? null, places, x: pos ? pos[0] : null, y: pos ? pos[1] : null, ...blank() };
        applyCommon(m, it, i);
        m.events = [...(m.events || []), it];
        return { result: brief(m, "events", it, ctx), map: m };
      },
    },
    {
      name: "add_road", scope: "map",
      description: `Build a road between places (via optional stops). Types: ${Object.entries(ROAD_TYPES).map(([k, t]) => `${k} (${t.desc})`).join(", ")}. By default it follows the terrain (avoids water and mountains, reuses roads, bridges rivers).`,
      shape: () => ({ mapId, from: z.string(), to: z.string(), via: z.array(z.string()).optional(), type: z.enum(Object.keys(ROAD_TYPES)).optional(), name: z.string().optional(), straight: z.boolean().optional().describe("straight segments instead of following the terrain"), ...common }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const world = buildWorld(m);
        const stops = [i.from, ...(i.via || []), i.to].map((r) => { const { item } = resolve(m, r); const a = anchor(item); if (!a) throw new Error(`"${r}" has no position.`); return a; });
        let pts = [stops[0]];
        for (let k = 1; k < stops.length; k++) {
          const seg = i.straight ? [stops[k - 1], stops[k]] : traceRoad(world, stops[k - 1], stops[k]);
          if (!seg) throw new Error("No land route between those places (water in the way?). Use straight: true or add stops.");
          pts.push(...seg.slice(1));
        }
        pts = pts.map(([x, y]) => [r2(x), r2(y)]);
        const it = { id: newId("r"), type: i.type || "road", name: i.name || "", pts, ...blank() };
        applyCommon(m, it, i);
        m.roads.push(it);
        return { result: { ...brief(m, "roads", it, ctx), length_text: fmtDist(polyLength(pts) * m.kmPerCell) }, map: m };
      },
    },
    {
      name: "update_item", scope: "map",
      description: "Change any item (settlement, place, road, river, label, event): rename, retype, move, describe, hide, set population, date, places, links, pictures, citations. Lists (links, images, cites, places) REPLACE the existing ones; use cite / add_link for adding.",
      shape: () => ({
        mapId, ref, kind, name: z.string().optional(), type: z.string().optional(),
        population: z.number().int().min(0).optional(), port: z.boolean().optional(), currency: z.string().optional(),
        date: z.string().optional(), order: z.number().nullable().optional(), places: z.array(z.string()).optional(), pin: z.boolean().optional().describe("events: false removes the pin"),
        size: z.number().optional(), angle: z.number().optional(), width: z.number().optional().describe("rivers"),
        ...where, ...common,
      }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const { kind: k, item: found } = resolve(m, i.ref, i.kind ? [i.kind] : KINDS);
        const it = m[k].find((x) => x.id === found.id);
        if (i.name !== undefined) it.name = i.name;
        if (i.type !== undefined) {
          const allowed = { settlements: SETTLEMENT_TYPES, pois: POI_TYPES, roads: ROAD_TYPES, labels: LABEL_TYPES, events: EVENT_TYPES }[k];
          if (!allowed || !allowed[i.type]) throw new Error(`Type "${i.type}" isn't valid for ${k}${allowed ? `: ${Object.keys(allowed).join(", ")}` : ""}.`);
          it.type = i.type;
        }
        for (const [f, t] of [["population", "population"], ["port", "port"], ["date", "date"], ["order", "sort"], ["size", "size"], ["angle", "angle"], ["width", "width"]]) if (i[f] !== undefined) it[t] = i[f];
        if (i.currency !== undefined) it.currencyId = (m.currency?.currencies || []).find((c) => c.name.toLowerCase() === i.currency.toLowerCase())?.id || null;
        if (i.places !== undefined) it.places = placesFrom(m, i.places);
        if (i.pin === false) { it.x = null; it.y = null; }
        const pos = position(m, i, false);
        if (pos) {
          if (it.pts) { const a = anchor(it); it.pts = it.pts.map(([x, y]) => [r2(x + pos[0] - a[0]), r2(y + pos[1] - a[1])]); }
          else { it.x = pos[0]; it.y = pos[1]; }
        }
        applyCommon(m, it, i, true);
        return { result: brief(m, k, it, ctx), map: m };
      },
    },
    {
      name: "add_link", scope: "map",
      description: "Attach external hyperlinks or picture URLs to an item (adds, does not replace).",
      shape: () => ({ mapId, ref, kind, links: z.array(z.object({ label: z.string(), url: z.string() })).optional(), images: z.array(z.string()).optional() }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const { kind: k, item: found } = resolve(m, i.ref, i.kind ? [i.kind] : KINDS);
        const it = m[k].find((x) => x.id === found.id);
        if (i.links) it.links = [...(it.links || []), ...i.links];
        if (i.images) it.images = [...(it.images || []), ...i.images];
        return { result: { ...brief(m, k, it, ctx), links: it.links, images: it.images }, map: m };
      },
    },
    {
      name: "delete_item", scope: "map",
      description: "Remove an item (settlement, place, road, river, label, event) from the map. Events that linked a removed place keep the rest of their places.",
      shape: () => ({ mapId, ref, kind }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const { kind: k, item } = resolve(m, i.ref, i.kind ? [i.kind] : KINDS);
        m[k] = m[k].filter((x) => x.id !== item.id);
        m.events = (m.events || []).map((e) => ({ ...e, places: (e.places || []).filter((p) => p.id !== item.id) }));
        return { result: { deleted: { kind: k, id: item.id, name: item.name } }, map: m };
      },
    },
    {
      name: "paint_terrain", scope: "map",
      description: `Paint terrain in a circle: ${Object.values(BIOMES).map((b) => b.name).join(", ")}. Use it to raise mountains, plant forests, dig lakes, drain marshes…`,
      shape: () => ({ mapId, terrain: z.string().describe("terrain name, e.g. 'Forest', 'Mountains', 'Lake'"), radius_km: z.number().min(0.1), ...where }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const code = BIOME_BY_NAME[i.terrain.toLowerCase()] || (BIOMES[i.terrain.toUpperCase()] ? i.terrain.toUpperCase() : null);
        if (!code) throw new Error(`Unknown terrain "${i.terrain}". One of: ${Object.values(BIOMES).map((b) => b.name).join(", ")}`);
        const [x, y] = position(m, i);
        const world = buildWorld(m);
        const touched = paintBiome(world, x, y, Math.max(0.5, cells(m, i.radius_km)), code);
        if (!touched) return { result: { changed: false } };
        m.terrain = encodeTerrain(world);
        return { result: { changed: true, terrain: BIOMES[code].name, x_km: km(m, x), y_km: km(m, y), radius_km: i.radius_km }, map: m };
      },
    },

    // ---------------------------------------------------------- the book
    {
      name: "upsert_book", scope: "map",
      description: "Create or edit a book (the story the map belongs to): title, author, link, description, hidden; delete: true removes it with its chapters.",
      shape: () => ({ mapId, book: z.string().optional().describe("id or title of an existing book; omit to create"), title: z.string().optional(), author: z.string().optional(), url: z.string().optional(), description: z.string().optional(), hidden: z.boolean().optional(), delete: z.boolean().optional() }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        m.books = m.books || [];
        let b = i.book ? findBook(m, i.book) : null;
        if (i.delete) { if (!b) throw new Error("Which book?"); m.books = m.books.filter((x) => x.id !== b.id); return { result: { deleted: b.title }, map: m }; }
        if (!b) { b = emptyBook(m.books.length + 1); m.books.push(b); } else b = m.books.find((x) => x.id === b.id);
        for (const f of ["title", "author", "url", "description", "hidden"]) if (i[f] !== undefined) b[f] = i[f];
        return { result: { id: b.id, title: b.title, chapters: b.chapters.length, link: ctx.link({ book: b.id }) }, map: m };
      },
    },
    {
      name: "upsert_chapter", scope: "map",
      description: "Create or edit a chapter of a book: title, link to its text, summary (Markdown, [[Name]] links to places/events), hidden; delete: true removes it.",
      shape: () => ({ mapId, book: z.string().optional().describe("book id or title (default: the first book; created if there is none)"), chapter: z.string().optional().describe("id, number or title of an existing chapter; omit to append a new one"), title: z.string().optional(), url: z.string().optional(), summary: z.string().optional(), hidden: z.boolean().optional(), delete: z.boolean().optional() }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        m.books = m.books || [];
        let b = i.book ? findBook(m, i.book) : m.books[0];
        if (!b) { b = emptyBook(1); m.books.push(b); }
        b = m.books.find((x) => x.id === b.id);
        let c = i.chapter ? findChapterRef(m, i.chapter, b.id).chapter : null;
        if (c) c = b.chapters.find((x) => x.id === c.id);
        if (i.delete) {
          if (!c) throw new Error("Which chapter?");
          b.chapters = b.chapters.filter((x) => x.id !== c.id).map((x, k) => ({ ...x, n: k + 1 }));
          return { result: { deleted: c.title }, map: m };
        }
        if (!c) { c = emptyChapter(b); b.chapters.push(c); }
        for (const f of ["title", "url", "summary", "hidden"]) if (i[f] !== undefined) c[f] = i[f];
        return { result: { id: c.id, book: b.title, n: c.n, title: c.title, link: ctx.link({ ch: c.id }) }, map: m };
      },
    },
    {
      name: "cite", scope: "map",
      description: "Say that an item (place, event, road…) appears in a chapter, with an optional page/note; remove: true drops that citation. The chapter view then lists the item and it glows on the map.",
      shape: () => ({ mapId, ref, kind, chapter: z.string().describe("chapter id, number, title or 'Book title 3'"), book: z.string().optional(), note: z.string().optional(), remove: z.boolean().optional() }),
      run: (i, ctx) => {
        const m = clone(ctx.map);
        const { kind: k, item: found } = resolve(m, i.ref, i.kind ? [i.kind] : KINDS);
        const it = m[k].find((x) => x.id === found.id);
        const f = findChapterRef(m, i.chapter, i.book);
        it.refs = (it.refs || []).filter((r) => r.chapter !== f.chapter.id);
        if (!i.remove) it.refs.push({ book: f.book.id, chapter: f.chapter.id, note: i.note || "" });
        return { result: { item: it.name, chapter: `${f.book.title} · ${f.chapter.n}. ${f.chapter.title}`, cited: !i.remove, chapter_link: ctx.link({ ch: f.chapter.id }) }, map: m };
      },
    },
  ].map((t) => ({ ...t, shape: t.shape() }));
}
