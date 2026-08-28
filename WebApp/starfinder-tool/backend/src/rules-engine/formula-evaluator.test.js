import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "./formula-evaluator.js";

const ctx = {
  attributes: { baseAttackBonus: { value: 7 } },
  details: { level: { value: 5 }, cl: { value: 5 } },
  abilities: { str: { value: 18, mod: 4 } },
};

test("plain arithmetic respects operator precedence", () => {
  assert.equal(evaluateFormula("2 + 3 * 4", ctx), 14);
});

test("parentheses override precedence", () => {
  assert.equal(evaluateFormula("(2 + 3) * 4", ctx), 20);
});

test("@-path lookup", () => {
  assert.equal(evaluateFormula("@attributes.baseAttackBonus.value", ctx), 7);
});

test("Deadly Aim's actual formula, high BAB", () => {
  assert.equal(evaluateFormula("max(1, floor(@attributes.baseAttackBonus.value/2))", ctx), 3);
});

test("Deadly Aim's actual formula, BAB=1 clamps to the floor of 1", () => {
  const lowCtx = { attributes: { baseAttackBonus: { value: 1 } } };
  assert.equal(evaluateFormula("max(1, floor(@attributes.baseAttackBonus.value/2))", lowCtx), 1);
});

test("nested ability-mod path in a larger expression", () => {
  assert.equal(evaluateFormula("@abilities.str.mod + 2", ctx), 6);
});

test("unary negation", () => {
  assert.equal(evaluateFormula("-@abilities.str.mod", ctx), -4);
});

test("dice notation resolves via an injected rng, not Math.random", () => {
  const fixedRng = () => 0.5; // floor(0.5*6)+1 = 4 per die
  assert.equal(evaluateFormula("3d6", ctx, { rng: fixedRng }), 12);
});

test("dice notation composes with arithmetic", () => {
  const fixedRng = () => 0.999999; // floor(5.999994)+1 = 6 per die
  assert.equal(evaluateFormula("1d6 + 2", ctx, { rng: fixedRng }), 8);
});

test("min() and ceil()", () => {
  assert.equal(evaluateFormula("min(3, 9)", ctx), 3);
  assert.equal(evaluateFormula("ceil(4.1)", ctx), 5);
});

test("unknown @-path throws rather than resolving to 0", () => {
  assert.throws(() => evaluateFormula("@attributes.speed.flying.value", ctx), /unknown path/i);
});

test("unknown function throws", () => {
  assert.throws(() => evaluateFormula("bogus(1)", ctx), /unknown function/i);
});

test("truncated formula throws", () => {
  assert.throws(() => evaluateFormula("2 +", ctx));
});

test("not eval() — property access and string literals are syntax errors, not silent no-ops", () => {
  assert.throws(() => evaluateFormula("process.exit()", ctx));
  assert.throws(() => evaluateFormula("require('fs')", ctx));
});

test("empty formula throws", () => {
  assert.throws(() => evaluateFormula("", ctx));
  assert.throws(() => evaluateFormula("   ", ctx));
});

// The functions/operators below were missing from an earlier draft of
// this evaluator and were only found by checking all 184 distinct
// @-formulas actually present across aon-cache — see the module
// docblock. lookupRange/lookup/eq/gt/gte/lt/lte/ne/ternary are ported
// verbatim from the Foundry system's own Roll.registerMathFunctions()
// (src/module/rolls/roll.js in the local checkout), not reimplemented
// from a guess.

test("lookupRange matches a real Foundry scaling table (a resolve/level-esque step function)", () => {
  // lookupRange(value, lowestValue, t1, r1, t2, r2, ...): the result
  // attached to the highest threshold that is NOT greater than value.
  const f = "lookupRange(@details.level.value, 0, 9, 10, 12, 15, 16, 20, 20, 25)";
  assert.equal(evaluateFormula(f, { details: { level: { value: 1 } } }), 0); // below first threshold -> lowestValue
  assert.equal(evaluateFormula(f, { details: { level: { value: 9 } } }), 10); // exactly on a threshold rounds up
  assert.equal(evaluateFormula(f, { details: { level: { value: 12 } } }), 15);
  assert.equal(evaluateFormula(f, { details: { level: { value: 25 } } }), 25); // past the last threshold -> last result
});

test("lookup returns the paired result, or 0 if nothing matches", () => {
  assert.equal(evaluateFormula("lookup(2, 1, 10, 2, 20, 3, 30)", ctx), 20);
  assert.equal(evaluateFormula("lookup(9, 1, 10, 2, 20)", ctx), 0);
});

test("ternary + comparison functions, an actual Envoy feature's shape", () => {
  const f = "ternary(gte(@classes.envoy.levels, 13), 8, 6)";
  assert.equal(evaluateFormula(f, { classes: { envoy: { levels: 13 } } }), 8);
  assert.equal(evaluateFormula(f, { classes: { envoy: { levels: 5 } } }), 6);
});

test("gt/lt/eq/ne resolve as real booleans, usable directly in arithmetic", () => {
  assert.equal(evaluateFormula("gt(5, 3)", ctx), true);
  assert.equal(evaluateFormula("lt(5, 3)", ctx), false);
  assert.equal(evaluateFormula("1 + eq(2, 2)", ctx), 2); // true coerces to 1
  assert.equal(evaluateFormula("1 + ne(2, 2)", ctx), 1); // false coerces to 0
});

test("round and sign", () => {
  assert.equal(evaluateFormula("round(4.5)", ctx), 5);
  assert.equal(evaluateFormula("sign(-3)", ctx), -1);
});

test("leading unary + is a no-op, seen on real modifier formulas", () => {
  assert.equal(evaluateFormula("+@abilities.str.mod", ctx), 4);
  assert.equal(evaluateFormula("+ @abilities.str.mod - 1", ctx), 3);
});

test("computed dice count and sides, e.g. a Solarian's (floor(@item.level/3))d4", () => {
  const fixedRng = () => 0.99; // floor(0.99*4)+1 = 4 per die
  assert.equal(evaluateFormula("(floor(@item.level / 3))d4", { item: { level: 9 } }, { rng: fixedRng }), 12);
});

test("computed dice sides only, e.g. an Operative's 1d(ternary(...))", () => {
  const fixedRng = () => 0.99; // floor(0.99*8)+1 = 8
  const f = "1d(ternary(gte(@classes.envoy.levels, 13), 8, 6))";
  assert.equal(evaluateFormula(f, { classes: { envoy: { levels: 13 } } }, { rng: fixedRng }), 8);
});
