import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import {
  ABILITIES, ABILITY_LABELS, QUICK_ARRAYS, POINT_BUY_POOL, SCORE_CAP,
  abilityMod, fmtMod, applyAbilityModifiers, hasAnyAbilityChoice,
  keyAbilityOptions, SKILLS, classSkillSet, deriveStats,
} from "../lib/sfCalc.js";

// Guided 9-step character creation wizard, following AoN's Character
// Creation Steps (Starfinder Core Rulebook pg. 14–16) — see
// docs/09-character-creation-flow.md for the full mapping. Nothing is
// written to the backend until the final "Create" step: a single
// POST /api/characters with the fully assembled draft, using the exact
// same FIELDS the rest of the app already reads/writes.
//
// Only two ability-score methods are offered (point buy, quick array) —
// the rolling method from AoN is intentionally not implemented here.

const STEPS = [
  { key: "concept", label: "Concept" },
  { key: "race", label: "Race" },
  { key: "theme", label: "Theme" },
  { key: "class", label: "Class" },
  { key: "abilities", label: "Ability Scores" },
  { key: "derived", label: "Class Features" },
  { key: "skills", label: "Skills & Feats" },
  { key: "equipment", label: "Equipment" },
  { key: "finish", label: "Finish" },
];

const EQUIPMENT_CATEGORIES = ["weapon", "armor", "shield", "gear", "augmentation", "technological", "consumable", "goods"];

function AoNPicker({ category, sources, selected, onSelect, placeholder }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category, limit: "50" });
    if (sources?.length) params.set("sources", sources.join(","));
    if (q) params.set("q", q);
    api(`/aon?${params.toString()}`).then(setRows).finally(() => setLoading(false));
  }, [category, q, sources?.join(",")]);

  return (
    <div className="wizard-picker">
      <input placeholder={placeholder || "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <p className="muted">Loading…</p>}
      <ul className="sheet-list wizard-picker-list">
        {rows.map((r) => (
          <li key={r.id} className={`sheet-card wizard-pick-card${selected?.id === r.id ? " active" : ""}`} onClick={() => onSelect(r)}>
            <strong>{r.name}</strong> <span className="muted">{r.source}</span>
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="muted">No entries found — check owned sources or try a different search.</li>}
      </ul>
    </div>
  );
}

function AoNMultiPicker({ category, sources, chosen, onAdd, onRemove, placeholder }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const chosenIds = new Set(chosen.map((c) => c.id));

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category, limit: "50" });
    if (sources?.length) params.set("sources", sources.join(","));
    if (q) params.set("q", q);
    api(`/aon?${params.toString()}`).then(setRows).finally(() => setLoading(false));
  }, [category, q, sources?.join(",")]);

  return (
    <div className="wizard-picker">
      <input placeholder={placeholder || "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <p className="muted">Loading…</p>}
      <ul className="sheet-list wizard-picker-list">
        {rows.map((r) => (
          <li key={r.id} className={`sheet-card wizard-pick-card${chosenIds.has(r.id) ? " active" : ""}`}
            onClick={() => (chosenIds.has(r.id) ? onRemove(r) : onAdd(r))}>
            <strong>{r.name}</strong> <span className="muted">{r.source}</span>
            {chosenIds.has(r.id) && <span className="pill ok" style={{ marginLeft: 8 }}>added</span>}
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="muted">No entries found — check owned sources or try a different search.</li>}
      </ul>
    </div>
  );
}

export default function CharacterCreationWizard({ onCreated, onCancel }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [ownedSources, setOwnedSources] = useState([]);
  const [wealthLimit, setWealthLimit] = useState({ mode: "manual", credits: 1000 });

  const [name, setName] = useState("");
  const [alignment, setAlignment] = useState("");
  const [description, setDescription] = useState("");
  const [homeworld, setHomeworld] = useState("");

  const [race, setRace] = useState(null);
  const [raceAnyAbility, setRaceAnyAbility] = useState("str");

  const [theme, setTheme] = useState(null);
  const [themeAnyAbility, setThemeAnyAbility] = useState("str");

  const [klass, setKlass] = useState(null);
  const [level, setLevel] = useState(1);
  const [keyAbility, setKeyAbility] = useState("str");

  const [method, setMethod] = useState("pointbuy");
  const [pointSpend, setPointSpend] = useState({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  const [arrayKey, setArrayKey] = useState("focused");
  // Each ability holds a *slot index* into QUICK_ARRAYS[arrayKey].values, not
  // the value itself — arrays like Split (16,16,...) have duplicate values,
  // so tracking by index is what makes "each slot used once" enforceable.
  const [arraySlots, setArraySlots] = useState({ str: null, dex: null, con: null, int: null, wis: null, cha: null });

  const [skillRanks, setSkillRanks] = useState({});
  const [feats, setFeats] = useState([]);
  const [featSlots, setFeatSlots] = useState(1);

  const [equipment, setEquipment] = useState([]);
  const [credits, setCredits] = useState(1000);

  useEffect(() => {
    api("/settings/owned_sources").then((s) => setOwnedSources(s.value || []));
    api("/settings/new_pc_wealth_limit").then((s) => {
      const v = s.value || { mode: "manual", credits: 1000 };
      setWealthLimit(v);
      setCredits(v.credits ?? 1000);
    });
  }, []);

  useEffect(() => {
    if (klass?.data?.keyAbilityScore) {
      const opts = keyAbilityOptions(klass.data.keyAbilityScore);
      if (opts.length && !opts.includes(keyAbility)) setKeyAbility(opts[0]);
    }
  }, [klass]);

  // Race/theme ability adjustments feed into the baseline scores for point
  // buy; quick array ignores them (per AoN's Ability Quick Picks rules).
  const raceModifiers = race?.mechanics?.abilityModifiers || [];
  const themeModifiers = theme?.mechanics?.abilityModifiers || [];

  const baselineScores = useMemo(() => {
    const base = Object.fromEntries(ABILITIES.map((a) => [a, 10]));
    const withRace = applyAbilityModifiers(base, raceModifiers, raceAnyAbility);
    return applyAbilityModifiers(withRace, themeModifiers, themeAnyAbility);
  }, [race, theme, raceAnyAbility, themeAnyAbility]);

  const pointBuyScores = useMemo(() => {
    const out = {};
    for (const a of ABILITIES) out[a] = Math.min(SCORE_CAP, baselineScores[a] + (pointSpend[a] || 0));
    return out;
  }, [baselineScores, pointSpend]);

  const pointsUsed = ABILITIES.reduce((sum, a) => sum + (pointSpend[a] || 0), 0);
  const pointsLeft = POINT_BUY_POOL - pointsUsed;

  const finalScores = method === "array"
    ? Object.fromEntries(ABILITIES.map((a) => [a, arraySlots[a] != null ? QUICK_ARRAYS[arrayKey].values[arraySlots[a]] : 10]))
    : pointBuyScores;

  const stats = useMemo(() => deriveStats({
    level, scores: finalScores, raceHitPoints: race?.data?.hitPoints || 0, klass: klass?.data, keyAbility,
  }), [level, finalScores, race, klass, keyAbility]);

  const classSkills = classSkillSet(klass?.data?.classSkills);
  const totalRanksSpent = Object.values(skillRanks).reduce((s, r) => s + (r || 0), 0);
  const ranksLeft = stats.skillRanksTotal - totalRanksSpent;

  const spentCredits = equipment.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.quantity || 1), 0);
  const creditsLeft = credits - spentCredits;

  const step = STEPS[stepIdx];
  const goNext = () => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  const canNext = {
    concept: !!name,
    race: !!race,
    theme: !!theme,
    class: !!klass,
    abilities: method === "pointbuy" ? pointsLeft === 0 : ABILITIES.every((a) => arraySlots[a] != null),
    derived: true,
    skills: ranksLeft >= 0 && feats.length <= featSlots,
    equipment: creditsLeft >= 0,
    finish: true,
  }[step.key];

  const create = async () => {
    const body = {
      name, race: race?.name || "", theme: theme?.name || "", class: klass?.name || "", level,
      str: finalScores.str, dex: finalScores.dex, con: finalScores.con,
      int: finalScores.int, wis: finalScores.wis, cha: finalScores.cha,
      hp_max: stats.hp_max, hp_cur: stats.hp_cur,
      sp_max: stats.sp_max, sp_cur: stats.sp_cur,
      rp_max: stats.rp_max, rp_cur: stats.rp_cur,
      eac: stats.eac, kac: stats.kac, bab: stats.bab,
      save_fort: stats.save_fort, save_ref: stats.save_ref, save_will: stats.save_will,
      init_bonus: stats.init_bonus, speed: stats.speed,
      skills: Object.fromEntries(SKILLS.map(([sname, ability]) => {
        const ranks = skillRanks[sname] || 0;
        const isClass = classSkills.has(sname.toLowerCase());
        const total = ranks + stats.mods[ability] + (ranks > 0 && isClass ? 3 : 0);
        return [sname, { total, ranks, ability, classSkill: isClass, notes: "" }];
      })),
      feats: feats.map((f) => ({ id: f.id, name: f.name, prerequisite: f.data?.prerequisite || "", benefit: f.data?.effect || "" })),
      spells: [],
      equipment: equipment.map((it) => ({ ...it, isEquipped: false, stashed: false })),
      notes: description,
      credits: creditsLeft,
      conditions: {},
    };
    const c = await api("/characters", { method: "POST", body });
    onCreated?.(c);
  };

  return (
    <div className="wizard">
      <nav className="wizard-steps">
        {STEPS.map((s, i) => (
          // Tabs only let you jump backward to a step you've already passed —
          // jumping ahead has to go through Next, which enforces each step's
          // own requirements one at a time (see `canNext`).
          <button key={s.key} className={i === stepIdx ? "active" : ""} disabled={i > stepIdx}
            onClick={() => i <= stepIdx && setStepIdx(i)}>
            {i + 1}. {s.label}
          </button>
        ))}
      </nav>

      <div className="wizard-body">
        {step.key === "concept" && (
          <div className="wizard-step">
            <h3>Who are you?</h3>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" />
            <label>Alignment</label>
            <input value={alignment} onChange={(e) => setAlignment(e.target.value)} placeholder="e.g. Neutral Good" />
            <label>Homeworld</label>
            <input value={homeworld} onChange={(e) => setHomeworld(e.target.value)} placeholder="Where they were raised" />
            <label>Description / backstory</label>
            <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        )}

        {step.key === "race" && (
          <div className="wizard-step">
            <h3>Choose a race</h3>
            <p className="muted">Filtered to your table's owned sourcebooks (GM → Sources).</p>
            <AoNPicker category="race" sources={ownedSources} selected={race} onSelect={setRace} placeholder="Search races…" />
            {race && hasAnyAbilityChoice(raceModifiers) && (
              <div className="wizard-any-ability">
                <label>Racial "+2 any" applies to:</label>
                <select value={raceAnyAbility} onChange={(e) => setRaceAnyAbility(e.target.value)}>
                  {ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_LABELS[a]}</option>)}
                </select>
              </div>
            )}
            {race && (
              <div className="sheet-card">
                <strong>{race.name}</strong>
                <p className="muted">Hit Points: {race.data?.hitPoints ?? 0} · {race.data?.sizeAndType || ""}</p>
              </div>
            )}
          </div>
        )}

        {step.key === "theme" && (
          <div className="wizard-step">
            <h3>Choose a theme</h3>
            <AoNPicker category="theme" sources={ownedSources} selected={theme} onSelect={setTheme} placeholder="Search themes…" />
            {theme && hasAnyAbilityChoice(themeModifiers) && (
              <div className="wizard-any-ability">
                <label>Theme's "any" ability bonus applies to:</label>
                <select value={themeAnyAbility} onChange={(e) => setThemeAnyAbility(e.target.value)}>
                  {ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_LABELS[a]}</option>)}
                </select>
              </div>
            )}
            {theme && (
              <div className="sheet-card">
                <strong>{theme.name}</strong>
                <p className="muted">Theme skill: {theme.data?.themeSkill || "—"}</p>
              </div>
            )}
          </div>
        )}

        {step.key === "class" && (
          <div className="wizard-step">
            <h3>Choose a class</h3>
            <AoNPicker category="class" sources={ownedSources} selected={klass} onSelect={setKlass} placeholder="Search classes…" />
            {klass && (
              <>
                <div className="sheet-card">
                  <strong>{klass.name}</strong>
                  <p className="muted">
                    Key ability: {klass.data?.keyAbilityScore} · BAB: {klass.data?.baseAttackBonus} ·
                    {" "}HP/level: {klass.data?.hitPointsPerLevel} · SP/level: {klass.data?.staminaPointsPerLevel} ·
                    {" "}Skill ranks/level: {klass.data?.skillRanksPerLevel}
                  </p>
                </div>
                {keyAbilityOptions(klass.data?.keyAbilityScore).length > 1 && (
                  <div className="wizard-any-ability">
                    <label>Key ability score for this build:</label>
                    <select value={keyAbility} onChange={(e) => setKeyAbility(e.target.value)}>
                      {keyAbilityOptions(klass.data?.keyAbilityScore).map((a) => <option key={a} value={a}>{ABILITY_LABELS[a]}</option>)}
                    </select>
                  </div>
                )}
                <label>Level</label>
                <input type="number" min="1" max="20" value={level} onChange={(e) => setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              </>
            )}
          </div>
        )}

        {step.key === "abilities" && (
          <div className="wizard-step">
            <h3>Finalize ability scores</h3>
            <div className="row">
              <label className="checkbox-inline">
                <input type="radio" checked={method === "pointbuy"} onChange={() => setMethod("pointbuy")} /> Point buy
              </label>
              <label className="checkbox-inline">
                <input type="radio" checked={method === "array"} onChange={() => setMethod("array")} /> Quick array
              </label>
            </div>

            {method === "pointbuy" && (
              <>
                <p className="muted">
                  Baseline already includes race/theme adjustments. Spend 10 points, 1-for-1, no score above 18.
                  Points remaining: <strong>{pointsLeft}</strong>
                </p>
                <table className="sheet-table">
                  <thead><tr><th>Ability</th><th>Baseline</th><th>Spend</th><th>Final</th><th>Mod</th></tr></thead>
                  <tbody>
                    {ABILITIES.map((a) => (
                      <tr key={a}>
                        <td>{ABILITY_LABELS[a]}</td>
                        <td className="muted">{baselineScores[a]}</td>
                        <td>
                          <div className="row">
                            <button onClick={() => setPointSpend((p) => ({ ...p, [a]: Math.max(0, (p[a] || 0) - 1) }))} disabled={(pointSpend[a] || 0) <= 0}>−</button>
                            <strong>{pointSpend[a] || 0}</strong>
                            <button
                              onClick={() => setPointSpend((p) => ({ ...p, [a]: (p[a] || 0) + 1 }))}
                              disabled={pointsLeft <= 0 || baselineScores[a] + (pointSpend[a] || 0) >= SCORE_CAP}
                            >+</button>
                          </div>
                        </td>
                        <td><strong>{pointBuyScores[a]}</strong></td>
                        <td>{fmtMod(abilityMod(pointBuyScores[a]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {method === "array" && (
              <>
                <p className="muted">Race/theme ability adjustments don't apply with quick arrays — assign each value to one ability (each slot can only be used once).</p>
                <select value={arrayKey} onChange={(e) => { setArrayKey(e.target.value); setArraySlots({ str: null, dex: null, con: null, int: null, wis: null, cha: null }); }}>
                  {Object.entries(QUICK_ARRAYS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <table className="sheet-table">
                  <thead><tr><th>Ability</th><th>Value</th><th>Mod</th></tr></thead>
                  <tbody>
                    {ABILITIES.map((a) => {
                      const takenElsewhere = new Set(ABILITIES.filter((o) => o !== a && arraySlots[o] != null).map((o) => arraySlots[o]));
                      return (
                        <tr key={a}>
                          <td>{ABILITY_LABELS[a]}</td>
                          <td>
                            <select
                              value={arraySlots[a] ?? ""}
                              onChange={(e) => setArraySlots((cur) => ({ ...cur, [a]: e.target.value === "" ? null : Number(e.target.value) }))}
                            >
                              <option value="">—</option>
                              {QUICK_ARRAYS[arrayKey].values.map((v, i) => (
                                <option key={i} value={i} disabled={takenElsewhere.has(i)}>{v}</option>
                              ))}
                            </select>
                          </td>
                          <td>{arraySlots[a] != null ? fmtMod(abilityMod(QUICK_ARRAYS[arrayKey].values[arraySlots[a]])) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {step.key === "derived" && (
          <div className="wizard-step">
            <h3>Class features (auto-calculated)</h3>
            <p className="muted">These come straight from your race/class/level — nothing to fill in here.</p>
            <section className="pools">
              <div className="pool"><span>HP</span><strong>{stats.hp_max}</strong></div>
              <div className="pool"><span>SP</span><strong>{stats.sp_max}</strong></div>
              <div className="pool"><span>RP</span><strong>{stats.rp_max}</strong></div>
            </section>
            <section className="grid-6">
              <div className="stat"><label>EAC</label><strong>{stats.eac}</strong></div>
              <div className="stat"><label>KAC</label><strong>{stats.kac}</strong></div>
              <div className="stat"><label>BAB</label><strong>{fmtMod(stats.bab)}</strong></div>
              <div className="stat"><label>Fort</label><strong>{fmtMod(stats.save_fort)}</strong></div>
              <div className="stat"><label>Ref</label><strong>{fmtMod(stats.save_ref)}</strong></div>
              <div className="stat"><label>Will</label><strong>{fmtMod(stats.save_will)}</strong></div>
              <div className="stat"><label>Init</label><strong>{fmtMod(stats.init_bonus)}</strong></div>
              <div className="stat"><label>Speed</label><strong>{stats.speed} ft</strong></div>
            </section>
          </div>
        )}

        {step.key === "skills" && (
          <div className="wizard-step">
            <h3>Assign skill ranks</h3>
            <p className="muted">
              Ranks available: <strong>{stats.skillRanksTotal}</strong>, remaining: <strong>{ranksLeft}</strong>.
              Max rank per skill at this level is {level}. ★ = class skill (+3 once ranked).
            </p>
            <table className="sheet-table">
              <thead><tr><th /><th>Skill</th><th>Ability</th><th>Ranks</th><th>Total</th></tr></thead>
              <tbody>
                {SKILLS.map(([sname, ability]) => {
                  const isClass = classSkills.has(sname.toLowerCase());
                  const ranks = skillRanks[sname] || 0;
                  const total = ranks + stats.mods[ability] + (ranks > 0 && isClass ? 3 : 0);
                  return (
                    <tr key={sname} className={isClass ? "class-skill" : ""}>
                      <td>{isClass ? "★" : ""}</td>
                      <td>{sname}</td>
                      <td className="muted">{ability}</td>
                      <td>
                        <div className="row">
                          <button onClick={() => setSkillRanks((r) => ({ ...r, [sname]: Math.max(0, ranks - 1) }))} disabled={ranks <= 0}>−</button>
                          <strong>{ranks}</strong>
                          <button onClick={() => setSkillRanks((r) => ({ ...r, [sname]: ranks + 1 }))} disabled={ranksLeft <= 0 || ranks >= level}>+</button>
                        </div>
                      </td>
                      <td><strong>{fmtMod(total)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Feats</h3>
            <label>Feat slots</label>
            <input type="number" min="1" value={featSlots} onChange={(e) => setFeatSlots(Math.max(1, Number(e.target.value) || 1))} />
            <p className="muted">Most characters start with 1 feat; bump this up if your race grants a bonus feat.</p>
            <AoNMultiPicker
              category="feat" sources={ownedSources} chosen={feats}
              onAdd={(f) => feats.length < featSlots && setFeats((cur) => [...cur, f])}
              onRemove={(f) => setFeats((cur) => cur.filter((x) => x.id !== f.id))}
              placeholder="Search feats…"
            />
            <p className="muted">Chosen: {feats.map((f) => f.name).join(", ") || "none"} ({feats.length}/{featSlots})</p>
          </div>
        )}

        {step.key === "equipment" && (
          <div className="wizard-step">
            <h3>Buy equipment</h3>
            <p className="muted">
              Starting credits: <strong>{credits.toLocaleString()}</strong>
              {wealthLimit.mode === "auto" ? " (GM-set, based on current party)" : ""} ·
              {" "}spent: {spentCredits.toLocaleString()} · remaining: <strong>{creditsLeft.toLocaleString()}</strong>
            </p>
            <EquipmentPicker sources={ownedSources} equipment={equipment} setEquipment={setEquipment} />
          </div>
        )}

        {step.key === "finish" && (
          <div className="wizard-step">
            <h3>Ready to adventure</h3>
            <div className="sheet-card">
              <strong>{name}</strong>
              <p className="muted">{race?.name} {theme?.name} {klass?.name} — level {level}</p>
              <p>Alignment: {alignment || "—"} · Homeworld: {homeworld || "—"}</p>
              <p>HP {stats.hp_max} · SP {stats.sp_max} · RP {stats.rp_max} · EAC {stats.eac} · KAC {stats.kac}</p>
              <p>Credits remaining: {creditsLeft.toLocaleString()}</p>
            </div>
            <button onClick={create}>Create character</button>
          </div>
        )}
      </div>

      <div className="wizard-nav">
        {onCancel && <button className="link" onClick={onCancel}>Cancel</button>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={goBack} disabled={stepIdx === 0}>Back</button>
          {step.key !== "finish" && <button onClick={goNext} disabled={!canNext}>Next</button>}
        </div>
      </div>
    </div>
  );
}

function EquipmentPicker({ sources, equipment, setEquipment }) {
  const [cat, setCat] = useState("weapon");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category: cat, limit: "50" });
    if (sources?.length) params.set("sources", sources.join(","));
    if (q) params.set("q", q);
    api(`/aon?${params.toString()}`).then(setRows).finally(() => setLoading(false));
  }, [cat, q, sources?.join(",")]);

  const add = (item) => {
    const existing = equipment.find((it) => it.aonId === item.id);
    if (existing) {
      setEquipment(equipment.map((it) => (it.aonId === item.id ? { ...it, quantity: (it.quantity || 1) + 1 } : it)));
    } else {
      setEquipment([...equipment, {
        id: `wiz-${item.id}`, aonId: item.id, name: item.name, type: cat === "weapon" ? "Weapon" : cat === "armor" ? "Armor" : "Item",
        price: item.data?.price || 0, bulk: item.data?.bulk || 0, quantity: 1,
      }]);
    }
  };
  const remove = (id) => setEquipment(equipment.filter((it) => it.id !== id));
  const changeQty = (id, qty) => setEquipment(equipment.map((it) => (it.id === id ? { ...it, quantity: Math.max(1, qty) } : it)));

  return (
    <div className="wizard-equipment">
      <div className="row">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Search equipment…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && <p className="muted">Loading…</p>}
      <ul className="sheet-list wizard-picker-list">
        {rows.map((r) => (
          <li key={r.id} className="sheet-card wizard-pick-card" onClick={() => add(r)}>
            <strong>{r.name}</strong> <span className="muted">{r.data?.price ?? 0} cr · {r.data?.bulk ?? 0} bulk</span>
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="muted">No entries found.</li>}
      </ul>

      <h4>Cart</h4>
      <table className="sheet-table">
        <thead><tr><th>Name</th><th>Qty</th><th>Price</th><th /></tr></thead>
        <tbody>
          {equipment.map((it) => (
            <tr key={it.id}>
              <td>{it.name}</td>
              <td><input type="number" min="1" value={it.quantity || 1} onChange={(e) => changeQty(it.id, Number(e.target.value) || 1)} style={{ width: 60 }} /></td>
              <td>{(it.price || 0) * (it.quantity || 1)}</td>
              <td><button className="link" onClick={() => remove(it.id)}>remove</button></td>
            </tr>
          ))}
          {equipment.length === 0 && <tr><td colSpan={4} className="muted">Cart is empty.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
