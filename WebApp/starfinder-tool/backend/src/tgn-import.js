import { load as loadYaml } from "js-yaml";

// Parses a Tangent (.tgn) campaign export — a YAML file with a
// `meta.columns` schema (Tangent's per-campaign type config: LOCATION /
// ORGANISATION / CREATURE / QUEST / THING, each with its own subtypes), a
// recursive `objects` tree per column (locations nest inside locations,
// etc. — a system nests inside its sector, a moon inside its planet), a
// flat `connections` list (id1/id2/note relationship edges) and a
// `timeline` list (campaign chapters). Maps all of it onto this app's
// existing campaign_entries/campaign_links tables (see migrations/006 +
// 011) rather than inventing parallel tables — that's exactly the "typed
// entries + relationships" shape those already are.
//
// Only two passes are needed: the first flattens the tree (so a
// Tangent-internal id can be resolved to a name for cross-references), the
// second turns each node into a campaign_entries row plus its links.

const CATEGORY_TO_TYPE = {
  LOCATION: "location",
  ORGANISATION: "faction",
  CREATURE: "npc",
  QUEST: "quest",
  THING: "object",
};

// The relation label written for a tree-nesting edge (child -> its parent
// in Tangent's `children` array), per entry type — "si trova in" reads
// right for a moon under its planet, but a sub-quest isn't "located in"
// its parent quest, and an NPC nested under a faction folder isn't either.
// Exported so the frontend can recognize these specific labels as tree
// edges (see frontend/src/components/Campaign.jsx's tree builder) without
// hardcoding the map twice.
export const HIERARCHY_RELATION_BY_TYPE = {
  location: "si trova in",
  faction: "parte di",
  npc: "parte di",
  quest: "sotto-quest di",
  object: "parte di",
  event: "sotto-capitolo di",
};

// Tangent's blurb markdown carries a few bits of its own syntax that don't
// mean anything outside the app: `$[objectname]` is a live template
// variable for the entry's own name, `![](url){hotspot,list}` appends
// clickable-hotspot coordinates to an otherwise ordinary image (stripped —
// nothing here renders those), and `@[label](id)` is an inline link to
// another Tangent object by its internal id (resolved to that object's
// name, since `id` means nothing once imported).
function cleanBlurb(blurb, name, idToName) {
  if (!blurb) return "";
  let text = blurb
    .replace(/^#\s*\$\[objectname\]\s*\n*/, "")
    .replaceAll("$[objectname]", name)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)\{[^}]*\}/g, "![$1]($2)")
    .replace(/@\[[^\]]*\]\(([a-z0-9]+)\)/gi, (whole, id) => {
      const linked = idToName.get(id);
      return linked ? `**${linked}**` : whole;
    });
  return text.trim();
}

function summarize(cleanedBody) {
  const plain = cleanedBody
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*_>`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 280);
}

export function parseTgn(yamlText) {
  const doc = loadYaml(yamlText);
  if (!doc || typeof doc !== "object") throw new Error("empty or invalid YAML document");

  const columns = doc.meta?.columns || [];
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const subtypeNamesByColumn = new Map(
    columns.map((c) => [c.id, new Map((c.types || []).map((t) => [t.id, t.name]))])
  );

  // Pass 1: flatten the recursive `objects` trees + timeline into one list,
  // recording parent/child and every id's display name along the way.
  const flat = [];
  const idToName = new Map();

  function walk(node, entryType, subtypeNames, parentId) {
    if (!node?.id) return;
    idToName.set(node.id, node.name || "");
    flat.push({
      id: node.id,
      name: node.name?.trim() || "(untitled)",
      type: entryType,
      subtype: subtypeNames.get(node.subtype) || "",
      blurb: node.blurb || "",
      chapters: node.chapters || [],
      parentId,
    });
    for (const child of node.children || []) walk(child, entryType, subtypeNames, node.id);
  }

  for (const group of doc.objects || []) {
    const column = columnById.get(group.id);
    const entryType = CATEGORY_TO_TYPE[column?.base_type] || "object";
    const subtypeNames = subtypeNamesByColumn.get(group.id) || new Map();
    for (const obj of group.objects || []) walk(obj, entryType, subtypeNames, null);
  }

  const chapters = doc.timeline || [];
  for (const ch of chapters) {
    if (!ch?.id) continue;
    idToName.set(ch.id, ch.name || "");
    flat.push({
      id: ch.id,
      name: ch.name?.trim() || "(untitled)",
      type: "event",
      subtype: "",
      blurb: ch.blurb || "",
      chapters: [],
      parentId: null,
      eventDate: ch.order != null ? `Capitolo ${ch.order}` : "",
    });
  }

  // Pass 2: build the campaign_entries rows + campaign_links edges.
  const entries = flat.map((f) => {
    const body = cleanBlurb(f.blurb, f.name, idToName);
    const summary = summarize(body);
    return {
      external_id: f.id,
      type: f.type,
      name: f.name,
      summary: f.subtype ? `[${f.subtype}] ${summary}` : summary,
      body,
      event_date: f.eventDate || "",
      visible_to_players: false,
    };
  });

  const links = [];
  for (const f of flat) {
    // Tree nesting (e.g. a moon under its planet, a sub-quest under its
    // parent quest) becomes an explicit link, same shape as an ordinary
    // Tangent connection — the tree structure itself isn't stored anywhere
    // else once flattened, so the frontend's tree view rebuilds it from
    // exactly this label (HIERARCHY_RELATION_BY_TYPE).
    if (f.parentId) links.push({ from: f.id, to: f.parentId, relation: HIERARCHY_RELATION_BY_TYPE[f.type] || "parte di" });
    for (const chapterId of f.chapters) links.push({ from: f.id, to: chapterId, relation: "appare in" });
  }
  for (const c of doc.connections || []) {
    if (!c.id1 || !c.id2) continue;
    links.push({ from: c.id1, to: c.id2, relation: c.note || "" });
  }

  return { entries, links };
}

// Writes a parsed .tgn into campaign_entries/campaign_links. Deliberately
// insert-only for entries already seen before (ON CONFLICT DO NOTHING on
// external_id): once a GM starts hand-editing an imported entry through the
// normal Campaign UI, a re-import (e.g. after fixing a parsing bug, or
// pulling in a newer Tangent export) must never silently overwrite that
// edit. Re-importing is safe to run repeatedly — it only ever adds
// entries/links this app hasn't seen yet.
export async function importTgnIntoDb(pool, parsed) {
  const idByExternalId = new Map();
  let inserted = 0;

  for (const e of parsed.entries) {
    const { rows } = await pool.query(
      `INSERT INTO campaign_entries (external_id, type, name, summary, body, event_date, visible_to_players)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id
       RETURNING id, external_id, xmax = 0 AS inserted`,
      [e.external_id, e.type, e.name, e.summary, e.body, e.event_date, e.visible_to_players]
    );
    idByExternalId.set(rows[0].external_id, rows[0].id);
    if (rows[0].inserted) inserted++;
  }

  let linked = 0;
  for (const l of parsed.links) {
    const fromId = idByExternalId.get(l.from);
    const toId = idByExternalId.get(l.to);
    if (!fromId || !toId || fromId === toId) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO campaign_links (from_id, to_id, relation) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [fromId, toId, l.relation]
    );
    linked += rowCount;
  }

  return { entriesSeen: parsed.entries.length, entriesInserted: inserted, linksInserted: linked };
}
