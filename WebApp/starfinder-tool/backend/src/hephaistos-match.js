// Proposes compendium (aon_entries) matches for every free-text name a
// Hephaistos export carries — race, theme, class(es), feats, spells, and
// inventory items — so a GM can eyeball "is this actually the entry we
// have on file, or did Hephaistos spell/label it differently" before an
// import commits. Never blocks or auto-corrects anything itself; it only
// proposes candidates, in score order, for the frontend's review step to
// show and the GM to accept or override.

const EQUIPMENT_CATEGORIES = [
  "weapon", "armor", "gear", "augmentation", "technological", "magic",
  "consumable", "hybrid", "upgrade", "fusion", "goods", "ammunition",
  "shield", "weaponAccessory", "container",
];

function normalizeForMatch(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// A small self-contained heuristic (exact / substring / word-overlap), not
// a real fuzzy-match library — good enough to rank candidates for a human
// to glance at and confirm, which is the whole point here.
function matchScore(query, candidate) {
  const a = normalizeForMatch(query);
  const b = normalizeForMatch(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wa = new Set(a.split(" "));
  const wb = new Set(b.split(" "));
  const overlap = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? (overlap / union) * 0.7 : 0;
}

// Every distinct spell name a Hephaistos export can carry lives under
// classes[].spells (the class's actual known/prepared list — spellsKnown
// is just per-level counts, not names, see hephaistos.js) and the
// top-level additionalSpells array. Entries may be a bare string or an
// object with a `name`.
function collectSpellNames(hephaistos) {
  const names = [];
  for (const c of hephaistos.classes ?? []) {
    for (const s of c.spells ?? []) names.push(typeof s === "string" ? s : s?.name);
  }
  for (const s of hephaistos.additionalSpells ?? []) names.push(typeof s === "string" ? s : s?.name);
  return names.filter(Boolean);
}

function collectItems(hephaistos) {
  const items = [];
  if (hephaistos.race?.name) items.push({ field: "race", name: hephaistos.race.name, categories: ["race"] });
  if (hephaistos.theme?.name) items.push({ field: "theme", name: hephaistos.theme.name, categories: ["theme"] });
  for (const c of hephaistos.classes ?? []) {
    if (c?.name) items.push({ field: "class", name: c.name, categories: ["class"] });
  }
  for (const f of hephaistos.feats?.acquiredFeats ?? []) {
    const name = typeof f === "string" ? f : f?.name;
    if (name) items.push({ field: "feats", name, categories: ["feat"] });
  }
  for (const name of collectSpellNames(hephaistos)) {
    items.push({ field: "spells", name, categories: ["spell"] });
  }
  for (const it of hephaistos.inventory ?? []) {
    if (it?.name) items.push({ field: "equipment", name: it.name, categories: EQUIPMENT_CATEGORIES });
  }
  return items;
}

export async function previewHephaistosMatches(pool, hephaistos) {
  const items = collectItems(hephaistos);
  if (!items.length) return [];

  // Fetch each needed category once (not once per item — a character
  // easily has a dozen+ feats/spells, no reason to re-scan the same table
  // for each of them).
  const neededCategories = [...new Set(items.flatMap((it) => it.categories))];
  const { rows } = await pool.query(
    "SELECT id, category, name, source FROM aon_entries WHERE category = ANY($1::text[])",
    [neededCategories]
  );
  const rowsByCategory = new Map();
  for (const row of rows) {
    if (!rowsByCategory.has(row.category)) rowsByCategory.set(row.category, []);
    rowsByCategory.get(row.category).push(row);
  }

  // Dedupe by (categories, lowercased name) — the same feat/spell/item
  // name showing up more than once on a sheet only needs matching once.
  const seen = new Map();
  const results = [];
  for (const it of items) {
    const key = `${it.categories.join(",")}::${it.name.toLowerCase()}`;
    if (seen.has(key)) {
      results.push(seen.get(key));
      continue;
    }
    const candidatePool = it.categories.flatMap((c) => rowsByCategory.get(c) || []);
    const candidates = candidatePool
      .map((row) => ({ id: row.id, name: row.name, category: row.category, source: row.source, score: matchScore(it.name, row.name) }))
      .filter((c) => c.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const entry = { field: it.field, name: it.name, candidates, exact: candidates[0]?.score === 1 };
    seen.set(key, entry);
    results.push(entry);
  }
  return results;
}
