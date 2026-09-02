// Grounded consistency checker for the RAW aon-cache/races/*.json entries —
// distinct from audit-race.js, which checks the *normalized draft* at
// DataEntry/output/races/*.json instead. The two are different pipelines
// writing different files: normalize-entries.js's draft decomposes a race
// into ability_modifiers/size/traits/alternate_traits, built for an
// in-progress authoring workflow, but nothing imports that draft anywhere —
// not into the database, not back into aon-cache. What import-aon-cache.js
// actually pushes into the live `aon_entries` table (what the app serves)
// is the raw Foundry-shaped entry: a single `data.effect` prose blob plus
// `mechanics.abilityModifiers` (an [{ability, value}] array) and
// `mechanics.tags` (creature type/subtype strings) — no separate `size`
// field, no decomposed trait list at all. Confirmed live: `mechanics.
// modifiers` is empty on every race checked, so traits exist only as
// unparsed prose here, nothing to build a checkable claim from.
//
// So this only checks what the raw shape actually has to check: ability
// score adjustments, the one piece of race mechanics guaranteed to appear
// both in `mechanics.abilityModifiers` and restated in the race's own
// prose. Reuses the same "Ability Adjustments/Modifiers ... Alternate
// Traits" region-extraction regex proven out in audit-race.js, applied
// directly to `data.effect` instead of a pre-split rulebook-section field
// (the raw entry doesn't have those separate fields — it's one string).

const ALTERNATE_TRAITS_RE = /Alternate\s+\w*\s*Traits?\b/i;
const ABILITY_WORD_RE = /(?:strength|dexterity|constitution|intelligence|wisdom|charisma)/i;

// A named variant's own file (e.g. "Osharu (Gengen)", "Kasatha (Nomad)")
// bundles the ENTIRE base race's page as its `data.effect` — including the
// base race's own generic "Ability Adjustments" line near the top — with
// the variant's own specific numbers appearing much later, under an
// "Alternate Ability Adjustments" heading, in a short paragraph named
// after the variant (e.g. "A gengen osharu's ability adjustments are +2
// Strength, +2 Intelligence, –2 Dexterity."). A naive "find the first
// 'Ability Adjustments' occurrence" (the approach that works fine for
// audit-race.js's already-narrowed rulebook-section fields) grabs the
// base race's generic line instead — confirmed live across ~24 variant
// races, all initially "mismatch" for this reason alone, not a real data
// problem. Extracts the variant name from the file's own `name` field
// (the parenthetical, or the segment after the last comma inside it for
// nested variants like "Lashunta (Damaya, Hunter Legacy)" → "Hunter
// Legacy") and finds THAT specific paragraph instead.
function extractVariantName(name) {
  const paren = /\(([^)]+)\)/.exec(name || "");
  if (!paren) return null;
  const parts = paren[1].split(",").map((s) => s.trim());
  return parts[parts.length - 1];
}

function abilityRegionText(effect, raceName) {
  if (!effect) return "";
  const variant = extractVariantName(raceName);
  if (variant) {
    // Search every occurrence of the variant name for one followed
    // (within a short window) by an actual ability-score sentence —
    // not just the heading that names the variant, which can appear
    // earlier as a passing reference (e.g. a "this replaces X" note).
    const nameRe = new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m;
    let best = null;
    while ((m = nameRe.exec(effect))) {
      const windowEnd = Math.min(effect.length, m.index + 500);
      const window = effect.slice(m.index, windowEnd);
      if (ABILITY_WORD_RE.test(window) && /[+−-]\s*\d/.test(window)) best = { start: m.index, end: windowEnd };
    }
    // Widen the lookback rather than cutting tight against the name match
    // itself — some variants (e.g. two sub-lineages sharing one "Hunter
    // Legacy" heading, each with their own sentence) need the preceding
    // sentence intact for the claim's specific numbers to actually appear
    // in the grounding text, not just the tail end of it.
    if (best) return effect.slice(Math.max(0, best.start - 300), best.end).trim();
    // Variant name never turned up near an ability-score sentence — fall
    // through to the generic-first-occurrence path rather than silently
    // returning nothing, since some variants only alter traits, not
    // ability scores, and inherit the base race's line untouched.
  }
  const startMatch = /Ability\s+(?:Adjustments|Modifiers)/i.exec(effect);
  if (!startMatch) return "";
  const endMatch = ALTERNATE_TRAITS_RE.exec(effect.slice(startMatch.index));
  const end = endMatch ? startMatch.index + endMatch.index : Math.min(effect.length, startMatch.index + 2000);
  return effect.slice(startMatch.index, end).trim();
}

const ABILITY_ABBR = { strength: "Str", dexterity: "Dex", constitution: "Con", intelligence: "Int", wisdom: "Wis", charisma: "Cha", any: "any" };

function abilityModsSummary(mods) {
  if (!mods || !mods.length) return "no adjustments (+0 to everything)";
  return mods
    .map((m) => `${ABILITY_ABBR[m.ability] || m.ability}: ${m.value > 0 ? "+" : ""}${m.value}`)
    .join(", ");
}

export function buildRaceRawAuditPrompt(entry) {
  const effect = entry.data?.effect || "";
  const region = abilityRegionText(effect, entry.name);
  const mods = entry.mechanics?.abilityModifiers || [];

  const claims = region
    ? [{ n: 1, field: "mechanics.abilityModifiers", text: `Ability score adjustments: ${abilityModsSummary(mods)}` }]
    : [];

  const user = [
    `This entry is named "${entry.name}".`,
    `SOURCE TEXT (this race's own "Ability Adjustments" section):\n"""\n${region || "(no ability-adjustments region found in this entry's text)"}\n"""`,
    "",
    "CLAIMS TO VERIFY AGAINST THE SOURCE TEXT ABOVE:",
    ...claims.map((c) => `${c.n}. ${c.text}`),
  ].join("\n");

  return {
    system:
      'You fact-check a structured summary against source text it was derived from. The source text may describe more than one named sub-variant (e.g. two sibling lineages sharing one heading) — when it does, check the claim against the sentence for the specific variant named in the entry\'s own name, not any other sibling variant\'s sentence. For each numbered claim, decide if the source text supports it. Respond with JSON: {"checks":[{"n":1,"verdict":"match|mismatch|uncertain","note":"short reason, especially if mismatch"}]}. Use "mismatch" only when the text clearly states different ability scores or different values than the claim for THIS entry\'s own variant. Use "uncertain" when the text is ambiguous or silent about this specific variant. Be literal: check what the text says, not whether it sounds plausible for a Starfinder race.',
    user,
    claimMeta: claims,
  };
}
