// Docs/11-AI-integration.md §6.2 — `query_galaxy`'s "full" mode: resolves
// a scope of typed refs to the exact SDF entry shape "Export SDF" writes
// (reusing persistence.js's entry-builders directly, so there's zero drift
// between what pass 2 sees and what actually gets exported), plus recent
// event slugs touching that scope. The "index" mode lives in aiIndex.js —
// this module is Pass 2's deep-detail counterpart (§9.3).
import {
  sectorToEntry,
  systemToEntry,
  factionToEntry,
  actorToEntry,
  organizationToEntry,
} from "./persistence.js";

function parseRef(ref) {
  const idx = typeof ref === "string" ? ref.indexOf(":") : -1;
  if (idx < 0) return null;
  return { type: ref.slice(0, idx), slug: ref.slice(idx + 1) };
}

export function resolveEntity(project, ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const { type, slug } = parsed;
  if (type === "sector") {
    const s = project.sectors.find((x) => x.slug === slug);
    return s ? { ref, entry: sectorToEntry(s) } : null;
  }
  if (type === "system") {
    const s = project.systems.find((x) => x.slug === slug);
    return s ? { ref, entry: systemToEntry(s) } : null;
  }
  if (type === "faction") {
    const f = project.factions.find((x) => x.slug === slug);
    return f ? { ref, entry: factionToEntry(f) } : null;
  }
  if (type === "party") {
    const o = project.organizations.find((x) => x.slug === slug);
    return o ? { ref, entry: organizationToEntry(o, project.actors) } : null;
  }
  if (type === "actor") {
    const a = project.actors.find((x) => x.slug === slug);
    return a ? { ref, entry: actorToEntry(a) } : null;
  }
  return null;
}

// `scope` is an array of typed refs (never the literal "all" — §6.2 only
// allows that shortcut in index mode; a full-mode caller must shortlist
// first, same rule this function's caller enforces by construction since
// it's always fed Pass 1's shortlist).
export function queryGalaxyFull(project, scope, includeEvents = 10) {
  const entities = scope.map((ref) => resolveEntity(project, ref)).filter(Boolean);
  const scopeSet = new Set(scope);
  const events = [...project.events]
    .reverse()
    .filter((e) => (e.scope || []).some((ref) => scopeSet.has(ref)))
    .slice(0, includeEvents)
    .map((e) => e.slug);
  return { entities, events };
}
