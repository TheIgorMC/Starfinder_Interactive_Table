// Shared between Campaign.jsx (the per-type tree view) and Sessions.jsx
// (cascading a location/faction/quest link to its sub-entries) — both work
// off the same hierarchy-nesting links tgn-import.js writes on the backend
// (see backend/src/tgn-import.js's HIERARCHY_RELATION_BY_TYPE). A link
// using one of these exact labels, from a child to its parent, is treated
// as tree structure rather than an ordinary cross-reference; a GM-authored
// link with one of these exact labels gets the same treatment.
export const HIERARCHY_RELATIONS = new Set(["si trova in", "parte di", "sotto-quest di", "sotto-capitolo di"]);

// parentId -> [childId, ...], built from every hierarchy-relation link
// regardless of type (tgn-import.js only ever nests same-type entries, so
// this never needs a type filter to stay correct).
export function buildChildrenIndex(links) {
  const childrenOf = new Map();
  for (const l of links) {
    if (!HIERARCHY_RELATIONS.has(l.relation)) continue;
    if (!childrenOf.has(l.to_id)) childrenOf.set(l.to_id, []);
    childrenOf.get(l.to_id).push(l.from_id);
  }
  return childrenOf;
}

// Every descendant of `id` (children, grandchildren, ...), flattened.
export function descendantIds(id, childrenOf) {
  const out = [];
  const seen = new Set([id]);
  const stack = [...(childrenOf.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const c of childrenOf.get(cur) || []) stack.push(c);
  }
  return out;
}
