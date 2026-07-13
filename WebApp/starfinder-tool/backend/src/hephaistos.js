// Maps a character JSON export from Hephaistos (hephaistos.online, a
// popular SF1e character builder) onto our `characters` row shape. Written
// defensively (every field optional-chained) since the export format is
// large and not officially documented — we only need a subset.

const ABILITY_KEYS = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };

export function mapHephaistosCharacter(json) {
  if (json?.type !== "character") throw new Error('not a Hephaistos character export (expected type: "character")');

  const abilities = {};
  for (const [short, long] of Object.entries(ABILITY_KEYS)) {
    abilities[short] = json.abilityScores?.[long]?.total ?? 10;
  }

  const classes = json.classes ?? [];
  const className = classes.map((c) => c.name).filter(Boolean).join(" / ") || "";
  const level = classes.reduce((sum, c) => sum + (c.levels || 0), 0) || 1;

  const stamina = json.vitals?.stamina ?? {};
  const health = json.vitals?.health ?? {};
  const resolve = json.vitals?.resolve ?? {};

  const skills = {};
  for (const s of json.skills ?? []) {
    const key = s.name ? `${s.skill} (${s.name})` : s.skill;
    if (key) skills[key] = s.total;
  }

  const notes = [json.description, json.quickNotes, json.campaignNotes].filter(Boolean).join("\n\n");

  return {
    name: json.name || "Imported Character",
    race: json.race?.name || "",
    theme: json.theme?.name || "",
    class: className,
    level,
    str: abilities.str, dex: abilities.dex, con: abilities.con,
    int: abilities.int, wis: abilities.wis, cha: abilities.cha,
    hp_max: health.max ?? 0,
    hp_cur: (health.max ?? 0) - (health.damage ?? 0),
    sp_max: stamina.max ?? 0,
    sp_cur: (stamina.max ?? 0) - (stamina.damage ?? 0),
    rp_max: resolve.max ?? 0,
    rp_cur: (resolve.max ?? 0) - (resolve.damage ?? 0),
    eac: json.armorClass?.eac?.total ?? 10,
    kac: json.armorClass?.kac?.total ?? 10,
    bab: json.attackBonuses?.bab?.total ?? 0,
    save_fort: json.saves?.fortitude?.total ?? 0,
    save_ref: json.saves?.reflex?.total ?? 0,
    save_will: json.saves?.will?.total ?? 0,
    init_bonus: json.initiative?.total ?? 0,
    speed: json.speed?.land ?? 30,
    skills,
    feats: json.feats?.acquiredFeats ?? [],
    spells: classes.flatMap((c) => c.spells ?? []),
    equipment: json.inventory ?? [],
    notes,
  };
}
