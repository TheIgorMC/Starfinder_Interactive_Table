import { poissonDiscInPolygon } from "./poisson.js";
import { createRng, weightedPick } from "./rng.js";
import { generateSystemName } from "./names.js";
import { GRID_SIZE, sampleBilinear } from "./grid.js";
import { slugify } from "./slug.js";

const STAR_TYPES = [
  { value: "O-type blue giant", weight: 1 },
  { value: "B-type blue-white", weight: 3 },
  { value: "A-type white", weight: 6 },
  { value: "F-type yellow-white", weight: 10 },
  { value: "G-type yellow", weight: 16 },
  { value: "K-type orange", weight: 20 },
  { value: "M-type red dwarf", weight: 30 },
  { value: "binary pair", weight: 6 },
  { value: "neutron star remnant", weight: 2 },
];

// Ordered low → high population; index is chosen from the painted
// population field (+noise), not picked independently of it.
const POPULATION_BANDS = [
  { value: "uninhabited / automated only", stationOnly: true },
  { value: "outpost (< 500)", stationOnly: true },
  { value: "small colony (500 - 50,000)", stationOnly: false },
  { value: "colony (50,000 - 1 million)", stationOnly: false },
  { value: "major colony (1 - 50 million)", stationOnly: false },
  { value: "core world (50 million+)", stationOnly: false },
];

// Docs/10-galaxy-mapgen.md §5 — sector focus biases what a system trades.
// Administrative sectors don't move cargo, they move people: high-security
// transit for ranking diplomats and officials shuttling between factions.
const FOCUS_TRADE = {
  mining: { export: ["ore", "refined metals", "rare minerals"], import: ["food", "machinery", "medical supplies"] },
  agriculture: { export: ["foodstuffs", "biomass"], import: ["machinery", "medical supplies", "technology"] },
  industry: { export: ["manufactured goods", "starship components", "machinery"], import: ["raw ore", "energy cells", "labor"] },
  research: { export: ["research data", "prototypes"], import: ["rare materials", "specialist equipment"] },
  "trade hub": { export: ["general cargo", "consumer goods", "raw materials"], import: ["general cargo", "consumer goods", "raw materials"] },
  frontier: { export: ["salvage", "raw materials"], import: ["fuel", "basic supplies"] },
  administrative: {
    export: ["diplomatic delegations"],
    import: ["diplomatic delegations"],
    tags: ["high-security-transit"],
    note: "Trades chiefly in people, not cargo — high-security transports ferrying ranking diplomats and officials between factions.",
  },
  military: { export: ["security contractors", "surplus hardware"], import: ["weapons", "fuel", "recruits"] },
  residential: { export: ["skilled labor"], import: ["consumer goods", "food"] },
  logistics: { export: ["shipping capacity"], import: ["fuel", "spare parts"] },
  medical: { export: ["pharmaceuticals", "medical technology"], import: ["biological samples", "specialist staff"] },
  cultural: { export: ["art", "media"], import: ["luxury goods", "pilgrims"] },
};
const DEFAULT_TRADE = { export: ["general goods"], import: ["general goods"] };

function uniqueSlug(base, usedSlugs) {
  if (!usedSlugs.has(base)) return base;
  let i = 2;
  while (usedSlugs.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function pickN(list, count) {
  return list.slice(0, Math.max(1, Math.min(list.length, count)));
}

// Rolls a realistic importance value (0-1) per newly-generated system:
// skewed toward low values (most systems are unremarkable background
// traffic) with a bump for higher population bands, then a spatial pass
// that dampens a system's importance near an already-settled, more-
// important neighbor — so two landmark systems don't end up sitting right
// next to each other. Locked systems (hand-renamed/hand-tuned) keep
// whatever importance they already had — they settle first, as an input
// the roll can't override, so new neighbors still get dampened near them,
// but their own value is never touched.
function assignImportance(systems, popBias, rng, maxSpacing, lockedMask) {
  const n = systems.length;
  const final = new Array(n);
  const settled = [];

  for (let i = 0; i < n; i++) {
    if (lockedMask[i]) {
      final[i] = Math.max(0, Math.min(1, Number(systems[i].important) || 0));
      settled.push(i);
    }
  }

  const toRoll = [];
  for (let i = 0; i < n; i++) {
    if (lockedMask[i]) continue;
    const roll = rng() ** 2.5; // skewed toward 0, rare spikes near 1
    const raw = Math.max(0, Math.min(1, roll * 0.65 + popBias[i] * 0.35));
    toRoll.push({ i, raw });
  }
  toRoll.sort((a, b) => b.raw - a.raw);

  const neighborRadius = Math.max(30, maxSpacing * 3);
  for (const { i, raw } of toRoll) {
    let suppression = 1;
    for (const j of settled) {
      const dx = systems[i].position.x - systems[j].position.x;
      const dy = systems[i].position.y - systems[j].position.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= neighborRadius) continue;
      suppression *= 1 - final[j] * (1 - dist / neighborRadius);
    }
    final[i] = Number(Math.max(0, Math.min(1, raw * suppression)).toFixed(3));
    settled.push(i);
  }

  for (let i = 0; i < n; i++) {
    if (!lockedMask[i]) systems[i].important = final[i];
  }
}

// Runs Poisson-disc placement inside every sector polygon (weighted by the
// painted population field, Docs/10-galaxy-mapgen.md §3 stage 4) and rolls
// per-system detail (§3 stage 5). Deterministic for a given project.seed +
// bounds + sectors + field state — regenerating with unchanged inputs
// reproduces the same galaxy.
export function generateSystems(project, options = {}) {
  const { minSpacing = 20, maxSpacing = 70 } = options;
  const rng = createRng(`${project.seed}:systems`);
  const populationGrid = project.fields.population;
  const exportGrid = project.fields.export;
  const importGrid = project.fields.import;
  const securityGrid = project.fields.security;

  const radiusAt = (x, y) => {
    const d = sampleBilinear(populationGrid, GRID_SIZE, x, y, project.bounds);
    return maxSpacing - (maxSpacing - minSpacing) * d;
  };

  // Locked systems (renamed, hand-tuned importance, or explicitly locked
  // in the inspector) survive a regen untouched — generation only places
  // new systems around them, respecting the same minimum spacing.
  const lockedSystems = project.systems.filter((s) => s.locked).map((s) => ({ ...s }));
  const lockedBySector = new Map();
  for (const s of lockedSystems) {
    if (!lockedBySector.has(s.sector)) lockedBySector.set(s.sector, []);
    lockedBySector.get(s.sector).push(s);
  }

  const systems = [...lockedSystems];
  const popBias = lockedSystems.map(() => 0); // unused for locked entries
  const lockedMask = lockedSystems.map(() => true);
  const usedSlugs = new Set(lockedSystems.map((s) => s.slug));
  const usedNames = new Set(lockedSystems.map((s) => s.name));

  for (const sector of project.sectors) {
    const existingInSector = lockedBySector.get(sector.slug) || [];
    const points = poissonDiscInPolygon({
      polygon: sector.points,
      bounds: project.bounds,
      radiusAt,
      rng,
      existingPoints: existingInSector.map((s) => [s.position.x, s.position.y]),
    });

    const trade = FOCUS_TRADE[sector.focus] || DEFAULT_TRADE;

    for (const [x, y] of points) {
      const popDensity = sampleBilinear(populationGrid, GRID_SIZE, x, y, project.bounds);
      const exportDensity = sampleBilinear(exportGrid, GRID_SIZE, x, y, project.bounds);
      const importDensity = sampleBilinear(importGrid, GRID_SIZE, x, y, project.bounds);
      const securityDensity = sampleBilinear(securityGrid, GRID_SIZE, x, y, project.bounds);

      const noise = (rng() - 0.5) * 0.3;
      const effectivePop = Math.max(0, Math.min(0.999, popDensity + noise));
      const bandIndex = Math.min(POPULATION_BANDS.length - 1, Math.floor(effectivePop * POPULATION_BANDS.length));
      const band = POPULATION_BANDS[bandIndex];

      const starType = weightedPick(rng, STAR_TYPES);
      const name = generateSystemName(rng, usedNames);
      usedNames.add(name);
      const slug = uniqueSlug(slugify(name), usedSlugs);
      usedSlugs.add(slug);

      const exportGoods = pickN(trade.export, Math.round(exportDensity * trade.export.length));
      const importGoods = pickN(trade.import, Math.round(importDensity * trade.import.length));

      systems.push({
        id: crypto.randomUUID(),
        slug,
        name,
        position: { x, y },
        sector: sector.slug,
        starType,
        population: band.value,
        stationOnly: band.stationOnly,
        export: exportGoods,
        import: importGoods,
        tags: [sector.focus, ...(trade.tags || [])],
        note: trade.note || null,
        security: { dominion: Number(securityDensity.toFixed(2)) },
        // Overwritten below by assignImportance — placeholder only.
        important: 0,
        // Hand-editing a system (rename, importance tweak, or an explicit
        // lock toggle) sets this true so it survives future regens as-is.
        locked: false,
        // Filled in by later phases (Docs/10-galaxy-mapgen.md §7): faction
        // control/war-chance need Phase 3, hyperlanes need the graph pass.
        control: null,
        warChance: null,
        hyperlanes: [],
      });
      popBias.push(bandIndex / (POPULATION_BANDS.length - 1));
      lockedMask.push(false);
    }
  }

  assignImportance(systems, popBias, rng, maxSpacing, lockedMask);

  return systems;
}
