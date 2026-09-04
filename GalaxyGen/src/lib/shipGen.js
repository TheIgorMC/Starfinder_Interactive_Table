// Docs/10-galaxy-mapgen.md §8-adjacent — the ship/fleet economy layer.
// Two generation passes, same "plausible, not simulated" spirit as the rest
// of this doc's generators:
//   1. generateShipModels — a galaxy-wide catalog of manufacturer+hull
//      combinations (like STAR_TYPES/STATION_CLASSES: a fixed reference
//      table, not per-system).
//   2. generateCompanies — seeds ship-operating companies per sector
//      (cargo lines, tourism operators, diplomatic couriers, private
//      charters, military contractors), each with an aggregate fleet
//      (model + count, not one entity per hull — see the scale decision
//      this was scoped under) plus a handful of individually-named notable
//      ships for GM-relevant vessels.
import { createRng, weightedPick, randRange } from "./rng.js";
import { slugify } from "./slug.js";
import { generateShipModelName, generateCompanyName, generateVesselName } from "./names.js";
import { POPULATION_BANDS } from "./populationBands.js";
import { HULL_CLASSES, SHIP_MANUFACTURERS, QUALITY_TIERS, COMPANY_KINDS } from "./shipTypes.js";

function uniqueSlug(base, usedSlugs) {
  const s = slugify(base);
  if (!usedSlugs.has(s)) return s;
  let i = 2;
  while (usedSlugs.has(`${s}-${i}`)) i++;
  return `${s}-${i}`;
}

// Biases a value toward the top (positive bias) or bottom (negative bias)
// of [lo, hi] — same shape as planetGen.js's scaleInRange, reused here for
// a manufacturer's quality tier instead of a population band.
function scaleInRange(rng, [lo, hi], bias) {
  const t = Math.min(1, Math.max(0, 0.5 + bias + (rng() - 0.5) * 0.6));
  return lo + t * (hi - lo);
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// A fixed-size, galaxy-wide reference catalog (not placed per-system) —
// scales gently with sector count so a small galaxy doesn't drown in models
// nobody will ever see fielded. Regenerating replaces the whole catalog;
// companies reference models by slug, so regenerating models after
// companies exist will leave stale `modelSlug` references (same "you broke
// it, not us" contract as renaming a system slug would — call
// generate_companies again afterward if that happens).
export function generateShipModels(project) {
  const rng = createRng(`${project.seed}:shipmodels`);
  const count = Math.max(16, Math.min(40, Math.round((project.sectors.length || 1) * 2.5)));
  const usedNames = new Set();
  const usedSlugs = new Set();
  const models = [];

  for (let i = 0; i < count; i++) {
    const manufacturer = pick(rng, SHIP_MANUFACTURERS);
    const hullPool = rng() < 0.7 ? HULL_CLASSES.filter((h) => h.role === manufacturer.specialty) : HULL_CLASSES;
    const hull = pick(rng, hullPool.length ? hullPool : HULL_CLASSES);
    const tier = QUALITY_TIERS[manufacturer.tier] || QUALITY_TIERS.standard;

    const modelName = generateShipModelName(rng, usedNames);
    usedNames.add(modelName);
    const name = `${manufacturer.value} ${modelName}`;
    const slug = uniqueSlug(name, usedSlugs);
    usedSlugs.add(slug);

    models.push({
      id: crypto.randomUUID(),
      slug,
      name,
      manufacturer: manufacturer.value,
      hullClass: hull.value,
      role: hull.role,
      sizeCategory: hull.sizeCategory,
      maneuverability: hull.maneuverability,
      crew: Math.round(scaleInRange(rng, hull.crew, tier.statBias)),
      cargoTons: Math.round(scaleInRange(rng, hull.cargoTons, tier.statBias)),
      speedHexes: Math.round(scaleInRange(rng, hull.speedHexes, tier.statBias)),
      combatRating: Math.round(scaleInRange(rng, hull.combatRating, tier.statBias)),
      costTier: tier.costTier,
    });
  }

  return models;
}

function companyScaleFor(system) {
  const bandIndex = Math.max(0, POPULATION_BANDS.findIndex((b) => b.value === system?.population));
  if (bandIndex >= 4) return "major";
  if (bandIndex >= 2) return "regional";
  return "small";
}

const SCALE_TOTAL_HULLS = { small: [2, 10], regional: [10, 40], major: [40, 200] };
const SCALE_NOTABLE_COUNT = { small: [1, 1], regional: [1, 2], major: [2, 4] };
const SCALE_HULL_VARIETY = { small: [1, 2], regional: [2, 3], major: [3, 5] };

function pickCompanyKind(rng, sectorFocus) {
  const matching = COMPANY_KINDS.filter((k) => k.foci.includes(sectorFocus));
  if (matching.length && rng() < 0.8) return pick(rng, matching);
  return pick(rng, COMPANY_KINDS);
}

function pickHomeSystem(rng, systemsInSector) {
  const weighted = systemsInSector.map((s) => ({ value: s, weight: (Number(s.important) || 0) + 0.15 }));
  return weightedPick(rng, weighted);
}

function pickModelForRole(rng, modelsByRole, role) {
  const pool = rng() < 0.8 && modelsByRole.has(role) ? modelsByRole.get(role) : null;
  const fallback = [...modelsByRole.values()].flat();
  const list = pool && pool.length ? pool : fallback;
  return pick(rng, list);
}

// §5-style per-sector seeding (mirrors factionGen.js's border-minor pass
// and systemGen.js's own per-sector loop): roughly one company per ~15
// systems in a sector (min 1, max 4), kind biased toward the sector's
// focus, home system weighted toward the sector's more important systems,
// fleet composition sampled from the ship-model catalog by role with a
// 20% crossover chance so a cargo line plausibly owns a courier or two.
// Deterministic per project seed; only `origin: "generated"` companies are
// replaced on a re-run (hand-authored ones, once that UI exists, would
// survive the same way authored factions/actors already do).
export function generateCompanies(project, shipModels) {
  const rng = createRng(`${project.seed}:companies`);
  const usedNames = new Set((project.companies || []).map((c) => c.name));
  const usedSlugs = new Set((project.companies || []).map((c) => c.slug));
  const vesselNames = new Set();

  const modelsByRole = new Map();
  for (const m of shipModels) {
    if (!modelsByRole.has(m.role)) modelsByRole.set(m.role, []);
    modelsByRole.get(m.role).push(m);
  }
  if (shipModels.length === 0) {
    throw new Error("No ship models to build a fleet from — call generate_ship_models first.");
  }

  const systemsBySector = new Map();
  for (const s of project.systems) {
    if (!systemsBySector.has(s.sector)) systemsBySector.set(s.sector, []);
    systemsBySector.get(s.sector).push(s);
  }

  const companies = [];
  for (const sector of project.sectors) {
    const systemsInSector = systemsBySector.get(sector.slug) || [];
    if (systemsInSector.length === 0) continue;
    const targetCount = Math.max(1, Math.min(4, Math.round(systemsInSector.length / 15)));

    for (let i = 0; i < targetCount; i++) {
      const kind = pickCompanyKind(rng, sector.focus);
      const homeSystem = pickHomeSystem(rng, systemsInSector);
      const scale = companyScaleFor(homeSystem);

      const name = generateCompanyName(rng, kind.role, usedNames);
      usedNames.add(name);
      const slug = uniqueSlug(name, usedSlugs);
      usedSlugs.add(slug);

      // Independent by default; a company based in a system with a clear
      // single-faction owner has a decent chance of being that faction's
      // subsidiary instead — plausible, not a hard rule (a Dominion-secured
      // core world can still host a fully independent shipping line).
      const owner = homeSystem.control?.owner;
      const parentFaction = owner && owner !== "dominion" && rng() < 0.6 ? owner : null;

      const [varLo, varHi] = SCALE_HULL_VARIETY[scale];
      const hullVariety = varLo + Math.floor(rng() * (varHi - varLo + 1));
      const [totalLo, totalHi] = SCALE_TOTAL_HULLS[scale];
      const totalHulls = Math.round(randRange(rng, totalLo, totalHi));
      const fleet = [];
      let remaining = totalHulls;
      for (let h = 0; h < hullVariety; h++) {
        const model = pickModelForRole(rng, modelsByRole, kind.role);
        const isLast = h === hullVariety - 1;
        const count = isLast ? Math.max(1, remaining) : Math.max(1, Math.round(remaining / (hullVariety - h) * (0.6 + rng() * 0.8)));
        remaining -= count;
        const existing = fleet.find((f) => f.modelSlug === model.slug);
        if (existing) existing.count += count;
        else fleet.push({ modelSlug: model.slug, count });
        if (remaining <= 0) break;
      }

      const [notLo, notHi] = SCALE_NOTABLE_COUNT[scale];
      const notableCount = notLo + Math.floor(rng() * (notHi - notLo + 1));
      const notableShips = [];
      for (let n = 0; n < notableCount; n++) {
        const model = pickModelForRole(rng, modelsByRole, kind.role);
        const vesselName = generateVesselName(rng, vesselNames);
        vesselNames.add(vesselName);
        notableShips.push({
          slug: uniqueSlug(`${slug}-${vesselName}`, usedSlugs),
          name: vesselName,
          modelSlug: model.slug,
          status: "active",
          currentSystem: homeSystem.slug,
          captainActor: null,
        });
      }
      for (const ship of notableShips) usedSlugs.add(ship.slug);

      companies.push({
        id: crypto.randomUUID(),
        slug,
        name,
        kind: kind.value,
        role: kind.role,
        scale,
        parentFaction,
        homeSystem: homeSystem.slug,
        homeSector: sector.slug,
        fleet,
        notableShips,
        extraTags: [],
        origin: "generated",
      });
    }
  }

  return companies;
}
