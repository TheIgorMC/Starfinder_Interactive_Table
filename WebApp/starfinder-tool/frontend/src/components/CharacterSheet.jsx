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

  // A pack with nothing left in its reserve (capacity - used <= 0) and no
  // spare packs (quantity <= 0) is permanently useless — nothing can ever
  // refill it again, so it's just a dead 0/0 row cluttering the list.
  // Applied only from the actions that can actually cause depletion (the
  // pack/spares "consume" steppers, and Reload) — never from a generic
  // updateItem/updateItems call — so editing some unrelated field on an
  // ammo item a GM just hasn't configured numbers for yet can't silently
  // vanish it.
  const isDepletedAmmo = (it) => it.type === "Ammunition" && (it.capacity ?? 0) - (it.used ?? 0) <= 0 && (it.quantity ?? 0) <= 0;
  const updateItemPruned = (id, changes) => {
    const next = equipment.map((it) => (it.id === id ? { ...it, ...changes } : it));
    patchEquipment(next.filter((it) => it.id !== id || !isDepletedAmmo(it)));
  };
  const updateItemsPruned = (idToChanges) => {
    const next = equipment.map((it) => (idToChanges.has(it.id) ? { ...it, ...idToChanges.get(it.id) } : it));
    patchEquipment(next.filter((it) => !idToChanges.has(it.id) || !isDepletedAmmo(it)));
  };

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
  // Two ammo rows with the same name and capacity aren't necessarily a
  // duplicate — a loaded battery and a spare battery are both real,
  // independently-tracked items (that's the whole point of "Reload"
  // swapping between them). What actually needs distinguishing them in the
  // UI is which weapon, if any, currently has each one loaded.
  const weaponByAmmoId = new Map();
  for (const w of equipment.filter((it) => it.type === "Weapon")) {
    for (const a of linkedAmmo(w, equipment)) weaponByAmmoId.set(a.id, w.name);
  }

  // Ammo model: a pack (capacity/used) is a reserve pool — e.g. a
  // high-capacity battery holds 40 charges total. The weapon has its OWN
  // magazine, separately tracked as `loadedCharges` on the weapon item
  // (undefined = assumed full, matching a freshly-imported/never-fired
  // weapon). Fire only ever drains the weapon's magazine. Reload is the
  // only thing that touches a pack: it tops the magazine back up to full,
  // drawing that amount out of the linked pack's remaining pool — and if
  // the current pack doesn't have enough left, opens a fresh one from its
  // `quantity` of spares (discarding whatever was left in the old one, same
  // as swapping batteries at the table).
  const magazineSize = (weapon, packs) => weapon.capacity || packs[0]?.capacity || 0;

  const fireWeapon = (weapon) => {
    const packs = linkedAmmo(weapon, equipment);
    const magSize = magazineSize(weapon, packs);
    const loaded = weapon.loadedCharges ?? magSize;
    if (loaded <= 0) return;
    updateItem(weapon.id, { loadedCharges: Math.max(0, loaded - (weapon.usage || 1)) });
  };
  const reloadWeapon = (weapon) => {
    const packs = linkedAmmo(weapon, equipment);
    const magSize = magazineSize(weapon, packs);
    if (!packs.length || !magSize) return;
    let need = magSize;
    const changes = new Map();
    for (const pack of packs) {
      if (need <= 0) break;
      let used = pack.used ?? 0;
      let quantity = pack.quantity ?? 0;
      let remaining = (pack.capacity ?? 0) - used;
      if (remaining <= 0 && quantity > 0) {
        // this pack is spent — open a fresh one from the spares
        used = 0;
        quantity -= 1;
        remaining = pack.capacity ?? 0;
      }
      const draw = Math.min(need, remaining);
      if (draw > 0) { used += draw; need -= draw; }
      changes.set(pack.id, { used, quantity });
    }
    // Whatever couldn't be drawn (ran out of packs entirely) just leaves
    // the magazine short of full instead of silently pretending it reloaded.
    changes.set(weapon.id, { loadedCharges: magSize - need });
    updateItemsPruned(changes);
  };

  const spells = normalizeSpells(char.spells);
  // No dedicated "is a caster" flag exists on a character — infer it from
  // the same data the Spells tab itself would show: an actual
  // spellcasting class (Mystic/Technomancer/Witchwarper, core SF1e's
  // casters) on the sheet, or spell data already present (a multiclass/
  // archetype caster, or a GM-authored homebrew NPC that doesn't use one
  // of those three class names). A blank non-caster never has either.
  const CASTER_CLASSES = new Set(["mystic", "technomancer", "witchwarper"]);
  const isCaster = spells.classes.length > 0 || spells.additional.length > 0 || CASTER_CLASSES.has((char.class || "").trim().toLowerCase());
  const visibleTabs = TABS.filter((t) => t.key !== "spells" || isCaster);
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
        {visibleTabs.map((t) => (
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

          <section className="defense-strip">
            <div className="stat"><label>EAC</label><strong>{char.eac}</strong></div>
            <div className="stat"><label>KAC</label><strong>{char.kac}</strong></div>
            <div className="stat"><label>Init</label><strong>{fmt(char.init_bonus)}</strong></div>
            <div className="stat"><label>Speed</label><strong>{char.speed} ft</strong></div>
          </section>

          <section className="save-strip">
            <div className="stat"><label>Fort</label><strong>{fmt(char.save_fort)}</strong></div>
            <div className="stat"><label>Ref</label><strong>{fmt(char.save_ref)}</strong></div>
            <div className="stat"><label>Will</label><strong>{fmt(char.save_will)}</strong></div>
            <div className="stat"><label>BAB</label><strong>{fmt(char.bab)}</strong></div>
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
                  const magSize = magazineSize(w, ammo);
                  const loaded = w.loadedCharges ?? magSize;
                  return (
                    <li key={w.id} className="sheet-card">
                      <strong>{w.name}</strong> <span className="muted">{itemSubtitle(w)}</span>
                      {ammo.length > 0 && (
                        <div className="row">
                          <span className="muted">Loaded: {loaded}/{magSize}</span>
                          <button onClick={() => fireWeapon(w)} disabled={loaded <= 0}>Fire</button>
                          <button onClick={() => reloadWeapon(w)} disabled={loaded >= magSize}>Reload</button>
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
                {ammoItems.map((a) => {
                  const reloadsFor = weaponByAmmoId.get(a.id);
                  return (
                    <li key={a.id} className="sheet-card ammo-card">
                      <div className="ammo-card-info">
                        <strong>{a.name}</strong>
                        <span className="muted">
                          {itemSubtitle(a)}
                          {reloadsFor ? ` · reload source for ${reloadsFor}` : " · unlinked"}
                        </span>
                      </div>
                      <div className="ammo-card-steppers">
                        <div className="ammo-card-stepper">
                          <span className="muted">pack</span>
                          <button onClick={() => updateItemPruned(a.id, { used: Math.min(a.capacity ?? 0, (a.used || 0) + 1) })}>−</button>
                          <button onClick={() => updateItem(a.id, { used: Math.max(0, (a.used || 0) - 1) })}>+</button>
                        </div>
                        <div className="ammo-card-stepper">
                          <span className="muted">spares ({a.quantity ?? 0})</span>
                          <button onClick={() => updateItemPruned(a.id, { quantity: Math.max(0, (a.quantity || 0) - 1) })}>−</button>
                          <button onClick={() => updateItem(a.id, { quantity: (a.quantity || 0) + 1 })}>+</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
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
