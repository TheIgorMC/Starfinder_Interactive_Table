import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCharacterContext } from "./character-context.js";
import { evaluateFormula } from "./formula-evaluator.js";

// Shaped like a real `characters` row (001_init.sql columns) plus the
// `skills` JSONB shape hephaistos.js actually produces — see
// Docs/Example-Hephaistos-Joe.json for the source export this mirrors.
function baseCharacter(overrides = {}) {
  return {
    class: "Mechanic",
    level: 5,
    str: 14, dex: 18, con: 12, int: 16, wis: 10, cha: 8,
    bab: 3,
    speed: 30,
    skills: {
      Acrobatics: { total: 8, ranks: 5, ability: "Dexterity", classSkill: false, notes: "" },
      Computers: { total: 12, ranks: 5, ability: "Intelligence", classSkill: true, notes: "" },
      "Profession (Chef)": { total: 4, ranks: 1, ability: "Wisdom", classSkill: false, notes: "" },
    },
    ...overrides,
  };
}

test("ability scores and modifiers", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.deepEqual(ctx.abilities.str, { value: 14, mod: 2 });
  assert.deepEqual(ctx.abilities.dex, { value: 18, mod: 4 });
  assert.deepEqual(ctx.abilities.cha, { value: 8, mod: -1 }); // odd score rounds down
});

test("attributes.baseAttackBonus and land speed", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.equal(ctx.attributes.baseAttackBonus.value, 3);
  assert.equal(ctx.attributes.speed.land.value, 30);
});

test("details.level and the single-class caster-level default", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.equal(ctx.details.level.value, 5);
  assert.equal(ctx.details.cl.value, 5);
});

test("single class maps to classes[key].levels", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.deepEqual(ctx.classes, { mechanic: { levels: 5 } });
});

test("multiclass splits on the Hephaistos ' / ' join, both report total level", () => {
  const ctx = buildCharacterContext(baseCharacter({ class: "Mechanic / Operative", level: 7 }));
  assert.deepEqual(ctx.classes, { mechanic: { levels: 7 }, operative: { levels: 7 } });
});

test("skills resolve by Foundry abbreviation from the full Hephaistos name", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.deepEqual(ctx.skills.acr, { ranks: 5, mod: 8 });
  assert.deepEqual(ctx.skills.com, { ranks: 5, mod: 12 });
});

test("a Profession specialization still resolves under the bare 'pro' abbreviation", () => {
  const ctx = buildCharacterContext(baseCharacter());
  assert.deepEqual(ctx.skills.pro, { ranks: 1, mod: 4 });
});

test("missing/empty character fields fall back to sane defaults", () => {
  const ctx = buildCharacterContext({});
  assert.equal(ctx.abilities.str.value, 10);
  assert.equal(ctx.attributes.baseAttackBonus.value, 0);
  assert.deepEqual(ctx.classes, {});
  assert.deepEqual(ctx.skills, {});
  assert.deepEqual(ctx.resources, {});
});

test("composes directly with evaluateFormula", () => {
  const ctx = buildCharacterContext(baseCharacter());
  // BAB 3 -> max(1, floor(3/2)) = 1
  assert.equal(evaluateFormula("max(1, floor(@attributes.baseAttackBonus.value/2))", ctx), 1);
});
