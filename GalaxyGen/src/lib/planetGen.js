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

// A station's *class* is really "role + rough size" bundled together, same
// spirit as SIZE_CLASSES above but for built infrastructure instead of
// planetary bodies — Docs/10-galaxy-mapgen.md §8's "a station should read
// like a small city, sized to the economy it serves." `population`/`docks`/
// `lengthM` are [min, max] ranges scaled by the *system's* population band
// (a mining platform in a core-world system is a very different place than
// one in a frontier outpost system) via scaleInRange below. `tier` gates
// which classes even become candidates at low population bands (a
// megastation has no business existing off a small colony's economy).
export const STATION_CLASSES = [
  { value: "refueling outpost", tier: 0, population: [4, 60], docks: [1, 2], lengthM: [60, 180] },
  { value: "waystation", tier: 1, population: [60, 500], docks: [2, 4], lengthM: [180, 400] },
  { value: "mining platform", tier: 1, population: [80, 800], docks: [2, 5], lengthM: [220, 500] },
  { value: "research outpost", tier: 1, population: [30, 300], docks: [1, 3], lengthM: [150, 350] },
  { value: "trade station", tier: 2, population: [500, 8000], docks: [4, 10], lengthM: [400, 900] },
  { value: "cargo terminal", tier: 2, population: [300, 4000], docks: [6, 16], lengthM: [500, 1100] },
  { value: "orbital shipyard", tier: 2, population: [400, 5000], docks: [3, 9], lengthM: [500, 1300] },
  { value: "orbital fortress", tier: 2, population: [600, 6000], docks: [3, 8], lengthM: [400, 1000] },
  { value: "megastation", tier: 3, population: [8000, 250000], docks: [14, 50], lengthM: [1300, 4500] },
];
const STATION_NAME_SUFFIX = {
  "refueling outpost": "Fuel Depot",
  waystation: "Waystation",
  "mining platform": "Mining Platform",
  "research outpost": "Research Outpost",
  "trade station": "Trade Station",
  "cargo terminal": "Cargo Terminal",
  "orbital shipyard": "Shipyard",
  "orbital fortress": "Fortress",
  megastation: "Megastation",
};
const DOCK_CLASS_BY_TIER = {
  0: "shuttle & light-freighter berths",
  1: "shuttle & light-freighter berths",
  2: "freighter-capable berths",
  3: "capital-ship dry dock",
};
// Which station classes a sector's economic focus tends to build — mirrors
// systemGen.js's FOCUS_TRADE table (same sector.focus values) but for
// "what infrastructure does this economy need in orbit" rather than "what
// goods move through it." A body actively being worked for resources
// (`status: "extraction"`) overrides this with EXTRACTION_STATION_WEIGHTS
// below, since that's about *that body's* economy, not the system's
// general one (a research-focus system can still have a mining platform
// parked over the one asteroid belt it's actually extracting from).
const FOCUS_STATION_WEIGHTS = {
  mining: [["mining platform", 45], ["cargo terminal", 30], ["refueling outpost", 15], ["waystation", 10]],
  agriculture: [["trade station", 35], ["waystation", 35], ["cargo terminal", 20], ["refueling outpost", 10]],
  industry: [["orbital shipyard", 35], ["cargo terminal", 35], ["trade station", 20], ["mining platform", 10]],
  research: [["research outpost", 55], ["waystation", 30], ["trade station", 15]],
  "trade hub": [["trade station", 40], ["cargo terminal", 35], ["megastation", 10], ["waystation", 15]],
  frontier: [["refueling outpost", 55], ["waystation", 30], ["mining platform", 15]],
  administrative: [["waystation", 45], ["orbital fortress", 30], ["trade station", 25]],
  military: [["orbital fortress", 55], ["orbital shipyard", 30], ["waystation", 15]],
  residential: [["waystation", 45], ["trade station", 35], ["research outpost", 20]],
  logistics: [["cargo terminal", 50], ["trade station", 30], ["waystation", 20]],
  medical: [["research outpost", 45], ["waystation", 40], ["trade station", 15]],
  cultural: [["waystation", 45], ["trade station", 40], ["research outpost", 15]],
};
const DEFAULT_STATION_WEIGHTS = [["waystation", 45], ["trade station", 30], ["refueling outpost", 25]];
const EXTRACTION_STATION_WEIGHTS = [["mining platform", 45], ["cargo terminal", 25], ["refueling outpost", 30]];

const SERVICE_POOL = {
  0: ["refueling", "basic repairs", "black-market goods"],
  1: ["refueling", "repairs", "general store", "cantina", "medical bay"],
  2: ["refueling", "full repairs", "cargo brokerage", "medical bay", "cantina", "black-market goods", "shipyard services"],
  3: [
    "refueling",
    "full repairs",
    "cargo brokerage",
    "medical center",
    "entertainment district",
    "shipyard services",
    "customs & security",
    "diplomatic offices",
  ],
};

function sampleN(rng, list, n) {
  const arr = list.slice();
  const out = [];
  const count = Math.min(n, arr.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * arr.length);
    out.push(arr.splice(idx, 1)[0]);
  }
  return out;
}

// Lerps within [lo, hi] biased upward by the system's population band (a
// station in a core-world system trends toward the top of its class's
// range) plus randomness, so two "trade station"s don't come out
// identical just because they picked the same class.
function scaleInRange(rng, [lo, hi], bandIndex) {
  const t = Math.min(1, Math.max(0, 0.1 + (bandIndex / 5) * 0.55 + rng() * 0.35));
  return lo + t * (hi - lo);
}

function pickStationClass(rng, system, host) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  const focus = system.tags?.[0];
  const table = host.status === "extraction" ? EXTRACTION_STATION_WEIGHTS : FOCUS_STATION_WEIGHTS[focus] || DEFAULT_STATION_WEIGHTS;
  // A megastation needs a major-colony-or-better economy behind it —
  // filter it out rather than let a lucky roll plant one over a backwater.
  const candidates = table.filter(([value]) => {
    const cls = STATION_CLASSES.find((c) => c.value === value);
    return !(cls.tier === 3 && bandIndex < 4);
  });
  const pool = candidates.length > 0 ? candidates : table;
  const value = weightedPick(rng, pool.map(([v, weight]) => ({ value: v, weight })));
  return STATION_CLASSES.find((c) => c.value === value);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const MOON_LETTERS = "abcdefgh";

function primaryCount(rng, system) {
  const bandIndex = POPULATION_BANDS.findIndex((b) => b.value === system.population);
  const base = 2 + Math.floor(rng() * rng() * 5); // skewed toward 2-4, occasional up to 6
  const bonus = bandIndex >= 4 ? 1 : 0; // major colony / core world systems get one more on average
  return Math.max(1, Math.min(7, base + bonus));
}

// Log-spaced from minOrbit out to a system-wide outer edge well past the
// frost line (2.2x-4.5x it), rather than a fixed per-step multiplier
// walked outward from minOrbit. The old version compounded a 1.3x-2.2x
// ratio starting from a tiny minOrbit (~0.03-0.06 AU) — with the common
// 2-4-body count (primaryCount skews low), that walk never reached even
// the habitable zone (~1 AU) before running out of bodies, let alone the
// frost line (~2.7 AU for a sun-like star), so nearly every system's
// primaries ended up crowded interior to the HZ regardless of count (a GM
// caught this live: "systems often are all before the HZ"). Spacing the
// whole body count log-uniformly across the *entire* minOrbit-to-outer-edge
// span instead guarantees a spread across close/HZ/far every time, even
// for a 2-body system — matching how gas giants and ice worlds (which
// pickKind only places past the frost line, barring rare hot-Jupiter/
// marginal edge cases) are actually supposed to show up at all. Per-body
// multiplicative jitter keeps it from reading as too evenly spaced (same
// concern systemGen.js's own system-spacing jitter addresses at the galaxy
// scale), with a minimum-separation clamp afterward so jitter can't shove
// two orbits into a collision.
function rollOrbits(rng, count, zones) {
  const { minOrbit, frostLine } = zones;
  const outerEdge = Math.max(minOrbit * 4, frostLine * (2.2 + rng() * 2.3));
  if (count === 1) return [minOrbit * (1.2 + rng() * (outerEdge / minOrbit - 1.2))];

  const logMin = Math.log(minOrbit);
  const logMax = Math.log(outerEdge);
  const orbits = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const base = Math.exp(logMin + t * (logMax - logMin));
    const jitter = 0.75 + rng() * 0.5; // ±25%, doesn't reorder neighbors given the log spacing below
    orbits.push(Math.max(minOrbit, base * jitter));
  }
  orbits.sort((a, b) => a - b);
  for (let i = 1; i < orbits.length; i++) {
    if (orbits[i] < orbits[i - 1] * 1.15) orbits[i] = orbits[i - 1] * 1.15;
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

// Realistic-feeling station: a role+size class driven by the sector's
// economy (or, for a body actively worked for resources, that body's own
// extraction economy), with population/docks/physical length all scaled
// together to the same size tier — no more "small crew complement" hand-
// wave, an actual headcount and berth count reflecting how big a "city in
// orbit" the local economy can support.
function rollStation(rng, host, system, siblingCount) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  const cls = pickStationClass(rng, system, host);
  const population = Math.round(scaleInRange(rng, cls.population, bandIndex));
  const docks = Math.round(scaleInRange(rng, cls.docks, bandIndex));
  const lengthM = Math.round(scaleInRange(rng, cls.lengthM, bandIndex));
  const services = sampleN(rng, SERVICE_POOL[cls.tier] || SERVICE_POOL[1], 2 + cls.tier + Math.floor(rng() * 2));
  const tradePool = [...(system.export || []), ...(system.import || [])];
  const goodsHandled = tradePool.length > 0 ? sampleN(rng, tradePool, Math.min(tradePool.length, 1 + cls.tier)) : [];

  return {
    slug: `${host.slug}-station-${siblingCount + 1}`,
    name: `${host.name} ${STATION_NAME_SUFFIX[cls.value] || "Station"}`,
    kind: "orbital station",
    parent: host.slug,
    orbitAU: null,
    orbitAUOuter: null,
    orbitAngleDeg: Number((rng() * 360).toFixed(1)),
    orbitPeriodDays: null,
    sizeClass: cls.value,
    lengthM,
    radiusKm: null,
    habitable: false,
    resources: [],
    status: "colonized",
    population,
    docks,
    dockClass: DOCK_CLASS_BY_TIER[cls.tier] || DOCK_CLASS_BY_TIER[1],
    services,
    goodsHandled,
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
  z.orbits = rollOrbits(rng, count, z);

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
