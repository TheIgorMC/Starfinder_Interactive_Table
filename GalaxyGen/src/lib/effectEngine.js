// Docs/10-galaxy-mapgen.md §9, §9.2 / Docs/11-AI-integration.md §6.5 — the
// deterministic effect engine (pipeline step 4): validates each effect
// against its op's magnitude envelope, applies the (possibly confidence-
// adjusted) delta to live state, and re-derives anything downstream that
// §4 defines as derived rather than stored (control → security → war
// chance). Pure functions throughout — every `apply*` takes a project and
// returns a new one plus a diff, never mutates its input — so a caller can
// try/catch an entire event and simply discard the result on failure
// (nothing was ever written to the real state), rather than needing an
// explicit rollback path.
import { SECTOR_FOCI } from "./project.js";
import {
  computeControlShares,
  resolveControl,
  factionSecurityFor,
  warChanceFor,
} from "./factionGen.js";

export const EFFECT_OPS = [
  "adjust_control",
  "set_owner",
  "set_system_status",
  "adjust_security",
  "adjust_relationship",
  "adjust_aggression",
  "adjust_focus",
  "adjust_influence",
  "set_affiliation",
  "relocate",
  "set_status",
  "adjust_reputation",
  "add_tag",
  "remove_tag",
];

export const MAGNITUDES = ["minor", "moderate", "major", "historic"];

export const VALID_SYSTEM_STATUSES = ["active", "destroyed", "quarantined", "uninhabitable"];
export const VALID_ACTOR_STATUSES = ["active", "deceased", "disbanded", "unknown"];

// §9.2 — "a minor event capped at ±0.05 can never flip ownership at all."
// GM-tunable defaults, not derived from anything else.
const MAGNITUDE_ENVELOPES = {
  control: { minor: 0.05, moderate: 0.15, major: 0.35, historic: 1 },
  security: { minor: 0.05, moderate: 0.15, major: 0.35, historic: 1 },
  relationship: { minor: 0.05, moderate: 0.15, major: 0.35, historic: 1 },
  aggression: { minor: 0.05, moderate: 0.15, major: 0.3, historic: 0.6 },
  influence: { minor: 0.05, moderate: 0.15, major: 0.3, historic: 0.6 },
  reputation: { minor: 0.05, moderate: 0.15, major: 0.3, historic: 0.6 },
};

// §9.2 — the separate, fixed gate `set_owner` must also clear regardless
// of magnitude tier: "the flip has to be earned by the event itself, not
// by proximity to the line."
export const MIN_OWNERSHIP_FLIP_DELTA = 0.15;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// §9.2 confidence handling: "the effect engine always pulls low-confidence
// deltas toward the midpoint of a narrower sub-range automatically." The
// exact curve isn't specified in the design doc — this is a reasonable,
// simple implementation of that intent (confidence 1 uses the full
// envelope, confidence 0 shrinks it to 30%) — tune the 0.3 floor here if
// Phase 6's actual AI-authored events call for something sharper. Inert
// for hand-authored events, which always pass confidence 1.
function envelopeCap(category, magnitude, confidence) {
  const base = MAGNITUDE_ENVELOPES[category]?.[magnitude];
  if (base == null) throw new Error(`Unknown magnitude envelope: ${category}/${magnitude}`);
  return base * (0.3 + 0.7 * clamp(confidence, 0, 1));
}

function clampToEnvelope(category, magnitude, delta, confidence) {
  const cap = envelopeCap(category, magnitude, confidence);
  return clamp(Number(delta) || 0, -cap, cap);
}

function parseRef(ref) {
  const idx = typeof ref === "string" ? ref.indexOf(":") : -1;
  if (idx < 0) throw new Error(`Invalid ref (expected "type:slug"): ${ref}`);
  return { type: ref.slice(0, idx), slug: ref.slice(idx + 1) };
}

function findSector(project, ref) {
  const { type, slug } = parseRef(ref);
  if (type !== "sector") throw new Error(`Expected a sector: ref, got ${ref}`);
  const sector = project.sectors.find((s) => s.slug === slug);
  if (!sector) throw new Error(`Sector not found: ${slug}`);
  return sector;
}

function findSystem(project, ref) {
  const { type, slug } = parseRef(ref);
  if (type !== "system") throw new Error(`Expected a system: ref, got ${ref}`);
  const system = project.systems.find((s) => s.slug === slug);
  if (!system) throw new Error(`System not found: ${slug}`);
  return system;
}

function findFaction(project, ref) {
  const { type, slug } = parseRef(ref);
  if (type !== "faction") throw new Error(`Expected a faction: ref, got ${ref}`);
  const faction = project.factions.find((f) => f.slug === slug);
  if (!faction) throw new Error(`Faction not found: ${slug}`);
  return faction;
}

function findActor(project, ref) {
  const { type, slug } = parseRef(ref);
  if (type !== "actor") throw new Error(`Expected an actor: ref, got ${ref}`);
  const actor = project.actors.find((a) => a.slug === slug);
  if (!actor) throw new Error(`Actor not found: ${slug}`);
  return actor;
}

function findOrganization(project, ref) {
  const { type, slug } = parseRef(ref);
  if (type !== "party") throw new Error(`Expected a party: ref, got ${ref}`);
  const org = project.organizations.find((o) => o.slug === slug);
  if (!org) throw new Error(`Organization not found: ${slug}`);
  return org;
}

function findActorOrOrg(project, ref) {
  const { type } = parseRef(ref);
  if (type === "actor") return { kind: "actor", entity: findActor(project, ref) };
  if (type === "party") return { kind: "organization", entity: findOrganization(project, ref) };
  throw new Error(`adjust_influence needs an actor: or party: ref, got ${ref}`);
}

const ENTITY_ARRAY_KEY = { sector: "sectors", system: "systems", faction: "factions", organization: "organizations", actor: "actors" };

function findAnyEntity(project, ref) {
  const { type } = parseRef(ref);
  if (type === "sector") return { kind: "sector", entity: findSector(project, ref) };
  if (type === "system") return { kind: "system", entity: findSystem(project, ref) };
  if (type === "faction") return { kind: "faction", entity: findFaction(project, ref) };
  if (type === "party") return { kind: "organization", entity: findOrganization(project, ref) };
  if (type === "actor") return { kind: "actor", entity: findActor(project, ref) };
  throw new Error(`Unknown ref type: ${ref}`);
}

// Reconstructs a system's current control as a `computeControlShares`-style
// list so an event-driven `adjust_control` can nudge it with the exact same
// ownership-threshold/contest logic `resolveFactions` uses — narrative
// events are a second, hand-tunable layer on top of the geometric baseline,
// same precedent as home-system anchoring already overriding the geometric
// contest outright (factionGen.js).
function sharesForSystem(system) {
  if (system.control?.owner && system.control.owner !== "dominion") {
    return [{ slug: system.control.owner, share: 1 }];
  }
  if (system.control?.contestedBy?.length) {
    return system.control.contestedBy.map((c) => ({ slug: c.faction, share: c.share }));
  }
  return [];
}

function replaceById(list, id, patch) {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function applyAdjustControl(project, effect, magnitude, confidence) {
  const system = findSystem(project, effect.target);
  const faction = findFaction(project, effect.faction);
  const clampedDelta = clampToEnvelope("control", magnitude, effect.delta, confidence);

  const shareMap = new Map(sharesForSystem(system).map((s) => [s.slug, s.share]));
  const before = shareMap.get(faction.slug) ?? 0;
  shareMap.set(faction.slug, clamp(before + clampedDelta, 0, 1));
  let total = 0;
  for (const v of shareMap.values()) total += v;
  const scale = total > 1 ? 1 / total : 1;
  const shares = [...shareMap.entries()]
    .map(([slug, share]) => ({ slug, share: Number((share * scale).toFixed(4)) }))
    .sort((a, b) => b.share - a.share);

  const factionsBySlug = new Map(project.factions.map((f) => [f.slug, f]));
  const control = resolveControl(shares);
  const factionSecurity = factionSecurityFor(shares, factionsBySlug);
  const warChance = warChanceFor(shares, factionsBySlug, system.security?.dominion ?? 0, factionSecurity);

  const nextProject = {
    ...project,
    systems: replaceById(project.systems, system.id, {
      control,
      security: { ...system.security, faction: factionSecurity },
      warChance,
    }),
  };
  return { project: nextProject, diff: { ref: effect.target, field: "control", before: system.control, after: control } };
}

function applySetOwner(project, effect, magnitude, confidence) {
  const system = findSystem(project, effect.target);
  const faction = findFaction(project, effect.faction);
  const cap = envelopeCap("control", magnitude, confidence);
  const clampedDelta = Math.min(Math.abs(Number(effect.delta) || 0), cap);
  if (clampedDelta < MIN_OWNERSHIP_FLIP_DELTA) {
    throw new Error(
      `set_owner needs a control shift of at least ${MIN_OWNERSHIP_FLIP_DELTA} (got ${clampedDelta.toFixed(2)} after the ${magnitude} envelope cap of ${cap.toFixed(2)}) — the flip has to be earned, not just declared.`,
    );
  }
  const control = { owner: faction.slug, contestedBy: [] };
  const factionSecurity = Number(Math.max(0.85, faction.strength).toFixed(2));
  const nextProject = {
    ...project,
    systems: replaceById(project.systems, system.id, {
      control,
      security: { ...system.security, faction: factionSecurity },
      warChance: 0,
    }),
  };
  return { project: nextProject, diff: { ref: effect.target, field: "control", before: system.control, after: control } };
}

function applySetSystemStatus(project, effect) {
  const system = findSystem(project, effect.target);
  if (!VALID_SYSTEM_STATUSES.includes(effect.status)) throw new Error(`Invalid system status: ${effect.status}`);
  const before = system.status || "active";
  let nextProject = { ...project, systems: replaceById(project.systems, system.id, { status: effect.status }) };

  const wasLive = before !== "destroyed" && before !== "quarantined";
  const isNowGone = effect.status === "destroyed" || effect.status === "quarantined";
  if (wasLive && isNowGone) {
    // Sever every hyperlane edge touching this system, on both ends.
    const neighborSlugs = new Set(system.hyperlanes);
    const remainingEdges = nextProject.hyperlanes.filter((e) => e.a !== system.id && e.b !== system.id);
    let systems = nextProject.systems.map((s) => {
      if (s.id === system.id) return { ...s, hyperlanes: [] };
      if (!neighborSlugs.has(s.slug)) return s;
      return { ...s, hyperlanes: s.hyperlanes.filter((slug) => slug !== system.slug) };
    });
    // Re-derive control/security/war_chance for every former neighbor —
    // a system vanishing changes their local contest (§9 pipeline step 4).
    // This is a local recompute against the live factions, not a full
    // "Generate factions" pass — it will overwrite any earlier event-driven
    // `adjust_control` on those specific neighbors with the fresh geometric
    // result, same as a full regen would.
    const factionsBySlug = new Map(project.factions.map((f) => [f.slug, f]));
    systems = systems.map((s) => {
      if (!neighborSlugs.has(s.slug)) return s;
      const shares = computeControlShares(s.position.x, s.position.y, project.factions);
      const control = resolveControl(shares);
      const factionSecurity = factionSecurityFor(shares, factionsBySlug);
      const warChance = warChanceFor(shares, factionsBySlug, s.security?.dominion ?? 0, factionSecurity);
      return { ...s, control, security: { ...s.security, faction: factionSecurity }, warChance };
    });
    nextProject = { ...nextProject, systems, hyperlanes: remainingEdges };
  }

  return { project: nextProject, diff: { ref: effect.target, field: "status", before, after: effect.status } };
}

function applyAdjustSecurity(project, effect, magnitude, confidence) {
  const system = findSystem(project, effect.target);
  const clampedDelta = clampToEnvelope("security", magnitude, effect.delta, confidence);
  const before = system.security?.dominion ?? 0;
  const after = clamp(before + clampedDelta, 0, 1);
  const shares = sharesForSystem(system);
  const factionsBySlug = new Map(project.factions.map((f) => [f.slug, f]));
  const warChance = warChanceFor(shares, factionsBySlug, after, system.security?.faction ?? 0);
  const nextProject = {
    ...project,
    systems: replaceById(project.systems, system.id, { security: { ...system.security, dominion: after }, warChance }),
  };
  return { project: nextProject, diff: { ref: effect.target, field: "security.dominion", before, after } };
}

function applyAdjustRelationship(project, effect, magnitude, confidence) {
  const factionA = findFaction(project, effect.a);
  const factionB = findFaction(project, effect.b);
  const clampedDelta = clampToEnvelope("relationship", magnitude, effect.delta, confidence);
  const before = factionA.relationships?.[factionB.slug] ?? 0;
  const after = clamp(before + clampedDelta, -1, 1);
  const nextProject = {
    ...project,
    factions: project.factions.map((f) => {
      if (f.id === factionA.id) return { ...f, relationships: { ...f.relationships, [factionB.slug]: after } };
      if (f.id === factionB.id) return { ...f, relationships: { ...f.relationships, [factionA.slug]: after } };
      return f;
    }),
  };
  return { project: nextProject, diff: { ref: effect.a, field: `relationships.${factionB.slug}`, before, after } };
}

function applyAdjustAggression(project, effect, magnitude, confidence) {
  const faction = findFaction(project, effect.faction);
  const clampedDelta = clampToEnvelope("aggression", magnitude, effect.delta, confidence);
  const before = faction.aggression;
  const after = clamp(before + clampedDelta, 0, 1);
  const nextProject = { ...project, factions: replaceById(project.factions, faction.id, { aggression: after }) };
  return { project: nextProject, diff: { ref: effect.faction, field: "aggression", before, after } };
}

function applyAdjustFocus(project, effect) {
  const sector = findSector(project, effect.target);
  if (!SECTOR_FOCI.includes(effect.focus)) throw new Error(`Invalid sector focus: ${effect.focus}`);
  const before = sector.focus;
  const nextProject = { ...project, sectors: replaceById(project.sectors, sector.id, { focus: effect.focus }) };
  return { project: nextProject, diff: { ref: effect.target, field: "focus", before, after: effect.focus } };
}

function applyAdjustInfluence(project, effect, magnitude, confidence) {
  const { kind, entity } = findActorOrOrg(project, effect.target);
  const clampedDelta = clampToEnvelope("influence", magnitude, effect.delta, confidence);
  if (kind === "actor") {
    const before = entity.influence;
    const after = clamp(before + clampedDelta, 0, 1);
    const nextProject = { ...project, actors: replaceById(project.actors, entity.id, { influence: after }) };
    return { project: nextProject, diff: { ref: effect.target, field: "influence", before, after } };
  }
  const before = entity.localInfluence;
  const after = clamp(before + clampedDelta, 0, 1);
  const nextProject = { ...project, organizations: replaceById(project.organizations, entity.id, { localInfluence: after }) };
  return { project: nextProject, diff: { ref: effect.target, field: "local_influence", before, after } };
}

// `affiliation` is already stored internally as a typed ref
// (`faction:<slug>` / `party:<slug>`), same as the AI contract — unlike
// `location` below, no bare-slug conversion needed.
function applySetAffiliation(project, effect) {
  const actor = findActor(project, effect.target);
  const affiliation = effect.affiliation ?? null;
  if (affiliation) {
    const { type } = parseRef(affiliation);
    if (type === "faction") findFaction(project, affiliation);
    else if (type === "party") findOrganization(project, affiliation);
    else throw new Error(`Invalid affiliation ref: ${affiliation}`);
  }
  const nextProject = { ...project, actors: replaceById(project.actors, actor.id, { affiliation }) };
  return { project: nextProject, diff: { ref: effect.target, field: "affiliation", before: actor.affiliation, after: affiliation } };
}

// `location` is a typed ref (`system:<slug>`) at the boundary, but stored
// internally as a bare system slug (matches every other actor-location
// write path in the app — see App.jsx's handleCreateActor/handleUpdateActor).
function applyRelocate(project, effect) {
  const actor = findActor(project, effect.target);
  let location = effect.location ?? null;
  if (location) {
    const { type, slug } = parseRef(location);
    if (type !== "system") throw new Error(`Invalid location ref: ${location}`);
    findSystem(project, location);
    location = slug;
  }
  const nextProject = {
    ...project,
    actors: replaceById(project.actors, actor.id, { location }),
    systems: location ? project.systems.map((s) => (s.slug === location ? { ...s, locked: true } : s)) : project.systems,
  };
  return { project: nextProject, diff: { ref: effect.target, field: "location", before: actor.location, after: location } };
}

function applySetActorStatus(project, effect) {
  const actor = findActor(project, effect.target);
  if (!VALID_ACTOR_STATUSES.includes(effect.status)) throw new Error(`Invalid actor status: ${effect.status}`);
  const nextProject = { ...project, actors: replaceById(project.actors, actor.id, { status: effect.status }) };
  return { project: nextProject, diff: { ref: effect.target, field: "status", before: actor.status, after: effect.status } };
}

function applyAdjustReputation(project, effect, magnitude, confidence) {
  const actor = findActor(project, effect.actor);
  const faction = findFaction(project, effect.faction);
  const clampedDelta = clampToEnvelope("reputation", magnitude, effect.delta, confidence);
  const before = actor.reputation?.[faction.slug] ?? 0;
  const after = clamp(before + clampedDelta, -1, 1);
  const nextProject = {
    ...project,
    actors: replaceById(project.actors, actor.id, { reputation: { ...actor.reputation, [faction.slug]: after } }),
  };
  return { project: nextProject, diff: { ref: effect.actor, field: `reputation.${faction.slug}`, before, after } };
}

function applyAddTag(project, effect) {
  const { kind, entity } = findAnyEntity(project, effect.target);
  const key = ENTITY_ARRAY_KEY[kind];
  const before = entity.extraTags || [];
  const after = before.includes(effect.tag) ? before : [...before, effect.tag];
  const nextProject = { ...project, [key]: replaceById(project[key], entity.id, { extraTags: after }) };
  return { project: nextProject, diff: { ref: effect.target, field: "extraTags", before, after } };
}

function applyRemoveTag(project, effect) {
  const { kind, entity } = findAnyEntity(project, effect.target);
  const key = ENTITY_ARRAY_KEY[kind];
  const before = entity.extraTags || [];
  const after = before.filter((t) => t !== effect.tag);
  const nextProject = { ...project, [key]: replaceById(project[key], entity.id, { extraTags: after }) };
  return { project: nextProject, diff: { ref: effect.target, field: "extraTags", before, after } };
}

// One effect in, one { project, diff } out — see the ops table in
// Docs/11-AI-integration.md §6.5 for each op's exact field shape.
export function applyEffect(project, effect, magnitude, confidence = 1) {
  switch (effect.op) {
    case "adjust_control": return applyAdjustControl(project, effect, magnitude, confidence);
    case "set_owner": return applySetOwner(project, effect, magnitude, confidence);
    case "set_system_status": return applySetSystemStatus(project, effect);
    case "adjust_security": return applyAdjustSecurity(project, effect, magnitude, confidence);
    case "adjust_relationship": return applyAdjustRelationship(project, effect, magnitude, confidence);
    case "adjust_aggression": return applyAdjustAggression(project, effect, magnitude, confidence);
    case "adjust_focus": return applyAdjustFocus(project, effect);
    case "adjust_influence": return applyAdjustInfluence(project, effect, magnitude, confidence);
    case "set_affiliation": return applySetAffiliation(project, effect);
    case "relocate": return applyRelocate(project, effect);
    case "set_status": return applySetActorStatus(project, effect);
    case "adjust_reputation": return applyAdjustReputation(project, effect, magnitude, confidence);
    case "add_tag": return applyAddTag(project, effect);
    case "remove_tag": return applyRemoveTag(project, effect);
    default: throw new Error(`Unknown effect op: ${effect.op}`);
  }
}

// Applies every effect in an event in order, threading the resulting
// project through each one so effect N sees effect N-1's changes (§9
// pipeline step 4). All-or-nothing: the moment any effect throws, this
// function throws too and nothing from `project` has been touched — the
// caller's existing state is the untouched original object the whole way
// through, so a rejected event never leaves partial changes behind.
export function applyEvent(project, event) {
  let current = project;
  const diffs = [];
  for (const effect of event.effects) {
    const { project: next, diff } = applyEffect(current, effect, event.magnitude, effect.confidence ?? 1);
    current = next;
    diffs.push({ ...diff, op: effect.op });
  }
  return { project: current, diffs };
}
