// Structured, machine-readable mechanics for an aon_entries row, stored in
// its `mechanics` JSONB column alongside the existing free-text `data`.
// This is the "categorization" layer a future character engine can consume
// directly (e.g. "how many targets can this spell hit, and under what
// distance constraint") instead of re-parsing prose at runtime.
//
// Deliberately a loose set of tagged unions, not a rigid enum-checked
// schema: `kind`/`type` accept any string so new mechanical concepts don't
// require a migration or a code change to represent (a curator can always
// write one by hand), but every node shape below is what the built-in
// parser (mechanics-parser.js) and the Compendium UI know how to read.
// Anything not confidently parsed still gets a `{ type: "raw", text }` (or
// `{ kind: "narrative", text }`) node so no information is silently lost.
//
// mechanics: {
//   version: 1,
//   targeting: { type, count: {min,max}|null, constraints: [Condition] } | null,
//   range: { unit, value?, category?, perLevel? } | null,
//   area: { shape, size, unit } | null,
//   duration: { unit, value?, formula?, perLevel?, dismissible? } | null,
//   savingThrow: { type, effects: [string] } | null,
//   spellResistance: { applies, harmless? } | null,
//   activation: { type, cost?, condition? } | null,
//   actions: [Effect],
//   requirements: [Condition],
//   modifiers: [Modifier],
//   abilityModifiers: [{ ability, value }],
//   armorClass: { type, eac, kac, maxDex, acp, speedAdjust, upgradeSlots } | null,
//   weaponProperties: [string],
//   tags: [string],
// }
//
// armorClass is separate from `modifiers` on purpose: Foundry's own armor
// items apply their EAC/KAC bonus through a dedicated `armor` field, not
// through the generic Modifiers system, so this preserves that distinction
// rather than force-fitting it into a Modifier.
//
// Effect: { kind: "damage"|"conditionInflict"|"bonus"|"grantAbility"|"narrative"|<custom>, ...params }
// Condition: { type: "abilityScore"|"minLevel"|"babMin"|"hasFeat"|"maxDistanceBetweenTargets"
//              |"savingThrowFailed"|"and"|"or"|"raw"|<custom>, ...params }
//
// Modifier: a pre-designed, formula-capable bonus, in the same shape the
// community FoundryVTT Starfinder system uses (see mechanics-parser.js's
// Foundry import) — kept close to verbatim rather than reinterpreted, since
// it's already exactly the "parametrized effect" a character engine needs:
// { name, type ("untyped"|"circumstance"|"racial"|...), effectType
//   (what it modifies, e.g. "all-attacks"/"skill"/"save"), valueAffected,
//   modifier (a formula string, e.g. "-2" or "max(1, floor(@attributes.
//   baseAttackBonus.value/2))" — @-prefixed paths refer to character sheet
//   attributes), modifierType ("formula"|"constant"), max, condition,
//   enabled, notes, source }
//
// IMPORTANT for anything that sums these into a character sheet: `type` is
// the SF1e bonus type, and same-type bonuses from different sources don't
// stack (take the highest) — except "untyped"/"circumstance"/"dodge",
// which always stack. Group active modifiers by (effectType, type) and
// take the max within each typed group before summing across groups.
// See Docs/04-data-pipeline-aon.md → "Foundry import" → "The Modifiers
// system" for the full `@`-path and `effectType`/`type` glossary (derived
// from what's actually present across the 8,921 imported entries).

export const SCHEMA_VERSION = 1;

export function blankMechanics() {
  return {
    version: SCHEMA_VERSION,
    targeting: null,
    range: null,
    area: null,
    duration: null,
    savingThrow: null,
    spellResistance: null,
    activation: null,
    actions: [],
    requirements: [],
    modifiers: [],
    abilityModifiers: [],
    armorClass: null,
    weaponProperties: [],
    tags: [],
  };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Fills in defaults for any missing top-level keys — lets consumers do
// `mechanics.actions.map(...)` without null-checking every field.
export function normalizeMechanics(raw) {
  const base = blankMechanics();
  if (!isPlainObject(raw)) return base;
  return {
    ...base,
    ...raw,
    version: SCHEMA_VERSION,
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    modifiers: Array.isArray(raw.modifiers) ? raw.modifiers : [],
    abilityModifiers: Array.isArray(raw.abilityModifiers) ? raw.abilityModifiers : [],
    weaponProperties: Array.isArray(raw.weaponProperties) ? raw.weaponProperties : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

// Structural validation only (right shape for the node's own kind/type) —
// does not enforce a closed vocabulary, so custom kinds/types always pass
// as long as they carry the generic shape a tagged union needs.
function checkCondition(c, path, errors) {
  if (!isPlainObject(c)) { errors.push(`${path}: condition must be an object`); return; }
  if (typeof c.type !== "string" || !c.type) { errors.push(`${path}: condition.type must be a non-empty string`); return; }
  if ((c.type === "and" || c.type === "or")) {
    if (!Array.isArray(c.conditions)) errors.push(`${path}: "${c.type}" condition needs a conditions[] array`);
    else c.conditions.forEach((sub, i) => checkCondition(sub, `${path}.conditions[${i}]`, errors));
  }
  if (c.type === "raw" && typeof c.text !== "string") errors.push(`${path}: "raw" condition needs a text string`);
}

function checkEffect(e, path, errors) {
  if (!isPlainObject(e)) { errors.push(`${path}: effect must be an object`); return; }
  if (typeof e.kind !== "string" || !e.kind) { errors.push(`${path}: effect.kind must be a non-empty string`); return; }
  if (e.kind === "narrative" && typeof e.text !== "string") errors.push(`${path}: "narrative" effect needs a text string`);
  if (e.appliesWhen != null) checkCondition(e.appliesWhen, `${path}.appliesWhen`, errors);
}

function checkModifier(m, path, errors) {
  if (!isPlainObject(m)) { errors.push(`${path}: modifier must be an object`); return; }
  if (typeof m.name !== "string" || !m.name) errors.push(`${path}: modifier.name must be a non-empty string`);
  if (m.modifier == null || (typeof m.modifier !== "string" && typeof m.modifier !== "number")) {
    errors.push(`${path}: modifier.modifier (the formula/value) is required`);
  }
}

function checkAbilityModifier(m, path, errors) {
  if (!isPlainObject(m)) { errors.push(`${path}: ability modifier must be an object`); return; }
  if (typeof m.ability !== "string" || !m.ability) errors.push(`${path}: ability must be a non-empty string`);
  if (typeof m.value !== "number") errors.push(`${path}: value must be a number`);
}

export function validateMechanics(mechanics) {
  const errors = [];
  if (mechanics == null) return errors; // absent/empty is always valid — categorization is opt-in per entry
  if (!isPlainObject(mechanics)) { errors.push("mechanics must be an object"); return errors; }

  if (mechanics.targeting != null) {
    const t = mechanics.targeting;
    if (!isPlainObject(t)) errors.push("targeting must be an object");
    else {
      if (t.count != null && typeof t.count !== "string" && !isPlainObject(t.count)) {
        errors.push('targeting.count must be an object ({min,max}) or the string "all"');
      }
      (t.constraints || []).forEach((c, i) => checkCondition(c, `targeting.constraints[${i}]`, errors));
    }
  }
  if (mechanics.range != null && (!isPlainObject(mechanics.range) || typeof mechanics.range.unit !== "string")) {
    errors.push("range must be an object with a unit");
  }
  if (mechanics.duration != null && (!isPlainObject(mechanics.duration) || typeof mechanics.duration.unit !== "string")) {
    errors.push("duration must be an object with a unit");
  }
  if (mechanics.savingThrow != null && (!isPlainObject(mechanics.savingThrow) || typeof mechanics.savingThrow.type !== "string")) {
    errors.push("savingThrow must be an object with a type");
  }
  if (mechanics.activation != null && (!isPlainObject(mechanics.activation) || typeof mechanics.activation.type !== "string")) {
    errors.push("activation must be an object with a type");
  }
  if (mechanics.armorClass != null && (!isPlainObject(mechanics.armorClass) || typeof mechanics.armorClass.type !== "string")) {
    errors.push("armorClass must be an object with a type");
  }
  (mechanics.actions || []).forEach((e, i) => checkEffect(e, `actions[${i}]`, errors));
  (mechanics.requirements || []).forEach((c, i) => checkCondition(c, `requirements[${i}]`, errors));
  (mechanics.modifiers || []).forEach((m, i) => checkModifier(m, `modifiers[${i}]`, errors));
  (mechanics.abilityModifiers || []).forEach((m, i) => checkAbilityModifier(m, `abilityModifiers[${i}]`, errors));

  return errors;
}
