// Canonical sourcebook names, shared by every pipeline that produces an
// aon-cache entry's `source` field: the Foundry importer (foundry-import.js,
// abbreviation-heavy — "CRB", "COM", "AA2") and the AoN scraper
// (scrape-aon.js, which lifts the book's full title straight off the page's
// own "Source" line — "Starfinder Core Rulebook"). Both are meant to land
// on the exact same string for the exact same book; before this was shared,
// each pipeline normalized independently (or not at all), so the live
// `aon_entries` table ended up with the same book under several different
// spellings — see scripts/normalize-sources.js for the retroactive cleanup
// over already-imported data.
//
// Keys are matched case-sensitively against the raw string *after* any
// page-number suffix has already been stripped (normalizeSource() below
// does that). Extend this list as new raw variants turn up — the cleanup
// script's report (run with no --apply) is the fastest way to find them:
// it prints every distinct raw `source` value in the live table, most-
// common first, so a new abbreviation shows up as its own line immediately
// next to the canonical book it should have mapped to.
export const SOURCE_BOOKS = {
  CRB: "Starfinder Core Rulebook",
  "Core Rulebook": "Starfinder Core Rulebook",
  "Starfinder Core Rulebook": "Starfinder Core Rulebook",
  COM: "Character Operations Manual",
  "Character Operation Manual": "Character Operations Manual",
  "Character Operations Manual": "Character Operations Manual",
  EN: "Starfinder Enhanced",
  "Starfinder Enhanced": "Starfinder Enhanced",
  AA: "Alien Archive", AA1: "Alien Archive", "Alien Archive": "Alien Archive",
  AA2: "Alien Archive 2", "Alien Archive 2": "Alien Archive 2",
  AA3: "Alien Archive 3", "Alien Archive 3": "Alien Archive 3",
  AA4: "Alien Archive 4", "Alien Archive 4": "Alien Archive 4",
  PW: "Pact Worlds", "Pact Worlds": "Pact Worlds",
  NS: "Near Space", "Near Space": "Near Space",
  GM: "Galactic Magic", "Galactic Magic": "Galactic Magic",
  GEM: "Galaxy Exploration Manual", "Galaxy Exploration Manual": "Galaxy Exploration Manual",
  SOM: "Ship Operations Manual", "Ship Operations Manual": "Ship Operations Manual",
  IS: "Interstellar Species", "Interstellar Species": "Interstellar Species",
  DC: "Drift Crisis", "Drift Crisis": "Drift Crisis",
  AR: "Armory", "Armory": "Armory",
  TR: "Tech Revolution", "Tech Revolution": "Tech Revolution",
  FFD: "Fly Free or Die", "Fly Free or Die": "Fly Free or Die",
};

// Page markers show up as " pg. 42", ", p. 60", " pg, 51" (typo), " pp.
// 316-317" (a page *range*, on rules/setting citing a multi-page section),
// "CRB.277" (conditions/effects/universal-creature-rules favor this dotted
// form with no "pg"/"p" token at all), and even "GEM pg .23" (a stray
// period before the digits) — inconsistent across items and categories, so
// the separator between the page token and the digits is matched
// permissively (any run of periods/commas/spaces) rather than one exact
// shape. Confirmed live against every distinct raw `source` string in the
// Foundry checkout (Docs/04-data-pipeline-aon.md's audit trail) — see
// PR discussion / commit history for the specific broken cases this
// replaced (a plural "pp." or an extra period before "pg" used to corrupt
// the book code, e.g. "CRB, pp. 316-317" -> book "CRB, p").
export function normalizeSource(raw) {
  if (!raw) return { book: "", page: null };
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const pageMatch = /\b(?:pg|pp|p)[.,\s]*(\d+)/i.exec(cleaned);
  let bookPart, page;
  if (pageMatch) {
    bookPart = cleaned.slice(0, pageMatch.index);
    page = Number(pageMatch[1]);
  } else {
    const dotted = /^([A-Za-z0-9 ]+?)\.(\d+)$/.exec(cleaned);
    // A bare "BOOK, 179" with no "pg"/"p" token at all (equipment/
    // grenade_arrow_ii.json and its siblings) — only taken when the
    // digits are the very end of the string, so a mid-string number that
    // isn't a page ("AP #34" or a book edition number) is never misread.
    const bareTrailingNumber = /^(.*?),\s*(\d+)$/.exec(cleaned);
    if (dotted) {
      bookPart = dotted[1];
      page = Number(dotted[2]);
    } else if (bareTrailingNumber) {
      bookPart = bareTrailingNumber[1];
      page = Number(bareTrailingNumber[2]);
    } else {
      bookPart = cleaned;
      page = null;
    }
  }
  // No digits ever showed up (e.g. "EN pg." with the page left blank
  // upstream) — the mandatory \d+ above never matched, so a dangling
  // "pg"/"p"/"pp" token is still sitting on the end of bookPart; drop it
  // rather than showing "EN pg." as if that were the book's name.
  bookPart = bookPart.replace(/[,]?\s*\b(?:pg|pp|p)\.?\s*$/i, "");
  bookPart = bookPart.replace(/[.,]+\s*$/, "").trim();
  // A free-text prefix before the real code (racial-features/cheek-pouches.json's
  // "Ysoki - CRB pg. 54") — only unwrapped when the suffix after the last
  // " - " is itself a recognized book, so a genuine label like "Operative -
  // Alternate Class Feature" (no page, no real book after the dash) is left
  // exactly as-is rather than guessed at.
  if (!SOURCE_BOOKS[bookPart] && bookPart.includes(" - ")) {
    const suffix = bookPart.slice(bookPart.lastIndexOf(" - ") + 3).trim();
    if (SOURCE_BOOKS[suffix]) bookPart = suffix;
  }
  return { book: SOURCE_BOOKS[bookPart] || bookPart, page };
}

// Adventure Path / module names are real, distinct sourcebooks too (each
// issue has its own rules content) but can't be enumerated in SOURCE_BOOKS
// the same way — there are dozens, and they're not abbreviations of a
// shared book, just long titles. Recognized by their conventional "Starfinder
// Adventure Path #<n>: <title>" or "Pact Worlds Index"-style shape so
// scripts/normalize-sources.js doesn't flag every single one as suspicious.
const KNOWN_GOOD_PATTERN = /^(Starfinder )?(Adventure Path|Society|Module)\b/i;

// Heuristic for "this almost certainly isn't a real sourcebook name" —
// used by scripts/normalize-sources.js to flag entries for a human/AI pass
// rather than silently renaming them (renaming requires knowing the right
// answer; flagging only requires noticing something's off). Deliberately
// conservative: false negatives (a bad value that slips through) are fine,
// since the canonical-mapping pass still catches known-bad exact strings;
// false positives (flagging a real book name) just mean one more row for a
// human to glance at and clear, not a new error introduced into the data.
export function looksLikeSuspiciousSource(raw) {
  const s = (raw || "").trim();
  if (!s) return "empty";
  if (SOURCE_BOOKS[s] || Object.values(SOURCE_BOOKS).includes(s)) return null;
  if (KNOWN_GOOD_PATTERN.test(s)) return null;
  if (s.length > 60) return "too long to be a book title (likely a parsing leak)";
  // A genuine book title is Title Case words, digits, #, :, &, - — no
  // sentence-ending punctuation, no lowercase leading article run that
  // reads like mid-sentence prose ("the ability to ..." leaking in from a
  // body-text field instead of the Source line).
  if (/[.!?]$/.test(s)) return "ends in sentence punctuation (likely leaked prose, not a title)";
  if (/^(the|a|an|and|or|but|this|that|with|for) /i.test(s)) return "starts like mid-sentence prose, not a title";
  if (/\bhttps?:\/\//i.test(s)) return "contains a URL";
  return null;
}
