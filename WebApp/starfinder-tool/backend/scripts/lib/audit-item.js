// Grounded consistency checker for item-shaped aon-cache entries (feats,
// spells, weapons, armor, conditions, effects, and the rest of the
// equipment family) — same principle as audit-race.js (check derived
// fields against their OWN source text, not the model's memory of rules),
// applied to categories that never went through normalize-entries.js
// because there's no decomposition/linking problem for a single-concept
// item the way there is for a race's bundled traits. That reasoning was
// about *linking*, not *correctness* — "already structured" doesn't mean
// "already right", so this checks the same class of thing anyway: does
// `mechanics.modifiers[]`/`mechanics.actions[]` (damage) actually match
// what `data.effect`'s prose says.
//
// Real, load-bearing asymmetry, confirmed live: conditions/effects prose
// routinely restates exact numbers ("Prone: You take a –4 penalty to
// melee attack rolls" matches mechanics.modifiers exactly) — a genuinely
// groundable check. Most equipment prose (weapons, armor, magic items,
// goods) is pure flavor text with zero mechanical numbers in it at all —
// damage/price/bonuses only exist in the structured fields, confirmed
// live across weapon/armor/augmentation/magic/goods samples. For those,
// most claims will honestly come back "uncertain" (the text doesn't
// address it), which is correct — not a wasted check, since the prompt
// is explicit that silence isn't confirmation, and the rare case where a
// flavor blurb *does* state a number that contradicts the structured
// field is exactly the kind of thing worth catching.

import { SKILL_NAMES } from "../../src/foundry-import.js";

// Translates the internal effectType key into a phrase closer to how the
// rulebook prose would actually describe it — confirmed live this was a
// real, if minor, source of false "mismatch" verdicts: rendering the raw
// key "all-attacks" produced a claim the model read as contradicting a
// source sentence about "attack rolls," even though they mean the same
// thing (conditions/dazzled.json). Not exhaustive, just the values from
// Docs/04-data-pipeline-aon.md's "The Modifiers system" glossary.
const EFFECT_TYPE_PHRASES = {
  "all-skills": "all skill checks", "ability-skills": "skills based on that ability",
  saves: "all saving throws", save: "the specified saving throw", ac: "Armor Class",
  "all-attacks": "attack rolls", "melee-attacks": "melee attack rolls",
  "ranged-attacks": "ranged attack rolls", "weapon-attacks": "weapon attack rolls",
  "all-damage": "damage rolls", "melee-damage": "melee damage rolls", "weapon-damage": "weapon damage rolls",
  "energy-resistance": "energy resistance", "damage-reduction": "damage reduction",
  "specific-speed": "movement speed", "all-speeds": "movement speed",
  initiative: "initiative", cmd: "Combat Maneuver Defense", acp: "armor check penalty", bulk: "carrying capacity",
};

const SAVE_NAMES = { fort: "Fortitude", ref: "Reflex", will: "Will" };

// Same class of bug as EFFECT_TYPE_PHRASES above, one level down: for the
// *narrow* types ("skill"/"save", which are supposed to be narrowed by
// valueAffected — that's the whole point, unlike the broad types), the
// raw abbreviation code was being glued onto the raw phrase verbatim —
// "per" + "skill" -> "to per skill" — confirmed live across conditions/
// dazzled.json, /blinded.json, /asleep.json and others, all flagged as
// "mismatch" against prose that plainly says "Perception checks", simply
// because "per skill" isn't English. Reuses foundry-import.js's own
// SKILL_NAMES map rather than a second copy that could drift from it.
function describeTarget(effectType, valueAffected) {
  if (effectType === "skill" && valueAffected) return `${SKILL_NAMES[valueAffected] || valueAffected} checks`;
  if (effectType === "save" && valueAffected) return `${SAVE_NAMES[valueAffected] || valueAffected} saving throws`;
  // "fire energy resistance" (valueAffected + the generic phrase) reads as
  // redundant/awkward next to prose that just says "resistance to fire" —
  // confirmed live this alone didn't cause false mismatches the way the
  // skill/save gluing did, but it's the same class of avoidable awkward
  // phrasing, worth fixing while already in here.
  if (effectType === "energy-resistance" && valueAffected) return `resistance to ${valueAffected} damage`;
  const phrase = EFFECT_TYPE_PHRASES[effectType] || effectType || "an unspecified target";
  return valueAffected ? `${valueAffected} ${phrase}` : phrase;
}

// effectType values that already mean "applies broadly" — a modifier with
// one of these should have no valueAffected narrowing it (that's what the
// singular counterparts like "skill"/"save" are for). Confirmed live, a
// real bug in this file (not the data): blindly concatenating them
// produced nonsense like "per all skill checks" (valueAffected: "per" +
// effectType: "all-skills"), which the model correctly rejected — but
// rejecting a garbled sentence isn't the same as finding a real error,
// and this pattern alone accounted for the overwhelming majority of a
// 131-mismatch run that turned out to be mostly false signal. Fixed by
// never building a valueAffected-qualified sentence for these — if
// valueAffected is non-empty anyway, that's a genuine anomaly worth a
// human's attention, but a *silent, deterministic* one, not something to
// hand the LLM a broken sentence about and trust its verdict on.
const BROAD_EFFECT_TYPES = new Set(["all-skills", "saves", "all-attacks", "all-damage", "all-speeds", "damage-reduction"]);

function modifierClaims(mechanics) {
  const claims = [];
  const anomalies = [];
  for (const m of mechanics?.modifiers || []) {
    const isBroad = BROAD_EFFECT_TYPES.has(m.effectType);
    if (isBroad) {
      // Confirmed live (re-verified after the valueAffected-concatenation
      // fix above): even *without* a conflicting valueAffected, asserting
      // "all saving throws"/"all skill checks" for these effectTypes is
      // itself an overclaim more often than not — this Foundry dataset
      // uses "saves"/"all-skills" loosely, with the real (usually
      // narrower) scope living only in free-text `notes`, not in the
      // structured `condition` field. A live re-test (racial-features,
      // same seed) showed the LLM correctly rejecting "all saving throws"
      // against notes describing a specific narrower case (illusion
      // spells, aid-another checks, ...) for entries that had *no*
      // valueAffected conflict at all — a real claim-precision problem,
      // not a data bug, and not reliably distinguishable from a genuine
      // "yes this really is unconditional" trait without re-deriving
      // `condition` from `notes` (a bigger, separate fix). Rather than
      // keep producing LLM-checkable claims this data shape can't
      // reliably support, broad types are never sent to the LLM at all —
      // only the deterministic anomaly check below (a real, provable
      // contradiction) fires for them.
      if (m.valueAffected) {
        anomalies.push(
          `Modifier "${m.name || m.effectType}" has effectType "${m.effectType}" (implies "applies broadly") but also a non-empty valueAffected ("${m.valueAffected}") — contradictory on its face. Check by hand: notes say "${m.notes || "(no notes)"}".`,
        );
      }
      continue;
    }
    // "ac" is a different shape than the broad types above: valueAffected
    // of "both"/"eac"/"kac" is normal and expected there (it's which AC
    // this applies to, not a narrowing condition), so it's not flagged as
    // an anomaly. But the same trapped-in-`notes` condition problem still
    // applies — confirmed live even *after* adding an explicit "missing
    // conditions aren't mismatches" instruction to the system prompt
    // (below), the model still flagged battle-hardened.json/stable.json's
    // AC bonuses as "mismatch" because their real "against combat
    // maneuvers" qualifier isn't in the claim — the soft prompt-level fix
    // demonstrably isn't reliable enough on this model to trust here.
    // Skip these the same deterministic way as the broad types, rather
    // than keep sending a claim this data shape can't fairly support.
    if (m.effectType === "ac" && ["both", "eac", "kac"].includes(m.valueAffected)) continue;
    // The modifier's own display `name` used to be embedded inline in the
    // claim sentence ('... ("Perceptive")') — confirmed live this caused
    // the model to sometimes treat the label itself as an asserted fact
    // ("source specifies Perception and Sense Motive as separate skills,
    // not a single 'Perceptive' skill" — the name was never a skill name,
    // just a display label). Kept in claimMeta for the human-facing
    // findings output (still useful context there), but no longer sent as
    // part of what the LLM has to verify.
    const target = describeTarget(m.effectType, m.valueAffected);
    const conditionText = m.condition ? ` (only ${m.condition})` : "";
    claims.push({
      llmText: `A ${m.type || "untyped"} modifier of ${m.modifier} to ${target}${conditionText}.`,
      displayText: `A ${m.type || "untyped"} modifier of ${m.modifier} to ${target}${conditionText}${m.name ? ` ("${m.name}")` : ""}.`,
    });
  }
  return { claims, anomalies };
}

// Foundry formulas can be simple dice notation (verifiable against prose,
// which routinely states the same thing: "1d6 damage") or a real
// implementation expression (@-path lookups, lookupRange(), floor()/max())
// meant for a rules engine to evaluate, never restated in prose the same
// way. Confirmed live: sending the latter verbatim produced claims like
// "Deals 1d3 + @abilities.str.mod + lookupRange(@details.level.value, 0,
// 3, floor(@details.level.value / 2)) piercing damage" against prose that
// says "1-1/2 × level damage bonus" — the model correctly notes the prose
// doesn't use a lookupRange function, which is true but not a real
// discrepancy: it's comparing implementation syntax to a natural-language
// description of the same formula, a category error, not a value check.
// Only simple dice-notation formulas (optionally with a flat +/- modifier
// or multiple dice terms) go to the LLM; anything with `@` or a function
// call is skipped rather than fed a comparison it can't fairly make.
const SIMPLE_FORMULA_RE = /^[\d+\-\sd]+$/i;

function actionClaims(mechanics) {
  return (mechanics?.actions || [])
    .filter((a) => a.kind === "damage" && SIMPLE_FORMULA_RE.test(a.formula || ""))
    .map((a) => {
      const text = `Deals ${a.formula} ${(a.damageTypes || []).join("/") || "untyped"} damage${a.onCritical ? " on a critical hit" : ""}.`;
      return { llmText: text, displayText: text };
    });
}

export function buildItemAuditPrompt(entry) {
  const text = (entry.data?.effect || "").slice(0, 4000);
  const { claims: modClaims, anomalies } = modifierClaims(entry.mechanics);
  const allClaims = [...modClaims, ...actionClaims(entry.mechanics)];
  const claimMeta = allClaims.map((c, i) => ({ n: i + 1, field: `mechanics[${i}]`, text: c.displayText }));

  const user = [
    `SOURCE TEXT ("${entry.name}", category: ${entry.category}):\n"""\n${text || "(no description text available)"}\n"""`,
    "",
    "CLAIMS TO VERIFY AGAINST THE SOURCE TEXT ABOVE (these come from a separate structured data field, not from this text):",
    ...allClaims.map((c, i) => `${i + 1}. ${c.llmText}`),
  ].join("\n");

  return {
    system:
      // The "conditions aren't mismatches" sentence is the one fix that
      // generalizes across every "X but only against Y"/"X but only when
      // Z" false positive found this session (saves, ac, skills, ...) —
      // confirmed live those all share one root cause: the real condition
      // lives in a modifier's free-text `notes`, never in the structured
      // `condition` field, so a claim never states it. Telling the model
      // that's expected, not an error, is a general fix; excluding
      // specific effectTypes (still done above for cases with an
      // additionally-contradictory valueAffected) is a narrower patch for
      // a narrower problem.
      'You fact-check a structured summary against source text it was derived from. For each numbered claim, decide if the source text supports it. Respond with JSON: {"checks":[{"n":1,"verdict":"match|mismatch|uncertain","note":"short reason, especially if mismatch"}]}. Each claim states a value and what it applies to — it does NOT claim the effect is unconditional. If the source describes the same value/target but adds a condition or circumstance the claim doesn\'t mention (e.g. "only against combat maneuvers", "only when trained"), that is NOT a mismatch — conditions are simply outside what this claim asserts. A claim\'s bonus type (e.g. "untyped", "racial", "morale") is a game-mechanical classification that source text never states explicitly — rulebook text just says "+2 to X", never "+2 untyped bonus to X"; "untyped" specifically means no type word was used at all, so the source NOT naming a type is exactly what confirms "untyped", never a reason for "mismatch". Use "mismatch" ONLY when the source clearly states a different number, or a fundamentally different target (e.g. claim says Reflex save, source says Fortitude save). Most flavor/item description text does NOT restate mechanical numbers at all — when the text simply doesn\'t mention the claim at all, that\'s "uncertain", never "mismatch". Be literal and conservative.',
    user,
    claimMeta,
    anomalies,
  };
}

// `anomalies` are deterministic (no LLM call), so they always apply
// regardless of whether `checks` came back at all — a caller should merge
// them into the same findings list, distinguished by verdict "anomaly".
export function applyItemAuditResults(entry, checks, claimMeta, anomalies = []) {
  const anomalyEntries = anomalies.map((text) => ({ field: "mechanics", claim: text, verdict: "anomaly", note: "" }));
  const byN = new Map(claimMeta.map((c) => [c.n, c]));
  const checkEntries = (checks || [])
    .map((c) => {
      const meta = byN.get(c.n);
      if (!meta) return null;
      return { field: meta.field, claim: meta.text, verdict: c.verdict || "uncertain", note: c.note || "" };
    })
    .filter(Boolean);
  return [...anomalyEntries, ...checkEntries];
}
