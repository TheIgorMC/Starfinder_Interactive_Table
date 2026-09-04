import { poissonDiscInPolygon } from "./poisson.js";
import { createRng, weightedPick } from "./rng.js";
import { generateSystemName } from "./names.js";
import { GRID_SIZE, sampleBilinear } from "./grid.js";
import { slugify } from "./slug.js";
import { pointInPolygon } from "./geometry.js";
import { generateBodies } from "./planetGen.js";
import { POPULATION_BANDS } from "./populationBands.js";
import { STAR_TYPES } from "./starTypes.js";

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

  // Pure Poisson-disc sampling is "blue noise" by design — it deliberately
  // avoids both clumping and large gaps, which is exactly why a galaxy
  // generated over a flat/lightly-painted population field looks almost
  // perfectly evenly spaced (confirmed live: a GM reported systems reading
  // as "equal distanced"). Real distributions aren't that tidy even within
  // one density level, so each candidate's own effective spacing gets a
  // bounded ±20% jitter — enough to break the uniform look (some pairs
  // pack closer, some sit farther apart) without risking overlap: the
  // clamp never lets the jittered value drop below `minSpacing`, which is
  // already the absolute floor the unjittered field math guarantees at
  // full population density, so poisson.js's collision check is exactly
  // as safe as before.
  const radiusAt = (x, y) => {
    const d = sampleBilinear(populationGrid, GRID_SIZE, x, y, project.bounds);
    const base = maxSpacing - (maxSpacing - minSpacing) * d;
    return Math.max(minSpacing, base * (0.8 + rng() * 0.4));
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

      const system = {
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
        // Event-effect (§9) `add_tag`/`remove_tag` targets — kept separate
        // from the sector/trade-derived `tags` above so regen never wipes
        // event history's own additions.
        extraTags: [],
        note: trade.note || null,
        security: { dominion: Number(securityDensity.toFixed(2)) },
        // Overwritten below by assignImportance — placeholder only.
        important: 0,
        // Hand-editing a system (rename, importance tweak, or an explicit
        // lock toggle) sets this true so it survives future regens as-is.
        locked: false,
        // §9 `set_system_status` — active | destroyed | quarantined |
        // uninhabitable. Only the event effect engine ever changes this.
        status: "active",
        // Filled in by later phases (Docs/10-galaxy-mapgen.md §7): faction
        // control/war-chance need Phase 3, hyperlanes need the graph pass.
        control: null,
        warChance: null,
        hyperlanes: [],
        bodies: [],
      };
      // §8 planet generation — a system-scoped rng (not the shared `rng`
      // above) so rerolling one system's bodies later doesn't reshuffle
      // every other system's Poisson placement/detail rolls downstream.
      system.bodies = generateBodies(createRng(`${project.seed}:bodies:${slug}`), system);
      systems.push(system);
      popBias.push(bandIndex / (POPULATION_BANDS.length - 1));
      lockedMask.push(false);
    }
  }

  assignImportance(systems, popBias, rng, maxSpacing, lockedMask);

  return systems;
}

// §3 stage 4's "GM can hand-place a system directly" half (the other half,
// Poisson-disc auto-placement, is `generateSystems` above). Rolls the same
// per-system detail from whatever's painted at that exact point, locks it
// immediately (hand-placement is a curation signal like renaming), and
// returns null if the point isn't inside any sector — placement, like
// auto-generation, only happens inside drawn boundaries. Not seeded off
// `project.seed` since a hand click isn't meant to be reproducible the way
// a full regen is.
export function placeSystemAt(project, x, y) {
  const sector = project.sectors.find((s) => pointInPolygon(x, y, s.points));
  if (!sector) return null;

  const rng = createRng(`manual:${crypto.randomUUID()}`);
  const populationGrid = project.fields.population;
  const exportGrid = project.fields.export;
  const importGrid = project.fields.import;
  const securityGrid = project.fields.security;

  const popDensity = sampleBilinear(populationGrid, GRID_SIZE, x, y, project.bounds);
  const exportDensity = sampleBilinear(exportGrid, GRID_SIZE, x, y, project.bounds);
  const importDensity = sampleBilinear(importGrid, GRID_SIZE, x, y, project.bounds);
  const securityDensity = sampleBilinear(securityGrid, GRID_SIZE, x, y, project.bounds);

  const bandIndex = Math.min(POPULATION_BANDS.length - 1, Math.floor(popDensity * POPULATION_BANDS.length));
  const band = POPULATION_BANDS[bandIndex];
  const starType = weightedPick(rng, STAR_TYPES);

  const usedNames = new Set(project.systems.map((s) => s.name));
  const usedSlugs = new Set(project.systems.map((s) => s.slug));
  const name = generateSystemName(rng, usedNames);
  const slug = uniqueSlug(slugify(name), usedSlugs);

  const trade = FOCUS_TRADE[sector.focus] || DEFAULT_TRADE;
  const exportGoods = pickN(trade.export, Math.round(exportDensity * trade.export.length));
  const importGoods = pickN(trade.import, Math.round(importDensity * trade.import.length));

  const system = {
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
    extraTags: [],
    note: trade.note || null,
    security: { dominion: Number(securityDensity.toFixed(2)) },
    important: 0.3,
    locked: true,
    status: "active",
    control: null,
    warChance: null,
    hyperlanes: [],
    bodies: [],
  };
  system.bodies = generateBodies(rng, system);
  return system;
}

function shuffle(rng, list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Rejection-samples a point inside `polygon`'s own bounding box (clamped to
// the galaxy bounds), retrying until one actually lands inside the polygon
// or attempts run out. Same fallback shape as poissonDiscInPolygon's own
// seed-point search.
function randomPointInPolygon(rng, polygon, bounds, maxAttempts = 60) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(bounds.width, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(bounds.height, Math.max(...ys));
  if (maxX <= minX || maxY <= minY) return null;
  for (let i = 0; i < maxAttempts; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (pointInPolygon(x, y, polygon)) return [x, y];
  }
  return null;
}

// GM-facing "shuffle positions, keep everything else" action — re-scatters
// every *unlocked* system's position within its own sector (same spacing/
// jitter rules as fresh generation, §3 stage 4) without touching name,
// slug, star type, population, trade goods, bodies, control, security, or
// any other rolled data. Locked systems never move (same contract as
// "Generate systems") and still count as obstacles the new positions must
// respect. Doesn't use poissonDiscInPolygon directly — that fills a
// polygon with *however many* points fit at the given spacing, which won't
// generally match the *existing* system count; this instead keeps the
// count fixed and rejection-samples one new position per system, so
// "redistribute" can never add or remove a system, only move it.
export function redistributeSystems(project, options = {}) {
  const { minSpacing = 20, maxSpacing = 70, maxAttempts = 40 } = options;
  const rng = createRng(`${project.seed}:redistribute:${Date.now()}`);
  const populationGrid = project.fields.population;

  const radiusAt = (x, y) => {
    const d = sampleBilinear(populationGrid, GRID_SIZE, x, y, project.bounds);
    const base = maxSpacing - (maxSpacing - minSpacing) * d;
    return Math.max(minSpacing, base * (0.8 + rng() * 0.4));
  };

  const bySector = new Map();
  for (const s of project.systems) {
    if (!bySector.has(s.sector)) bySector.set(s.sector, []);
    bySector.get(s.sector).push(s);
  }

  const positions = new Map(); // system id -> new {x, y}
  for (const sector of project.sectors) {
    const systemsInSector = bySector.get(sector.slug) || [];
    const locked = systemsInSector.filter((s) => s.locked);
    const unlocked = systemsInSector.filter((s) => !s.locked);
    if (unlocked.length === 0) continue;

    // Obstacles the new positions must clear, seeded with locked systems
    // (which never move) and grown as each unlocked one gets placed.
    const placed = locked.map((s) => ({ x: s.position.x, y: s.position.y, r: radiusAt(s.position.x, s.position.y) }));

    // Shuffled order so it's not always the same system that "loses" a
    // tight spot and falls back to its old position.
    for (const sys of shuffle(rng, unlocked)) {
      let accepted = null;
      for (let attempt = 0; attempt < maxAttempts && !accepted; attempt++) {
        const point = randomPointInPolygon(rng, sector.points, project.bounds);
        if (!point) break; // degenerate polygon — nothing to do here
        const [x, y] = point;
        const r = radiusAt(x, y);
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= Math.max(r, p.r))) {
          accepted = { x, y, r };
        }
      }
      // No valid spot found (a genuinely crowded sector) — leave it where
      // it was rather than forcing an overlap.
      const final = accepted || { x: sys.position.x, y: sys.position.y, r: radiusAt(sys.position.x, sys.position.y) };
      positions.set(sys.id, { x: final.x, y: final.y });
      placed.push(final);
    }
  }

  const systems = project.systems.map((s) => (positions.has(s.id) ? { ...s, position: positions.get(s.id) } : s));

  // Hyperlane edges cache each endpoint's straight-line length at the time
  // they were generated (hyperlaneGen.js) — moving an endpoint without
  // refreshing it would leave that number silently wrong even though the
  // line itself renders correctly (GalaxyCanvas looks up each system's
  // *current* position live, by id, rather than trusting stored
  // coordinates). Risk/capacity are cheap to recompute too, so just redo
  // all three rather than tracking which edges actually moved.
  const byId = new Map(systems.map((s) => [s.id, s]));
  const densityGrid = project.fields.hyperlane;
  const hyperlanes = project.hyperlanes.map((e) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return e;
    const length = Math.round(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y));
    const secA = a.security?.dominion ?? 0.5;
    const secB = b.security?.dominion ?? 0.5;
    const risk = Number(Math.max(0, Math.min(1, 1 - (secA + secB) / 2)).toFixed(2));
    const midX = (a.position.x + b.position.x) / 2;
    const midY = (a.position.y + b.position.y) / 2;
    const density = sampleBilinear(densityGrid, GRID_SIZE, midX, midY, project.bounds);
    const capacity = density >= 0.66 ? "major trade route" : density <= 0.25 ? "backwater spur" : null;
    return { ...e, length, risk, capacity };
  });

  return { systems, hyperlanes };
}

// GM-facing "Generate planets" bulk action (Generate tab) — rerolls the
// body list for every *unlocked* system in place, same lock contract as
// "Generate systems"/redistribute (a locked system's bodies are exactly as
// hand-tuned as its name/position, so they're never touched here). Unlike
// the per-system "Reroll bodies" button in the system inspector (manual
// rng, not reproducible), this is seeded the same way `generateSystems`
// itself seeds each system's bodies (`${project.seed}:bodies:<slug>`), so
// running it twice with nothing else changed reproduces the same galaxy —
// useful after a `planetGen.js` change (e.g. an orbit-distribution fix)
// to re-roll an existing galaxy's bodies onto the corrected model without
// touching system placement, names, or any other rolled data.
export function regeneratePlanets(project) {
  return project.systems.map((s) =>
    s.locked ? s : { ...s, bodies: generateBodies(createRng(`${project.seed}:bodies:${s.slug}`), s) },
  );
}
