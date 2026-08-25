// Grounded consistency checker for a normalized race doc
// (DataEntry/output/races/<slug>.json, built by normalize-entries.js) —
// re-checks every field the assembler derived against the *same source
// text it was derived from*, via a local LLM. Deliberately not "does this
// match real Starfinder rules" (an 8B local model doesn't reliably know
// that, and would confidently fabricate an answer, which is the worst
// failure mode for a checker specifically) — every claim below is checked
// against text already embedded in the doc itself, so the model's job is
// reading comprehension over a supplied excerpt, not rules recall. Same
// "grounded, bounded, closed-answer" shape as the trait-`replaces` resolver
// in assemblers.js, just pointed at auditing instead of extracting.

// Claims 1-3 (ability mods, size, default trait list) only ever live in one
// specific stretch of text — "Ability Adjustments ... Size and Type ...
// [default trait headings]". Two real bugs found getting this extraction
// right, neither in the underlying data:
//
// 1. That stretch doesn't reliably land in description_rulebook.
//    race_description — splitByHeadings() (aon-normalize.js) files text
//    under whichever of the six recognized headings comes first in the
//    source, and "Ability Adjustments..." can appear *after* one of them
//    in the raw prose. Confirmed live: human.json's entire mechanical
//    block (ability scores through every alternate trait) sits under
//    description_rulebook.adventurers, not race_description, because
//    "Adventurers" happens to head a section earlier than the stats block
//    in Human's actual page layout. Fix: search all six fields, not just
//    race_description.
// 2. The "Alternate ... Traits" end marker needs to allow singular "Trait"
//    — confirmed live: formian.json (which has exactly one alternate
//    trait) headers it "Alternate Species Trait", no "s".
//
// Blindly sending everything instead (no end marker at all) isn't a safe
// fallback either: race_description can also contain every *alternate*
// trait's full description when a race has no other recognized headings
// (Aasimar has none), which is exactly the runaway-length case this
// function exists to avoid — a median race's *whole* overview text is
// 4,684 chars (already past a naive 4000-char truncation point) vs. a
// median of 1,075 once narrowed to just this region.
const ALTERNATE_TRAITS_RE = /Alternate\s+\w*\s*Traits?\b/i;

function raceDefaultsRegionText(doc) {
  const d = doc.description_rulebook || {};
  const fields = [d.race_description, d.description_physical, d.home_world, d.society_alignment, d.relations, d.adventurers, d.names];
  for (const full of fields) {
    if (!full) continue;
    // \s+, not a literal space: confirmed live, some pages use a
    // non-breaking space (U+00A0, likely an un-normalized &nbsp; from the
    // source HTML) between "Ability" and the next word instead of a
    // regular one (kasatha.json among them) — invisible in a terminal
    // dump, silently non-matching against a literal " ". Two different
    // headings for the same concept also confirmed live: most races say
    // "Ability Adjustments", ganzi.json says "Ability Modifiers" instead —
    // there may be further variants this still doesn't catch; an empty
    // region just means claims 1-3 are skipped for that race (see
    // buildRaceAuditPrompt), not silently checked against the wrong text.
    const startMatch = /Ability\s+(?:Adjustments|Modifiers)/i.exec(full);
    if (!startMatch) continue;
    const endMatch = ALTERNATE_TRAITS_RE.exec(full.slice(startMatch.index));
    const end = endMatch ? startMatch.index + endMatch.index : full.length;
    return full.slice(startMatch.index, end).trim();
  }
  return "";
}

function abilityModsSummary(am) {
  if (!am) return "none stated";
  const parts = Object.entries(am)
    .filter(([k]) => k !== "special")
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => (v === "any" ? `${k}: any (+${am.special})` : `${k}: ${v > 0 ? "+" : ""}${v}`));
  return parts.length ? parts.join(", ") : "no adjustments (+0 to everything)";
}

// Builds one bounded prompt covering every field the assembler touched:
// ability_modifiers/size (checked against the race's own overview text)
// plus one "replaces" claim per alternate trait (each checked against that
// specific trait's own description, not the whole race blob — keeps each
// claim's grounding text short and unambiguous). Capped at MAX_CLAIMS
// total so the prompt stays small regardless of how many alternate traits
// a race has (Aasimar has 6) — remaining claims are simply left unchecked,
// not silently guessed at.
const MAX_ALT_TRAIT_CLAIMS = 6;

export function buildRaceAuditPrompt(doc) {
  const overview = raceDefaultsRegionText(doc).slice(0, 4000);
  const defaultNames = (doc.traits || []).map((t) => t.name);

  const claims = [
    { n: 1, field: "ability_modifiers", text: `Ability score adjustments: ${abilityModsSummary(doc.ability_modifiers)}` },
    { n: 2, field: "size", text: `Size: ${doc.size}` },
    { n: 3, field: "traits", text: `Default traits (granted automatically to every member of this race, not optional/alternate): ${defaultNames.join(", ") || "none"}` },
  ];

  const altClaims = (doc.alternate_traits || [])
    .filter((t) => t.replaces)
    .slice(0, MAX_ALT_TRAIT_CLAIMS)
    .map((t, i) => ({
      n: 4 + i,
      field: `alternate_traits[${doc.alternate_traits.indexOf(t)}].replaces`,
      text: `The alternate trait "${t.name}" replaces the trait "${doc.traits?.find((dt) => dt.id === t.replaces)?.name || t.replaces}".`,
      snippet: (t.description || "").slice(0, 600),
    }));

  const user = [
    `SOURCE TEXT (this race's own overview/description):\n"""\n${overview || "(no overview text available)"}\n"""`,
    "",
    "CLAIMS TO VERIFY AGAINST THE SOURCE TEXT ABOVE:",
    ...claims.map((c) => `${c.n}. ${c.text}`),
    "",
    altClaims.length ? "ADDITIONAL CLAIMS — each verified against its OWN snippet, not the source text above:" : "",
    ...altClaims.map((c) => `${c.n}. [snippet: "${c.snippet}"]\n   Claim: ${c.text}`),
  ].filter((l) => l !== "").join("\n");

  return {
    system:
      'You fact-check a structured summary against source text it was derived from. For each numbered claim, decide if the relevant text (the shared source text for claims 1-3, or that claim\'s own snippet for the rest) supports it. Respond with JSON: {"checks":[{"n":1,"verdict":"match|mismatch|uncertain","note":"short reason, especially if mismatch"}]}. Use "mismatch" only when the text clearly says something different — not when it simply doesn\'t mention something. Use "uncertain" when the text is ambiguous or doesn\'t address the claim at all. Be literal: check what the text says, not whether it sounds plausible for a Starfinder race.',
    user,
    claimMeta: [...claims, ...altClaims],
  };
}

// Merges the model's verdicts into the doc's _audit array (created if
// absent) — additive and idempotent-ish: re-running replaces prior audit
// results for the same field rather than piling up duplicates.
export function applyAuditResults(doc, checks, claimMeta) {
  const byN = new Map(claimMeta.map((c) => [c.n, c]));
  const newEntries = (checks || [])
    .map((c) => {
      const meta = byN.get(c.n);
      if (!meta) return null;
      return { field: meta.field, claim: meta.text, verdict: c.verdict || "uncertain", note: c.note || "" };
    })
    .filter(Boolean);

  const checkedFields = new Set(newEntries.map((e) => e.field));
  const prior = (doc._audit || []).filter((e) => !checkedFields.has(e.field));
  doc._audit = [...prior, ...newEntries];
  return newEntries;
}
