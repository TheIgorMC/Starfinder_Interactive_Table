import { pointInPolygon } from "./geometry.js";
import { GRID_SIZE, gridToWorld } from "./grid.js";
import { createRng, randRange } from "./rng.js";
import { generateFactionName } from "./names.js";
import { slugify } from "./slug.js";

// Docs/10-galaxy-mapgen.md §4 — tunable constants for the control-field
// contest. `strength` governs reach (how far a faction's influence still
// carries), not intensity at the seed — every faction fully controls its
// own capital regardless of strength.
const MAX_RANGE_FACTOR = 300;
const MIN_RANGE = 15;
const OWNERSHIP_THRESHOLD = 0.85;
const MIN_CONTEST_SHARE = 0.05;
const FRAGMENT_THRESHOLD = 0.5; // below this max-share, a point counts as "uncovered" border territory
const MIN_REGION_CELLS = 30; // skip noise-sized slivers (grid-quantization/boundary-clipping artifacts) when auto-seeding minors

function uniqueSlug(base, usedSlugs) {
  if (!usedSlugs.has(base)) return base;
  let i = 2;
  while (usedSlugs.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// Weighted-Voronoi-ish control contest (§4): every faction's influence
// peaks at 1 at its own seed and falls off with distance at a rate set by
// its strength; shares are normalized only where total influence saturates
// past 1 (an actual contest), otherwise raw influence stands (mostly-empty
// space stays mostly uncontrolled rather than being inflated to sum to 1).
export function computeControlShares(x, y, factions) {
  if (!factions.length) return [];
  const raw = factions.map((f) => {
    const dist = Math.hypot(x - f.seed.x, y - f.seed.y);
    const range = Math.max(MIN_RANGE, f.strength * MAX_RANGE_FACTOR);
    const influence = 1 / (1 + (dist / range) ** 2);
    return { slug: f.slug, influence };
  });
  const total = raw.reduce((sum, r) => sum + r.influence, 0);
  const scale = total > 1 ? 1 / total : 1;
  return raw
    .map((r) => ({ slug: r.slug, share: Number((r.influence * scale).toFixed(4)) }))
    .sort((a, b) => b.share - a.share);
}

// §4 ownership rule + §7 export shape: owner is only set at ~100% single-
// faction share; anywhere else with meaningful presence is contested, not
// owned; nothing meaningful present at all falls back to the Dominion
// baseline with no contest.
function resolveControl(shares) {
  if (shares.length === 0 || shares[0].share < MIN_CONTEST_SHARE) {
    return { owner: "dominion", contestedBy: [] };
  }
  if (shares[0].share >= OWNERSHIP_THRESHOLD) {
    return { owner: shares[0].slug, contestedBy: [] };
  }
  return {
    owner: null,
    contestedBy: shares
      .filter((s) => s.share >= MIN_CONTEST_SHARE)
      .map((s) => ({ faction: s.slug, share: s.share })),
  };
}

// §4 "faction security" — the locally dominant faction's own enforcement,
// scaled by how solidly it holds the point and how strong it is overall.
function factionSecurityFor(shares, factionsBySlug) {
  if (!shares.length || shares[0].share < MIN_CONTEST_SHARE) return 0;
  const top = shares[0];
  const faction = factionsBySlug.get(top.slug);
  return Number(Math.max(0, Math.min(1, top.share * (faction?.strength ?? 0))).toFixed(2));
}

// §4 war-chance formula: aggression differential (and overall aggression
// level — two calm factions abutting stays calm even with a small gap)
// pushed up, combined security pushed down. Placeholder until Phase 6+
// events can feed real faction relations in; deterministic from what
// already exists (aggression, control shares, security).
function warChanceFor(shares, factionsBySlug, dominionSecurity, factionSecurity) {
  const contestants = shares.filter((s) => s.share >= MIN_CONTEST_SHARE);
  if (contestants.length < 2) return 0;
  const [a, b] = contestants;
  const aggA = factionsBySlug.get(a.slug)?.aggression ?? 0;
  const aggB = factionsBySlug.get(b.slug)?.aggression ?? 0;
  const avgAgg = (aggA + aggB) / 2;
  const diffAgg = Math.abs(aggA - aggB);
  const aggressionFactor = Math.max(0, Math.min(1, avgAgg + diffAgg * 0.5));
  const localSecurity = Math.max(0, Math.min(1, (dominionSecurity + factionSecurity) / 2));
  return Number(Math.max(0, Math.min(1, aggressionFactor * (1 - localSecurity))).toFixed(2));
}

const MINOR_GOVERNMENTS = [
  "warlord domain",
  "independent outpost",
  "minor house",
  "local militia",
  "free port authority",
  "criminal syndicate",
];

function randomFactionColor(rng) {
  const hue = Math.floor(rng() * 360);
  return hslToHex(hue, 60, 50);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

export function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(150,150,150,${alpha})`;
  const [, r, g, b] = m;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${alpha})`;
}

// §3 stage 7 / §4 border fragmentation: fully-automatic second seeding
// pass, no per-faction approval. Samples the same density-grid resolution
// used elsewhere, finds contiguous colonized regions where no authored
// faction clears the contest threshold, and drops one small local faction
// per region above a minimum size.
function autoSeedBorderFactions(project, authoredFactions, rng) {
  const { bounds, sectors } = project;
  const size = GRID_SIZE;
  const uncovered = new Uint8Array(size * size);

  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const [wx, wy] = gridToWorld(gx + 0.5, gy + 0.5, bounds, size);
      const insideSector = sectors.some((sector) => pointInPolygon(wx, wy, sector.points));
      if (!insideSector) continue;
      const top = computeControlShares(wx, wy, authoredFactions)[0]?.share ?? 0;
      if (top < FRAGMENT_THRESHOLD) uncovered[gy * size + gx] = 1;
    }
  }

  const visited = new Uint8Array(size * size);
  const regions = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const idx = gy * size + gx;
      if (!uncovered[idx] || visited[idx]) continue;
      const stack = [[gx, gy]];
      visited[idx] = 1;
      const cells = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const nidx = ny * size + nx;
          if (uncovered[nidx] && !visited[nidx]) {
            visited[nidx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      regions.push(cells);
    }
  }

  const usedSlugs = new Set(authoredFactions.map((f) => f.slug));
  const minors = [];
  for (const region of regions) {
    if (region.length < MIN_REGION_CELLS) continue;
    const cx = region.reduce((s, [x]) => s + x, 0) / region.length;
    const cy = region.reduce((s, [, y]) => s + y, 0) / region.length;
    const [wx, wy] = gridToWorld(cx + 0.5, cy + 0.5, bounds, size);
    const name = generateFactionName(rng);
    const slug = uniqueSlug(slugify(name), usedSlugs);
    usedSlugs.add(slug);
    minors.push({
      id: crypto.randomUUID(),
      slug,
      name,
      color: randomFactionColor(rng),
      government: MINOR_GOVERNMENTS[Math.floor(rng() * MINOR_GOVERNMENTS.length)],
      aggression: Number(randRange(rng, 0.35, 0.85).toFixed(2)),
      strength: Number(randRange(rng, 0.08, 0.25).toFixed(2)),
      seed: { x: wx, y: wy },
      toleratedCrimes: [],
      relationships: {},
      origin: "generated",
    });
  }
  return minors;
}

// Full Phase 3 resolution pass (§3 stages 7-8): auto-seed border minors
// alongside the GM-authored factions, then resolve every system's control/
// security/war-chance from the combined set. Deterministic for a given
// seed + authored factions + system layout; re-rollable independently of
// systems/hyperlanes (only `authoredFactions` carry over, generated minors
// are always rebuilt from scratch).
export function resolveFactions(project, authoredFactions) {
  const rng = createRng(`${project.seed}:factions`);
  const minors = autoSeedBorderFactions(project, authoredFactions, rng);
  const allFactions = [...authoredFactions, ...minors];
  const factionsBySlug = new Map(allFactions.map((f) => [f.slug, f]));

  const systems = project.systems.map((s) => {
    const shares = computeControlShares(s.position.x, s.position.y, allFactions);
    const control = resolveControl(shares);
    const dominionSecurity = s.security?.dominion ?? 0;
    const factionSecurity = factionSecurityFor(shares, factionsBySlug);
    const warChance = warChanceFor(shares, factionsBySlug, dominionSecurity, factionSecurity);
    return {
      ...s,
      control,
      security: { ...s.security, faction: factionSecurity },
      warChance,
    };
  });

  return { factions: allFactions, systems };
}
