import React, { useState } from "react";

const mod = (score) => Math.floor((score - 10) / 2);
const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6];

// Hephaistos's own condition keys (camelCase) and display labels — shown
// even for characters imported before `conditions` existed, or created
// from scratch (self-service players), so the list is always complete.
const STANDARD_CONDITIONS = [
  ["asleep", "Asleep"], ["bleeding", "Bleeding"], ["blinded", "Blinded"], ["broken", "Broken"],
  ["burning", "Burning"], ["confused", "Confused"], ["cowering", "Cowering"], ["dazed", "Dazed"],
  ["dazzled", "Dazzled"], ["dead", "Dead"], ["deafened", "Deafened"], ["dying", "Dying"],
  ["encumbered", "Encumbered"], ["entangled", "Entangled"], ["exhausted", "Exhausted"],
  ["fascinated", "Fascinated"], ["fatigued", "Fatigued"], ["flatFooted", "Flat-footed"],
  ["frightened", "Frightened"], ["grappled", "Grappled"], ["helpless", "Helpless"],
  ["nauseated", "Nauseated"], ["offKilter", "Off-kilter"], ["offTarget", "Off-target"],
  ["overburdened", "Overburdened"], ["panicked", "Panicked"], ["paralyzed", "Paralyzed"],
  ["pinned", "Pinned"], ["prone", "Prone"], ["shaken", "Shaken"], ["sickened", "Sickened"],
  ["stable", "Stable"], ["staggered", "Staggered"], ["stunned", "Stunned"], ["unconscious", "Unconscious"],
];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "skills", label: "Skills" },
  { key: "feats", label: "Feats" },
  { key: "spells", label: "Spells" },
  { key: "inventory", label: "Inventory" },
  { key: "conditions", label: "Conditions" },
  { key: "notes", label: "Notes" },
];

// Normalizes whatever shape `spells`/`skills` happen to be in — older rows
// (or ones written outside this app) may still have the flat shapes the
// importer used before the sheet needed slots/ranks. Never throws on
// unexpected data; worst case a section just renders as empty.
function normalizeSpells(spells) {
  if (Array.isArray(spells)) {
    return { classes: spells.length ? [{ name: "Spells", spellsKnown: [], spellsPerDay: [], spellsUsed: [], spells }] : [], additional: [] };
  }
  return { classes: spells?.classes || [], additional: spells?.additional || [] };
}

function normalizeSkill(entry) {
  if (typeof entry === "number") return { total: entry, ranks: 0, ability: "", classSkill: false, notes: "" };
  return entry || { total: 0, ranks: 0, ability: "", classSkill: false, notes: "" };
}

function formatWeaponDamage(item) {
  if (!item.damage) return "";
  const dice = item.damage.dice ? `${item.damage.dice.count}d${item.damage.dice.sides}` : "";
  const bonus = item.damageBonus ? `+${item.damageBonus}` : "";
  const types = (item.damage.damage || []).join("/");
  return [`${dice}${bonus}`.trim(), types].filter(Boolean).join(" ");
}

function itemEquipped(item) {
  return item.type === "ArmorUpgrade" ? !!item.isInstalled : !!item.isEquipped;
}

function itemSubtitle(item) {
  switch (item.type) {
    case "Weapon": {
      const parts = [formatWeaponDamage(item), item.weaponType].filter(Boolean);
      if (item.critical?.name) parts.push(`crit ${item.critical.name}`);
      return parts.join(" · ");
    }
    case "Armor":
      return [item.armorType, item.eacBonus != null && `EAC +${item.eacBonus}`, item.kacBonus != null && `KAC +${item.kacBonus}`]
        .filter(Boolean).join(" · ");
    case "Ammunition":
      return `${(item.capacity ?? 0) - (item.used ?? 0)}/${item.capacity ?? 0} remaining${item.quantity > 1 ? ` (×${item.quantity} stacks)` : ""}`;
    case "ArmorUpgrade":
      return [item.slots != null && `${item.slots} slot${item.slots === 1 ? "" : "s"}`, (item.forArmorTypes || []).join("/")].filter(Boolean).join(" · ");
    default:
      return item.itemType || "";
  }
}

// A weapon's `ammunitionId` can be a comma-separated list (multiple loaded
// mags/batteries) — resolve to the actual ammo item rows so "remaining"
// reflects everything currently linked, not just the first one.
function linkedAmmo(weapon, equipment) {
  if (!weapon.ammunitionId) return [];
  const ids = new Set(String(weapon.ammunitionId).split(",").map((s) => s.trim()));
  return equipment.filter((e) => ids.has(String(e.id)));
}

export default function CharacterSheet({ character, patch }) {
  const [tab, setTab] = useState("overview");
  const char = character;

  const Pool = ({ label, cur, max, curKey }) => (
    <div className="pool">
      <span>{label}</span>
      <button onClick={() => patch({ [curKey]: Math.max(0, char[curKey] - 1) })}>−</button>
      <strong>{cur} / {max}</strong>
      <button onClick={() => patch({ [curKey]: Math.min(max, char[curKey] + 1) })}>+</button>
    </div>
  );

  const equipment = Array.isArray(char.equipment) ? char.equipment : [];
  const patchEquipment = (next) => patch({ equipment: next });
  const updateItem = (id, changes) => patchEquipment(equipment.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  // For touching several items in one go (e.g. reloading a weapon linked to
  // multiple ammo stacks) — updateItem() alone would have each call compute
  // its new array from the same stale `equipment` closure and clobber the
  // previous call's change instead of composing with it.
  const updateItems = (idToChanges) => patchEquipment(equipment.map((it) => (idToChanges.has(it.id) ? { ...it, ...idToChanges.get(it.id) } : it)));

  // SF1e bulk rule: items lighter than 1 Bulk ("L") don't add up fractionally —
  // every 10 light items together count as 1 Bulk, any remainder is dropped.
  // Summing the raw fractional values instead (e.g. 8 light items -> 0.8)
  // overstates carried bulk and never lines up with the source sheet's total.
  const sumBulk = (items) => {
    let heavy = 0;
    let lightCount = 0;
    for (const it of items) {
      const b = Number(it.bulk) || 0;
      const q = it.quantity || 1;
      if (b > 0 && b < 1) lightCount += q;
      else heavy += b * q;
    }
    return Math.round((heavy + Math.floor(lightCount / 10)) * 10) / 10;
  };
  const carriedBulk = sumBulk(equipment.filter((it) => !it.stashed));
  const stashedBulk = sumBulk(equipment.filter((it) => it.stashed));

  const equippedWeapons = equipment.filter((it) => it.type === "Weapon" && it.isEquipped);
  const ammoItems = equipment.filter((it) => it.type === "Ammunition");

  const fireWeapon = (weapon) => {
    const ammo = linkedAmmo(weapon, equipment).filter((a) => (a.used ?? 0) < (a.capacity ?? 0));
    if (!ammo.length) return;
    const target = ammo[0];
    updateItem(target.id, { used: Math.min(target.capacity ?? 0, (target.used ?? 0) + (weapon.usage || 1)) });
  };
  const reloadWeapon = (weapon) => {
    const changes = new Map(linkedAmmo(weapon, equipment).map((a) => [a.id, { used: 0 }]));
    if (changes.size) updateItems(changes);
  };

  const spells = normalizeSpells(char.spells);
  const restAll = () => patch({
    spells: { ...spells, classes: spells.classes.map((c) => ({ ...c, spellsUsed: (c.spellsPerDay || []).map(() => 0) })) },
  });
  const castSpell = (classIdx, level, delta) => {
    const classes = spells.classes.map((c, i) => {
      if (i !== classIdx) return c;
      const used = [...(c.spellsUsed || c.spellsPerDay.map(() => 0))];
      used[level] = Math.max(0, Math.min(c.spellsPerDay[level] || 0, (used[level] || 0) + delta));
      return { ...c, spellsUsed: used };
    });
    patch({ spells: { ...spells, classes } });
  };

  const skillEntries = Object.entries(char.skills || {}).map(([name, v]) => [name, normalizeSkill(v)])
    .sort(([a], [b]) => a.localeCompare(b));

  const conditions = char.conditions || {};
  const toggleCondition = (key) => patch({
    conditions: { ...conditions, [key]: { ...(conditions[key] || {}), active: !conditions[key]?.active } },
  });
  const setConditionNotes = (key, notes) => patch({
    conditions: { ...conditions, [key]: { ...(conditions[key] || {}), notes } },
  });

  const [notesDraft, setNotesDraft] = useState(char.notes || "");
  const notesDirty = notesDraft !== (char.notes || "");

  return (
    <div className="sheet">
      <header className="sheet-header">
        {char.portrait_url && <img className="sheet-portrait" src={char.portrait_url} alt="" />}
        <div>
          <h2>{char.name}</h2>
          <p className="muted">{char.race} {char.theme} {char.class} — level {char.level}</p>
        </div>
        <div className="sheet-credits">
          <label>Credits</label>
          <input
            type="number" value={char.credits ?? 0}
            onChange={(e) => patch({ credits: Number(e.target.value) || 0 })}
          />
        </div>
      </header>

      <nav className="sheet-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>

      {tab === "overview" && (
        <div>
          <section className="grid-6">
            {ABILITIES.map((a) => (
              <div key={a} className="stat">
                <label>{a.toUpperCase()}</label>
                <strong>{char[a]}</strong>
                <span>{fmt(mod(char[a]))}</span>
              </div>
            ))}
          </section>

          <section className="pools">
            <Pool label="SP" cur={char.sp_cur} max={char.sp_max} curKey="sp_cur" />
            <Pool label="HP" cur={char.hp_cur} max={char.hp_max} curKey="hp_cur" />
            <Pool label="RP" cur={char.rp_cur} max={char.rp_max} curKey="rp_cur" />
          </section>

          <section className="grid-6">
            <div className="stat"><label>EAC</label><strong>{char.eac}</strong></div>
            <div className="stat"><label>KAC</label><strong>{char.kac}</strong></div>
            <div className="stat"><label>BAB</label><strong>{fmt(char.bab)}</strong></div>
            <div className="stat"><label>Fort</label><strong>{fmt(char.save_fort)}</strong></div>
            <div className="stat"><label>Ref</label><strong>{fmt(char.save_ref)}</strong></div>
            <div className="stat"><label>Will</label><strong>{fmt(char.save_will)}</strong></div>
            <div className="stat"><label>Init</label><strong>{fmt(char.init_bonus)}</strong></div>
            <div className="stat"><label>Speed</label><strong>{char.speed} ft</strong></div>
          </section>
        </div>
      )}

      {tab === "skills" && (
        <table className="sheet-table">
          <colgroup>
            <col style={{ width: "24px" }} />
            <col />
            <col style={{ width: "60px" }} />
            <col style={{ width: "90px" }} />
            <col style={{ width: "60px" }} />
          </colgroup>
          <thead><tr><th /><th>Skill</th><th>Ranks</th><th>Ability</th><th>Total</th></tr></thead>
          <tbody>
            {skillEntries.map(([name, s]) => (
              <tr key={name} className={s.classSkill ? "class-skill" : ""}>
                <td title={s.classSkill ? "Class skill" : ""}>{s.classSkill ? "★" : ""}</td>
                <td>{name}</td>
                <td>{s.ranks}</td>
                <td className="muted">{s.ability}</td>
                <td><strong>{fmt(s.total)}</strong></td>
              </tr>
            ))}
            {skillEntries.length === 0 && <tr><td colSpan={5} className="muted">No skills recorded.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === "feats" && (
        <ul className="sheet-list">
          {(char.feats || []).map((f, i) => {
            const feat = typeof f === "string" ? { name: f } : f;
            return (
              <li key={feat.id || i} className="sheet-card">
                <strong>{feat.name}</strong>
                {feat.isCombatFeat && <span className="pill">combat</span>}
                {feat.prerequisite && <p className="muted">Prerequisite: {feat.prerequisite}</p>}
                {feat.benefit && <p>{feat.benefit}</p>}
                {(feat.selectedOptions || []).map((o, j) => <p key={j} className="muted">Selected: {o.name}</p>)}
              </li>
            );
          })}
          {(!char.feats || char.feats.length === 0) && <li className="muted">No feats recorded.</li>}
        </ul>
      )}

      {tab === "spells" && (
        <div>
          <button onClick={restAll}>Long rest (reset all slots)</button>
          {spells.classes.map((c, ci) => (
            <div key={c.name + ci} className="sheet-card">
              <h3>{c.name}</h3>
              {SPELL_LEVELS.filter((lvl) => (c.spellsPerDay?.[lvl] || 0) > 0).map((lvl) => (
                <div className="pool" key={lvl}>
                  <span>Level {lvl}</span>
                  <button onClick={() => castSpell(ci, lvl, 1)}>Cast</button>
                  <strong>{c.spellsUsed?.[lvl] || 0} / {c.spellsPerDay[lvl]} used</strong>
                  <button onClick={() => castSpell(ci, lvl, -1)}>Undo</button>
                </div>
              ))}
              {!SPELL_LEVELS.some((lvl) => (c.spellsPerDay?.[lvl] || 0) > 0) && <p className="muted">No spell slots.</p>}
              {(c.spells || []).length > 0 && (
                <>
                  <h4>Known spells</h4>
                  <p>{c.spells.map((s) => (typeof s === "string" ? s : s.name)).join(", ")}</p>
                </>
              )}
            </div>
          ))}
          {spells.classes.length === 0 && <p className="muted">No spellcasting classes.</p>}
          {spells.additional.length > 0 && (
            <div className="sheet-card">
              <h4>Additional spells</h4>
              <p>{spells.additional.map((s) => (typeof s === "string" ? s : s.name)).join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {tab === "inventory" && (
        <div>
          <p className="muted">Carried bulk: {carriedBulk} {stashedBulk > 0 && `(+${stashedBulk} stashed)`}</p>

          {equippedWeapons.length > 0 && (
            <>
              <h3>Equipped weapons</h3>
              <ul className="sheet-list">
                {equippedWeapons.map((w) => {
                  const ammo = linkedAmmo(w, equipment);
                  const remaining = ammo.reduce((sum, a) => sum + ((a.capacity ?? 0) - (a.used ?? 0)), 0);
                  const capacityTotal = ammo.reduce((sum, a) => sum + (a.capacity ?? 0), 0);
                  return (
                    <li key={w.id} className="sheet-card">
                      <strong>{w.name}</strong> <span className="muted">{itemSubtitle(w)}</span>
                      {ammo.length > 0 && (
                        <div className="row">
                          <span className="muted">Ammo: {remaining}/{capacityTotal}</span>
                          <button onClick={() => fireWeapon(w)} disabled={remaining <= 0}>Fire</button>
                          <button onClick={() => reloadWeapon(w)}>Reload</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {ammoItems.length > 0 && (
            <>
              <h3>Ammunition</h3>
              <ul className="sheet-list">
                {ammoItems.map((a) => (
                  <li key={a.id} className="row">
                    <span>{a.name}</span>
                    <span className="muted">{itemSubtitle(a)}</span>
                    <button onClick={() => updateItem(a.id, { used: Math.max(0, (a.used || 0) - 1) })}>−</button>
                    <button onClick={() => updateItem(a.id, { used: Math.min(a.capacity ?? 0, (a.used || 0) + 1) })}>+</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>All equipment</h3>
          <table className="sheet-table">
            <colgroup>
              <col />
              <col />
              <col style={{ width: "50px" }} />
              <col style={{ width: "56px" }} />
              <col style={{ width: "76px" }} />
              <col style={{ width: "76px" }} />
            </colgroup>
            <thead><tr><th>Name</th><th>Details</th><th>Qty</th><th>Bulk</th><th>Equipped</th><th>Stashed</th></tr></thead>
            <tbody>
              {equipment.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="muted">{itemSubtitle(it)}</td>
                  <td>{it.quantity ?? 1}</td>
                  <td>{it.bulk ?? 0}</td>
                  <td>
                    {(it.type === "Weapon" || it.type === "Armor" || it.type === "Item" || it.type === "ArmorUpgrade") && (
                      <input type="checkbox" checked={itemEquipped(it)}
                        onChange={(e) => updateItem(it.id, it.type === "ArmorUpgrade" ? { isInstalled: e.target.checked } : { isEquipped: e.target.checked })} />
                    )}
                  </td>
                  <td><input type="checkbox" checked={!!it.stashed} onChange={(e) => updateItem(it.id, { stashed: e.target.checked })} /></td>
                </tr>
              ))}
              {equipment.length === 0 && <tr><td colSpan={6} className="muted">No equipment recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "conditions" && (
        <ul className="sheet-list conditions-list">
          {STANDARD_CONDITIONS.map(([key, label]) => {
            const c = conditions[key] || { active: false, notes: "" };
            return (
              <li key={key} className="row">
                <label className="checkbox-inline">
                  <input type="checkbox" checked={!!c.active} onChange={() => toggleCondition(key)} />
                  {label}
                </label>
                {c.active && (
                  <input placeholder="notes" value={c.notes || ""} onChange={(e) => setConditionNotes(key, e.target.value)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "notes" && (
        <div>
          <textarea rows={12} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
          <button onClick={() => patch({ notes: notesDraft })} disabled={!notesDirty}>Save notes</button>
        </div>
      )}
    </div>
  );
}
