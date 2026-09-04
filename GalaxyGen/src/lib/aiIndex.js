// Docs/11-AI-integration.md §6.2 — the compact "index" `query_galaxy`
// returns for Pass 1 (broad/coherence, §9.3). One row per entity: enough
// for an LLM to judge relevance without paying for a full record. Every
// row carries `tags` (cheap keyword scanning) *and* a small `stats` object
// (precise numeric/boolean judgment) — text alone loses "which systems are
// hot right now," and stats alone loses "why," so both travel together.
// Pure and framework-agnostic: takes an in-memory `project`, no I/O, so it
// can run in the browser today and inside a future backend unchanged.

function sectorRow(sector) {
  return {
    ref: `sector:${sector.slug}`,
    name: sector.name,
    tags: [sector.focus],
    summary: `${sector.focus} sector.`,
    stats: { focus: sector.focus },
  };
}

function systemRow(system) {
  const contested = !!(system.control && !system.control.owner && system.control.contestedBy?.length > 0);
  const important = Math.max(0, Math.min(1, Number(system.important) || 0));
  const tags = [...system.tags, ...(system.extraTags || [])];
  if (contested) tags.push("contested");
  if (important >= 0.7) tags.push("landmark");
  if (system.stationOnly) tags.push("station-only");
  return {
    ref: `system:${system.slug}`,
    name: system.name,
    tags,
    summary: `${system.starType} system (${system.population}).`,
    stats: {
      important,
      population: system.population,
      station_only: system.stationOnly,
      sector: system.sector,
      owner: system.control?.owner ?? null,
      contested,
      war_chance: system.warChance,
    },
  };
}

function factionRow(faction) {
  const tags = [
    faction.government,
    faction.origin === "generated" ? "auto-seeded" : "authored",
    ...(faction.extraTags || []),
  ];
  if (faction.homeSystem) tags.push("anchored");
  return {
    ref: `faction:${faction.slug}`,
    name: faction.name,
    tags,
    summary: `${faction.government} faction.`,
    stats: {
      strength: faction.strength,
      aggression: faction.aggression,
      origin: faction.origin,
      home_system: faction.homeSystem ?? null,
    },
  };
}

function actorRow(actor) {
  const tags = [
    actor.role,
    actor.kind,
    actor.origin === "generated" ? "background" : "curated",
    ...(actor.extraTags || []),
  ];
  return {
    ref: `actor:${actor.slug}`,
    name: actor.name,
    tags,
    summary: `${actor.role} (${actor.kind}).`,
    stats: {
      influence: actor.influence,
      status: actor.status,
      affiliation: actor.affiliation,
      location: actor.location,
      origin: actor.origin,
    },
  };
}

function organizationRow(org, actors) {
  const memberCount = actors.filter((a) => a.affiliation === `party:${org.slug}`).length;
  return {
    ref: `party:${org.slug}`,
    name: org.name,
    tags: [org.ideology, "organization", ...(org.extraTags || [])],
    summary: `${org.ideology} organization.`,
    stats: {
      parent_faction: org.parentFaction,
      local_influence: org.localInfluence,
      member_count: memberCount,
      home_system: org.homeSystem ?? null,
      home_sector: org.homeSector ?? null,
    },
  };
}

function shipModelRow(model) {
  return {
    ref: `ship_model:${model.slug}`,
    name: model.name,
    tags: [model.role, model.hullClass, model.costTier],
    summary: `${model.sizeCategory} ${model.hullClass} (${model.role}), by ${model.manufacturer}.`,
    stats: {
      role: model.role,
      size_category: model.sizeCategory,
      combat_rating: model.combatRating,
      cargo_tons: model.cargoTons,
    },
  };
}

function companyRow(company) {
  const fleetTotal = company.fleet.reduce((n, f) => n + f.count, 0);
  return {
    ref: `company:${company.slug}`,
    name: company.name,
    tags: [company.kind, company.role, company.scale, ...(company.extraTags || [])],
    summary: `${company.kind} (${company.scale}).`,
    stats: {
      role: company.role,
      scale: company.scale,
      parent_faction: company.parentFaction,
      home_system: company.homeSystem,
      fleet_total: fleetTotal,
      notable_ship_count: company.notableShips.length,
    },
  };
}

// `scope` mirrors `query_galaxy`'s request shape (Docs/11-AI-integration.md
// §6.2): omit for the full-galaxy index (the only mode the design doc
// allows `scope: "all"` for — pass 2's `full` mode must shortlist first),
// or pass an array of typed refs (`system:<slug>`, `faction:<slug>`, ...)
// to build the index for just that subset.
export function buildGalaxyIndex(project, scope = null) {
  const wantAll = !scope;
  const wanted = wantAll ? null : new Set(scope);
  const has = (ref) => wantAll || wanted.has(ref);

  const rows = [];
  for (const s of project.sectors) {
    if (has(`sector:${s.slug}`)) rows.push(sectorRow(s));
  }
  for (const s of project.systems) {
    if (has(`system:${s.slug}`)) rows.push(systemRow(s));
  }
  for (const f of project.factions) {
    if (has(`faction:${f.slug}`)) rows.push(factionRow(f));
  }
  for (const a of project.actors) {
    if (has(`actor:${a.slug}`)) rows.push(actorRow(a));
  }
  for (const o of project.organizations) {
    if (has(`party:${o.slug}`)) rows.push(organizationRow(o, project.actors));
  }
  for (const m of project.shipModels || []) {
    if (has(`ship_model:${m.slug}`)) rows.push(shipModelRow(m));
  }
  for (const c of project.companies || []) {
    if (has(`company:${c.slug}`)) rows.push(companyRow(c));
  }
  return rows;
}

// The full `query_galaxy` "index" response envelope (Docs/11-AI-integration.md
// §6.2) — what gets written to `index.json` at the root of an SDF export, or
// returned by a future backend's `query_galaxy` tool in `mode: "index"`.
export function buildGalaxyIndexEnvelope(project) {
  const entities = buildGalaxyIndex(project);
  return {
    sdf: 1,
    type: "galaxy-index",
    generated_at: new Date().toISOString(),
    seed: project.seed,
    entity_count: entities.length,
    entities,
  };
}
