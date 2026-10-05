// Procedural place names by "culture". Each culture builds a root word and
// wraps it in feature templates ({X} = root, {A} = adjective).
import { pick } from "./rng.js";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const CULTURES = {
  anglo: {
    name: "Anglo (Ashford, Wolfmere)",
    root: (r) => pick(r, ["Ash", "Black", "Bright", "Brook", "Bram", "Cold", "Dun", "Elm", "Ever", "Fair", "Glen", "Green", "Hart", "Hazel", "High", "Holl", "Kings", "Lang", "Lin", "Mar", "Mill", "Mor", "North", "Oak", "Pen", "Red", "Rook", "Sal", "Stan", "Stone", "Thorn", "Wester", "White", "Wil", "Wolf", "Wych", "Ald", "Bar", "Crow", "Fox", "Gold", "Hawk", "Iron", "Ravens", "Ship"])
      + pick(r, ["ford", "ham", "bury", "wick", "ton", "mere", "dale", "by", "field", "stead", "worth", "bridge", "combe", "holt", "ley", "moor", "stow", "gate", "haven", "wood", "brook", "ridge", "well", "thorpe"]),
    adj: ["Dark", "Grey", "Whispering", "Old", "Silent", "Misty", "Iron", "Broken", "Golden", "Black", "Shadow", "Red", "Weeping", "Howling", "Pale"],
    place: { capital: ["{X}"], castle: ["{X} Castle", "{X} Keep", "Fort {X}"], default: ["{X}"] },
    feature: {
      forest: ["{X} Wood", "{X} Forest", "The {A} Forest", "{A}wood"], mountains: ["{X} Mountains", "The {A} Peaks", "{X} Range"],
      hills: ["{X} Hills", "The {A} Downs", "{X} Fells"], marsh: ["{X} Fens", "The {A} Marshes", "{X} Mire"],
      desert: ["{X} Wastes", "The {A} Sands"], sea: ["Sea of {X}", "{X} Bay", "The {A} Sea"], lake: ["Lake {X}", "{X} Water", "{X} Mere"],
      river: ["River {X}", "The {X}", "{X} Run"], region: ["Kingdom of {X}", "{X}shire", "March of {X}"],
    },
    poi: {
      cave: ["{X} Cave", "The {A} Hollow", "Caverns of {X}"], mine: ["{X} Mine", "{X} Deeps"], ruin: ["Ruins of {X}", "Old {X}"],
      tower: ["{X} Tower", "The {A} Tower"], shrine: ["Shrine of {X}", "{X} Cross"], temple: ["Temple of {X}"],
      monastery: ["{X} Abbey", "{X} Priory"], dungeon: ["The {A} Crypt", "Vaults of {X}"], lair: ["{A} Den", "Wyrm's Rest"],
      camp: ["{X} Camp"], inn: ["The {A} Stag", "The {A} Lantern", "The {A} Boar"], stones: ["{X} Stones", "The {A} Ring"],
      battlefield: ["Field of {X}"], lighthouse: ["{X} Light"], bridge: ["{X} Bridge"], portal: ["The {A} Gate"], landmark: ["{X} Rock"],
    },
  },
  italic: {
    name: "Italic (Castelfiore, Borgo Ardano)",
    root: (r) => pick(r, ["Ard", "Bel", "Cerv", "Cast", "Lun", "Mar", "Mont", "Orv", "Pal", "Riv", "Sel", "Tor", "Val", "Vit", "Fior", "Grav", "Lam", "Ner", "Ost", "Sor", "Ver", "Brac", "Cor", "Fel", "Gual", "Lor", "Mel", "Rav", "Tagl", "Ugl"])
      + pick(r, ["ano", "ella", "ate", "ago", "ino", "eto", "ona", "ara", "ello", "enza", "asco", "engo", "iano", "ola", "aro"]),
    adj: ["Oscura", "Antica", "Grigia", "Silente", "Nebbiosa", "Nera", "Rossa", "Dorata", "Vecchia", "Perduta"],
    place: {
      capital: ["{X}"], city: ["{X}", "{X}", "San {X}"], town: ["{X}", "Borgo {X}", "{X} al Monte", "Castel{x}"],
      village: ["{X}", "{X}", "Borgo {X}", "{X} di Sopra", "{X} di Sotto", "Pieve {X}"], hamlet: ["Casale {X}", "Villa {X}", "{X}"],
      castle: ["Rocca {X}", "Castel {X}", "Torre {X}"], default: ["{X}"],
    },
    feature: {
      forest: ["Bosco di {X}", "Selva di {X}", "Foresta {A}"], mountains: ["Monti di {X}", "Alpi {X}e", "Catena di {X}"],
      hills: ["Colli di {X}", "Colline di {X}"], marsh: ["Paludi di {X}", "Acquitrini di {X}"], desert: ["Deserto di {X}", "Lande di {X}"],
      sea: ["Mare di {X}", "Golfo di {X}"], lake: ["Lago di {X}"], river: ["Fiume {X}", "Torrente {X}"], region: ["Regno di {X}", "Contea di {X}", "Marca di {X}"],
    },
    poi: {
      cave: ["Grotta di {X}", "Antro di {X}"], mine: ["Miniera di {X}"], ruin: ["Rovine di {X}", "{X} Vecchia"], tower: ["Torre di {X}", "Torre {A}"],
      shrine: ["Edicola di {X}", "Santuario di {X}"], temple: ["Tempio di {X}"], monastery: ["Abbazia di {X}", "Convento di {X}"],
      dungeon: ["Cripta {A}", "Segrete di {X}"], lair: ["Tana {A}", "Covo di {X}"], camp: ["Accampamento di {X}"], inn: ["Locanda {A}", "Osteria di {X}"],
      stones: ["Pietre di {X}", "Cerchio {A}"], battlefield: ["Piana di {X}"], lighthouse: ["Faro di {X}"], bridge: ["Ponte di {X}"], portal: ["Porta {A}"], landmark: ["Sasso di {X}"],
    },
  },
  nordic: {
    name: "Nordic (Hrafnvik, Skarheim)",
    root: (r) => pick(r, ["Ask", "Bjorn", "Dal", "Frey", "Grim", "Hal", "Hrafn", "Jarn", "Kald", "Lund", "Mjol", "Nor", "Ragn", "Sig", "Skar", "Stav", "Thor", "Ulf", "Vald", "Ys", "Eik", "Fjal", "Gud", "Hel", "Ivar", "Ljos", "Odd", "Rim", "Svart", "Troll"])
      + pick(r, ["heim", "vik", "by", "stad", "fjord", "holm", "gard", "berg", "dal", "nes", "havn", "sund", "vald", "fell", "lund"]),
    adj: ["Grey", "Frozen", "Silent", "Black", "Ashen", "Howling", "Iron", "Pale", "Storm", "Old"],
    place: { castle: ["{X} Hold", "{X}borg"], default: ["{X}"] },
    feature: {
      forest: ["{X}skog", "{X} Forest", "The {A} Pines"], mountains: ["{X}fjell", "The {A} Teeth", "{X} Peaks"], hills: ["{X} Hills", "{X}haug"],
      marsh: ["{X}myr", "The {A} Bog"], desert: ["{X} Barrens"], sea: ["{X}havet", "{X} Fjord", "The {A} Sea"], lake: ["{X}vatn", "Lake {X}"],
      river: ["{X}elva", "{X} River"], region: ["{X}land", "Jarldom of {X}"],
    },
    poi: {
      cave: ["{X} Hollow", "Troll Cave"], mine: ["{X} Mine"], ruin: ["{X} Barrow", "Ruins of {X}"], tower: ["{X} Watch"], shrine: ["Altar of {X}"],
      temple: ["Hof of {X}"], monastery: ["{X} Hall"], dungeon: ["{A} Barrow"], lair: ["Wyrm of {X}", "{A} Den"], camp: ["{X} Camp"], inn: ["The {A} Mead Hall"],
      stones: ["{X} Runestones"], battlefield: ["{X} Field"], lighthouse: ["{X} Beacon"], bridge: ["{X} Bridge"], portal: ["The {A} Gate"], landmark: ["{X} Stone"],
    },
  },
  elvish: {
    name: "Elvish (Lindoreth, Aelwen)",
    root: (r) => {
      const syl = ["ae", "el", "lin", "dor", "wen", "thal", "ri", "an", "sil", "mir", "ith", "nor", "eth", "las", "gal", "lor", "ia", "ond", "quen", "ar", "fal", "cel", "nim", "ost"];
      const n = 1 + Math.floor(r() * 2);
      let s = "";
      for (let i = 0; i < n; i++) s += pick(r, syl);
      return cap(s + pick(r, ["ion", "iel", "ost", "ond", "las", "wen", "dor", "nar", "eth", "ith"]));
    },
    adj: ["Silver", "Star", "Moon", "Twilight", "Golden", "Hidden", "Elder", "Sorrow"],
    place: { castle: ["Tirith {X}", "{X} Hold"], default: ["{X}"] },
    feature: {
      forest: ["Taur {X}", "{X} Forest", "The {A} Wood"], mountains: ["Ered {X}", "The {A} Mountains"], hills: ["Emyn {X}", "{X} Downs"],
      marsh: ["{X} Marshes"], desert: ["{X} Wastes"], sea: ["Belegaer {X}", "Sea of {X}"], lake: ["Nen {X}", "Lake {X}"], river: ["{X}duin", "River {X}"], region: ["Realm of {X}"],
    },
    poi: {
      cave: ["Grotto of {X}"], mine: ["{X} Delvings"], ruin: ["Ruins of {X}"], tower: ["Tower of {X}", "The {A} Spire"], shrine: ["Shrine of {X}"],
      temple: ["Sanctum of {X}"], monastery: ["House of {X}"], dungeon: ["The {A} Halls"], lair: ["{A} Lair"], camp: ["{X} Refuge"], inn: ["The {A} Leaf"],
      stones: ["{X} Stones"], battlefield: ["Dagorlad {X}"], lighthouse: ["{X} Light"], bridge: ["{X} Bridge"], portal: ["The {A} Gate"], landmark: ["{X} Seat"],
    },
  },
  plain: {
    name: "Bare names (just the name, no 'Forest of…')",
    root: (r) => CULTURES.anglo.root(r),
    adj: ["Old"],
    place: { default: ["{X}"] },
    feature: {},
    poi: {},
  },
};

// ---- custom name sets ------------------------------------------------------
// A list of sample names → a character-level Markov chain that writes new
// names in the same style (Azgaar's "namesbase" idea). Order 2 with few
// samples (more variety), 3 with many (closer to the originals).
export function parseNameList(text) {
  const list = Array.isArray(text) ? text : String(text || "").split(/[\n,;]+/);
  return [...new Set(list.map((x) => String(x).trim()).filter((x) => x.length >= 2 && x.length <= 40))];
}
// `samples` are the category's own names (weighted ×3); `extra` are the
// other names of the same language — they teach the sounds when a category
// has only a handful of examples.
export function markovModel(samples, extra = []) {
  const words = parseNameList(samples);
  const more = parseNameList(extra).filter((w) => !words.includes(w));
  const all = [...words, ...more];
  const order = all.length < 25 ? 2 : 3;
  const chain = new Map();
  const add = (k, c) => { if (!chain.has(k)) chain.set(k, []); chain.get(k).push(c); };
  const learn = (w) => {
    const s = "^".repeat(order) + w.toLowerCase() + "$";
    for (let i = 0; i + order < s.length; i++) add(s.slice(i, i + order), s[i + order]);
  };
  for (const w of words) { learn(w); learn(w); learn(w); }
  for (const w of more) learn(w);
  const lens = (words.length >= 2 ? words : all).map((w) => w.length).sort((a, b) => a - b);
  return { chain, order, words: words.length ? words : all, known: new Set(all.map((w) => w.toLowerCase())), min: Math.max(3, lens[0] || 3), max: Math.max(5, lens[lens.length - 1] || 10) };
}
const titleCase = (s) => s.replace(/(^|[\s\-'’])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
export function markovName(model, rng, { allowKnown = false } = {}) {
  for (let t = 0; t < 80; t++) {
    let key = "^".repeat(model.order), out = "";
    for (;;) {
      const next = model.chain.get(key);
      if (!next) break;
      const c = next[Math.floor(rng() * next.length)];
      if (c === "$") break;
      out += c;
      key = (key + c).slice(-model.order);
      if (out.length > model.max + 2) break;
    }
    out = out.trim();
    if (out.length < model.min || out.length > model.max + 1) continue;
    if (!allowKnown && model.known.has(out)) continue;
    if (/(.)\1\1/.test(out)) continue; // no triple letters
    return titleCase(out);
  }
  return titleCase(model.words[Math.floor(rng() * model.words.length)] || "Nameless");
}

// names: optional custom set, one "language" in three lists:
//   { samples: towns & cities, places?: features (forests, rivers, caves…),
//     people?: persons, mode: "inspire" | "use", base: cultureKey }
// Lists can be arrays or text (one per line / comma separated).
export function nameSetSize(names) {
  return names ? parseNameList(names.samples).length + parseNameList(names.places).length + parseNameList(names.people).length : 0;
}
export function makeNamer(rng, cultureKey = "anglo", names = null) {
  const custom = nameSetSize(names) >= 3 ? names : null;
  const c = CULTURES[custom ? custom.base || cultureKey : cultureKey] || CULTURES.anglo;
  const lists = custom ? { towns: parseNameList(custom.samples), places: parseNameList(custom.places), people: parseNameList(custom.people) } : null;
  const modelFor = (key) => {
    if (!lists) return null;
    const others = Object.entries(lists).filter(([k]) => k !== key).flatMap(([, v]) => v);
    return markovModel(lists[key], others);
  };
  const model = modelFor("towns"), placeModel = modelFor("places"), peopleModel = modelFor("people");
  // "use": the given names go to settlements (and places) first, most important first
  const pool = custom && custom.mode === "use" ? [...lists.towns] : [];
  const poiPool = custom && custom.mode === "use" ? [...lists.places] : [];
  const root = () => (model ? markovName(model, rng) : c.root(rng));
  const placeRoot = () => (placeModel ? markovName(placeModel, rng) : c.root(rng));
  const used = new Set();
  const fill = (tpl, rootFn = root) => {
    const r = rootFn();
    return tpl.replace("{X}", r).replace("{x}", r.toLowerCase()).replace("{A}", pick(rng, c.adj));
  };
  const unique = (tpls, rootFn) => {
    for (let k = 0; k < 30; k++) {
      const s = fill(pick(rng, tpls), rootFn);
      if (!used.has(s)) { used.add(s); return s; }
    }
    // small name lists run out of fresh roots: join two (Xeredon + Kashr → Xerekashr)
    const r = rootFn || root;
    for (let k = 0; k < 40; k++) {
      const x = r(), y = r();
      const joined = x.slice(0, Math.max(2, Math.ceil(x.length * 0.6))) + y.slice(Math.floor(y.length / 2)).toLowerCase();
      const s = pick(rng, tpls).replace("{X}", joined).replace("{x}", joined.toLowerCase()).replace("{A}", pick(rng, c.adj));
      if (!used.has(s) && joined.length <= 12) { used.add(s); return s; }
    }
    return fill(pick(rng, tpls), rootFn) + " " + (used.size + 1);
  };
  return {
    culture: c,
    custom: !!custom,
    place: (type) => {
      if (pool.length && type !== "castle") { const n = pool.shift(); used.add(n); return n; }
      // a custom set's names are whole place names: no "Borgo {X}" dressing
      return unique(custom ? (type === "castle" ? c.place.castle || ["{X}"] : ["{X}"]) : c.place[type] || c.place.default || ["{X}"]);
    },
    feature: (type) => unique(c.feature[type] || ["{X}"], placeRoot),
    poi: (type) => {
      if (poiPool.length) { const n = poiPool.shift(); used.add(n); return n; }
      return unique(c.poi[type] || ["{X}"], placeRoot);
    },
    // a person's name in the set's language (custom sets only have a voice
    // for this; built-in cultures fall back to their place roots)
    person: () => {
      const one = () => (peopleModel ? markovName(peopleModel, rng) : c.root(rng));
      for (let k = 0; k < 30; k++) { const s = one(); if (!used.has(s)) { used.add(s); return s; } }
      for (let k = 0; k < 40; k++) { const x = one(), y = one(); const s = x.slice(0, Math.max(2, Math.ceil(x.length * 0.6))) + y.slice(Math.floor(y.length / 2)).toLowerCase(); if (!used.has(s) && s.length <= 11) { used.add(s); return s; } }
      return one();
    },
    root,
  };
}
