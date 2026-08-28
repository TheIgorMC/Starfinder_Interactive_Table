// A small, sandboxed evaluator for the formula strings Foundry-sourced
// Modifiers/durations carry (e.g. "max(1, floor(@attributes.
// baseAttackBonus.value/2))" — Deadly Aim's damage bonus), per
// Docs/14-automated-rules-engine.md §4.1.
//
// Deliberately not eval() — a restricted recursive-descent parser over a
// fixed grammar: @-path lookups against a Character Context
// (character-context.js), +-*/ arithmetic, the math/comparison/lookup
// functions below, and dice notation (both literal "1d6" and computed,
// e.g. "(floor(@item.level/3))d4") as a formula component *the system*
// resolves for itself (a spell's duration in rounds, a scaling DC) —
// never a substitute for a physical die roll a player is expected to
// make and report at the table. Anything outside this grammar (property
// access, string literals, arbitrary function calls) is a syntax error,
// not a silent no-op — see the doc's §4.1 for why that distinction
// matters.
//
// The function set below isn't guessed — the doc's original scope
// (arithmetic + max/min/floor/ceil + dice) covered barely half of the
// real formula strings across aon-cache when checked against all 184
// distinct @-formulas in mechanics.modifiers[]/mechanics.duration:
// lookupRange/ternary/gt/gte/lt/lte/eq/ne/round/sign are all real and
// common (Solarian/Envoy/Operative/Evolutionist/Nanocyte scaling
// formulas lean on them heavily). lookupRange/lookup/eq/gt/gte/lt/lte/ne/
// ternary are ported verbatim from the Foundry system's own
// `Roll.registerMathFunctions()` (src/module/rolls/roll.js:91-124 in the
// local checkout) rather than reimplemented from a guess at their
// semantics.
const FUNCTIONS = {
  max: (...args) => Math.max(...args),
  min: (...args) => Math.min(...args),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  sign: (x) => Math.sign(x),
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  ternary: (condition, ifTrue, ifFalse) => (condition ? ifTrue : ifFalse),
  // value, key1, result1, key2, result2, ... -> the result paired with the
  // first key that === value, or 0 if none match.
  lookup: (value, ...pairs) => {
    for (let i = 0; i < pairs.length - 1; i += 2) {
      if (pairs[i] === value) return pairs[i + 1];
    }
    return 0;
  },
  // value, lowestValue, threshold1, result1, threshold2, result2, ... ->
  // a step function: the result attached to the highest threshold that is
  // NOT greater than value, starting from lowestValue.
  lookupRange: (value, lowestValue, ...pairs) => {
    let base = lowestValue;
    for (let i = 0; i < pairs.length - 1; i += 2) {
      if (pairs[i] > value) return base;
      base = pairs[i + 1];
    }
    return base;
  },
};

function tokenize(formula) {
  const tokens = [];
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === "@") {
      const m = /^@[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/.exec(formula.slice(i));
      if (!m) throw new Error(`evaluateFormula: malformed @-path at position ${i} in "${formula}"`);
      tokens.push({ type: "atpath", value: m[0] });
      i += m[0].length;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const m = /^\d+d\d+|^\d+(?:\.\d+)?/.exec(formula.slice(i));
      const raw = m[0];
      tokens.push(raw.includes("d") ? { type: "dice", value: raw } : { type: "number", value: Number(raw) });
      i += raw.length;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      // "d6"/"d4" right after a parenthesized/computed dice count (e.g.
      // "(floor(@item.level/3))d4") must tokenize as the dice operator
      // "d" plus a separate number "4", not one identifier "d4" — split
      // it explicitly before falling through to generic identifier
      // scanning, which would otherwise swallow it whole.
      const diceOp = /^d(\d+)(?![A-Za-z0-9_])/.exec(formula.slice(i));
      if (diceOp) {
        tokens.push({ type: "ident", value: "d" });
        tokens.push({ type: "number", value: Number(diceOp[1]) });
        i += diceOp[0].length;
        continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i));
      tokens.push({ type: "ident", value: m[0] });
      i += m[0].length;
      continue;
    }

    if ("()+-*/,".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    throw new Error(`evaluateFormula: unexpected character "${ch}" at position ${i} in "${formula}"`);
  }
  return tokens;
}

function parse(tokens, formula) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isPunct = (t, v) => !!t && t.type === "punct" && t.value === v;

  function expectPunct(v) {
    const t = next();
    if (!t || t.type !== "punct" || t.value !== v) {
      throw new Error(`evaluateFormula: expected "${v}" in "${formula}"`);
    }
  }

  function parseExpression() {
    let node = parseTerm();
    while (isPunct(peek(), "+") || isPunct(peek(), "-")) {
      const op = next().value;
      node = { type: "binop", op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    while (isPunct(peek(), "*") || isPunct(peek(), "/")) {
      const op = next().value;
      node = { type: "binop", op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary() {
    if (isPunct(peek(), "-")) {
      next();
      return { type: "negate", operand: parseUnary() };
    }
    if (isPunct(peek(), "+")) {
      next(); // leading "+" is a no-op — seen on real modifier formulas
      return parseUnary();
    }
    return parseDiceTerm();
  }

  // count 'd' sides, where both sides of the operator are themselves
  // factors (a number, an @-path, a function call, or a parenthesized
  // expression) — covers computed dice like "(floor(@item.level/3))d4"
  // or "1d(ternary(...))" on top of the tokenizer's literal "1d6" fast
  // path (handled below as its own token type).
  function parseDiceTerm() {
    let node = parseFactor();
    if (peek() && peek().type === "ident" && peek().value === "d") {
      next();
      const sides = parseFactor();
      node = { type: "diceExpr", count: node, sides };
    }
    return node;
  }

  function parseFactor() {
    const t = peek();
    if (!t) throw new Error(`evaluateFormula: unexpected end of formula "${formula}"`);

    if (t.type === "number") { next(); return { type: "number", value: t.value }; }
    if (t.type === "dice") { next(); return { type: "dice", value: t.value }; }
    if (t.type === "atpath") { next(); return { type: "atpath", value: t.value }; }

    if (t.type === "ident") {
      next();
      expectPunct("(");
      const args = [];
      if (!isPunct(peek(), ")")) {
        args.push(parseExpression());
        while (isPunct(peek(), ",")) {
          next();
          args.push(parseExpression());
        }
      }
      expectPunct(")");
      return { type: "call", name: t.value, args };
    }

    if (isPunct(t, "(")) {
      next();
      const node = parseExpression();
      expectPunct(")");
      return node;
    }

    throw new Error(`evaluateFormula: unexpected token "${t.value}" in "${formula}"`);
  }

  const ast = parseExpression();
  if (pos !== tokens.length) {
    throw new Error(`evaluateFormula: unexpected trailing input near "${tokens[pos].value}" in "${formula}"`);
  }
  return ast;
}

function resolvePath(context, path) {
  const segments = path.slice(1).split(".");
  let node = context;
  for (const seg of segments) {
    if (node == null || typeof node !== "object" || !(seg in node)) {
      throw new Error(`evaluateFormula: unknown path "${path}"`);
    }
    node = node[seg];
  }
  if (typeof node !== "number") {
    throw new Error(`evaluateFormula: path "${path}" did not resolve to a number (got ${JSON.stringify(node)})`);
  }
  return node;
}

function rollDice(count, sides, rng) {
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(rng() * sides) + 1;
  return total;
}

function evalNode(node, context, rng) {
  switch (node.type) {
    case "number": return node.value;
    case "atpath": return resolvePath(context, node.value);
    case "dice": {
      const [count, sides] = node.value.split("d").map(Number);
      return rollDice(count, sides, rng);
    }
    case "diceExpr":
      return rollDice(evalNode(node.count, context, rng), evalNode(node.sides, context, rng), rng);
    case "negate": return -evalNode(node.operand, context, rng);
    case "binop": {
      const l = evalNode(node.left, context, rng);
      const r = evalNode(node.right, context, rng);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      return l / r; // "/"
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`evaluateFormula: unknown function "${node.name}"`);
      return fn(...node.args.map((a) => evalNode(a, context, rng)));
    }
    default:
      throw new Error(`evaluateFormula: internal error, unknown node type "${node.type}"`);
  }
}

// context: a Character Context from character-context.js (or any plain
// object with the same @-path shape). rng: injectable for deterministic
// tests of dice-bearing formulas — defaults to Math.random.
export function evaluateFormula(formula, context, { rng = Math.random } = {}) {
  if (typeof formula !== "string" || !formula.trim()) {
    throw new Error("evaluateFormula: formula must be a non-empty string");
  }
  const tokens = tokenize(formula);
  const ast = parse(tokens, formula);
  return evalNode(ast, context, rng);
}
