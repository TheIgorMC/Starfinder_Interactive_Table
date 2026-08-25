// Shared helpers for scripts/normalize-entries.js — turns already-cached
// aon-cache/ entries (see Docs/04-data-pipeline-aon.md) into the
// DataEntry/schema/*.json shapes. Deliberately deterministic/regex-based:
// most of the "decompose a race/class/archetype/theme into its individual
// traits/features" problem turns out to already be solved by the Foundry
// import (racial-features/class-features/archetype-features/theme-features
// are already separate, mechanically-structured entries) — this module's
// job is *linking* them back to their parent and to each other, not
// re-parsing prose. The genuinely prose-dependent judgment calls (which
// default trait an alternate racial trait replaces, when the source text's
// wording doesn't match the patterns below) are left as `null` + a
// `_review` note for either a human or scripts/lib/ollama-client.js to
// resolve — see normalize-entries.js.

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[’'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "6th Level (Envoy)" | "12th Level - Guard" | "2nd Level" -> {level, parentName}
export function parseLevelHeader(text) {
  if (!text) return null;
  const trimmed = text.trim();
  let m = /^(\d+)\w{0,3}\s*level\s*\(([^)]+)\)/i.exec(trimmed);
  if (m) return { level: Number(m[1]), parentName: m[2].trim() };
  m = /^(\d+)\w{0,3}\s*level\s*-\s*(.+)$/i.exec(trimmed);
  if (m) return { level: Number(m[1]), parentName: m[2].trim() };
  m = /^(\d+)\w{0,3}\s*level$/i.exec(trimmed);
  if (m) return { level: Number(m[1]), parentName: null };
  return null;
}

// "Weapon Specialization (Ex) (Soldier)" -> "Soldier" (the *last*
// parenthetical — "(Ex)" is a rules-type tag, not the parent name).
export function trailingParenName(name) {
  const m = /\(([^()]+)\)\s*$/.exec(name || "");
  return m ? m[1].trim() : null;
}

// Best-effort resolution of which parent (class/archetype/theme) a
// -feature entry belongs to and at what level, trying three independent
// signals in order of confidence. Returns null if none matched.
export function resolveLevelAndParent(entry, filename, parentNames) {
  const bySlug = new Map(parentNames.map((n) => [slugify(n), n]));

  const fromPrereq = parseLevelHeader(entry.data?.prerequisites);
  if (fromPrereq?.parentName && bySlug.has(slugify(fromPrereq.parentName))) {
    return { level: fromPrereq.level, parentName: bySlug.get(slugify(fromPrereq.parentName)), via: "prerequisites" };
  }

  const fromName = trailingParenName(entry.name);
  if (fromName && bySlug.has(slugify(fromName))) {
    const level = fromPrereq?.level ?? null;
    if (level != null) return { level, parentName: bySlug.get(slugify(fromName)), via: "name+prerequisites-level" };
  }

  if (fromPrereq && !fromPrereq.parentName) {
    // Level known, parent not named in prerequisites text — try the filename.
    const base = filename.replace(/\.json$/, "");
    for (const [slug, original] of bySlug) {
      if (base === slug || base.startsWith(`${slug}-`) || base.endsWith(`-${slug}`)) {
        return { level: fromPrereq.level, parentName: original, via: "filename" };
      }
    }
  }

  return null;
}

// A racial-feature's own text carries its "replaces" relationship, e.g.
// "This replaces celestial radiance for aasimars or reverse fate for
// ganzis." Self-contained per entry — no need to parse the race's own
// combined prose blob at all.
const REPLACES_RE = /This (?:replaces|ability alters)\s+(.+?)(?:\n|$)/i;

export function extractReplacesClause(effectText) {
  const m = REPLACES_RE.exec(effectText || "");
  return m ? m[1].replace(/\.$/, "").trim() : null;
}

// "celestial radiance for aasimars or reverse fate for ganzis"
//   -> [{ traitPhrase: "celestial radiance", racePhrase: "aasimar" },
//       { traitPhrase: "reverse fate", racePhrase: "ganzi" }]
// "skilled" (single trait, no "for <race>" — the entry's own hasFeat names
// the race instead) -> [{ traitPhrase: "skilled", racePhrase: null }]
export function parseReplacesClauses(clauseText) {
  if (!clauseText) return [];
  return clauseText.split(/,?\s+(?:or|and)\s+/i).map((part) => {
    const m = /^(.+?)\s+for\s+([a-z][a-z' -]*?)s?$/i.exec(part.trim());
    if (m) return { traitPhrase: m[1].trim(), racePhrase: m[2].trim().toLowerCase() };
    return { traitPhrase: part.trim(), racePhrase: null };
  });
}

// Strips a feature entry's trailing "(ParentName)" so the schema's
// human-facing `name` field reads "Draw Fire (Ex)" not "Draw Fire (Ex)
// (Envoy)" — the parent is already implicit in which entity this trait/
// feature is attached under.
export function stripTrailingParen(name) {
  return (name || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

// Splits a prose blob on a fixed list of known English section headings
// (each expected on its own line, e.g. "Physical Description\n...") — the
// same convention scrape-aon.js's fetchDetail() already relies on for the
// original AoN pages. Returns the text before the first recognized
// heading plus a {heading: content} map for whichever headings were found
// (order-independent, since headings don't always appear in the same
// sequence across every race).
export function splitByHeadings(text, headings) {
  const found = [];
  for (const h of headings) {
    const re = new RegExp(`(^|\\n)${h.replace(/ /g, "\\s+")}\\n`, "i");
    const m = re.exec(text || "");
    if (m) found.push({ heading: h, headingStart: m.index + m[1].length, contentStart: m.index + m[0].length });
  }
  found.sort((a, b) => a.headingStart - b.headingStart);
  const sections = {};
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].headingStart : text.length;
    sections[found[i].heading] = text.slice(found[i].contentStart, end).trim();
  }
  const before = found.length ? text.slice(0, found[0].headingStart).trim() : (text || "").trim();
  return { before, sections };
}

// Classes/archetypes/themes: the base entry's data.effect is flavor text
// followed by inline "Feature Name - Nth Level" headings for each feature
// — split off just the flavor text before the first one.
export function splitBeforeLevelHeadings(text) {
  const m = /\n[A-Z][^\n]*-\s*\d+\w{0,3}\s+Levels?\b/.exec(text || "");
  return m ? text.slice(0, m.index).trim() : (text || "").trim();
}

// Cheap pre-filter so assembleLeveledFeatures only spends a review note on
// entries that look like they were meant for this parent (name/filename
// mentions it) but failed full level/parent resolution — without this,
// every OTHER class's/theme's/archetype's features (the vast majority of
// any -feature directory) would get flagged as "unlinked" for every
// unrelated parent, which is just noise, not a real gap.
export function looksLikeCandidate(entry, filename, parentName) {
  const parentSlug = slugify(parentName);
  const base = filename.replace(/\.json$/, "");
  if (`-${base}-`.includes(`-${parentSlug}-`)) return true;
  if (slugify(entry.data?.prerequisites || "").includes(parentSlug)) return true;
  if (slugify(entry.name).includes(parentSlug)) return true;
  return false;
}

// Sanity check against a real data-quality bug found live: a racial
// feature's own description can name a *different* race as its actual
// subject than its `hasFeat` requirement claims (aon-cache's
// racial-features/reverse-fate.json says "a ganzi can reroll..." in its
// own text, but hasFeat says "Aasimar" — an upstream Foundry-import
// mislabel). Returns the other race's name if the text's grammatical
// subject looks like it's naming one, else null.
export function mentionsOtherRace(text, thisRaceName, allRaceNames) {
  const t = text || "";
  const thisBase = slugify(stripTrailingParen(thisRaceName));
  for (const name of allRaceNames) {
    // A variant race's own base name isn't "another" race — "Android
    // (Companion)"'s traits legitimately talk about "androids" in
    // prose. Confirmed live: 60/190 races have a parenthetical variant
    // name (Android (Companion), Elf (Forlorn), ...) whose linked traits
    // reference the base species by name throughout.
    if (slugify(name) === slugify(thisRaceName) || slugify(name) === thisBase) continue;
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b(?:a|an|the)?\\s*${escaped}s?\\b`, "i");
    if (re.test(t)) return name;
  }
  return null;
}

// Generic/shared racial-feature entries (hasFeat: "Racial Feature" —
// Darkvision granted to many species) don't link to any one race via
// hasFeat at all. Fallback signal: the race's own combined prose lists
// each of its default traits' bare names as a heading line before the
// "Alternate ... Traits" marker (confirmed live against Aasimar's and
// Human's own data.effect) — so a feature whose name appears there is
// very likely one of this race's defaults, just weaker evidence than a
// direct hasFeat match (hence still worth a _review note, not silent
// inclusion).
export function nameAppearsAsHeading(featureName, raceProseText) {
  const region = (raceProseText || "").split(/Alternate\s+\w*\s*Traits\b/i)[0];
  const escaped = featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)${escaped}\\n`, "i").test(region);
}

const ABILITY_WORD_TO_SHORT = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
  // The line embedded in data.effect ("Ability Adjustments+2 Con, +2 Wis,
  // -2 Dex") uses short forms, unlike data.abilityScores' long-form
  // summary ("-2 constitution, +2 wisdom...") — both need parsing.
  str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha",
};

// Parses data.abilityScores' free-text summary ("+2 charisma", "-2
// constitution, +2 wisdom, +2 dexterity", "+2 any") into the same
// {str,dex,con,int,wis,cha,special} shape buildAbilityModifiers() produces
// from the structured mechanics.abilityModifiers field — lets the two be
// cross-checked against each other. Returns null if the text doesn't match
// one of the shapes actually seen across all 190 races (better to flag
// "couldn't parse" than guess at an unfamiliar format).
export function parseAbilityScoresText(text) {
  if (!text) return null;
  const out = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, special: 0 };
  let sawAny = false;
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^([+-]?\d+)\s+(\w+)$/.exec(part);
    if (!m) return null;
    const value = Number(m[1]);
    const word = m[2].toLowerCase();
    if (word === "any") { sawAny = true; out.special = value; continue; }
    const key = ABILITY_WORD_TO_SHORT[word];
    if (!key) return null;
    out[key] += value;
  }
  if (sawAny) {
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) if (out[key] === 0) out[key] = "any";
  }
  return out;
}

// The same "Ability Adjustments" line the size cross-check already scans
// for (raceDefaultsRegionText-style) carries its own value list inline —
// "Ability Adjustments+2 Con, +2 Wis, -2 Dex" — a *third* independent copy
// of this fact alongside data.abilityScores and mechanics.abilityModifiers.
// Confirmed live these three don't always agree: dessamar-instar.json has
// data.abilityScores and mechanics.abilityModifiers both saying "-2 Con,
// +2 Dex" (consistent with each other, both wrong against the real
// rulebook), while this embedded line correctly says "+2 Con, -2 Dex" —
// this is the one that turned out to be trustworthy in that case, so it's
// checked first, not assumed to always win.
export function extractEmbeddedAbilityAdjustments(effectText) {
  const m = /Ability\s+Adjustments\s*([^\n]+)/i.exec(effectText || "");
  return m ? m[1].trim() : null;
}

export function abilityModsEqual(a, b) {
  return ["str", "dex", "con", "int", "wis", "cha", "special"].every((k) => a[k] === b[k]);
}

export function hasFeatName(entry) {
  const req = (entry.mechanics?.requirements || []).find((r) => r.type === "hasFeat");
  return req?.name || null;
}

// Passes an already-structured Modifier (backend/src/mechanics-schema.js)
// through close to verbatim as a race/class/archetype/theme schema
// bonusEffect of type "modifier" — see race.schema.json's definitions for
// why this exists instead of lossily remapping into skill/ability/save/
// condition, which don't cover most real effectType values (energy
// resistance, AC, speed, ...).
export function modifiersToBonus(modifiers) {
  return (modifiers || []).map((m) => ({
    type: "modifier",
    name: m.name,
    modifierType_: m.type,
    effectType: m.effectType,
    valueAffected: m.valueAffected ?? null,
    modifier: m.modifier,
    modifierType: m.modifierType || "constant",
    max: m.max ?? null,
    condition: m.condition || "",
    notes: m.notes || "",
    source: m.source || "",
  }));
}

export function reviewNote(scope, reason, raw) {
  const note = { scope, reason };
  if (raw) note.raw = String(raw).slice(0, 400);
  return note;
}

const ABILITY_SHORT = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

// Foundry's abilityModifiers is a flat array ({ability, value}[], "any" as
// a literal pseudo-ability meaning "player picks one"); the schema wants
// the six fixed str/dex/con/int/wis/cha slots. When an "any" entry is
// present every slot not otherwise fixed is marked "any" and `special`
// carries its value — this loses the "choose 1 of 6" vs "choose N of 6"
// count some races' text implies (schema has no field for it yet), so
// every race with an "any" entry gets a _review note flagging that.
export function buildAbilityModifiers(abilityModifiers, review) {
  const out = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, special: 0 };
  let sawAny = false;
  for (const am of abilityModifiers || []) {
    if (am.ability === "any") {
      sawAny = true;
      out.special = am.value;
    } else {
      const key = ABILITY_SHORT[am.ability] || am.ability;
      if (key in out) out[key] += am.value;
    }
  }
  if (sawAny) {
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      if (out[key] === 0) out[key] = "any";
    }
    review.push(
      reviewNote(
        "ability_modifiers",
        "Source data marks an \"any\" ability bonus without a count (\"any one\" vs \"any two\" aren't distinguished) — every non-fixed slot was marked \"any\"; confirm the count matches the race's actual text.",
      ),
    );
  }
  return out;
}
