import { createRng, randRange } from "./rng.js";
import { generateActorName } from "./names.js";
import { slugify } from "./slug.js";
import { POPULATION_BANDS } from "./populationBands.js";

// Docs/10-galaxy-mapgen.md §6.1 — a system with meaningful presence from a
// faction other than its sole owner still gets that faction's own small
// batch of local reps; anything below this share is background noise, not
// worth a dedicated actor.
const MEANINGFUL_SHARE = 0.15;
// Safety valve so a single wildly-contested, max-population system doesn't
// spawn an absurd actor count — mirrors MAX_MINORS_PER_REGION in factionGen.js.
const MAX_ACTORS_PER_SYSTEM = 6;

const POP_ROLES = ["senator", "guild-rep", "merchant-broker", "station-chief", "local-clerk"];
const FACTION_ROLES = ["garrison-captain", "faction-functionary", "faction-liaison", "security-officer"];

function uniqueSlug(base, usedSlugs) {
  if (!usedSlugs.has(base)) return base;
  let i = 2;
  while (usedSlugs.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function popWeight(system) {
  const index = POPULATION_BANDS.findIndex((b) => b.value === system.population);
  if (index < 0) return 0;
  return index / (POPULATION_BANDS.length - 1);
}

// §6.1 — one small batch of background actors per system, scaled by both
// population (more populous = more officials/merchants) and faction
// presence/contest (a hot border system draws a rep per faction with
// meaningful local share, on top of the population-driven baseline). Fully
// automatic, no per-actor review, mirroring the border-faction auto-seed
// pass in factionGen.js.
export function generateBackgroundActors(project) {
  const rng = createRng(`${project.seed}:actors`);
  const usedSlugs = new Set(project.actors.map((a) => a.slug));
  const usedNames = new Set(project.actors.map((a) => a.name));
  const generated = [];

  for (const system of project.systems) {
    const baselineCount = system.stationOnly ? 0 : Math.round(popWeight(system) * 3);

    const factionSlugs = [];
    if (system.control?.owner && system.control.owner !== "dominion") {
      factionSlugs.push(system.control.owner);
    }
    for (const c of system.control?.contestedBy || []) {
      if (c.share >= MEANINGFUL_SHARE) factionSlugs.push(c.faction);
    }

    const total = Math.min(MAX_ACTORS_PER_SYSTEM, baselineCount + factionSlugs.length);
    if (total <= 0) continue;

    let factionIdx = 0;
    for (let n = 0; n < total; n++) {
      const isFactionRep = n >= baselineCount && factionIdx < factionSlugs.length;
      const role = isFactionRep
        ? FACTION_ROLES[Math.floor(rng() * FACTION_ROLES.length)]
        : POP_ROLES[Math.floor(rng() * POP_ROLES.length)];
      const affiliation = isFactionRep ? `faction:${factionSlugs[factionIdx++]}` : null;
      const name = generateActorName(rng, usedNames);
      usedNames.add(name);
      const slug = uniqueSlug(slugify(name), usedSlugs);
      usedSlugs.add(slug);

      generated.push({
        id: crypto.randomUUID(),
        slug,
        name,
        kind: "individual",
        role,
        affiliation,
        location: system.slug,
        mobile: false,
        influence: Number(randRange(rng, 0.05, 0.25).toFixed(2)),
        status: "active",
        reputation: {},
        extraTags: [],
        origin: "generated",
      });
    }
  }

  return generated;
}
