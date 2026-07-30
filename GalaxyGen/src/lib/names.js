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

const ACTOR_FIRST_NAMES = [
  "Aria", "Doran", "Ilyra", "Marek", "Sonya", "Talis", "Yevra", "Corin",
  "Nessa", "Bram", "Vashti", "Osric", "Tamsin", "Kael", "Lyris", "Endra",
  "Pavo", "Sela", "Draven", "Mira", "Anselm", "Ysolde", "Rurik", "Cassia",
];

const ACTOR_LAST_NAMES = [
  "Valeran", "Kresh", "Ombric", "Sarn", "Dellow", "Thessaly", "Norrick",
  "Ashgrove", "Vantor", "Ilsen", "Corvane", "Mirelle", "Brakstone", "Yorric",
  "Selwyn", "Draeg", "Palmerin", "Voss", "Herrick", "Amaris",
];

// Docs/10-galaxy-mapgen.md §6.1 — cheap procedural person-name for
// background (`origin: "generated"`) actors; curated actors get a
// GM-chosen name instead and never call this.
export function generateActorName(rng, usedNames) {
  for (let i = 0; i < 6; i++) {
    const name = `${pick(rng, ACTOR_FIRST_NAMES)} ${pick(rng, ACTOR_LAST_NAMES)}`;
    if (!usedNames.has(name)) return name;
  }
  let name = `${pick(rng, ACTOR_FIRST_NAMES)} ${pick(rng, ACTOR_LAST_NAMES)}`;
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}
