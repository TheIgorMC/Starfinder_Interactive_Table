import { slugify } from "../../src/lib/slug.js";

// Same "append -2, -3, ..." collision handling systemGen.js/App.jsx already
// use for every entity list — kept here once so every tools/*.js module
// slugifies new entities identically instead of re-implementing it.
export function uniqueSlug(base, list) {
  const used = new Set(list.map((x) => x.slug));
  const s = slugify(base);
  if (!used.has(s)) return s;
  let i = 2;
  while (used.has(`${s}-${i}`)) i++;
  return `${s}-${i}`;
}

// Every entity-by-slug lookup a tool needs, in one place — throws a
// specific, GM/AI-readable error instead of returning undefined and
// letting a `.slug` access blow up somewhere downstream with a confusing
// stack trace.
export function findBySlug(list, slug, kind) {
  const found = list.find((x) => x.slug === slug);
  if (!found) throw new Error(`No ${kind} with slug "${slug}".`);
  return found;
}

export function findById(list, id, kind) {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`No ${kind} with id "${id}".`);
  return found;
}

export function sector(project, slug) {
  return findBySlug(project.sectors, slug, "sector");
}
export function system(project, slug) {
  return findBySlug(project.systems, slug, "system");
}
export function faction(project, slug) {
  return findBySlug(project.factions, slug, "faction");
}
export function actor(project, slug) {
  return findBySlug(project.actors, slug, "actor");
}
export function organization(project, slug) {
  return findBySlug(project.organizations, slug, "organization");
}

export function replaceBySlug(list, slug, patch) {
  return list.map((x) => (x.slug === slug ? { ...x, ...patch } : x));
}
