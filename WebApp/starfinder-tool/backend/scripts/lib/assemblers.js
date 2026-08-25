// Category-specific assembly: joins an aon-cache base entry (race/class/
// archetype/theme) with its linked -feature entries into the
// DataEntry/schema/*.json shape. See aon-normalize.js's header comment for
// why most of this is deterministic rather than an LLM's job.

import {
  slugify,
  stripTrailingParen,
  splitByHeadings,
  splitBeforeLevelHeadings,
  resolveLevelAndParent,
  looksLikeCandidate,
  extractReplacesClause,
  parseReplacesClauses,
  hasFeatName,
  modifiersToBonus,
  reviewNote,
  buildAbilityModifiers,
  mentionsOtherRace,
  nameAppearsAsHeading,
  parseAbilityScoresText,
  abilityModsEqual,
  extractEmbeddedAbilityAdjustments,
} from "./aon-normalize.js";

const RACE_HEADINGS = ["Physical Description", "Home World", "Society and Alignment", "Relations", "Adventurers", "Names"];

function featureId(entry) {
  return slugify(stripTrailingParen(entry.name));
}

// singular-ish match for "aasimars" ~ "aasimar", "ganzis" ~ "ganzi"
function raceNameMatches(racePhrase, raceName) {
  if (!racePhrase) return false;
  const a = slugify(racePhrase);
  const b = slugify(raceName);
  if (a === b) return true;
  if (a.endsWith("s") && a.slice(0, -1) === b) return true;
  return false;
}

export async function assembleRace(slug, raceEntry, racialFeatures, opts = {}) {
  const review = [];
  const sources = [`races/${slug}.json`];
  const raceName = raceEntry.name;
  // Variant races (e.g. "Android (Companion)") link their traits via the
  // *base* species' hasFeat ("Android"), not their own full name —
  // confirmed live: 60/190 races have a parenthetical variant name, and
  // every one of them was coming back with zero linked traits before this
  // fix, caught by the audit checker flagging "default traits: none"
  // against source text that clearly describes several.
  const baseRaceName = stripTrailingParen(raceName);
  const isThisRace = (name) => { const s = slugify(name); return s === slugify(raceName) || s === slugify(baseRaceName); };
  const allRaceNames = opts.allRaceNames || [raceName];

  // 1. Default traits: cleanly hasFeat-linked to this race (or its base
  // species, for a variant), no "replaces" text — but cross-checked
  // against the entry's own description, since a real data bug was found
  // live (racial-features/reverse-fate.json's hasFeat says "Aasimar" but
  // its own text says "a ganzi can reroll...").
  const claimedDefaults = racialFeatures.filter(({ entry }) => {
    const feat = hasFeatName(entry);
    return feat && isThisRace(feat) && !extractReplacesClause(entry.data?.effect);
  });
  const defaultEntries = [];
  for (const item of claimedDefaults) {
    const other = mentionsOtherRace(item.entry.data?.effect, raceName, allRaceNames);
    if (other) {
      review.push(
        reviewNote(
          `traits (excluded: ${item.entry.name})`,
          `hasFeat claims "${raceName}" but the entry's own text names "${other}" instead — likely a source-data mislabel (confirmed pattern: racial-features/reverse-fate.json). Excluded from traits[]; add back by hand if this race really does grant it.`,
          item.entry.data?.effect,
        ),
      );
    } else {
      defaultEntries.push(item);
    }
  }

  // 1b. Shared/generic entries (hasFeat doesn't name any known race, e.g.
  // "Racial Feature" — Darkvision granted to many species at once) don't
  // link via hasFeat at all. Fall back to matching the feature's bare name
  // against a heading line in this race's own prose (before "Alternate ...
  // Traits") — weaker evidence, always flagged for review even when it hits.
  const alreadyLinkedIds = new Set(defaultEntries.map((d) => featureId(d.entry)));
  for (const item of racialFeatures) {
    const bareName = stripTrailingParen(item.entry.name);
    if (alreadyLinkedIds.has(slugify(bareName))) continue;
    const feat = hasFeatName(item.entry);
    const isGeneric = !feat || !allRaceNames.some((n) => slugify(n) === slugify(feat));
    if (!isGeneric || extractReplacesClause(item.entry.data?.effect)) continue;
    if (nameAppearsAsHeading(bareName, raceEntry.data?.effect)) {
      defaultEntries.push(item);
      alreadyLinkedIds.add(slugify(bareName));
      review.push(
        reviewNote(
          `traits (${bareName})`,
          `Linked via heading-name match against a shared/generic entry (hasFeat: "${feat}"), not a direct hasFeat match — verify this race actually grants it as written.`,
        ),
      );
    }
  }

  const traits = defaultEntries.map(({ filename, entry }) => {
    sources.push(`racial-features/${filename}`);
    return {
      id: featureId(entry),
      name: stripTrailingParen(entry.name),
      source: entry.source || "",
      page: entry.data?.sourcePage ?? undefined,
      description: entry.data?.effect || "",
      bonus: modifiersToBonus(entry.mechanics?.modifiers),
    };
  });
  const knownTraitIds = new Set(traits.map((t) => t.id));

  // 2. Alternate traits: entries carrying a "This replaces ..." clause
  // that names (or implies, via hasFeat) this race.
  const alternate_traits = [];
  for (const { filename, entry } of racialFeatures) {
    const clauseText = extractReplacesClause(entry.data?.effect);
    if (!clauseText) continue;
    const clauses = parseReplacesClauses(clauseText);
    const feat = hasFeatName(entry);
    const matchesThisRace = (c) =>
      raceNameMatches(c.racePhrase, raceName) ||
      raceNameMatches(c.racePhrase, baseRaceName) ||
      (c.racePhrase === null && feat && isThisRace(feat));
    const applicableClauses = clauses.filter(matchesThisRace);
    if (applicableClauses.length === 0) continue;
    // "This replaces X and Y" genuinely names two traits (confirmed live:
    // dwarf.json's "Opposite Reaction" replaces both Traditional Enemies
    // and Weapon Familiarity) — the schema only has room for one
    // `replaces` id, so prefer whichever clause actually resolves to a
    // known trait rather than always taking the first (which used to lock
    // onto "Traditional Enemies" — not a real linked trait for this race —
    // and never even consider "Weapon Familiarity", which was).
    const appliesHere =
      applicableClauses.find((c) => knownTraitIds.has(slugify(c.traitPhrase))) || applicableClauses[0];
    if (applicableClauses.length > 1) {
      review.push(
        reviewNote(
          `alternate_traits (${stripTrailingParen(entry.name)})`,
          `Source text names multiple replaced traits ("${applicableClauses.map((c) => c.traitPhrase).join('", "')}") — schema only records one; recorded "${appliesHere.traitPhrase}".`,
        ),
      );
    }

    // Same hasFeat-mislabel check as defaults, above — only when we're
    // trusting hasFeat rather than an explicit "for <race>" clause (a
    // second real instance found live: racial-features/
    // fiendish-nihilism.json's hasFeat says "Aasimar" but its own text is
    // entirely about tieflings, "This replaces deceitful and fiendish
    // gloom" — both Tiefling traits, not Aasimar's).
    if (appliesHere.racePhrase === null) {
      const other = mentionsOtherRace(entry.data?.effect, raceName, allRaceNames);
      if (other) {
        review.push(
          reviewNote(
            `alternate_traits (excluded: ${entry.name})`,
            `hasFeat claims "${raceName}" but the entry's own text names "${other}" instead — likely a source-data mislabel (same pattern as racial-features/reverse-fate.json). Excluded; add back by hand if this race really does grant it.`,
            entry.data?.effect,
          ),
        );
        continue;
      }
    }

    sources.push(`racial-features/${filename}`);
    const id = featureId(entry);
    let replaces = null;
    const candidateId = slugify(appliesHere.traitPhrase);
    if (knownTraitIds.has(candidateId)) {
      replaces = candidateId;
    } else if (opts.askLLM) {
      try {
        const answer = await opts.askLLM({
          system:
            // Confirmed live this needed to be explicit: without a strong
            // push toward null, the model picked a real-but-wrong id from
            // the list instead of admitting no match (android-laborer.json
            // "replaces exceptional vision" resolved to "constructed" —
            // a valid id, just not the right one, so it passed the
            // knownTraitIds membership check below undetected). The root
            // cause there wasn't a resolution failure — Android's source
            // data has no "Exceptional Vision"/"Upgrade Slot" trait entry
            // at all to link to — so the correct answer really was null.
            'You match a Starfinder alternate racial trait\'s replacement description to a known trait id. Answer with a single JSON object: {"replaces": "<id-from-the-list-or-null>"}. The described trait is often something NOT in the list at all (e.g. the race\'s source data may simply be missing that trait) — null is a common and correct answer, not a fallback of last resort. Only return an id if it plausibly names the same thing; never return the closest-sounding or most similar id as a guess.',
          user: `Known trait ids for this race: ${JSON.stringify([...knownTraitIds])}\nThe alternate trait's source text says it replaces: "${appliesHere.traitPhrase}"\nWhich known id does that refer to? (null if none of them plausibly do)`,
        });
        if (answer && typeof answer.replaces === "string" && knownTraitIds.has(answer.replaces)) {
          replaces = answer.replaces;
        }
      } catch (err) {
        review.push(reviewNote(`alternate_traits[${alternate_traits.length}].replaces`, `LLM lookup failed: ${err.message}`, appliesHere.traitPhrase));
      }
    }
    if (!replaces) {
      review.push(
        reviewNote(
          `alternate_traits[${alternate_traits.length}].replaces`,
          `Couldn't match "${appliesHere.traitPhrase}" to a known trait id for ${raceName}`,
          entry.data?.effect,
        ),
      );
    }

    alternate_traits.push({
      id,
      name: stripTrailingParen(entry.name),
      source: entry.source || "",
      page: entry.data?.sourcePage ?? undefined,
      description: entry.data?.effect || "",
      bonus: modifiersToBonus(entry.mechanics?.modifiers),
      replaces,
    });
  }

  if (traits.length === 0) {
    review.push(reviewNote("traits", `No racial-feature entries cleanly linked to "${raceName}" via a matching hasFeat requirement — check aon-cache/racial-features manually.`));
  }

  const { before, sections } = splitByHeadings(raceEntry.data?.effect || "", RACE_HEADINGS);
  const description_rulebook = {
    race_description: before,
    description_physical: sections["Physical Description"] || "",
    home_world: sections["Home World"] || "",
    society_alignment: sections["Society and Alignment"] || "",
    relations: sections["Relations"] || "",
    adventurers: sections["Adventurers"] || "",
    names: sections["Names"] || "",
  };
  for (const [field, key] of [
    ["description_physical", "Physical Description"],
    ["home_world", "Home World"],
    ["society_alignment", "Society and Alignment"],
    ["relations", "Relations"],
    ["adventurers", "Adventurers"],
    ["names", "Names"],
  ]) {
    if (!description_rulebook[field]) {
      review.push(reviewNote(`description_rulebook.${field}`, `"${key}" heading not found in source prose — needs manual fill.`));
    }
  }

  // Confirmed live, a real upstream Foundry inconsistency (not a linking
  // bug this time): copaxi.json's structured `data.sizeAndType` field says
  // "fine humanoid (copaxi)", but its own prose says "Copaxis are Medium
  // humanoids" — the two disagree within the same source entry. Prose wins
  // on disagreement (not just flagged) — the rulebook-transcribed text is
  // closer to the actual source than a machine-encoded structured field
  // one more transformation removed from it; still flagged either way so
  // a human can override.
  const structuredSize = (raceEntry.data?.sizeAndType || "").split(/\s+/)[0]?.toLowerCase() || "medium";
  const proseSize = /Size and Type\n[^\n]*?\bare\s+(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\b/i.exec(
    raceEntry.data?.effect || "",
  )?.[1]?.toLowerCase();
  let size = structuredSize;
  if (proseSize && proseSize !== structuredSize) {
    review.push(
      reviewNote(
        "size",
        `Structured data said "${structuredSize}" but the "Size and Type" prose says "${proseSize}" — these disagree in the source itself; used the prose value, verify against the rulebook.`,
      ),
    );
    size = proseSize;
  }

  // Three independent copies of the same fact exist per race, and they can
  // all disagree (confirmed live, dessamar-instar.json): the structured
  // mechanics.abilityModifiers field, the data.abilityScores summary text,
  // and the "Ability Adjustments" line embedded in data.effect's prose.
  // Priority order below is "closest to the actual rulebook wins": the
  // embedded prose line first (it's what turned out correct for
  // dessamar-instar — data.abilityScores *and* mechanics.abilityModifiers
  // agreed with each other there while both being wrong, so agreement
  // between those two isn't itself evidence of correctness), then the
  // separate summary text, then the structured field as a last resort.
  // Every disagreement is flagged regardless of which value wins, since
  // even the embedded line isn't guaranteed correct in general — this is
  // "best available evidence," not a guarantee.
  const structuredAbilityMods = buildAbilityModifiers(raceEntry.mechanics?.abilityModifiers, review);
  const summaryAbilityMods = parseAbilityScoresText(raceEntry.data?.abilityScores);
  const embeddedText = extractEmbeddedAbilityAdjustments(raceEntry.data?.effect);
  const embeddedAbilityMods = embeddedText ? parseAbilityScoresText(embeddedText) : null;

  const candidates = [
    embeddedAbilityMods && { source: `embedded prose ("${embeddedText}")`, value: embeddedAbilityMods },
    summaryAbilityMods && { source: `data.abilityScores ("${raceEntry.data.abilityScores}")`, value: summaryAbilityMods },
    { source: "structured mechanics.abilityModifiers", value: structuredAbilityMods },
  ].filter(Boolean);

  const ability_modifiers = candidates[0].value;
  const disagreements = candidates.slice(1).filter((c) => !abilityModsEqual(c.value, ability_modifiers));
  if (disagreements.length) {
    review.push(
      reviewNote(
        "ability_modifiers",
        `Sources disagree — used ${candidates[0].source}. Also present: ${disagreements.map((d) => `${d.source} = ${JSON.stringify(d.value)}`).join("; ")}. Verify against the rulebook.`,
      ),
    );
  }
  if (!embeddedAbilityMods && embeddedText) {
    review.push(reviewNote("ability_modifiers", `Couldn't parse the embedded prose ability text "${embeddedText}" — fell back to a lower-priority source.`));
  }

  const doc = {
    name: slug,
    type: (raceEntry.mechanics?.tags || []).find((t) => !["landmark", "contested", "station-only"].includes(t)) || "humanoid",
    subtype: "",
    size,
    hp: raceEntry.data?.hitPoints ?? 0,
    ability_modifiers,
    traits,
    alternate_traits,
    description_rulebook,
    _source: sources,
    _review: review,
  };
  return doc;
}

function assembleLeveledFeatures(baseEntry, featureEntries, parentName) {
  const review = [];
  const sources = [];
  const byLevel = new Map();
  for (const { filename, entry } of featureEntries) {
    if (!looksLikeCandidate(entry, filename, parentName)) continue;
    const resolved = resolveLevelAndParent(entry, filename, [parentName]);
    if (!resolved) {
      review.push(reviewNote(`unlinked:${filename}`, `Looked like a candidate for "${parentName}" (name/filename match) but level+parent parsing failed — prerequisites: "${entry.data?.prerequisites || ""}".`));
      continue;
    }
    sources.push(filename);
    const feature = {
      id: featureId(entry),
      name: stripTrailingParen(entry.name),
      source: entry.source || "",
      page: entry.data?.sourcePage ?? undefined,
      description: entry.data?.effect || "",
      bonus: modifiersToBonus(entry.mechanics?.modifiers),
    };
    if (!byLevel.has(resolved.level)) byLevel.set(resolved.level, []);
    byLevel.get(resolved.level).push(feature);
  }
  const levels = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, features]) => ({ level, features }));
  return { levels, review, sources };
}

export function assembleClass(slug, classEntry, classFeatures) {
  const { levels, review, sources } = assembleLeveledFeatures(classEntry, classFeatures, classEntry.name);
  const saves = (classEntry.data?.savingThrows || "").toLowerCase();
  const savingThrow = (name) => (saves.includes(`${name}: fast`) ? "fast" : "slow");

  const skillNameToSlug = (s) => slugify(s.trim());
  const doc = {
    name: slug,
    key_ability_score: (classEntry.data?.keyAbilityScore || "").slice(0, 3).toLowerCase() || "str",
    base_attack_bonus: classEntry.data?.baseAttackBonus || "3/4",
    saving_throws: { fort: savingThrow("fort"), ref: savingThrow("ref"), will: savingThrow("will") },
    hit_points_per_level: classEntry.data?.hitPointsPerLevel ?? 0,
    stamina_points_per_level: classEntry.data?.staminaPointsPerLevel ?? 0,
    skill_ranks_per_level: classEntry.data?.skillRanksPerLevel ?? 0,
    class_skills: (classEntry.data?.classSkills || "").split(",").map(skillNameToSlug).filter(Boolean),
    flavor_text: splitBeforeLevelHeadings(classEntry.data?.effect || ""),
    levels,
    _source: [`classes/${slug}.json`, ...sources.map((f) => `class-features/${f}`)],
    _review: review,
  };
  return doc;
}

// SF1e's 1st-level theme benefit ("Theme Knowledge") isn't a separate
// theme-features/ entry the way 6th/12th/18th are — it's embedded directly
// in the theme's own base entry, under an ALL-CAPS "THEME KNOWLEDGE (1ST)"
// heading (confirmed live against ace-pilot.json's data.effect) alongside
// the other three levels' headings in the same style.
function extractThemeKnowledge(text) {
  const m = /THEME KNOWLEDGE\s*\(1ST\)([\s\S]*?)(?=[A-Z][A-Z0-9 '-]{3,}\s*\(\d+(?:ST|ND|RD|TH)\)|$)/i.exec(text || "");
  return m ? m[1].trim() : null;
}

export function assembleTheme(slug, themeEntry, themeFeatures) {
  const { levels, review, sources } = assembleLeveledFeatures(themeEntry, themeFeatures, themeEntry.name);
  const abilityMod = /([+-]?\d+)\s+(\w+)/.exec(themeEntry.data?.abilityMod || "");

  const knowledgeText = extractThemeKnowledge(themeEntry.data?.effect);
  if (knowledgeText) {
    levels.unshift({ level: 1, features: [{ id: "theme-knowledge", name: "Theme Knowledge", source: themeEntry.source || "", page: themeEntry.data?.sourcePage, description: knowledgeText, bonus: [] }] });
  } else {
    review.push(reviewNote("levels[1]", "Couldn't find a \"THEME KNOWLEDGE (1ST)\" section in the theme's own text — 1st-level benefit needs manual fill."));
  }

  const doc = {
    name: slug,
    ability_mod: abilityMod ? { ability: abilityMod[2].slice(0, 3).toLowerCase(), value: Number(abilityMod[1]) } : { ability: "str", value: 0 },
    theme_skill: slugify(themeEntry.data?.themeSkill || ""),
    flavor_text: splitBeforeLevelHeadings(themeEntry.data?.effect || "").split(/THEME KNOWLEDGE/i)[0].trim(),
    levels: levels.map(({ level, features }) => ({ level, feature: features[0] })).filter((l) => l.feature),
    _source: [`themes/${slug}.json`, ...sources.map((f) => `theme-features/${f}`)],
    _review: review,
  };
  if (!abilityMod) doc._review.push(reviewNote("ability_mod", `Couldn't parse abilityMod text: "${themeEntry.data?.abilityMod || ""}"`));
  for (const l of levels) {
    if (l.features.length > 1) {
      doc._review.push(reviewNote(`levels[${l.level}]`, `${l.features.length} features resolved to the same level — themes should have exactly one; extras dropped, check manually.`, l.features.map((f) => f.name).join(", ")));
    }
  }
  return doc;
}

export function assembleArchetype(slug, archetypeEntry, archetypeFeatures) {
  const { levels, review, sources } = assembleLeveledFeatures(archetypeEntry, archetypeFeatures, archetypeEntry.name);
  for (const level of levels) {
    for (const feature of level.features) {
      feature.replaces_class_feature = null;
    }
    review.push(
      reviewNote(
        `levels[${level.level}].features[].replaces_class_feature`,
        "Archetype source text almost never states which class feature this swaps out explicitly — confirm against the archetype's own class's level table by hand.",
      ),
    );
  }
  const doc = {
    name: slug,
    requirements: archetypeEntry.data?.requirements || "",
    flavor_text: splitBeforeLevelHeadings(archetypeEntry.data?.effect || ""),
    levels,
    _source: [`archetypes/${slug}.json`, ...sources.map((f) => `archetype-features/${f}`)],
    _review: review,
  };
  if (!doc.requirements) doc._review.push(reviewNote("requirements", "Requirements text is empty in the source data — confirm the archetype's real prerequisite by hand."));
  return doc;
}
