import { z } from "./zod.js";
import { generateStation, summarizeStation, updateShop, addShop, SHOP_KINDS } from "../lib/stationGen.js";
import * as state from "./state.js";
import { tool } from "./respond.js";

// Station Gen (Docs/15-settlement-generators.md): block layouts for station
// bodies and notable ships, stored on the target as `layout`, plus the named
// venues on board ("is there a pub on this station?").

const ARCHETYPES = ["auto", "orbital", "vessel", "mining"];

// Resolve a station body (systemSlug + bodySlug) or a notable ship (shipSlug,
// optionally companySlug) and return a writer that stores a new layout.
function resolveTarget(project, { systemSlug, bodySlug, companySlug, shipSlug }) {
  if (bodySlug) {
    const sys = systemSlug ? project.systems.find((s) => s.slug === systemSlug) : project.systems.find((s) => (s.bodies || []).some((b) => b.slug === bodySlug));
    const body = sys?.bodies?.find((b) => b.slug === bodySlug);
    if (!body) throw new Error(`No body "${bodySlug}"${systemSlug ? ` in system "${systemSlug}"` : ""}.`);
    if (body.kind !== "orbital station") throw new Error(`"${bodySlug}" is a ${body.kind}, not an orbital station.`);
    return {
      entity: body, genInput: body, label: `${body.name} (${sys.name})`,
      write: (p, layout) => ({ ...p, systems: p.systems.map((s) => (s.slug !== sys.slug ? s : { ...s, locked: true, bodies: s.bodies.map((b) => (b.slug === bodySlug ? { ...b, layout } : b)) })) }),
    };
  }
  if (shipSlug) {
    const co = project.companies.find((c) => (companySlug ? c.slug === companySlug : (c.notableShips || []).some((s) => s.slug === shipSlug)));
    const ship = co?.notableShips?.find((s) => s.slug === shipSlug);
    if (!ship) throw new Error(`No notable ship "${shipSlug}".`);
    const model = (project.shipModels || []).find((m) => m.slug === ship.modelSlug) || { sizeCategory: "Medium", crew: 6, role: co.role };
    return {
      entity: ship, genInput: { ...ship, model }, label: `${ship.name} (${co.name})`,
      write: (p, layout) => ({ ...p, companies: p.companies.map((c) => (c.slug !== co.slug ? c : { ...c, notableShips: c.notableShips.map((s) => (s.slug === shipSlug ? { ...s, layout } : s)) })) }),
    };
  }
  throw new Error("Give bodySlug (a station body) or shipSlug (a company's notable ship).");
}

function allLayouts(project) {
  const out = [];
  for (const s of project.systems) for (const b of s.bodies || []) if (b.layout) out.push({ where: `${b.name} (${s.name})`, ref: { systemSlug: s.slug, bodySlug: b.slug }, layout: b.layout });
  for (const c of project.companies || []) for (const sh of c.notableShips || []) if (sh.layout) out.push({ where: `${sh.name} (${c.name})`, ref: { companySlug: c.slug, shipSlug: sh.slug }, layout: sh.layout });
  return out;
}

const targetShape = {
  systemSlug: z.string().optional(),
  bodySlug: z.string().optional().describe("an orbital station body"),
  companySlug: z.string().optional(),
  shipSlug: z.string().optional().describe("a company's notable ship"),
};

export function register(server) {
  server.tool(
    "generate_station_layout",
    "Generate the block layout of an orbital station body or a company's notable ship: stylized prefab blocks on a 2 m grid (transit, bridge, habitation, dining, commercial, recreation, medical, security, research, factory, cargo, hangar, technical, generator, engine), deck by deck, sized to the hull and headcount, plus named venues (pubs, shops…). Shapes: orbital (grows in every direction along corridors), vessel (long: bridge at the bow, hangars amidships, engines aft), mining (cubic, dense). Colossal city-ships are left to the city generator. Refuses to replace an existing layout unless overwrite is true (it would drop manual edits).",
    {
      ...targetShape,
      archetype: z.enum(ARCHETYPES).optional(),
      purpose: z.string().optional().describe("override: cargo, tourism, diplomacy, private, research, military, colony, trade, logistics, shipyard, fortress, waystation, fuel, metropolis, mining"),
      seed: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
    tool(({ archetype, purpose, seed, overwrite, ...ref }) => {
      const project = state.requireProject();
      const t = resolveTarget(project, ref);
      if (t.entity.layout && !overwrite) throw new Error(`${t.label} already has a layout — pass overwrite: true to replace it.`);
      const layout = generateStation(t.genInput, { archetype: archetype || "auto", purpose, seed });
      if (!layout) throw new Error("Colossal hull: city-ships are built by the city generator, not the station generator.");
      state.setProject(t.write(project, layout));
      return { target: t.label, ...summarizeStation(layout), shops: layout.shops.length };
    }),
  );

  server.tool(
    "get_station_layout",
    "Summary of a station's or ship's generated layout: shape, size, decks, floor area per block type, capacity, and every named venue with its deck and block.",
    targetShape,
    tool((ref) => {
      const t = resolveTarget(state.requireProject(), ref);
      if (!t.entity.layout) throw new Error(`${t.label} has no layout yet — use generate_station_layout.`);
      return { target: t.label, ...summarizeStation(t.entity.layout) };
    }),
  );

  server.tool(
    "find_venues",
    "Search the named venues (pubs, bars, shops, gyms…) across every generated station/ship layout, or one target. Filter by kind (e.g. \"pub\") and/or a name substring.",
    { ...targetShape, kind: z.string().optional(), query: z.string().optional() },
    tool(({ kind, query, ...ref }) => {
      const project = state.requireProject();
      const scope = ref.bodySlug || ref.shipSlug ? [(() => { const t = resolveTarget(project, ref); return { where: t.label, layout: t.entity.layout }; })()] : allLayouts(project);
      const q = (query || "").toLowerCase();
      const out = [];
      for (const { where, layout } of scope) {
        if (!layout) continue;
        const sum = summarizeStation(layout);
        layout.shops.forEach((s, i) => {
          if (kind && s.kind !== kind) return;
          if (q && !s.name.toLowerCase().includes(q)) return;
          out.push({ id: s.id, name: s.name, kind: s.kind, on: where, where: sum.shops[i]?.where });
        });
      }
      return out.slice(0, 200);
    }),
  );

  server.tool(
    "update_venue",
    `Rename / re-kind a venue on a station or ship layout, or add a new one to a block (blockId + kind, optional name — generated if omitted). Kinds: ${[...new Set(Object.values(SHOP_KINDS).flat())].join(", ")}.`,
    { ...targetShape, venueId: z.string().optional(), blockId: z.string().optional(), name: z.string().optional(), kind: z.string().optional() },
    tool(({ venueId, blockId, name, kind, ...ref }) => {
      const project = state.requireProject();
      const t = resolveTarget(project, ref);
      const layout = t.entity.layout;
      if (!layout) throw new Error(`${t.label} has no layout yet.`);
      let next;
      if (venueId) {
        if (!layout.shops.some((s) => s.id === venueId)) throw new Error(`No venue "${venueId}".`);
        next = updateShop(layout, venueId, Object.fromEntries(Object.entries({ name, kind }).filter(([, v]) => v !== undefined)));
      } else if (blockId) {
        if (!layout.blocks.some((b) => b.id === blockId)) throw new Error(`No block "${blockId}".`);
        next = addShop(layout, blockId, kind, name);
      } else throw new Error("Give venueId (to edit) or blockId (to add).");
      state.setProject(t.write(project, next));
      return next.shops.find((s) => s.id === venueId) || next.shops[next.shops.length - 1];
    }),
  );
}
