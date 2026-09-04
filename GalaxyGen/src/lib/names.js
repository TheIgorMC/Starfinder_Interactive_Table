// Procedural system-name generator, seeded via the caller's rng so a given
// project seed always produces the same names (Docs/10-galaxy-mapgen.md §3).
//
// Pool sizes matter more than they look: at background-actor scale (§6.1,
// hundreds to low thousands per galaxy) a small flat list collides
// constantly and falls back to ugly " 2"/" 3" numbered suffixes — verified
// live (e.g. "Sonya Ombric 2", "Mira Herrick 3" appearing in a real test
// galaxy). Every pool below is sized to keep raw combinations comfortably
// above anything a single galaxy will actually generate, and the actor
// name pools additionally use an occasional compound variant (two words
// fused with a hyphen) to push the effective space an order of magnitude
// further beyond the flat first×last product without having to
// hand-write hundreds more words.
export const ROOTS = [
  "Vor", "Kreel", "Thal", "Nys", "Ordo", "Ashen", "Corvain", "Meridian",
  "Halcyon", "Tessera", "Drexel", "Onyx", "Pallas", "Ithra", "Serrin",
  "Doran", "Vesk", "Auric", "Kestrel", "Marrow", "Solace", "Wraith",
  "Cindra", "Novara", "Brack", "Ilyra", "Quen", "Zareth", "Hollis", "Amara",
  "Ostara", "Kaldris", "Threnn", "Isolde", "Yssara", "Corel", "Vantis",
  "Mireth", "Sable", "Obsidia", "Auroch", "Thessal", "Kryos", "Malven",
  "Ostrya", "Wyndra", "Aldren", "Farros", "Belmir", "Cindral", "Elowen",
  "Fenrik", "Gorath", "Harrow", "Ilios", "Jexen", "Kalor", "Lynthe",
  "Morrow", "Nadir", "Orenth", "Pryce", "Quorra", "Rethis", "Selvane",
  "Torvik", "Ustra", "Velmar", "Xarrow", "Yveth", "Zorai",
];

const PLACE_WORDS = [
  "Reach", "Junction", "Drift", "Expanse", "Hollow", "Gate", "Span",
  "Verge", "Crossing", "Rest", "Anchor", "Bastion", "Cradle", "Shoal",
  "Vale", "Rift", "Wake", "Nexus", "Sprawl", "Hearth", "Threshold",
  "Terminus", "Horizon", "Pale", "Marches", "Reef", "Furrow", "Redoubt",
  "Sanctum", "Waystation", "Frontier", "Causeway", "Watch", "Landing",
  "Vault", "Confluence",
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
  "Dominion", "Accord", "League", "Order", "Enclave", "Cartel", "Hegemony",
  "Alliance", "Federation", "Conclave", "Brotherhood", "Union",
  "Consortium", "Ascendancy", "Protectorate", "Vanguard", "Guild", "Circle",
];

// Docs/10-galaxy-mapgen.md §3 stage 7 — auto-seeded border factions get a
// simpler "root + political-flavor suffix" name, distinct from system names.
// Occasionally reverses to "Suffix of Root" or fuses two roots for extra
// distinctiveness — small factions shouldn't all read as "<Root> <Suffix>."
export function generateFactionName(rng) {
  const style = rng();
  if (style < 0.12) return `${pick(rng, FACTION_SUFFIXES)} of ${pick(rng, ROOTS)}`;
  if (style < 0.22) {
    let root2 = pick(rng, ROOTS);
    const root1 = pick(rng, ROOTS);
    if (root2 === root1) root2 = pick(rng, ROOTS);
    return `${root1}-${root2} ${pick(rng, FACTION_SUFFIXES)}`;
  }
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
  "Elin", "Fennick", "Garrow", "Halden", "Iolanthe", "Joss", "Kestrel",
  "Liora", "Magnus", "Neris", "Orin", "Perse", "Quill", "Rasha", "Sabine",
  "Torin", "Ulla", "Varek", "Wrenna", "Xiomel", "Yara", "Zephyr",
  "Alistene", "Branik", "Cyrene", "Delric", "Eowen", "Faelan", "Grenna",
  "Hesper", "Idris", "Jareth", "Kyra", "Lucan", "Mirelle", "Nadira",
  "Oleth", "Phaidra", "Quinlan", "Riven", "Soren", "Thalia", "Ursa",
  "Vespera", "Wyatt", "Zorin",
];

const ACTOR_LAST_NAMES = [
  "Valeran", "Kresh", "Ombric", "Sarn", "Dellow", "Thessaly", "Norrick",
  "Ashgrove", "Vantor", "Ilsen", "Corvane", "Brakstone", "Yorric",
  "Selwyn", "Draeg", "Palmerin", "Voss", "Herrick", "Amaris",
  "Bellweather", "Castellan", "Drummond", "Esterling", "Fairwind",
  "Grayve", "Holt", "Ironwood", "Jarrow", "Kesteven", "Larkspur",
  "Nightshade", "Osprey", "Pemberton", "Quillon", "Ravenscar",
  "Stormwake", "Thackeray", "Underhill", "Vestergaard", "Winterbourne",
  "Ashcombe", "Blackwood", "Cromwell", "Duskwatch", "Ellingsworth",
  "Fenmoor", "Graystone", "Hollowell", "Ivyrest", "Junewood",
  "Kettleburn", "Larchmont", "Moorland", "Northgate", "Oakhaven",
  "Pinecrest", "Quarrymoor", "Redbrook", "Silverpine", "Thornfield",
  "Umberlyn", "Vaelwood", "Westmark", "Yewbranch", "Zenmoor", "Ashford",
  "Briarwood", "Coldharbor",
];

// Occasional compound variants push the effective name space well beyond
// the flat first×last product (70×70 = 4900) without hand-writing more
// words: a hyphenated double surname ("Kresh-Vantor") or double given name
// ("Kael-Ren") reads as a plausible noble-house/hyphenate-culture name,
// not a glitch — and only fires a fraction of the time so most names stay
// simple.
function rollFirstName(rng) {
  const first = pick(rng, ACTOR_FIRST_NAMES);
  if (rng() < 0.06) {
    let second = pick(rng, ACTOR_FIRST_NAMES);
    if (second === first) second = pick(rng, ACTOR_FIRST_NAMES);
    return `${first}-${second}`;
  }
  return first;
}

function rollLastName(rng) {
  const last = pick(rng, ACTOR_LAST_NAMES);
  if (rng() < 0.1) {
    let second = pick(rng, ACTOR_LAST_NAMES);
    if (second === last) second = pick(rng, ACTOR_LAST_NAMES);
    return `${last}-${second}`;
  }
  return last;
}

// Individual vessel naming (shipGen.js's notable ships) — reuses
// `rollName`'s "Root('s) PlaceWord" shape (ships-named-after-places is a
// common sci-fi convention) but tracked in its own `usedNames` set, kept
// separate from generateSystemName so a ship name never collides with (or
// gets confused for) an actual system in the same galaxy.
export function generateVesselName(rng, usedNames) {
  for (let i = 0; i < 6; i++) {
    const name = rollName(rng);
    if (!usedNames.has(name)) return name;
  }
  let name = rollName(rng);
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

const SHIP_MODEL_SUFFIXES = [
  "wing", "runner", "strider", "tide", "comet", "drifter", "wake", "spear",
  "lance", "current", "star", "wind", "flare", "shard", "voyager", "warden",
  "sentinel", "courier", "prowler", "gale",
];

// Ship-model naming (§8-adjacent ship/fleet economy, shipGen.js) — a root
// (reusing the same place-name root pool everything else in this galaxy
// draws from, so a ship model reads as belonging to the same setting) fused
// with a nautical/aerospace-flavored suffix, e.g. "Kreelrunner"-class or
// "Vorwing"-class. Distinct pool from system/faction naming so a model name
// never collides with (or gets mistaken for) a place or a faction.
export function generateShipModelName(rng, usedNames) {
  for (let i = 0; i < 6; i++) {
    const name = `${pick(rng, ROOTS)}${pick(rng, SHIP_MODEL_SUFFIXES)}`;
    if (!usedNames.has(name)) return name;
  }
  let name = `${pick(rng, ROOTS)}${pick(rng, SHIP_MODEL_SUFFIXES)}`;
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// Ship-company naming (shipGen.js), role-flavored suffix pools so a cargo
// line and a diplomatic courier service don't read as the same kind of
// business even when they share a root word.
const COMPANY_SUFFIXES = {
  cargo: ["Freight Co.", "Shipping", "Bulk Lines", "Logistics", "Hauling Guild", "Cargo Concern"],
  tourism: ["Voyages", "Excursions", "Cruise Line", "Getaways", "Charter Tours"],
  diplomacy: ["Envoy Service", "Diplomatic Transit", "Courier Guild", "Legation Lines"],
  private: ["Charter Services", "Air & Void", "Private Fleet", "Custom Yachts"],
  military: ["Security Contractors", "Defense Works", "Armaments & Escort", "Militia Fleet"],
};

export function generateCompanyName(rng, role, usedNames) {
  const suffixes = COMPANY_SUFFIXES[role] || COMPANY_SUFFIXES.cargo;
  for (let i = 0; i < 6; i++) {
    const name = `${pick(rng, ROOTS)} ${pick(rng, suffixes)}`;
    if (!usedNames.has(name)) return name;
  }
  let name = `${pick(rng, ROOTS)} ${pick(rng, suffixes)}`;
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// Docs/10-galaxy-mapgen.md §6.1 — cheap procedural person-name for
// background (`origin: "generated"`) actors; curated actors get a
// GM-chosen name instead and never call this.
export function generateActorName(rng, usedNames) {
  for (let i = 0; i < 6; i++) {
    const name = `${rollFirstName(rng)} ${rollLastName(rng)}`;
    if (!usedNames.has(name)) return name;
  }
  let name = `${rollFirstName(rng)} ${rollLastName(rng)}`;
  let n = 2;
  while (usedNames.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}
