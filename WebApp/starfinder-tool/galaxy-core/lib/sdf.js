// SDF entry builders (Docs/10-galaxy-mapgen.md §7, Docs/06-data-format-sdf.md)
// — pure, shared by the in-app editor's "Export SDF" and the MCP tools.

// Docs/10-galaxy-mapgen.md §7 — sectors/<slug>/entry.json shape. Exported
// (alongside the other four below) so aiQuery.js's `query_galaxy` "full"
// mode can resolve a typed ref straight to the exact same entry shape the
// real SDF export writes, with zero duplicated logic.
export function sectorToEntry(sector) {
  return {
    sdf: 1,
    type: "sector",
    name: sector.name,
    summary: `${sector.focus} sector.`,
    tags: [sector.focus],
    data: {
      boundary: sector.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
      focus: sector.focus,
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — systems/<slug>/entry.json shape. `control`/
// `war_chance`/faction security are `null` until "Generate factions" has
// run at least once. `bodies` (§8) is a leaf list, not its own SDF
// category — a body has no typed ref of its own, addressed only via its
// parent system.
export function systemToEntry(system) {
  return {
    sdf: 1,
    type: "system",
    name: system.name,
    summary: `${system.starType} system (${system.population}).`,
    tags: [...system.tags, ...(system.extraTags || [])],
    data: {
      position: { x: Math.round(system.position.x), y: Math.round(system.position.y) },
      star_type: system.starType,
      population: system.population,
      station_only: system.stationOnly,
      status: system.status || "active",
      export: system.export,
      import: system.import,
      sector: system.sector,
      control: system.control
        ? { owner: system.control.owner, contested_by: system.control.contestedBy }
        : null,
      security: { dominion: system.security.dominion, faction: system.security.faction ?? null },
      hyperlanes: system.hyperlanes,
      war_chance: system.warChance,
      important: Math.max(0, Math.min(1, Number(system.important) || 0)),
      bodies: (system.bodies || []).map((b) => ({
        slug: b.slug,
        name: b.name,
        kind: b.kind,
        parent: b.parent ?? null,
        orbit_au: b.orbitAU ?? null,
        orbit_au_outer: b.orbitAUOuter ?? null,
        orbit_period_days: b.orbitPeriodDays ?? null,
        size_class: b.sizeClass ?? null,
        radius_km: b.radiusKm ?? null,
        habitable: b.habitable,
        resources: b.resources,
        status: b.status,
        population: b.population,
        // Orbital-station-only fields (Docs/10-galaxy-mapgen.md §8) —
        // undefined on every planetary/moon body, so `?? null` keeps the
        // entry shape uniform rather than omitting the keys entirely.
        length_m: b.lengthM ?? null,
        docks: b.docks ?? null,
        dock_class: b.dockClass ?? null,
        services: b.services ?? null,
        goods_handled: b.goodsHandled ?? null,
        tags: b.tags,
        // Authored surface sites + city layouts (CityEditor.jsx) — rendered
        // by the SIT galaxy viewer's planet/settlement views.
        sites: b.sites ?? null,
      })),
      ...(system.note ? { note: system.note } : {}),
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — factions/<slug>/entry.json shape. The
// Dominion itself is never exported here — it's the implicit baseline
// represented only via `security.dominion` on systems (§4).
export function factionToEntry(faction) {
  return {
    sdf: 1,
    type: "faction",
    name: faction.name,
    summary: `${faction.government} faction.`,
    tags: [faction.government, faction.origin === "generated" ? "auto-seeded" : "authored", ...(faction.extraTags || [])],
    data: {
      color: faction.color,
      government: faction.government,
      aggression: faction.aggression,
      strength: faction.strength,
      control_seed: { x: Math.round(faction.seed.x), y: Math.round(faction.seed.y) },
      home_system: faction.homeSystem ?? null,
      tolerated_crimes: faction.toleratedCrimes,
      relationships: faction.relationships,
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — actors/<slug>/entry.json shape. `origin` is
// always "authored" until Phase 4's background auto-seeding pass exists.
export function actorToEntry(actor) {
  return {
    sdf: 1,
    type: "actor",
    name: actor.name,
    summary: `${actor.role} (${actor.kind}).`,
    tags: [actor.role, actor.kind, ...(actor.extraTags || [])],
    data: {
      kind: actor.kind,
      origin: actor.origin,
      affiliation: actor.affiliation,
      location: actor.location,
      mobile: actor.mobile,
      influence: actor.influence,
      status: actor.status,
      reputation: actor.reputation,
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — organizations/<slug>/entry.json shape.
// `members` is derived from every actor whose `affiliation` points here,
// rather than a separately hand-maintained list, so it can never drift out
// of sync with what the actors themselves say.
export function organizationToEntry(org, actors) {
  return {
    sdf: 1,
    type: "organization",
    name: org.name,
    summary: `${org.ideology} organization.`,
    tags: [org.ideology, "organization", ...(org.extraTags || [])],
    data: {
      ideology: org.ideology,
      parent_faction: org.parentFaction,
      home_system: org.homeSystem,
      home_sector: org.homeSector,
      members: actors.filter((a) => a.affiliation === `party:${org.slug}`).map((a) => a.slug),
      local_influence: org.localInfluence,
    },
  };
}

// Docs/10-galaxy-mapgen.md §8-adjacent — ship_models/<slug>/entry.json
// shape. A catalog entry, not tied to any one system/sector — companies
// reference it by slug from their own `fleet`/`notableShips` lists.
export function shipModelToEntry(model) {
  return {
    sdf: 1,
    type: "ship_model",
    name: model.name,
    summary: `${model.sizeCategory} ${model.hullClass} (${model.role}), by ${model.manufacturer}.`,
    tags: [model.role, model.hullClass, model.costTier, ...(model.custom ? ["custom"] : [])],
    data: {
      // Hand-authored one-of-a-kind hulls only (city-ships etc.); null on
      // every generated catalog model.
      custom: !!model.custom,
      population: model.population ?? null,
      notes: model.notes ?? null,
      manufacturer: model.manufacturer,
      hull_class: model.hullClass,
      role: model.role,
      size_category: model.sizeCategory,
      maneuverability: model.maneuverability,
      crew: model.crew,
      cargo_tons: model.cargoTons,
      speed_hexes: model.speedHexes,
      combat_rating: model.combatRating,
      cost_tier: model.costTier,
    },
  };
}

// Docs/10-galaxy-mapgen.md §8-adjacent — companies/<slug>/entry.json shape.
// `fleet` stays an aggregate (model slug + count, Docs' "fleet aggregates +
// named notables" scale decision) rather than one entry per hull.
export function companyToEntry(company) {
  return {
    sdf: 1,
    type: "company",
    name: company.name,
    summary: `${company.kind} (${company.scale}).`,
    tags: [company.kind, company.role, company.scale, ...(company.extraTags || [])],
    data: {
      kind: company.kind,
      role: company.role,
      scale: company.scale,
      parent_faction: company.parentFaction,
      home_system: company.homeSystem,
      home_sector: company.homeSector,
      fleet: company.fleet.map((f) => ({ model: f.modelSlug, count: f.count })),
      notable_ships: company.notableShips.map((s) => ({
        slug: s.slug,
        name: s.name,
        model: s.modelSlug,
        status: s.status,
        current_system: s.currentSystem,
        captain_actor: s.captainActor,
      })),
    },
  };
}

// Docs/10-galaxy-mapgen.md §7, §9 pipeline step 5 — events/<slug>/entry.json
// shape. Append-only: nothing in the app ever edits or re-derives an
// existing event's own fields after commit, only removes it from the log.
export function eventToEntry(event) {
  return {
    sdf: 1,
    type: "event",
    name: event.name,
    summary: event.summary,
    tags: event.tags || [],
    data: {
      timestamp: event.timestamp,
      timestep: event.timestep,
      mode: event.mode,
      magnitude: event.magnitude,
      scope: event.scope,
      effects: event.effects,
      narrative: event.narrative,
    },
  };
}

