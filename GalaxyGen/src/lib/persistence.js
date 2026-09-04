import { buildGalaxyIndexEnvelope } from "./aiIndex.js";

const STORAGE_KEY = "galaxygen.project.v1";
// Separate key, deliberately never part of `project` — an API base
// URL/key/model is a machine-local setting, not galaxy data, so it must
// never end up in a saved project file or SDF export that gets shared.
const AI_SETTINGS_KEY = "galaxygen.aiSettings.v1";

export function loadAISettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { baseUrl: "", apiKey: "", model: "" };
  } catch {
    return { baseUrl: "", apiKey: "", model: "" };
  }
}

export function saveAISettings(settings) {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not critical — settings just won't persist across reloads.
  }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveToStorage(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Storage full/unavailable — not critical, explicit export still works.
  }
}

function triggerDownload(filename, contents, type = "application/json") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProjectJSON(project) {
  triggerDownload(`galaxy-${project.seed}.json`, JSON.stringify(project, null, 2));
}

// A standalone download of just the compact index (Docs/11-AI-integration.md
// §6.2) — lets a GM hand it straight to an LLM chat today (paste it in as
// context) without needing the full SDF tree or any backend/tool-calling
// wiring to exist yet.
export function downloadGalaxyIndex(project) {
  triggerDownload(`galaxy-index-${project.seed}.json`, JSON.stringify(buildGalaxyIndexEnvelope(project), null, 2));
}

export async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.fields || !parsed.bounds) {
    throw new Error("Not a recognized GalaxyGen project file.");
  }
  return parsed;
}

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
    tags: [model.role, model.hullClass, model.costTier],
    data: {
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

// Writes the real SDF tree (sectors/<slug>/entry.json, systems/<slug>/entry.json)
// via the File System Access API when the browser supports it (Chromium);
// otherwise falls back to a single combined JSON download the GM can split
// by hand.
export async function exportGalaxySDF(project) {
  const sectorCount = project.sectors.length;
  const systemCount = project.systems.length;
  const factionCount = project.factions.length;
  const actorCount = project.actors.length;
  const organizationCount = project.organizations.length;
  const eventCount = project.events.length;
  const companyCount = project.companies?.length || 0;
  const shipModelCount = project.shipModels?.length || 0;
  if (
    sectorCount === 0 &&
    systemCount === 0 &&
    factionCount === 0 &&
    actorCount === 0 &&
    organizationCount === 0 &&
    eventCount === 0 &&
    companyCount === 0 &&
    shipModelCount === 0
  ) {
    return { mode: "none", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
  }

  if ("showDirectoryPicker" in window) {
    const root = await window.showDirectoryPicker();
    // Docs/11-AI-integration.md §6.2 — the compact index a future AI
    // layer's Pass 1 (broad/coherence, §9.3) reasons over, written once at
    // the tree root rather than a per-category file since it spans all of
    // them.
    {
      const fileHandle = await root.getFileHandle("index.json", { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(buildGalaxyIndexEnvelope(project), null, 2));
      await writable.close();
    }
    if (sectorCount > 0) {
      const sectorsDir = await root.getDirectoryHandle("sectors", { create: true });
      for (const sector of project.sectors) {
        const dir = await sectorsDir.getDirectoryHandle(sector.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(sectorToEntry(sector), null, 2));
        await writable.close();
      }
    }
    if (systemCount > 0) {
      const systemsDir = await root.getDirectoryHandle("systems", { create: true });
      for (const system of project.systems) {
        const dir = await systemsDir.getDirectoryHandle(system.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(systemToEntry(system), null, 2));
        await writable.close();
      }
    }
    if (factionCount > 0) {
      const factionsDir = await root.getDirectoryHandle("factions", { create: true });
      for (const faction of project.factions) {
        const dir = await factionsDir.getDirectoryHandle(faction.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(factionToEntry(faction), null, 2));
        await writable.close();
      }
    }
    if (actorCount > 0) {
      const actorsDir = await root.getDirectoryHandle("actors", { create: true });
      for (const actor of project.actors) {
        const dir = await actorsDir.getDirectoryHandle(actor.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(actorToEntry(actor), null, 2));
        await writable.close();
      }
    }
    if (organizationCount > 0) {
      const orgsDir = await root.getDirectoryHandle("organizations", { create: true });
      for (const org of project.organizations) {
        const dir = await orgsDir.getDirectoryHandle(org.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(organizationToEntry(org, project.actors), null, 2));
        await writable.close();
      }
    }
    if (eventCount > 0) {
      const eventsDir = await root.getDirectoryHandle("events", { create: true });
      for (const event of project.events) {
        const dir = await eventsDir.getDirectoryHandle(event.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(eventToEntry(event), null, 2));
        await writable.close();
      }
    }
    if (shipModelCount > 0) {
      const modelsDir = await root.getDirectoryHandle("ship_models", { create: true });
      for (const model of project.shipModels) {
        const dir = await modelsDir.getDirectoryHandle(model.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(shipModelToEntry(model), null, 2));
        await writable.close();
      }
    }
    if (companyCount > 0) {
      const companiesDir = await root.getDirectoryHandle("companies", { create: true });
      for (const company of project.companies) {
        const dir = await companiesDir.getDirectoryHandle(company.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(companyToEntry(company), null, 2));
        await writable.close();
      }
    }
    return { mode: "fs", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
  }

  const combined = {
    index: buildGalaxyIndexEnvelope(project),
    sectors: Object.fromEntries(project.sectors.map((s) => [s.slug, sectorToEntry(s)])),
    systems: Object.fromEntries(project.systems.map((s) => [s.slug, systemToEntry(s)])),
    factions: Object.fromEntries(project.factions.map((f) => [f.slug, factionToEntry(f)])),
    actors: Object.fromEntries(project.actors.map((a) => [a.slug, actorToEntry(a)])),
    organizations: Object.fromEntries(project.organizations.map((o) => [o.slug, organizationToEntry(o, project.actors)])),
    events: Object.fromEntries(project.events.map((e) => [e.slug, eventToEntry(e)])),
    ship_models: Object.fromEntries((project.shipModels || []).map((m) => [m.slug, shipModelToEntry(m)])),
    companies: Object.fromEntries((project.companies || []).map((c) => [c.slug, companyToEntry(c)])),
  };
  triggerDownload("galaxy-sdf.json", JSON.stringify(combined, null, 2));
  return { mode: "download", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
}
