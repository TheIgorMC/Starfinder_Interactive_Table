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

  const systems = [];
  const usedSlugs = new Set();
  const usedNames = new Set();

  for (const sector of project.sectors) {
    const points = poissonDiscInPolygon({
      polygon: sector.points,
      bounds: project.bounds,
      radiusAt,
      rng,
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
        // Filled in by later phases (Docs/10-galaxy-mapgen.md §7): faction
        // control/war-chance need Phase 3, hyperlanes need the graph pass.
        control: null,
        warChance: null,
        hyperlanes: [],
      });
    }
  }

  return systems;
}
