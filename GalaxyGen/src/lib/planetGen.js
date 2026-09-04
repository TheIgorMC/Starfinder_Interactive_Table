// Docs/10-galaxy-mapgen.md §8 — "Planet generation inside a system" and
// "colonization resolution," rebuilt on real orbital mechanics rather than
// pure flavor rolls so an orrery view (§8) has something plausible to draw:
// bodies get an actual orbital distance (AU) placed relative to the star's
// real habitable zone and frost line (both derived from stellar luminosity
// via the standard sqrt(L) scaling), a body's *kind* is chosen by where
// that orbit falls (rocky/scorched close in, terrestrial candidates only
// inside the habitable zone, ice/gas/belts beyond the frost line), and
// orbital period comes straight from Kepler's third law. Moons orbit their
// parent planet, not the star, and stations only spawn attached to a body
// that's actually colonized or being worked for resources — not floating
// at a random, purposeless orbit. None of this is N-body simulation, just
// astronomically-plausible *placement*, same spirit as the Delaunay/
// Poisson-disc "plausible not simulated" approach the rest of this doc
// uses for the galaxy scale.
import { weightedPick } from "./rng.js";
import { slugify } from "./slug.js";
import { POPULATION_BANDS } from "./populationBands.js";
import { getStarProfile } from "./starTypes.js";

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// Conservative habitable-zone flux thresholds (relative to solar flux at
// 1 AU) and the frost-line/inner-edge constants — all standard sqrt(L)
// approximations, not simulated radiative transfer.
const HZ_INNER_FLUX = 1.1;
const HZ_OUTER_FLUX = 0.53;
const FROST_LINE_AU_PER_SQRT_L = 2.7;
const MIN_ORBIT_AU_PER_SQRT_L = 0.06;
const MIN_ORBIT_FLOOR_AU = 0.03;

function starZones(profile) {
  const sqrtL = Math.sqrt(Math.max(profile.luminosity, 1e-6));
  return {
    hzInner: sqrtL / Math.sqrt(HZ_INNER_FLUX),
    hzOuter: sqrtL / Math.sqrt(HZ_OUTER_FLUX),
    frostLine: FROST_LINE_AU_PER_SQRT_L * sqrtL,
    minOrbit: Math.max(MIN_ORBIT_FLOOR_AU, MIN_ORBIT_AU_PER_SQRT_L * sqrtL),
  };
}

// Kepler's third law: P(years) = sqrt(a(AU)^3 / M(solar masses)).
function orbitalPeriodDays(orbitAU, starMassSolar) {
  const years = Math.sqrt(orbitAU ** 3 / Math.max(starMassSolar, 0.05));
  return Math.round(years * 365.25);
}

const RESOURCE_POOL = {
  "rocky planet": ["ore", "rare minerals", "heavy metals"],
  "terrestrial world": ["biomass", "arable land", "fresh water"],
  "ice world": ["ice deposits", "volatile gases", "cryo-minerals"],
  "gas giant": ["fuel gases", "exotic gases"],
  "asteroid belt": ["ore", "rare minerals", "salvage"],
  moon: ["ore", "ice deposits", "rare minerals"],
};
const RESOURCE_CHANCE = {
  "rocky planet": 0.35,
  "terrestrial world": 0.22,
  "ice world": 0.45,
  "gas giant": 0.5,
  "asteroid belt": 0.8,
  moon: 0.3,
};

const SIZE_CLASSES = {
  "rocky planet": [
    { value: "dwarf world", weight: 25, radius: [1500, 3200] },
    { value: "small rocky world", weight: 35, radius: [3200, 5800] },
    { value: "Earth-sized world", weight: 30, radius: [5800, 7200] },
    { value: "super-Earth", weight: 10, radius: [7200, 11000] },
  ],
  "terrestrial world": [
    { value: "small terrestrial world", weight: 25, radius: [3500, 5800] },
    { value: "Earth-sized world", weight: 45, radius: [5800, 7200] },
    { value: "super-Earth", weight: 30, radius: [7200, 11500] },
  ],
  "ice world": [
    { value: "small icy body", weight: 40, radius: [800, 2500] },
    { value: "ice dwarf", weight: 35, radius: [2500, 4500] },
    { value: "large ice world", weight: 25, radius: [4500, 7000] },
  ],
  "gas giant": [
    { value: "Neptune-class gas giant", weight: 45, radius: [20000, 28000] },
    { value: "Jupiter-class gas giant", weight: 40, radius: [50000, 75000] },
    { value: "super-Jupiter", weight: 15, radius: [75000, 100000] },
  ],
  moon: [
    { value: "minor moon", weight: 50, radius: [150, 900] },
    { value: "major moon", weight: 35, radius: [900, 2600] },
    { value: "large moon", weight: 15, radius: [2600, 5200] },
  ],
};

function rollSize(rng, kind) {
  const classes = SIZE_CLASSES[kind];
  if (!classes) return { sizeClass: null, radiusKm: null };
  const value = weightedPick(rng, classes);
  const spec = classes.find((c) => c.value === value);
  const radiusKm = Math.round(spec.radius[0] + rng() * (spec.radius[1] - spec.radius[0]));
  return { sizeClass: value, radiusKm };
}

// Colonized-body population is capped at the *system's* own population
// band (a colony can't outgrow the system it's rated for) and never uses
// the "uninhabited / automated only" band, which would contradict
// "colonized".
const COLONIZED_BANDS = POPULATION_BANDS.filter((b) => !b.stationOnly);
const STATION_CREW = ["skeleton crew", "small crew complement", "full station complement"];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const MOON_LETTERS = "abcdefgh";

function primaryCount(rng, system) {
  const bandIndex = POPULATION_BANDS.findIndex((b) => b.value === system.population);
  const base = 2 + Math.floor(rng() * rng() * 5); // skewed toward 2-4, occasional up to 6
  const bonus = bandIndex >= 4 ? 1 : 0; // major colony / core world systems get one more on average
  return Math.max(1, Math.min(7, base + bonus));
}

// Successive orbits step out by a random 1.3x-2.2x ratio from the previous
// one — not physically derived (real systems don't follow a single rule;
// Titius-Bode-style relations are a loose historical pattern, not a law),
// but it keeps orbits spread out in the same rough-geometric-progression
// shape real systems tend to show rather than clustering unrealistically.
function rollOrbits(rng, count, minOrbit) {
  const orbits = [];
  let a = minOrbit * (0.85 + rng() * 0.3);
  for (let i = 0; i < count; i++) {
    orbits.push(a);
    a *= 1.3 + rng() * 0.9;
  }
  return orbits;
}

function pickKind(rng, orbitAU, zones, remnant) {
  if (remnant) {
    return weightedPick(rng, [
      { value: "rocky planet", weight: 40 },
      { value: "asteroid belt", weight: 35 },
      { value: "ice world", weight: 15 },
      { value: "gas giant", weight: 10 },
    ]);
  }
  const inHZ = orbitAU >= zones.hzInner && orbitAU <= zones.hzOuter;
  if (orbitAU >= zones.frostLine) {
    return weightedPick(rng, [
      { value: "gas giant", weight: 34 },
      { value: "ice world", weight: 34 },
      { value: "asteroid belt", weight: 24 },
      { value: "rocky planet", weight: 8 },
    ]);
  }
  if (inHZ) {
    return weightedPick(rng, [
      { value: "terrestrial world", weight: 55 },
      { value: "rocky planet", weight: 35 },
      { value: "asteroid belt", weight: 6 },
      { value: "gas giant", weight: 4 }, // rare "hot Jupiter parked in the HZ" edge case
    ]);
  }
  // Inside the frost line but outside the HZ — either scorched-close or a
  // warm-but-dry gap between the HZ and the frost line.
  return weightedPick(rng, [
    { value: "rocky planet", weight: 60 },
    { value: "asteroid belt", weight: 25 },
    { value: "gas giant", weight: 10 }, // hot Jupiter
    { value: "terrestrial world", weight: 5 }, // marginal (e.g. tidally-locked edge case)
  ]);
}

// Only a body actually sitting in the habitable zone can roll habitable —
// this is the fix for the old model, which rolled habitability completely
// independent of where a body actually was. Gas giants/ice worlds/belts
// are never themselves habitable, but a moon orbiting a gas giant parked
// in the HZ can be (real sci-fi convention, and physically not absurd).
function rollHabitable(rng, kind, orbitAU, zones, remnant) {
  if (remnant) return false;
  const inHZ = orbitAU >= zones.hzInner && orbitAU <= zones.hzOuter;
  if (!inHZ) return false;
  if (kind === "terrestrial world") return rng() < 0.55;
  if (kind === "rocky planet") return rng() < 0.18;
  return false;
}

function rollColonization(rng, body, system) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  if (system.stationOnly) {
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

function rollPrimary(rng, system, zones, remnant, starMass, index) {
  const orbitAU = zones.orbits[index];
  const kind = pickKind(rng, orbitAU, zones, remnant);
  const habitable = rollHabitable(rng, kind, orbitAU, zones, remnant);
  const resourceRich = rng() < (RESOURCE_CHANCE[kind] ?? 0.3);
  const resources = resourceRich && RESOURCE_POOL[kind]?.length ? [pick(rng, RESOURCE_POOL[kind])] : [];
  const { sizeClass, radiusKm } = rollSize(rng, kind);
  const isBelt = kind === "asteroid belt";

  const body = {
    slug: `${system.slug}-${slugify(ROMAN[index] || String(index + 1))}`,
    name: `${system.name} ${ROMAN[index] || index + 1}`,
    kind,
    parent: null,
    orbitAU: Number(orbitAU.toFixed(3)),
    orbitAUOuter: isBelt ? Number((orbitAU * (1.08 + rng() * 0.12)).toFixed(3)) : null,
    orbitAngleDeg: Number((rng() * 360).toFixed(1)),
    orbitPeriodDays: isBelt ? null : orbitalPeriodDays(orbitAU, starMass),
    sizeClass,
    radiusKm,
    habitable,
    resources,
    status: "untouched",
    population: null,
    tags: remnant ? ["irradiated"] : [],
  };
  body.status = rollColonization(rng, { habitable, resourceRich }, system);
  if (body.status === "colonized") body.population = rollPopulation(rng, system);
  if (body.status === "extraction") body.tags = [...body.tags, "automated-or-minimal-crew"];
  return body;
}

// Real moons orbit their planet, not the star — modeled as attachments
// (`parent: <primary slug>`) rather than their own star-orbit slot. Gas
// giants get more moon slots than rocky/terrestrial worlds; belts and
// ice-world edge cases get none, matching real-solar-system proportions
// loosely (Jupiter/Saturn have dozens; Earth/Mars have one or two).
const MOON_SLOTS = { "gas giant": 3, "terrestrial world": 2, "rocky planet": 2, "ice world": 1 };

function rollMoons(rng, primary, zones, remnant) {
  if (remnant) return [];
  const slots = MOON_SLOTS[primary.kind] || 0;
  const moons = [];
  for (let i = 0; i < slots; i++) {
    if (rng() >= 0.4) continue;
    const resourceRich = rng() < RESOURCE_CHANCE.moon;
    const resources = resourceRich ? [pick(rng, RESOURCE_POOL.moon)] : [];
    const { sizeClass, radiusKm } = rollSize(rng, "moon");
    // A moon of a body parked in the habitable zone can itself be
    // habitable — a real orbital-mechanics case (a rocky moon gets its
    // own light/heat from the star, same as any planet at that distance),
    // and standard in sci-fi worldbuilding.
    const inHZ = primary.orbitAU >= zones.hzInner && primary.orbitAU <= zones.hzOuter;
    const habitable = inHZ && rng() < 0.12;
    moons.push({
      slug: `${primary.slug}-${MOON_LETTERS[i] || i}`,
      name: `${primary.name} ${MOON_LETTERS[i] || i}`,
      kind: "moon",
      parent: primary.slug,
      orbitAU: null,
      orbitAUOuter: null,
      orbitAngleDeg: Number((rng() * 360).toFixed(1)),
      orbitPeriodDays: null,
      sizeClass,
      radiusKm,
      habitable,
      resources,
      status: "untouched", // resolved below once the caller knows the primary's status
      population: null,
      tags: [],
    });
  }
  return moons;
}

function rollStation(rng, host, system, siblingCount) {
  return {
    slug: `${host.slug}-station-${siblingCount + 1}`,
    name: `${host.name} Station`,
    kind: "orbital station",
    parent: host.slug,
    orbitAU: null,
    orbitAUOuter: null,
    orbitAngleDeg: Number((rng() * 360).toFixed(1)),
    orbitPeriodDays: null,
    sizeClass: pick(rng, ["outpost platform", "trade station", "orbital shipyard"]),
    radiusKm: null,
    habitable: false,
    resources: [],
    status: "colonized",
    population: pick(rng, STATION_CREW),
    tags: ["orbital-infrastructure"],
  };
}

// Rolls a full body list for one system: primaries (rocky/terrestrial/ice/
// gas-giant/asteroid-belt) placed by real orbital distance relative to the
// star's habitable zone and frost line, plus moons attached to a primary
// and stations attached only to a primary that's actually colonized or
// worked for resources. `rng` is the caller's — pass a system-scoped rng
// (e.g. createRng(`${seed}:bodies:${system.slug}`)) so regenerating just
// one system's bodies doesn't reshuffle any other system's roll.
export function generateBodies(rng, system) {
  const profile = getStarProfile(system.starType);
  const remnant = !!profile.remnant;
  const z = starZones(profile);
  const count = primaryCount(rng, system);
  z.orbits = rollOrbits(rng, count, z.minOrbit);

  const bodies = [];
  let stationsPlaced = 0;

  for (let i = 0; i < count; i++) {
    const primary = rollPrimary(rng, system, z, remnant, profile.mass, i);
    bodies.push(primary);

    const moons = rollMoons(rng, primary, z, remnant);
    for (const moon of moons) {
      // A moon shares its parent's colonization outcome by default (a
      // habitable HZ moon can still independently roll extraction/
      // colonized on top of that), rather than every moon defaulting to
      // untouched regardless of what's happening on its parent.
      const resourceRich = moon.resources.length > 0;
      moon.status = rollColonization(rng, { habitable: moon.habitable, resourceRich }, system);
      if (moon.status === "colonized") moon.population = rollPopulation(rng, system);
      if (moon.status === "extraction") moon.tags = ["automated-or-minimal-crew"];
      bodies.push(moon);
    }

    if (!remnant && (primary.status === "colonized" || primary.status === "extraction") && stationsPlaced < 2 && rng() < 0.35) {
      stationsPlaced++;
      bodies.push(rollStation(rng, primary, system, moons.length));
    }
  }

  return bodies;
}

// Exposed for the orrery view (SectorList.jsx) so it can draw the
// habitable-zone band and frost line without re-deriving the formulas.
export function getSystemZones(system) {
  const profile = getStarProfile(system.starType);
  const z = starZones(profile);
  return { ...z, remnant: !!profile.remnant, starColor: profile.color, starMass: profile.mass, starLuminosity: profile.luminosity };
}
