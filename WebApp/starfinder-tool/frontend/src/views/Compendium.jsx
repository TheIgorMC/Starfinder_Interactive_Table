import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

// Fields already shown elsewhere (header, dedicated columns, mechanics
// block) — don't repeat them in the generic "everything else in data" dump.
const HIDDEN_DATA_FIELDS = new Set(["sourceUrl", "sourcePage", "description", "prerequisite", "combat"]);
// Shown big and first, if present, ahead of the rest of the fields.
const HEADLINE_FIELD = "effect";

function fieldLabel(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const numOrNull = (v) => (v == null || v === "" ? null : Number(v));
// "L" (light bulk) sorts just above negligible ("-"), everything else is its face value.
const bulkValue = (b) => (b == null || b === "" || b === "-" ? 0 : /^l$/i.test(b) ? 0.1 : Number(b) || 0);

function formatCondition(c) {
  if (!c) return "";
  switch (c.type) {
    case "maxDistanceBetweenTargets": return `no two more than ${c.value} ${c.unit} apart`;
    case "abilityScore": return `${c.ability.toUpperCase()} ${c.min}+`;
    case "babMin": return `BAB +${c.value}`;
    case "minLevel": return `level ${c.value}+`;
    case "hasFeat": return c.option ? `${c.name} (${c.option})` : c.name;
    case "and": return (c.conditions || []).map(formatCondition).join(" and ");
    case "or": return (c.conditions || []).map(formatCondition).join(" or ");
    case "raw": return c.text;
    default: return c.raw || c.type;
  }
}

function formatRange(r) {
  if (!r) return "";
  if (r.unit === "personal") return "Personal";
  if (r.unit === "touch") return "Touch";
  if (r.unit === "unlimited") return "Unlimited";
  if (r.category) {
    const perLevelText = r.perLevel?.levels > 1 ? `${r.perLevel.levels} levels` : "level";
    return r.perLevel
      ? `${cap(r.category)} (${r.base} ft. + ${r.perLevel.amount} ft./${perLevelText})`
      : `${cap(r.category)}${r.raw ? ` (${r.raw})` : ""}`;
  }
  if (r.value != null) return `${r.value} ${r.unit === "mi" ? "mi." : "ft."}`;
  if (r.formula) return `${r.formula} ${r.unit === "mi" ? "mi." : "ft."}`;
  return r.raw || "";
}

function formatArea(a) {
  if (!a) return "";
  if (a.size != null) return `${a.size}-${a.unit || "ft"}. ${a.shape}`;
  if (a.formula) return `${a.formula} ${a.unit || "ft"}. ${a.shape}`;
  return a.shape || a.raw || "";
}

function formatDuration(d) {
  if (!d) return "";
  const suffix = d.dismissible ? " (D)" : "";
  if (["instantaneous", "permanent", "concentration"].includes(d.unit)) return cap(d.unit) + suffix;
  if (d.value != null) return `${d.value} ${d.unit}${d.value > 1 ? "s" : ""}${d.perLevel ? "/level" : ""}${suffix}`;
  if (d.formula) return `${d.formula} ${d.unit}${suffix}`;
  return (d.raw || "") + suffix;
}

function formatSavingThrow(s) {
  if (!s) return "";
  if (s.type === "none") return "None";
  if (s.type === "raw") return s.raw;
  const text = [cap(s.type), ...(s.effects || [])].join(" ");
  return s.dc ? `${text} (DC ${s.dc})` : text;
}

function formatModifier(m) {
  const parts = [m.name || "modifier", `${m.modifier}`];
  if (m.valueAffected) parts.push(`to ${m.valueAffected}`);
  else if (m.effectType) parts.push(`to ${fieldLabel(m.effectType)}`);
  if (m.condition) parts.push(`(${m.condition})`);
  return parts.join(" ");
}

function formatAbilityModifier(m) {
  return `${m.value >= 0 ? "+" : ""}${m.value} ${cap(m.ability)}`;
}

function formatActivation(a) {
  if (!a || !a.type) return "";
  const text = fieldLabel(a.type);
  return a.condition ? `${text} (${a.condition})` : text;
}

function formatSpellResistance(sr) {
  if (!sr) return "";
  if (sr.applies === true) return sr.harmless ? "Yes (harmless)" : sr.note ? `Yes (${sr.note})` : "Yes";
  if (sr.applies === false) return "No";
  return sr.raw || "";
}

function formatTargeting(t) {
  if (!t) return "";
  if (t.type === "raw") return t.raw;
  let text = "";
  if (t.count === "all") text = `all ${t.type === "area" ? "in area" : t.type + "s"}`;
  else if (t.count) text = `${t.count.min === t.count.max ? t.count.max : `up to ${t.count.max}`} ${t.type}${t.count.max > 1 ? "s" : ""}`;
  else text = t.type;
  const constraints = (t.constraints || []).map(formatCondition).filter(Boolean);
  return constraints.length ? `${text} (${constraints.join("; ")})` : text;
}

function formatAction(a) {
  if (a.kind !== "damage") return a.text || a.kind;
  const types = (a.damageTypes || []).join("/");
  return `${a.formula}${types ? ` ${types}` : ""}${a.onCritical ? " (critical)" : ""}`;
}

function formatArmorClass(ac) {
  if (!ac) return "";
  const parts = [`${cap(ac.type)} armor`];
  if (ac.eac != null) parts.push(`EAC +${ac.eac}`);
  if (ac.kac != null) parts.push(`KAC +${ac.kac}`);
  if (ac.maxDex != null) parts.push(`max Dex +${ac.maxDex}`);
  if (ac.acp) parts.push(`ACP ${ac.acp}`);
  if (ac.speedAdjust) parts.push(`speed ${ac.speedAdjust}`);
  if (ac.upgradeSlots != null) parts.push(`${ac.upgradeSlots} upgrade slot${ac.upgradeSlots === 1 ? "" : "s"}`);
  return parts.join(", ");
}

// Structured mechanics fields worth surfacing as a compact stat block,
// in display order — only rendered when the parser/curation actually
// populated that field for this entry.
function mechanicsRows(mechanics) {
  if (!mechanics) return [];
  const rows = [];
  if (mechanics.abilityModifiers?.length) rows.push(["Ability Modifiers", mechanics.abilityModifiers.map(formatAbilityModifier).join(", ")]);
  if (mechanics.activation) rows.push(["Activation", formatActivation(mechanics.activation)]);
  if (mechanics.armorClass) rows.push(["Armor", formatArmorClass(mechanics.armorClass)]);
  if (mechanics.targeting) rows.push(["Targets", formatTargeting(mechanics.targeting)]);
  if (mechanics.range) rows.push(["Range", formatRange(mechanics.range)]);
  if (mechanics.area) rows.push(["Area", formatArea(mechanics.area)]);
  if (mechanics.duration) rows.push(["Duration", formatDuration(mechanics.duration)]);
  if (mechanics.savingThrow) rows.push(["Saving Throw", formatSavingThrow(mechanics.savingThrow)]);
  if (mechanics.spellResistance) rows.push(["Spell Resistance", formatSpellResistance(mechanics.spellResistance)]);
  if (mechanics.weaponProperties?.length) rows.push(["Weapon Properties", mechanics.weaponProperties.join(", ")]);
  if (mechanics.actions?.length) rows.push(["Damage", mechanics.actions.map(formatAction).join("; ")]);
  if (mechanics.requirements?.length) rows.push(["Requirements", mechanics.requirements.map(formatCondition).join(", ")]);
  if (mechanics.modifiers?.length) rows.push(["Modifiers", mechanics.modifiers.map(formatModifier).join("; ")]);
  return rows.filter(([, v]) => v);
}

const MELEE_WEAPON_TYPES = new Set(["Basic Melee", "Advanced Melee"]);
const typeCol = { key: "category", label: "Type", get: (r) => fieldLabel(r.category) };
const sourceCol = { key: "source", label: "Source", get: (r) => r.source || "" };
const levelCol = { key: "level", label: "Lvl", numeric: true, get: (r) => numOrNull(r.data?.level) };
const priceCol = { key: "price", label: "Price", numeric: true, get: (r) => numOrNull(r.data?.price) };
const bulkCol = { key: "bulk", label: "Bulk", get: (r) => r.data?.bulk ?? "", sort: (r) => bulkValue(r.data?.bulk) };

// One tab per group of related categories, each rendered as its own
// sortable/filterable table. Category names not covered by any section
// below simply won't appear (there are none currently — every aon_entries
// category maps to exactly one section).
const SECTIONS = [
  {
    key: "spells", label: "Spells", categories: ["spell"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      levelCol,
      { key: "school", label: "School", get: (r) => r.data?.school || "" },
      { key: "range", label: "Range", get: (r) => formatRange(r.mechanics?.range) },
      { key: "duration", label: "Duration", get: (r) => formatDuration(r.mechanics?.duration) },
      { key: "save", label: "Save", get: (r) => formatSavingThrow(r.mechanics?.savingThrow) },
      sourceCol,
    ],
    facets: [
      { key: "school", label: "School", get: (r) => r.data?.school || "" },
      { key: "level", label: "Level", get: (r) => (r.data?.level != null ? String(r.data.level) : "") },
    ],
  },
  {
    key: "weapons", label: "Weapons", categories: ["weapon"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      { key: "weaponType", label: "Type", get: (r) => r.data?.weaponType || "" },
      { key: "weaponCategory", label: "Damage Type", get: (r) => r.data?.weaponCategory || "" },
      { key: "damage", label: "Damage", get: (r) => (r.mechanics?.actions || []).map(formatAction).join("; ") },
      { key: "range", label: "Range", get: (r) => formatRange(r.mechanics?.range) },
      bulkCol, levelCol, priceCol, sourceCol,
    ],
    facets: [
      { key: "weaponType", label: "Weapon Type", get: (r) => r.data?.weaponType || "" },
      { key: "weaponCategory", label: "Damage Type", get: (r) => r.data?.weaponCategory || "" },
      { key: "melee", label: "Melee / Ranged", get: (r) => (MELEE_WEAPON_TYPES.has(r.data?.weaponType) ? "Melee" : "Ranged") },
    ],
  },
  {
    key: "armor", label: "Armor & Shields", categories: ["armor", "shield"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      { key: "armorType", label: "Weight", get: (r) => r.data?.armorType || "" },
      { key: "eac", label: "EAC", numeric: true, get: (r) => r.mechanics?.armorClass?.eac ?? null },
      { key: "kac", label: "KAC", numeric: true, get: (r) => r.mechanics?.armorClass?.kac ?? null },
      { key: "maxDex", label: "Max Dex", numeric: true, get: (r) => r.mechanics?.armorClass?.maxDex ?? null },
      { key: "acp", label: "ACP", numeric: true, get: (r) => r.mechanics?.armorClass?.acp ?? null },
      bulkCol, levelCol, priceCol, sourceCol,
    ],
    facets: [{ key: "armorType", label: "Weight", get: (r) => r.data?.armorType || "" }],
  },
  {
    key: "ammo", label: "Ammunition", categories: ["ammunition", "weaponAccessory", "fusion"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      { key: "ammoType", label: "Ammo Type", get: (r) => r.data?.ammunitionType || "" },
      { key: "capacity", label: "Capacity", get: (r) => r.data?.capacity || r.data?.useCapacity || "" },
      bulkCol, levelCol, priceCol, sourceCol,
    ],
    facets: [{ key: "ammoType", label: "Ammo Type", get: (r) => r.data?.ammunitionType || "" }],
  },
  {
    key: "feats", label: "Feats", categories: ["feat"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      { key: "prerequisites", label: "Prerequisites", get: (r) => r.data?.prerequisites || "" },
      { key: "combat", label: "Combat", get: (r) => (r.data?.combat ? "Yes" : "") },
      sourceCol,
    ],
    facets: [{ key: "combat", label: "Combat feats", get: (r) => (r.data?.combat ? "Yes" : "No") }],
  },
  {
    key: "features", label: "Class / Racial / Theme Features",
    categories: ["class-feature", "racial-feature", "archetype-feature", "theme-feature", "universal-creature-rule"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      { key: "requirements", label: "Requirements", get: (r) => (r.mechanics?.requirements || []).map(formatCondition).join(", ") },
      sourceCol,
    ],
    facets: [],
  },
  {
    key: "items", label: "Gear & Items",
    categories: ["augmentation", "technological", "magic", "consumable", "hybrid", "upgrade", "goods", "container"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      { key: "subtype", label: "Subtype", get: (r) => r.data?.augmentationType || r.data?.consumableType || "" },
      bulkCol, levelCol, priceCol, sourceCol,
    ],
    facets: [{ key: "subtype", label: "Subtype", get: (r) => r.data?.augmentationType || r.data?.consumableType || "" }],
  },
  {
    key: "character", label: "Races, Classes & Archetypes", categories: ["race", "class", "archetype", "theme"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      sourceCol,
    ],
    facets: [],
  },
  {
    key: "conditions", label: "Conditions & Effects", categories: ["condition", "effect"],
    columns: [
      { key: "name", label: "Name", get: (r) => r.name },
      typeCol,
      sourceCol,
    ],
    facets: [],
  },
];

function compareRows(a, b, column) {
  const accessor = column.sort || column.get;
  const av = accessor(a), bv = accessor(b);
  if (av == null || av === "") return bv == null || bv === "" ? 0 : 1;
  if (bv == null || bv === "") return -1;
  if (column.numeric) return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv));
}

function ExpandedRow({ row, columns }) {
  const mechRows = useMemo(() => mechanicsRows(row.mechanics), [row]);
  const detailFields = useMemo(
    () => Object.entries(row.data || {}).filter(
      ([k, v]) => k !== HEADLINE_FIELD && !HIDDEN_DATA_FIELDS.has(k) && v !== null && v !== "" && v !== undefined
    ),
    [row]
  );
  return (
    <tr className="compendium-expand-row">
      <td colSpan={columns.length + 1}>
        <div className="compendium-expand">
          <p className="muted compendium-detail-source">
            {row.source}{row.data?.sourcePage != null && ` pg. ${row.data.sourcePage}`}
          </p>

          {mechRows.length > 0 && (
            <dl className="compendium-fields compendium-mechanics">
              {mechRows.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {row.data?.[HEADLINE_FIELD] && <p className="compendium-effect">{row.data[HEADLINE_FIELD]}</p>}

          {detailFields.length > 0 && (
            <dl className="compendium-fields">
              {detailFields.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{fieldLabel(k)}</dt>
                  <dd>{String(v)}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {row.url && (
            <p><a href={row.url} target="_blank" rel="noreferrer">View on Archives of Nethys ↗</a></p>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Compendium() {
  const [sectionKey, setSectionKey] = useState(SECTIONS[0].key);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [ownedSources, setOwnedSources] = useState([]);
  const [onlyOwned, setOnlyOwned] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [facetValues, setFacetValues] = useState({});
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedKey, setExpandedKey] = useState(null);

  const section = SECTIONS.find((s) => s.key === sectionKey);

  useEffect(() => {
    api("/aon/categories").then((rows) => {
      const counts = {};
      for (const r of rows) counts[r.category] = r.count;
      setCategoryCounts(counts);
    }).catch(() => {});
    api("/settings/owned_sources").then((s) => {
      const owned = s.value || [];
      setOwnedSources(owned);
      setOnlyOwned(owned.length > 0);
    });
  }, []);

  // Switching sections resets everything scoped to the previous one, then
  // fetches the whole section in one shot — sort/filter/search all happen
  // client-side afterward (sections top out around 3,300 rows, comfortably
  // fine to hold in memory for a personal-use tool).
  useEffect(() => {
    setTypeFilter(""); setSourceFilter(""); setFacetValues({}); setQ("");
    setSortKey("name"); setSortDir("asc"); setExpandedKey(null);
    setLoading(true); setError("");
    let cancelled = false;
    api(`/aon?categories=${section.categories.join(",")}&limit=5000`)
      .then((data) => { if (!cancelled) { setRows(data); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [sectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionTotal = section.categories.reduce((n, c) => n + (categoryCounts[c] || 0), 0);

  const sourceOptions = useMemo(() => {
    const counts = {};
    for (const r of rows) counts[r.source] = (counts[r.source] || 0) + 1;
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const facetOptions = useMemo(() => {
    const out = {};
    for (const f of section.facets) {
      const set = new Set(rows.map((r) => f.get(r)).filter(Boolean));
      out[f.key] = [...set].sort();
    }
    return out;
  }, [rows, section]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (typeFilter) list = list.filter((r) => r.category === typeFilter);
    if (sourceFilter) list = list.filter((r) => r.source === sourceFilter);
    else if (onlyOwned && ownedSources.length > 0) list = list.filter((r) => ownedSources.includes(r.source));
    for (const f of section.facets) {
      const val = facetValues[f.key];
      if (val) list = list.filter((r) => f.get(r) === val);
    }
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(needle));
    }
    return list;
  }, [rows, typeFilter, sourceFilter, onlyOwned, ownedSources, facetValues, q, section]);

  const sortedRows = useMemo(() => {
    const column = section.columns.find((c) => c.key === sortKey);
    if (!column) return filteredRows;
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filteredRows].sort((a, b) => compareRows(a, b, column) * dir);
  }, [filteredRows, sortKey, sortDir, section]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const rowKey = (r) => `${r.category}:${r.id}`;

  return (
    <div className="compendium">
      <header>
        <Link className="link" to="/">← Home</Link>
        <h2>Compendium</h2>
        <span className="muted">{sortedRows.length} of {sectionTotal || rows.length} shown</span>
      </header>

      <nav className="compendium-tabs">
        {SECTIONS.map((s) => {
          const total = s.categories.reduce((n, c) => n + (categoryCounts[c] || 0), 0);
          return (
            <button key={s.key} className={s.key === sectionKey ? "active" : ""} onClick={() => setSectionKey(s.key)}>
              {s.label}{total ? ` (${total})` : ""}
            </button>
          );
        })}
      </nav>

      <div className="compendium-filters">
        {section.categories.length > 1 && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {section.categories.map((c) => (
              <option key={c} value={c}>{fieldLabel(c)} ({categoryCounts[c] || 0})</option>
            ))}
          </select>
        )}

        {section.facets.map((f) => (
          <select key={f.key} value={facetValues[f.key] || ""} onChange={(e) => setFacetValues((v) => ({ ...v, [f.key]: e.target.value }))}>
            <option value="">{f.label}: all</option>
            {(facetOptions[f.key] || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}

        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">{onlyOwned && ownedSources.length > 0 ? "My sources" : "All sources"}</option>
          {sourceOptions.map(([s, count]) => (
            <option key={s || "(none)"} value={s}>{s || "(unknown source)"} ({count})</option>
          ))}
        </select>

        {ownedSources.length > 0 && (
          <label className="checkbox-inline" title="Uncheck to see entries from every imported source">
            <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} disabled={!!sourceFilter} />
            Only my sources
          </label>
        )}

        <input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="compendium-table-wrap">
        <table className="compendium-table">
          <thead>
            <tr>
              <th className="compendium-expand-col" />
              {section.columns.map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)} className={sortKey === col.key ? "sorted" : ""}>
                  {col.label}{sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={section.columns.length + 1} className="muted">Loading…</td></tr>}
            {error && <tr><td colSpan={section.columns.length + 1} className="pill bad">{error}</td></tr>}
            {!loading && !error && sortedRows.length === 0 && (
              <tr>
                <td colSpan={section.columns.length + 1} className="muted">
                  No results.{" "}
                  {onlyOwned && ownedSources.length > 0 && (
                    <button className="link" onClick={() => setOnlyOwned(false)}>Try showing all sources.</button>
                  )}
                </td>
              </tr>
            )}
            {!loading && sortedRows.map((r) => {
              const key = rowKey(r);
              const expanded = expandedKey === key;
              return (
                <React.Fragment key={key}>
                  <tr className={"compendium-row" + (expanded ? " active" : "")} onClick={() => setExpandedKey(expanded ? null : key)}>
                    <td className="compendium-expand-col">{expanded ? "▾" : "▸"}</td>
                    {section.columns.map((col) => (
                      <td key={col.key}>{col.key === "name" ? r.name : String(col.get(r) ?? "")}</td>
                    ))}
                  </tr>
                  {expanded && <ExpandedRow row={r} columns={section.columns} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
