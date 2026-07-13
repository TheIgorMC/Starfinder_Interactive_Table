// Best-effort structured extraction from the raw scraped strings already
// in `data` (spell Range/Area/Duration/Saving Throw/Targets, feat
// Prerequisites) into the `mechanics` shape (mechanics-schema.js). This is
// deliberately conservative: prose it can't confidently parse is kept as a
// `raw` fallback rather than guessed at, so nothing is lost and nothing is
// silently wrong. Re-run whenever scraped data changes — it's a pure
// function of `data`, nothing here is hand-curated.

import { blankMechanics } from "./mechanics-schema.js";

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCount(word) {
  if (word == null) return null;
  const w = word.toLowerCase();
  if (WORD_NUMBERS[w] != null) return WORD_NUMBERS[w];
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
}

// "Personal", "Touch", "Close (25 ft. + 5 ft./2 levels)", "Medium (100 ft. + 10 ft./level)",
// "Long (400 ft. + 40 ft./level)", "60 ft.", "Unlimited", "See text"
export function parseRange(str) {
  if (!str) return null;
  const s = str.trim();
  const lower = s.toLowerCase();
  if (lower === "personal") return { unit: "personal" };
  if (lower === "touch") return { unit: "touch" };
  if (lower === "unlimited") return { unit: "unlimited" };

  const categoryMatch = s.match(/^(Close|Medium|Long)\s*\(([^)]+)\)/i);
  if (categoryMatch) {
    const [, category, inner] = categoryMatch;
    const m = inner.match(/(\d+)\s*ft\.?\s*\+\s*(\d+)\s*ft\.?\s*\/\s*(\d+)?\s*level/i);
    if (m) {
      return {
        unit: "ft",
        category: category.toLowerCase(),
        base: Number(m[1]),
        perLevel: { amount: Number(m[2]), levels: m[3] ? Number(m[3]) : 1 },
      };
    }
    return { unit: "ft", category: category.toLowerCase(), raw: s };
  }

  const flat = s.match(/^(\d+)\s*ft\.?$/i);
  if (flat) return { unit: "ft", value: Number(flat[1]) };

  return { unit: "raw", raw: s };
}

// "20-ft.-radius burst", "one 5-ft. square/level", "Cone-shaped burst", "10-ft.-radius spread"
export function parseArea(str) {
  if (!str) return null;
  const s = str.trim();
  const m = s.match(/(\d+)[\s-]*ft\.?[\s-]*(radius|cone|line|burst|spread|square)/i);
  if (m) return { size: Number(m[1]), unit: "ft", shape: m[2].toLowerCase() };
  const shapeOnly = s.match(/\b(cone|line|burst|spread|sphere|cylinder)\b/i);
  if (shapeOnly) return { shape: shapeOnly[1].toLowerCase(), raw: s };
  return { raw: s };
}

// "Instantaneous", "1 round/level", "1 minute/level (D)", "Permanent", "Concentration", "See text"
export function parseDuration(str) {
  if (!str) return null;
  let s = str.trim();
  let dismissible = false;
  if (/\(D\)\s*$/i.test(s)) { dismissible = true; s = s.replace(/\(D\)\s*$/i, "").trim(); }

  const lower = s.toLowerCase();
  if (lower === "instantaneous") return { unit: "instantaneous", dismissible };
  if (lower === "permanent") return { unit: "permanent", dismissible };
  if (lower === "concentration") return { unit: "concentration", dismissible };

  const m = s.match(/^(\d+)\s*(round|minute|hour|day)s?(\s*\/\s*level)?/i);
  if (m) {
    return {
      unit: m[2].toLowerCase(),
      value: Number(m[1]),
      perLevel: !!m[3],
      dismissible,
    };
  }

  return { unit: "raw", raw: str.trim(), dismissible };
}

// "None", "Reflex half", "Will negates (harmless)", "Fortitude partial", "Will disbelief"
export function parseSavingThrow(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^none$/i.test(s)) return { type: "none", effects: [] };

  const m = s.match(/^(Fortitude|Reflex|Will)\b(.*)$/i);
  if (m) {
    const rest = m[2].toLowerCase();
    const effects = [];
    if (/negates/.test(rest)) effects.push("negates");
    if (/half/.test(rest)) effects.push("half");
    if (/partial/.test(rest)) effects.push("partial");
    if (/harmless/.test(rest)) effects.push("harmless");
    if (/disbelief/.test(rest)) effects.push("disbelief");
    return { type: m[1].toLowerCase(), effects };
  }

  return { type: "raw", raw: s, effects: [] };
}

// "Yes", "No", "Yes (harmless)", "Yes (object)"
export function parseSpellResistance(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^no$/i.test(s)) return { applies: false };
  const m = s.match(/^yes\s*(?:\(([^)]+)\))?$/i);
  if (m) return { applies: true, harmless: /harmless/i.test(m[1] || ""), note: m[1] || undefined };
  return { applies: null, raw: s };
}

// "Up to three creatures, no two of which can be more than 15 ft. apart",
// "one creature", "one object", "you", "one ally"
export function parseTargets(str) {
  if (!str) return null;
  const s = str.trim();
  const targeting = { type: "creature", count: null, constraints: [] };

  const lower = s.toLowerCase();
  if (/^you\b/.test(lower)) { targeting.type = "self"; targeting.count = { min: 1, max: 1 }; }

  const upTo = s.match(/up to (\w+)\s+(creatures?|targets?|objects?|allies)/i);
  if (upTo) {
    const n = parseCount(upTo[1]);
    if (n != null) targeting.count = { min: 1, max: n };
    if (/ally|allies/i.test(upTo[2])) targeting.type = "ally";
    else if (/object/i.test(upTo[2])) targeting.type = "object";
  } else {
    const exact = s.match(/^(one|a|an)\s+(creature|object|ally|willing creature)/i);
    if (exact) {
      targeting.count = { min: 1, max: 1 };
      if (/object/i.test(exact[2])) targeting.type = "object";
      else if (/ally/i.test(exact[2])) targeting.type = "ally";
    }
  }

  const apart = s.match(/no two of which (?:can be|are)?\s*more than (\d+)\s*ft\.?\s*apart/i);
  if (apart) {
    targeting.constraints.push({ type: "maxDistanceBetweenTargets", value: Number(apart[1]), unit: "ft" });
  }

  if (!targeting.count && targeting.type === "creature") return { type: "raw", raw: s, constraints: [] };
  return targeting;
}

// "Str 13", "Base attack bonus +1", "Weapon Focus (longarm)", "5th level",
// joined by "," or ";" — each clause becomes its own requirement Condition.
const ABILITY_NAMES = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };

function parsePrereqClause(clause) {
  const c = clause.trim();
  if (!c) return null;

  const ability = c.match(/^(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/i);
  if (ability) return { type: "abilityScore", ability: ABILITY_NAMES[ability[1].toLowerCase()], min: Number(ability[2]) };

  const bab = c.match(/^Base attack bonus \+?(\d+)/i);
  if (bab) return { type: "babMin", value: Number(bab[1]) };

  const level = c.match(/^(\d+)(?:st|nd|rd|th) level/i);
  if (level) return { type: "minLevel", value: Number(level[1]) };

  const feat = c.match(/^([A-Z][\w' -]*?)(?:\s*\(([^)]+)\))?$/);
  if (feat) return { type: "hasFeat", name: feat[1].trim(), option: feat[2] || undefined };

  return { type: "raw", text: c };
}

export function parsePrerequisites(str) {
  if (!str) return [];
  return str.split(/[,;]/).map(parsePrereqClause).filter(Boolean);
}

// Category-specific entry points — pure functions of the already-scraped
// `data` object, returning a full `mechanics` object (mechanics-schema.js).
export function deriveSpellMechanics(data) {
  const m = blankMechanics();
  m.range = parseRange(data.range);
  m.area = parseArea(data.area);
  m.duration = parseDuration(data.duration);
  m.savingThrow = parseSavingThrow(data.savingThrow);
  m.spellResistance = parseSpellResistance(data.spellResistance);
  if (data.targets) m.targeting = parseTargets(data.targets);
  else if (m.area) m.targeting = { type: "area", count: "all", constraints: [] };
  return m;
}

export function deriveFeatMechanics(data) {
  const m = blankMechanics();
  m.requirements = parsePrerequisites(data.prerequisites || data.prerequisite);
  if (data.combat) m.tags.push("combat");
  return m;
}

export function deriveMechanics(category, data) {
  if (category === "spell") return deriveSpellMechanics(data || {});
  if (category === "feat") return deriveFeatMechanics(data || {});
  return blankMechanics();
}
