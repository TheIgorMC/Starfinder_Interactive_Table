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

function modifierClaims(mechanics) {
  return (mechanics?.modifiers || []).map((m) => {
    const target = m.valueAffected ? `${m.valueAffected} (${m.effectType})` : m.effectType || "an unspecified target";
    return `A ${m.type || "untyped"} modifier of ${m.modifier} to ${target}${m.name ? ` ("${m.name}")` : ""}.`;
  });
}

function actionClaims(mechanics) {
  return (mechanics?.actions || [])
    .filter((a) => a.kind === "damage")
    .map((a) => `Deals ${a.formula} ${(a.damageTypes || []).join("/") || "untyped"} damage${a.onCritical ? " on a critical hit" : ""}.`);
}

export function buildItemAuditPrompt(entry) {
  const text = (entry.data?.effect || "").slice(0, 4000);
  const claimTexts = [...modifierClaims(entry.mechanics), ...actionClaims(entry.mechanics)];
  const claimMeta = claimTexts.map((text, i) => ({ n: i + 1, field: `mechanics[${i}]`, text }));

  const user = [
    `SOURCE TEXT ("${entry.name}", category: ${entry.category}):\n"""\n${text || "(no description text available)"}\n"""`,
    "",
    "CLAIMS TO VERIFY AGAINST THE SOURCE TEXT ABOVE (these come from a separate structured data field, not from this text):",
    ...claimTexts.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n");

  return {
    system:
      'You fact-check a structured summary against source text it was derived from. For each numbered claim, decide if the source text supports it. Respond with JSON: {"checks":[{"n":1,"verdict":"match|mismatch|uncertain","note":"short reason, especially if mismatch"}]}. Use "mismatch" ONLY when the text clearly states a different number/effect than the claim. Most flavor/item description text does NOT restate mechanical numbers at all — when the text simply doesn\'t mention the claim, that\'s "uncertain", never "mismatch". Be literal and conservative.',
    user,
    claimMeta,
  };
}

export function applyItemAuditResults(entry, checks, claimMeta) {
  const byN = new Map(claimMeta.map((c) => [c.n, c]));
  return (checks || [])
    .map((c) => {
      const meta = byN.get(c.n);
      if (!meta) return null;
      return { field: meta.field, claim: meta.text, verdict: c.verdict || "uncertain", note: c.note || "" };
    })
    .filter(Boolean);
}
