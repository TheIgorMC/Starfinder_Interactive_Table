// Docs/10-galaxy-mapgen.md §8 — "Planet generation inside a system":
// populate system.data.bodies[] with rolled planets/moons/belts/stations,
// each getting its own habitability/resource-type roll, plus §8's
// "colonization resolution" (colonized vs extraction-only vs untouched).
// Deliberately stops at that line — §8's *surface maps* (settlements/roads
// on a colonized body) are a separate, still-deferred future pass reusing
// the galaxy engine at a smaller scale; a body here is a leaf record, not
// its own node/edge graph.
import { weightedPick } from "./rng.js";
import { slugify } from "./slug.js";
import { POPULATION_BANDS } from "./populationBands.js";

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

const BODY_KINDS = [
  { value: "rocky planet", weight: 22, habitableChance: 0.35, resourceChance: 0.35 },
  { value: "terrestrial world", weight: 14, habitableChance: 0.55, resourceChance: 0.25 },
  { value: "ice world", weight: 16, habitableChance: 0.12, resourceChance: 0.45 },
  { value: "gas giant", weight: 14, habitableChance: 0, resourceChance: 0.5 },
  { value: "asteroid belt", weight: 16, habitableChance: 0, resourceChance: 0.75 },
  { value: "moon", weight: 14, habitableChance: 0.2, resourceChance: 0.3 },
  { value: "orbital station", weight: 4, habitableChance: 0, resourceChance: 0 },
];

const RESOURCE_POOL = {
  "rocky planet": ["ore", "rare minerals", "heavy metals"],
  "terrestrial world": ["biomass", "arable land", "fresh water"],
  "ice world": ["ice deposits", "volatile gases", "cryo-minerals"],
  "gas giant": ["fuel gases", "exotic gases"],
  "asteroid belt": ["ore", "rare minerals", "salvage"],
  "moon": ["ore", "ice deposits", "rare minerals"],
  "orbital station": [],
};

// Colonized-body population is capped at the *system's* own population band
// (a colony can't outgrow the system it's rated for) and never uses the
// "uninhabited / automated only" band, which would contradict "colonized".
const COLONIZED_BANDS = POPULATION_BANDS.filter((b) => !b.stationOnly);

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function bodyCount(rng, system) {
  const bandIndex = POPULATION_BANDS.findIndex((b) => b.value === system.population);
  const base = 1 + Math.floor(rng() * rng() * 5); // skewed toward 1-3, occasional up to 5
  const bonus = bandIndex >= 4 ? 1 : 0; // major colony / core world systems get one more on average
  return Math.max(1, Math.min(6, base + bonus));
}

function rollColonization(rng, body, system) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  if (body.kind === "orbital station") return "colonized"; // built infrastructure, exists by definition
  if (system.stationOnly) {
    // The system itself is uninhabited/outpost-only — real colonies are off
    // the table; at most a body ends up as an extraction site.
    if (body.resourceRich && rng() < 0.3) return "extraction";
    return "untouched";
  }
  if (body.habitable) {
    const chance = 0.12 + bandIndex * 0.15;
    if (rng() < chance) return "colonized";
    if (body.resourceRich && rng() < 0.5) return "extraction";
    return "untouched";
  }
  if (body.resourceRich) {
    const chance = 0.35 + bandIndex * 0.05;
    if (rng() < chance) return "extraction";
  }
  return "untouched";
}

function rollPopulation(rng, system) {
  const systemBandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  // A colonized body skews toward smaller than its system's own band —
  // most colonies in a "core world" system are still just a colony, not
  // another core world.
  const maxIndex = Math.min(COLONIZED_BANDS.length - 1, systemBandIndex);
  const roll = Math.floor(rng() * rng() * (maxIndex + 1));
  return COLONIZED_BANDS[Math.min(maxIndex, roll)].value;
}

// One rolled body: kind, habitability, resource, and colonization status —
// deterministic for a given rng, so it participates in the same seeded
// generation contract as everything else in systemGen.js.
function rollBody(rng, system, index) {
  const kind = weightedPick(rng, BODY_KINDS);
  const spec = BODY_KINDS.find((k) => k.value === kind);
  const habitable = rng() < spec.habitableChance;
  const resourceRich = rng() < spec.resourceChance;
  const resources = resourceRich && RESOURCE_POOL[kind].length > 0 ? [pick(rng, RESOURCE_POOL[kind])] : [];

  const body = {
    slug: `${system.slug}-${slugify(ROMAN[index] || String(index + 1))}`,
    name: `${system.name} ${ROMAN[index] || index + 1}`,
    kind,
    habitable,
    resources,
    status: "untouched",
    population: null,
    tags: [],
  };
  body.status = rollColonization(rng, { kind, habitable, resourceRich }, system);
  if (body.status === "colonized") body.population = rollPopulation(rng, system);
  if (body.status === "extraction") body.tags = ["automated-or-minimal-crew"];
  return body;
}

// Rolls a full body list for one system. `rng` is the caller's — pass a
// system-scoped rng (e.g. createRng(`${seed}:bodies:${system.slug}`)) so
// regenerating just the bodies for one system doesn't reshuffle every other
// system's roll.
export function generateBodies(rng, system) {
  const count = bodyCount(rng, system);
  const bodies = [];
  for (let i = 0; i < count; i++) bodies.push(rollBody(rng, system, i));
  return bodies;
}
