// Builds the fixed @-path namespace every Foundry-derived formula is
// written against (Docs/04-data-pipeline-aon.md → "The Modifiers
// system") from a `characters` row. Pure function, no side effects — the
// input to both the formula evaluator (formula-evaluator.js) and
// effective-stat computation (a later phase). See
// Docs/14-automated-rules-engine.md §4 for the shape this returns.

import { SKILL_NAMES } from "../foundry-import.js";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

// Reverse of SKILL_NAMES (abbr -> full name), reused rather than
// duplicated. characters.skills is keyed by the full skill name Hephaistos
// exports (confirmed live against Docs/Example-Hephaistos-Joe.json:
// {"skill": "Acrobatics", ...}, threaded through as-is by
// hephaistos.js:27-39), but every Foundry formula addresses a skill by its
// 3-letter abbreviation (@skills.acr.ranks) — this is the join between the
// two conventions.
const SKILL_ABBR_BY_NAME = Object.fromEntries(
  Object.entries(SKILL_NAMES).map(([abbr, name]) => [name, abbr])
);

function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

// characters.class is a free-text, possibly-multiclass display string
// ("Mechanic / Operative", joined by hephaistos.js:17) with no per-class
// level breakdown stored anywhere — 001_init.sql only has one flat
// `class`/`level` pair, not a classes[] table. A single-class character
// gets an accurate `classes` entry; a multiclass character's every class
// reports the character's *total* level, which overstates any class that
// isn't the character's only one. Flagged here rather than guessed at
// silently — fixing it needs a schema change, out of scope for this pure
// computation layer (see Docs/14-automated-rules-engine.md §9's resolved
// decisions for the kind of gap this is).
function classKeyFor(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildCharacterContext(character) {
  const abilities = {};
  for (const key of ABILITY_KEYS) {
    const value = character[key] ?? 10;
    abilities[key] = { value, mod: abilityMod(value) };
  }

  const classes = {};
  for (const name of (character.class || "").split("/").map((s) => s.trim()).filter(Boolean)) {
    classes[classKeyFor(name)] = { levels: character.level ?? 1 };
  }

  // A character with two different Profession/Perform-style specializations
  // (e.g. "Profession (Chef)" and "Profession (Pilot)") both collapse onto
  // the single `pro` abbreviation — Foundry's @-path convention has no way
  // to address a specific specialization, only the base skill. Last one
  // processed wins; a real limitation of the upstream formula vocabulary,
  // not something this function can resolve on its own.
  const skills = {};
  for (const [fullKey, s] of Object.entries(character.skills || {})) {
    const baseName = fullKey.includes(" (") ? fullKey.slice(0, fullKey.indexOf(" (")) : fullKey;
    const abbr = SKILL_ABBR_BY_NAME[baseName];
    if (!abbr) continue; // unrecognized skill name — no @-path target to key it under
    skills[abbr] = { ranks: s.ranks ?? 0, mod: s.total ?? 0 };
  }

  return {
    abilities,
    attributes: {
      baseAttackBonus: { value: character.bab ?? 0 },
      // Only land speed exists as a column (`characters.speed`) — no
      // flying/swimming/climbing/burrowing columns anywhere in the schema,
      // so a formula referencing those paths will correctly throw in
      // evaluateFormula rather than silently resolve to 0.
      speed: { land: { value: character.speed ?? 30 } },
    },
    details: {
      level: { value: character.level ?? 1 },
      // No per-class caster-level tracking exists yet (see the `classes`
      // caveat above) — best-effort default of total character level,
      // correct for a single-class caster, wrong for a multiclass
      // caster's actual caster level.
      cl: { value: character.level ?? 1 },
    },
    classes,
    skills,
    resources: {}, // class resource pools — deferred, Docs/14-automated-rules-engine.md §9
  };
}
