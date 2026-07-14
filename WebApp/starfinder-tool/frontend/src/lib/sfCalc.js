// Shared SF1e math for the character creation wizard (and anything else
// that needs to derive stats from race/theme/class/ability scores).
// Formulas come from AoN Chapter 2 — see docs/09-character-creation-flow.md.

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_LABELS = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

const FULL_TO_SHORT = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha",
};

export function abilityShort(fullOrShort) {
  const s = (fullOrShort || "").toLowerCase().trim();
  return FULL_TO_SHORT[s] || (ABILITIES.includes(s) ? s : null);
}

// AoN "Ability Quick Picks" — race/theme adjustments don't apply under
// this method, you just assign the array's values freely.
export const QUICK_ARRAYS = {
  focused: { label: "Focused (18, 14, 11, 10, 10, 10)", values: [18, 14, 11, 10, 10, 10] },
  split: { label: "Split (16, 16, 11, 10, 10, 10)", values: [16, 16, 11, 10, 10, 10] },
  versatile: { label: "Versatile (14, 14, 14, 11, 10, 10)", values: [14, 14, 14, 11, 10, 10] },
};

export const POINT_BUY_POOL = 10;
export const SCORE_CAP = 18;

export function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

export function fmtMod(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

// mechanics.abilityModifiers entries look like { ability: "strength"|"any", value: 2 }.
// "any" adjustments are the player's choice (human, themeless, etc.) — resolved
// via `anyAbility` (a short ability key) supplied by the caller.
export function applyAbilityModifiers(baseline, modifiers, anyAbility) {
  const out = { ...baseline };
  for (const m of modifiers || []) {
    const target = m.ability === "any" ? anyAbility : abilityShort(m.ability);
    if (target && out[target] != null) out[target] += m.value;
  }
  return out;
}

export function hasAnyAbilityChoice(modifiers) {
  return (modifiers || []).some((m) => m.ability === "any");
}

// BAB progression labels as stored in aon class data.baseAttackBonus.
export function babForLevel(progression, level) {
  const p = (progression || "").toLowerCase();
  if (p === "full") return level;
  if (p === "moderate" || p === "3/4") return Math.floor((level * 3) / 4);
  return Math.floor(level / 2); // slow / 1/2
}

// data.savingThrows looks like "Fort: fast, Ref: slow, Will: fast".
export function parseSaveProgressions(savingThrows) {
  const out = { fort: "slow", ref: "slow", will: "slow" };
  for (const part of (savingThrows || "").split(",")) {
    const m = part.match(/(Fort|Ref|Will)\s*:\s*(fast|slow)/i);
    if (m) out[m[1].toLowerCase()] = m[2].toLowerCase();
  }
  return out;
}

export function saveBonusForLevel(progression, level) {
  return progression === "fast" ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
}

export function keyAbilityOptions(keyAbilityScore) {
  // "strength" -> ["str"], "strength or dexterity" -> ["str", "dex"]
  return (keyAbilityScore || "")
    .split(/\s+or\s+/i)
    .map((s) => abilityShort(s.trim()))
    .filter(Boolean);
}

// Standard SF1e skill list (Core Rulebook pg. 20). Profession's key ability
// varies by the specific profession chosen — defaulted to "wis" here since
// there's no per-skill UI for it, but that's noted wherever it's shown.
export const SKILLS = [
  ["Acrobatics", "dex"], ["Athletics", "str"], ["Bluff", "cha"], ["Computers", "int"],
  ["Culture", "int"], ["Diplomacy", "cha"], ["Disguise", "cha"], ["Engineering", "int"],
  ["Intimidate", "cha"], ["Life Science", "int"], ["Medicine", "int"], ["Mysticism", "wis"],
  ["Perception", "wis"], ["Physical Science", "int"], ["Piloting", "dex"],
  ["Profession", "wis"], ["Sense Motive", "wis"], ["Sleight of Hand", "dex"],
  ["Stealth", "dex"], ["Survival", "wis"],
];

export function classSkillSet(classSkillsField) {
  return new Set((classSkillsField || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// Derived stats for a freshly-created character at `level`, given final
// ability scores and the chosen race/class data. Matches AoN steps 6 & 9.
export function deriveStats({ level, scores, raceHitPoints, klass, keyAbility }) {
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(scores[a])]));
  const hpPerLevel = klass?.hitPointsPerLevel || 0;
  const spPerLevel = klass?.staminaPointsPerLevel || 0;
  const skillPerLevel = klass?.skillRanksPerLevel || 0;
  const saves = parseSaveProgressions(klass?.savingThrows);

  const hpMax = (raceHitPoints || 0) + hpPerLevel * level;
  const spMax = level * Math.max(0, spPerLevel + mods.con);
  const rpMax = Math.max(1, Math.floor(level / 2) + (mods[keyAbility] ?? 0));
  const skillRanksTotal = level * Math.max(1, skillPerLevel + mods.int);

  return {
    mods,
    hp_max: hpMax, hp_cur: hpMax,
    sp_max: spMax, sp_cur: spMax,
    rp_max: rpMax, rp_cur: rpMax,
    eac: 10 + mods.dex,
    kac: 10 + mods.dex,
    bab: babForLevel(klass?.baseAttackBonus, level),
    save_fort: saveBonusForLevel(saves.fort, level) + mods.con,
    save_ref: saveBonusForLevel(saves.ref, level) + mods.dex,
    save_will: saveBonusForLevel(saves.will, level) + mods.wis,
    init_bonus: mods.dex,
    speed: 30,
    skillRanksTotal,
  };
}
