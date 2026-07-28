// Procedural system-name generator, seeded via the caller's rng so a given
// project seed always produces the same names (Docs/10-galaxy-mapgen.md §3).
export const ROOTS = [
  "Vor", "Kreel", "Thal", "Nys", "Ordo", "Ashen", "Corvain", "Meridian",
  "Halcyon", "Tessera", "Drexel", "Onyx", "Pallas", "Ithra", "Serrin",
  "Doran", "Vesk", "Auric", "Kestrel", "Marrow", "Solace", "Wraith",
  "Cindra", "Novara", "Brack", "Ilyra", "Quen", "Zareth", "Hollis", "Amara",
];

const PLACE_WORDS = [
  "Reach", "Junction", "Drift", "Expanse", "Hollow", "Gate", "Span",
  "Verge", "Crossing", "Rest", "Anchor", "Bastion", "Cradle", "Shoal",
];

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function rollName(rng) {
  const root = pick(rng, ROOTS);
  const style = rng();
  if (style < 0.35) return `${root}'s ${pick(rng, PLACE_WORDS)}`;
  if (style < 0.6) return `${root} ${pick(rng, PLACE_WORDS)}`;
  if (style < 0.8) {
    let root2 = pick(rng, ROOTS);
    if (root2 === root) root2 = pick(rng, ROOTS);
    return `${root}-${root2}`;
  }
  return `${root}-${1 + Math.floor(rng() * 12)}`;
}

const FACTION_SUFFIXES = [
  "Coalition", "Clans", "Concord", "Compact", "Free State", "Syndicate",
  "Warband", "Combine", "Directorate", "Assembly", "Remnant", "Collective",
];

// Docs/10-galaxy-mapgen.md §3 stage 7 — auto-seeded border factions get a
// simpler "root + political-flavor suffix" name, distinct from system names.
export function generateFactionName(rng) {
  return `${pick(rng, ROOTS)} ${pick(rng, FACTION_SUFFIXES)}`;
}

// Rerolls a few times on collision (within a single generation batch)
// before falling back to a numbered suffix, so names stay readable.
export function generateSystemName(rng, usedNames) {
  for (let i = 0; i < 6; i++) {
    const name = rollName(rng);
    if (!usedNames.has(name)) return name;
  }
  let name = rollName(rng);
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}
