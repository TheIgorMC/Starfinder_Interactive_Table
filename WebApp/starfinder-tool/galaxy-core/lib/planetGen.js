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
// Populations are for a setting where the colonized systems are *crowded*:
// a core-world trade station is a small city, a megastation a big one.
export const STATION_CLASSES = [
  { value: "refueling outpost", tier: 0, population: [20, 900], docks: [2, 6], lengthM: [80, 300] },
  { value: "waystation", tier: 1, population: [400, 25000], docks: [4, 14], lengthM: [250, 900] },
  { value: "mining platform", tier: 1, population: [600, 30000], docks: [4, 16], lengthM: [300, 1200] },
  { value: "research outpost", tier: 1, population: [200, 12000], docks: [2, 8], lengthM: [200, 800] },
  { value: "trade station", tier: 2, population: [8000, 400000], docks: [12, 60], lengthM: [800, 3000] },
  { value: "cargo terminal", tier: 2, population: [5000, 150000], docks: [20, 120], lengthM: [1000, 4000] },
  { value: "orbital shipyard", tier: 2, population: [10000, 300000], docks: [8, 40], lengthM: [1200, 6000] },
  { value: "orbital fortress", tier: 2, population: [6000, 200000], docks: [8, 30], lengthM: [900, 3500] },
  { value: "megastation", tier: 3, population: [300000, 12000000], docks: [60, 400], lengthM: [4000, 30000] },
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
  const t = Math.min(1, Math.max(0, (bandIndex / 5) * 0.65 + rng() * 0.35));
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
    return !(cls.tier === 3 && bandIndex < 4) && !(cls.tier === 2 && bandIndex === 0);
  });
  const pool = candidates.length > 0 ? candidates : [["waystation", 60], ["refueling outpost", 40]];
  const value = weightedPick(rng, pool.map(([v, weight]) => ({ value: v, weight })));
  return STATION_CLASSES.find((c) => c.value === value);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const MOON_LETTERS = "abcdefgh";

// Charted primaries only (the map shows bodies that matter, not every
// rock): 3-8, centred on 4-6, one more for major-colony/core systems.
function primaryCount(rng, system) {
  const bandIndex = POPULATION_BANDS.findIndex((b) => b.value === system.population);
  const base = 3 + Math.floor((rng() + rng()) * 2.5); // 3-7, triangular around 5
  const bonus = bandIndex >= 4 && rng() < 0.6 ? 1 : 0;
  return Math.max(3, Math.min(8, base + bonus));
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
  // Every (non-remnant) star gets at least one body in its golden zone:
  // the orbit closest to the HZ centre is moved into it.
  if (zones.hzOuter > zones.minOrbit && !orbits.some((o) => o >= zones.hzInner && o <= zones.hzOuter)) {
    const mid = Math.sqrt(Math.max(zones.hzInner, zones.minOrbit) * zones.hzOuter);
    let best = 0;
    orbits.forEach((o, i) => { if (Math.abs(Math.log(o / mid)) < Math.abs(Math.log(orbits[best] / mid))) best = i; });
    orbits[best] = mid * (0.9 + rng() * 0.2);
    orbits.sort((a, b) => a - b);
  }
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
      { value: "terrestrial world", weight: 70 },
      { value: "rocky planet", weight: 24 },
      { value: "asteroid belt", weight: 2 },
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
  if (kind === "terrestrial world") return rng() < 0.85;
  if (kind === "rocky planet") return rng() < 0.35;
  return false;
}

// `coreProximity` (0 = galaxy edge, 1 = at the core, default 0.5 neutral for
// any caller that doesn't have a position to derive it from) suppresses
// *colonization* specifically — a GM asked for the core to read as old,
// settled space and the frontier to stay sparse even where a world is
// perfectly habitable. coreFactor bottoms out at 0.3 rather than 0, so a
// frontier world still has *some* chance (worlds do get colonized out
// there, just rarely) instead of a hard cutoff. Resource extraction is
// untouched by this — mining the frontier for what it's worth, without
// anyone actually living there, is the classic frontier economy, not
// something that should also get suppressed.
function rollColonization(rng, body, system, coreProximity = 0.5) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  if (system.stationOnly) {
    if (body.resourceRich && rng() < 0.3) return "extraction";
    return "untouched";
  }
  if (body.habitable) {
    const coreFactor = 0.7 + 0.3 * Math.max(0, Math.min(1, coreProximity));
    const chance = Math.min(0.97, (0.45 + bandIndex * 0.12) * coreFactor);
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

function rollPrimary(rng, system, zones, remnant, starMass, index, coreProximity) {
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
  body.status = rollColonization(rng, { habitable, resourceRich }, system, coreProximity);
  if (body.status === "colonized") body.population = rollPopulation(rng, system);
  if (body.status === "extraction") body.tags = [...body.tags, "automated-or-minimal-crew"];
  return body;
}

// Real moons orbit their planet, not the star — modeled as attachments
// (`parent: <primary slug>`) rather than their own star-orbit slot. Gas
// giants get more moon slots than rocky/terrestrial worlds; belts and
// ice-world edge cases get none, matching real-solar-system proportions
// loosely (Jupiter/Saturn have dozens; Earth/Mars have one or two).
const MOON_SLOTS = { "gas giant": 4, "terrestrial world": 2, "rocky planet": 2, "ice world": 1 };

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
// `coreProximity` (0-1, 0.5 default) is the system's own distance-from-the-
// core score computed by the caller (systemGen.js, which has the sector/
// bounds data to derive it) — see rollColonization for what it does.
export function generateBodies(rng, system, coreProximity = 0.5) {
  const profile = getStarProfile(system.starType);
  const remnant = !!profile.remnant;
  const z = starZones(profile);
  const count = primaryCount(rng, system);
  z.orbits = rollOrbits(rng, count, z);

  const bodies = [];
  let stationsPlaced = 0;

  for (let i = 0; i < count; i++) {
    const primary = rollPrimary(rng, system, z, remnant, profile.mass, i, coreProximity);
    bodies.push(primary);

    const moons = rollMoons(rng, primary, z, remnant);
    for (const moon of moons) {
      // A moon shares its parent's colonization outcome by default (a
      // habitable HZ moon can still independently roll extraction/
      // colonized on top of that), rather than every moon defaulting to
      // untouched regardless of what's happening on its parent.
      const resourceRich = moon.resources.length > 0;
      moon.status = rollColonization(rng, { habitable: moon.habitable, resourceRich }, system, coreProximity);
      if (moon.status === "colonized") moon.population = rollPopulation(rng, system);
      if (moon.status === "extraction") moon.tags = ["automated-or-minimal-crew"];
      bodies.push(moon);
    }

    if (!remnant && (primary.status === "colonized" || primary.status === "extraction") && stationsPlaced < 2 && rng() < 0.35) {
      stationsPlaced++;
      bodies.push(rollStation(rng, primary, system, moons.length));
    }
  }

  settleSystem(rng, system, bodies, z, coreProximity);
  return bodies;
}

// ---------------------------------------------------------------------------
// Settlement pass — the rules that make every charted system worth charting.
// Run at the end of generateBodies, and on its own (settleExistingSystems) to
// upgrade an already-generated galaxy without re-rolling its bodies:
//
// 1. Golden zone: habitable bodies in the HZ of an inhabited system are
//    colonized (almost always in core/major systems).
// 2. Crowded space: populated systems also settle non-habitable solid
//    bodies (domes, arcologies, underground) and gas giants (cloud cities),
//    more the higher the band.
// 3. Real headcounts: `inhabitants` (a number) on every colonized body, drawn
//    from a system total that matches its band — core worlds run to tens of
//    billions. `population` keeps the band label for compatibility.
// 4. Orbital infrastructure scaled to the economy (1-5 stations).
// 5. Relevance: no charted system is left with only barren rocks — at least
//    one colonized world or a commercial outpost (station) is guaranteed.
//
// Never removes or renames anything; only statuses/populations/stations.
const BAND_TOTAL = [
  [0, 0], // uninhabited / automated only: stations only
  [80, 500], // outpost
  [5e3, 5e4], // small colony
  [2e5, 1e6], // colony
  [5e6, 5e7], // major colony
  [2e9, 8e10], // core world: tens of billions across the system
];
const COLONY_EXTRA = [0, 0, 0.1, 0.2, 0.35, 0.55]; // chance a non-habitable solid body is settled anyway
const CLOUD_CITY = [0, 0, 0.05, 0.12, 0.25, 0.45]; // gas giant floating cities
const STATION_TARGET = [[1, 1], [1, 1], [1, 2], [1, 2], [1, 3], [2, 4]]; // [min, max] per band

// Key systems — the organizational heart of a realm (e.g. the Dominion's
// administrative worlds) run to several tens of billions regardless of band,
// the seat of government even more. A system is "key" when flagged
// (`keySystem`), tagged as a capital, or at importance ≥ 0.95; "important"
// (≥ 0.6) systems get a raised floor. Returns [lo, hi] or null.
const CAPITAL_TAGS = ["dominion-capital", "capital", "seat-of-government", "capital-of-colonized-systems"];
const KEY_TOTAL = { capital: [8e10, 2.5e11], key: [4e10, 1.2e11], important: [1e10, 8e10] };
export function keyTier(system) {
  const tags = [...(system.tags || []), ...(system.extraTags || [])];
  const bodyCapital = (system.bodies || []).some((b) => (b.tags || []).some((t) => CAPITAL_TAGS.includes(t)));
  if (tags.some((t) => CAPITAL_TAGS.includes(t)) || (system.keySystem && bodyCapital)) return "capital";
  if (system.keySystem || (system.important ?? 0) >= 0.95) return "key";
  if ((system.important ?? 0) >= 0.6) return "important";
  return null;
}

// Per-key deterministic randomness: the settlement pass decides each body's
// fate from its own slug, so running it again never changes its mind.
function keyRng(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  let st = h >>> 0;
  return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
}

function logUniform(rng, lo, hi) { return Math.exp(Math.log(lo) + rng() * (Math.log(hi) - Math.log(lo))); }

function bandForCount(n) {
  if (n >= 5e7) return COLONIZED_BANDS[3].value;
  if (n >= 1e6) return COLONIZED_BANDS[2].value;
  if (n >= 5e4) return COLONIZED_BANDS[1].value;
  return COLONIZED_BANDS[0].value;
}
function roundNice(n) {
  if (n < 1000) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.round(n / p) * p;
}

// A charted system has at least 3 primaries and (for a real star) at least
// one of them in the golden zone. Additive: missing ones are appended with
// the next free numeral, nothing is renamed or moved.
function ensurePrimaries(rng, system, bodies, zones, profile, coreProximity, inHZ) {
  const prim = () => bodies.filter((b) => !b.parent);
  const add = (orbitAU, hzKind) => {
    const n = prim().length;
    const z2 = { ...zones, orbits: [orbitAU] };
    const b = rollPrimary(rng, system, z2, false, profile.mass, 0, coreProximity);
    if (hzKind) { b.kind = hzKind; Object.assign(b, rollSize(rng, hzKind)); b.habitable = rollHabitable(rng, hzKind, orbitAU, zones, false) || hzKind === "terrestrial world"; }
    let k = n;
    const slugOf = (i) => `${system.slug}-${slugify(ROMAN[i] || String(i + 1))}`;
    while (bodies.some((x) => x.slug === slugOf(k))) k++;
    b.slug = slugOf(k);
    b.name = `${system.name} ${ROMAN[k] || k + 1}`;
    b.orbitPeriodDays = b.kind === "asteroid belt" ? null : orbitalPeriodDays(orbitAU, profile.mass);
    b.orbitAUOuter = b.kind === "asteroid belt" ? Number((orbitAU * 1.12).toFixed(3)) : null;
    bodies.push(b);
    return b;
  };
  if (!prim().some(inHZ) && zones.hzOuter > zones.minOrbit) {
    const mid = Math.sqrt(Math.max(zones.hzInner, zones.minOrbit) * zones.hzOuter) * (0.9 + rng() * 0.2);
    add(mid, rng() < 0.8 ? "terrestrial world" : "rocky planet");
  }
  let guard = 0;
  while (prim().length < 3 && guard++ < 6) {
    const outer = Math.max(...prim().map((b) => b.orbitAUOuter || b.orbitAU || zones.minOrbit), zones.minOrbit);
    add(Math.max(outer * (1.6 + rng()), zones.frostLine * (0.8 + rng() * 0.6)));
  }
}

// `curated`: the system was hand-curated — integrate it additively only
// (no new primaries, no rescaled crews, hand-set headcounts never touched).
function settleSystem(rng, system, bodies, zones, coreProximity = 0.5, { curated = false } = {}) {
  const profile = getStarProfile(system.starType);
  if (profile.remnant && !bodies.length) return bodies;
  let band = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system.population));
  const tier = system.stationOnly ? null : keyTier({ ...system, bodies });
  if (tier === "capital" || tier === "key") band = Math.max(band, 5);
  const populated = !system.stationOnly && band >= 2;
  const bySlug = new Map(bodies.map((b) => [b.slug, b]));
  const orbitOf = (b) => (b.parent ? bySlug.get(b.parent)?.orbitAU : b.orbitAU) ?? null;
  const inHZ = (b) => { const o = orbitOf(b); return o != null && o >= zones.hzInner && o <= zones.hzOuter; };
  const solid = (b) => ["terrestrial world", "rocky planet", "moon", "ice world"].includes(b.kind);
  const colonize = (b) => { if (b.status !== "colonized") { b.status = "colonized"; b.tags = (b.tags || []).filter((t) => t !== "automated-or-minimal-crew"); } };

  if (!profile.remnant && !curated) ensurePrimaries(rng, system, bodies, zones, profile, coreProximity, inHZ);

  if (populated && !profile.remnant) {
    for (const b of bodies) {
      if (b.kind === "orbital station" || b.kind === "asteroid belt") continue;
      const r = keyRng(`settle:${b.slug}`)();
      if (b.habitable && inHZ(b)) {
        if (r < [0, 0, 0.9, 1, 1, 1][band]) colonize(b);
      } else if (solid(b) && b.status !== "colonized") {
        if (r < COLONY_EXTRA[band] * (inHZ(b) ? 1.8 : 1)) colonize(b);
      } else if (b.kind === "gas giant" && b.status !== "colonized") {
        if (r < CLOUD_CITY[band]) colonize(b);
      }
    }
  }

  // relevance: a populated system always has a colonized world
  let colonies = bodies.filter((b) => b.status === "colonized" && b.kind !== "orbital station");
  if (populated && !colonies.length) {
    const score = (b) => (b.habitable ? 100 : 0) + (inHZ(b) ? 50 : 0) + (b.kind === "terrestrial world" ? 20 : 0) + (solid(b) ? 10 : 0) + (b.kind === "gas giant" ? 5 : 0) + (b.radiusKm || 0) / 10000;
    const cand = bodies.filter((b) => b.kind !== "orbital station" && b.kind !== "asteroid belt").sort((a, b) => score(b) - score(a))[0];
    if (cand) { colonize(cand); colonies = [cand]; }
  }

  // headcounts: split the system total, habitable garden worlds (and the
  // capital world of a key system) take the lion's share
  if (colonies.length) {
    let [lo, hi] = BAND_TOTAL[band] || BAND_TOTAL[2];
    const key = tier && band >= (tier === "important" ? 3 : 2) ? KEY_TOTAL[tier] : null;
    if (key) { lo = Math.max(lo, key[0]); hi = Math.max(hi, key[1]); }
    const tr = keyRng(`total:${system.slug}`);
    const total = hi > 0 ? logUniform(tr, lo || 50, hi) : 0;
    const capital = (b) => (b.tags || []).some((t) => CAPITAL_TAGS.includes(t));
    const weight = (b) => (b.habitable ? 12 : 1) * (b.kind === "terrestrial world" ? 2 : 1) * (capital(b) ? 8 : 1) * ((b.tags || []).includes("ecumenopolis") ? 6 : 1) * (0.5 + keyRng(`w:${b.slug}`)());
    const ws = colonies.map(weight), sum = ws.reduce((a, x) => a + x, 0);
    const setN = (b, n) => {
      b.inhabitants = n;
      b.population = bandForCount(n);
      // the very biggest garden worlds become city-planets
      if (n > 2.5e10 && b.kind === "terrestrial world" && !(b.tags || []).includes("ecumenopolis") && keyRng(`ecu:${b.slug}`)() < (capital(b) ? 1 : 0.5)) b.tags = [...(b.tags || []), "ecumenopolis"];
    };
    colonies.forEach((b, i) => {
      if (typeof b.inhabitants === "number" && b.inhabitants > 0) return; // keep hand-set numbers
      const n = total > 0 ? roundNice(Math.max(50, (total * ws[i]) / sum)) : 0;
      if (n) setN(b, n);
    });
    // a key system settled earlier under the plain band ranges is raised to
    // its tier (proportionally, so the split between worlds is kept) —
    // never for curated systems, whose numbers are the GM's
    if (key && !curated) {
      const cur = colonies.reduce((a, b) => a + (Number(b.inhabitants) || 0), 0);
      if (cur > 0 && cur < key[0] * 0.98) {
        const f = total / cur;
        colonies.forEach((b) => { if (b.inhabitants > 0) setN(b, roundNice(b.inhabitants * f)); });
      }
    }
  }

  // stations generated under the old, tiny crew ranges are scaled up to the
  // current ones (deterministic per station)
  for (const st of bodies) {
    if (curated || st.kind !== "orbital station") continue;
    const cls = STATION_CLASSES.find((c) => c.value === st.sizeClass);
    const n = Number(st.population);
    if (!cls || (Number.isFinite(n) && n >= cls.population[0])) continue;
    const r = keyRng(`crew:${st.slug}`);
    st.population = Math.round(scaleInRange(r, cls.population, band));
    if ((st.docks ?? 0) < cls.docks[0]) st.docks = Math.round(scaleInRange(r, cls.docks, band));
    if ((st.lengthM ?? 0) < cls.lengthM[0]) st.lengthM = Math.round(scaleInRange(r, cls.lengthM, band));
  }

  // orbital infrastructure
  if (!profile.remnant || bodies.length) {
    const [minS, maxS] = STATION_TARGET[band] || [1, 2];
    const existing = bodies.filter((b) => b.kind === "orbital station");
    const want = Math.max(minS, Math.min(maxS, minS + Math.floor(keyRng(`stations:${system.slug}`)() * (maxS - minS + 1))));
    if (existing.length >= want) return bodies;
    const hostScore = (b) => (b.status === "colonized" ? 100 + Math.log10(b.inhabitants || 10) : 0) + (b.status === "extraction" ? 40 : 0) + (b.kind === "gas giant" ? 25 : 0) + (b.kind === "asteroid belt" ? 15 : 0);
    const hosts = bodies.filter((b) => !b.parent && b.kind !== "orbital station").sort((a, b) => hostScore(b) - hostScore(a));
    let i = 0;
    while (existing.length < want && hosts.length) {
      const host = hosts[i % hosts.length];
      const siblings = bodies.filter((b) => b.parent === host.slug).length;
      const st = rollStation(rng, host, system, siblings);
      while (bodies.some((b) => b.slug === st.slug)) st.slug += "x";
      bodies.push(st);
      existing.push(st);
      i++;
    }
  }
  return bodies;
}

// Upgrade an existing galaxy in place (bodies are kept; only statuses,
// headcounts and extra stations are added). Script-locked systems
// (`scriptLocked`) are never touched. Curated systems (`locked`, or with
// hand-authored surface sites) are skipped unless `integrateCurated`, in
// which case they're integrated additively (see settleSystem's `curated`).
// Returns the new systems array plus a small report.
export function settleExistingSystems(project, rngFor, coreProximityOf = () => 0.5, { integrateCurated = false } = {}) {
  let changed = 0;
  const systems = project.systems.map((s) => {
    if (s.scriptLocked) return s;
    const curated = !!s.locked || (s.bodies || []).some((b) => b.sites?.length);
    if (curated && !integrateCurated) return s;
    const bodies = (s.bodies || []).map((b) => ({ ...b, tags: [...(b.tags || [])] }));
    const before = JSON.stringify(bodies);
    const profile = getStarProfile(s.starType);
    if (!bodies.length && !profile.remnant) return s;
    settleSystem(rngFor(s), s, bodies, starZones(profile), coreProximityOf(s), { curated });
    if (JSON.stringify(bodies) === before) return s;
    changed++;
    return { ...s, bodies };
  });
  return { systems, changed };
}

// Exposed for the orrery view (SectorList.jsx) so it can draw the
// habitable-zone band and frost line without re-deriving the formulas.
export function getSystemZones(system) {
  const profile = getStarProfile(system.starType);
  const z = starZones(profile);
  return { ...z, remnant: !!profile.remnant, starColor: profile.color, starMass: profile.mass, starLuminosity: profile.luminosity };
}
