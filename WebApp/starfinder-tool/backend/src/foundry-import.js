// Maps item JSON from a local checkout of the community FoundryVTT
// Starfinder system (github.com/foundryvtt-starfinder/foundryvtt-starfinder,
// MIT-licensed code + Paizo Community Use content — same basis as the AoN
// scraper) into our aon-cache entry shape: { category, name, source, url,
// data, mechanics }. This is a far higher-fidelity source than scraping
// aonsrd.com's HTML — range/duration/area/save/damage/prerequisites are
// already-enumerated fields, not prose to guess at, and every item ships a
// hand-authored `modifiers` array: pre-designed, formula-capable bonuses
// (e.g. "max(1, floor(@attributes.baseAttackBonus.value/2))") that are
// exactly the "parametrized effect" a character engine needs — kept
// close to verbatim in mechanics.modifiers rather than reinterpreted.
//
// Covers: feats, spells, races, classes, archetypes, themes, conditions,
// effects, and the full equipment family (weapons, armor, augmentations,
// consumables, and 10 more subtypes — see EQUIPMENT_FOUNDRY_TYPES).
// A Foundry item's own `type` decides which deriveXMechanics/buildXData
// branch runs; the *stored* `category` can differ (see categoryFor()) —
// e.g. Foundry uses `type: "feat"` for actual feats AND for every granted
// class/racial/archetype/theme feature, which we split into distinct
// categories via the source folder so the Compendium (and a character
// engine) can tell "a feat you chose" from "a trait your race granted".
//
// See Docs/04-data-pipeline-aon.md → "Foundry import" for the full field
// reference (per-category `data`/`mechanics` shapes) and
// backend/src/mechanics-schema.js for the general schema.

import { load } from "cheerio";
import { blankMechanics } from "./mechanics-schema.js";
import { parsePrerequisites, parseTargets } from "./mechanics-parser.js";

const ABILITY_NAMES = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };

const SKILL_NAMES = {
  acr: "Acrobatics", ath: "Athletics", blu: "Bluff", com: "Computers", cul: "Culture",
  dip: "Diplomacy", dis: "Disguise", eng: "Engineering", int: "Intimidate",
  lsc: "Life Science", med: "Medicine", mys: "Mysticism", per: "Perception",
  phs: "Physical Science", pil: "Piloting", pro: "Profession", sen: "Sense Motive",
  sle: "Sleight of Hand", ste: "Stealth", sur: "Survival",
};

// Label tables below are extracted once from the Foundry system's own
// src/module/config.js + static/lang/en.json (its CONFIG.SFRPG.* enums) —
// not re-derived at import time, so this file has no dependency on the
// reference checkout's internals beyond the item JSON shape itself.
const WEAPON_TYPES = {
  basicM: "Basic Melee", advancedM: "Advanced Melee", smallA: "Small Arms",
  longA: "Long Arms", heavy: "Heavy Weapons", sniper: "Sniper Weapons",
  grenade: "Grenades", special: "Special Weapons", solarian: "Solarian Weapon Crystals",
};
const WEAPON_CATEGORIES = {
  cryo: "Cryo", disruption: "Disruption", disintegrator: "Disintegrator", flame: "Flame",
  laser: "Laser", plasma: "Plasma", projectile: "Projectile", shock: "Shock",
  sonic: "Sonic", uncategorized: "Uncategorized",
};
const WEAPON_PROPERTIES = {
  one: "One-handed", two: "Two-handed", amm: "Ammunition", aeon: "Aeon", analog: "Analog",
  antibiological: "Antibiological", archaic: "Archaic", aurora: "Aurora", automatic: "Automatic",
  blast: "Blast", block: "Block", boost: "Boost", breach: "Breach", breakdown: "Breakdown",
  bright: "Bright", buttressing: "Buttressing", cluster: "Cluster", conceal: "Conceal",
  deconstruct: "Deconstruct", deflect: "Deflect", disarm: "Disarm", double: "Double",
  drainCharge: "Drain Charge", echo: "Echo", entangle: "Entangle", explode: "Explode",
  extinguish: "Extinguish", feint: "Feint", fiery: "Fiery", firstArc: "First Arc",
  flexibleLine: "Flexible Line", force: "Force", freeHands: "Free Hands", fueled: "Fueled",
  gearArray: "Gear Array", grapple: "Grapple", gravitation: "Gravitation", guided: "Guided",
  harrying: "Harrying", healing: "Healing", holyWater: "Holy Water", hybrid: "Hybrid",
  hydrodynamic: "Hydrodynamic", ignite: "Ignite", indirect: "Indirect", injection: "Injection",
  instrumental: "Instrumental", integrated: "Integrated", line: "Line", living: "Living",
  lockdown: "Lockdown", "mind-affecting": "Mind-Affecting", mine: "Mine", mire: "Mire",
  modal: "Modal", necrotic: "Necrotic", nonlethal: "Nonlethal", operative: "Operative",
  penetrating: "Penetrating", polarize: "Polarize", polymorphic: "Polymorphic", powered: "Powered",
  professional: "Professional", propel: "Propel", punchGun: "Punch Gun", qreload: "Quick Reload",
  radioactive: "Radioactive", reach: "Reach", recall: "Recall", regrowth: "Regrowth",
  relic: "Relic", reposition: "Reposition", scramble: "Scramble", shape: "Shape",
  shatter: "Shatter", shells: "Shells", shield: "Shield", sniper: "Sniper", stun: "Stun",
  subtle: "Subtle", sunder: "Sunder", swarm: "Swarm", tail: "Tail", teleportive: "Teleportive",
  thought: "Thought", throttle: "Throttle", thrown: "Thrown", thruster: "Thruster", trip: "Trip",
  unbalancing: "Unbalancing", underwater: "Underwater", unwieldy: "Unwieldy",
  variantBoost: "Variant Boost", wideLine: "Wide Line",
};
const ARMOR_TYPES = { light: "Light Armor", heavy: "Heavy Armor", power: "Power Armor" };
const AUGMENTATION_TYPES = {
  cybernetic: "Cybernetic", biotech: "Biotech", magitech: "Magitech",
  necrograft: "Necrograft", personal: "Personal Upgrade", speciesGraft: "Species Graft",
};
const AUGMENTATION_SYSTEMS = {
  none: "None", arm: "Arm", armAndHand: "Arm and Hand", allArms: "All Arms", brain: "Brain",
  brainHeartLungs: "Brain, Heart, Lungs", brainAndEyes: "Brain and Eyes", ears: "Ears",
  earsAndThroat: "Ears and Throat", endocrine: "Endocrine", eye: "Eye", eyes: "Eyes",
  foot: "Foot", allFeet: "All Feet", hand: "Hand", allHands: "All Hands", heart: "Heart",
  leg: "Leg", legAndFoot: "Leg and Foot", allLegs: "All Legs", allLegsAndFeet: "All Legs and Feet",
  lungs: "Lungs", lungsAndThroat: "Lungs and Throat", spinal: "Spinal column", skin: "Skin",
  skinAndThroat: "Skin and Throat", throat: "Throat",
};
const CONSUMABLE_TYPES = {
  serum: "Serums", ampoule: "Spell Ampoules", spellGem: "Spell Gems", drugs: "Drugs",
  medicne: "Medicinals", poison: "Poisons", foodDrink: "Food and drink", other: "Other",
};
const AMMUNITION_TYPES = {
  charge: "Charges", roundS: "Small Arm Rounds", roundL: "Longarm and Sniper Rounds",
  roundH: "Heavy Rounds", arrow: "Arrows", dart: "Darts", fuel: "Petrol", missile: "Missiles",
  rocket: "Mini-Rockets", shell: "Shells", flare: "Flares", flechettes: "Flechettes",
  nanite: "Nanites", junk: "Junk", caustrol: "Caustrol", sclerite: "Sclerites",
  moodGoo: "Mood Goo", thasphalt: "Thasphalt", thasteronPellets: "Thasteron Pellets",
};
const SPELL_SCHOOLS = {
  abj: "Abjuration", con: "Conjuration", div: "Divination", enc: "Enchantment",
  evo: "Evocation", ill: "Illusion", nec: "Necromancy", trs: "Transmutation", uni: "Universal",
};

// Best-effort abbreviation → full title, for consistency with the AoN
// scraper's source names (so the Compendium's source filter doesn't end up
// with two separate buckets for the same book). Unrecognized/adventure-path
// codes ("AP #36", "PoC", ...) pass through as-is rather than being guessed.
const SOURCE_BOOKS = {
  CRB: "Starfinder Core Rulebook",
  "Core Rulebook": "Starfinder Core Rulebook",
  COM: "Character Operations Manual",
  "Character Operation Manual": "Character Operations Manual",
  EN: "Starfinder Enhanced",
  AA: "Alien Archive", AA1: "Alien Archive",
  AA2: "Alien Archive 2", AA3: "Alien Archive 3", AA4: "Alien Archive 4",
  PW: "Pact Worlds", NS: "Near Space", GM: "Galactic Magic",
  GEM: "Galaxy Exploration Manual", SOM: "Ship Operations Manual",
  IS: "Interstellar Species", DC: "Drift Crisis", AR: "Armory",
  TR: "Tech Revolution",
};

// Page markers show up as " pg. 42", ", p. 60", " pg, 51" (typo), "CRB.277"
// (conditions/effects/universal-creature-rules favor this dotted form) —
// inconsistent across items and categories, so match either shape rather
// than assuming one exact format.
export function normalizeSource(raw) {
  if (!raw) return { book: "", page: null };
  const cleaned = raw.replace(/,\s*$/, "").trim();
  const m = cleaned.match(/^(.*?),?\s*(?:pg|p)\.?,?\s*(\d+)/i) || cleaned.match(/^([A-Za-z0-9 ]+?)\.(\d+)$/);
  const codeOrName = (m ? m[1] : cleaned).trim();
  const page = m && m[2] ? Number(m[2]) : null;
  return { book: SOURCE_BOOKS[codeOrName] || codeOrName, page };
}

// Converts Foundry's rich-text HTML (including its own @UUID[...]{Label}
// and @Check[type:x|dc:y]{Label} link syntax) into plain text for `data`
// fields, matching what the AoN scraper already produces.
export function foundryTextToPlain(html) {
  if (!html) return "";
  const withLabels = html
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@Check\[type:([a-z-]+)(?:\|dc:[^\]]*)?\]\{([^}]*)\}/gi, "$2")
    .replace(/@Check\[type:([a-z-]+)(?:\|dc:[^\]]*)?\]/gi, (_, type) => `${SKILL_NAMES[type] || type} check`);
  return load(withLabels).text().replace(/\n{3,}/g, "\n\n").trim();
}

// Pulls "Prerequisites: ..." out of a feat's stripped description text —
// used as a fallback when system.requirements (a cleaner field) is blank.
function extractPrerequisitesFromText(plainText) {
  const m = plainText.match(/Prerequisites?:\s*(.+?)(?:\n|$)/i);
  return m ? m[1].trim() : "";
}

const RANGE_CATEGORY_FORMULAS = {
  close: { base: 25, perLevel: { amount: 5, levels: 2 } },
  medium: { base: 100, perLevel: { amount: 10, levels: 1 } },
  long: { base: 400, perLevel: { amount: 40, levels: 1 } },
};

function mapRange(range) {
  if (!range || !range.units) return null;
  const units = range.units;
  if (units === "personal") return { unit: "personal" };
  if (units === "touch") return { unit: "touch" };
  if (units === "none" || units === "") return null;
  if (RANGE_CATEGORY_FORMULAS[units]) return { unit: "ft", category: units, ...RANGE_CATEGORY_FORMULAS[units] };
  if (units === "ft" || units === "mi") {
    const n = Number(range.value);
    return Number.isFinite(n) ? { unit: units, value: n } : { unit: units, formula: range.value || "" };
  }
  return { unit: "raw", raw: range.value || units };
}

function mapArea(area) {
  if (!area || !area.shape) return null;
  const n = Number(area.value);
  return {
    shape: area.shape || "",
    unit: area.units || "",
    ...(Number.isFinite(n) && area.value !== "" ? { size: n } : area.value ? { formula: area.value } : {}),
  };
}

function mapDuration(duration) {
  if (!duration || !duration.units) return null;
  const { units, value } = duration;
  if (["instantaneous", "permanent"].includes(units)) return { unit: units };
  if (value === "" || value == null) return { unit: units };
  const n = Number(value);
  return Number.isFinite(n) ? { unit: units, value: n } : { unit: units, formula: value };
}

const SAVE_DESCRIPTOR_EFFECTS = {
  negate: "negates", half: "half", partial: "partial",
  harmless: "harmless", object: "object", disbelieve: "disbelief",
};

function mapSave(save) {
  if (!save || !save.type) return null;
  const effects = [];
  if (save.descriptor && SAVE_DESCRIPTOR_EFFECTS[save.descriptor]) effects.push(SAVE_DESCRIPTOR_EFFECTS[save.descriptor]);
  return { type: save.type, effects, ...(save.dc ? { dc: save.dc } : {}) };
}

function mapActivation(activation) {
  if (!activation || !activation.type) return null;
  return { type: activation.type, cost: activation.cost || 0, condition: activation.condition || "" };
}

// Foundry's own Modifiers system — kept close to verbatim (see the
// "Modifier" shape documented in mechanics-schema.js) since it's already
// exactly the parametrized bonus a character engine needs.
function mapModifiers(modifiers) {
  if (!Array.isArray(modifiers)) return [];
  return modifiers
    .filter((m) => m && m.modifier != null && m.modifier !== "")
    .map((m) => ({
      name: m.name || "",
      type: m.type || "untyped",
      effectType: m.effectType || "",
      valueAffected: m.valueAffected || "",
      modifier: m.modifier,
      modifierType: m.modifierType || "constant",
      max: m.max ?? null,
      condition: m.condition || "",
      enabled: !!m.enabled,
      notes: m.notes || "",
      source: m.source || "",
    }));
}

// Damage/critical parts become "damage" actions — the one piece of
// `actions` this importer populates confidently, since Foundry already
// gives a clean formula + type set instead of prose to parse.
function mapDamageActions(damage, critical) {
  const actions = [];
  const activeTypes = (types) => Object.entries(types || {}).filter(([, v]) => v).map(([k]) => k);
  for (const part of damage?.parts || []) {
    if (!part.formula) continue;
    actions.push({ kind: "damage", formula: part.formula, damageTypes: activeTypes(part.types) });
  }
  for (const part of critical?.parts || []) {
    if (!part.formula) continue;
    actions.push({ kind: "damage", formula: part.formula, damageTypes: activeTypes(part.types), onCritical: true });
  }
  return actions;
}

function mapAbilityMods(abilityMods) {
  const parts = abilityMods?.parts || [];
  return parts
    .filter((p) => Array.isArray(p) && p.length === 2)
    .map(([value, ability]) => ({ ability: ABILITY_NAMES[ability] || ability, value }));
}

// Weapon/armor-style items carry their AC/damage-affecting fields outside
// the generic `modifiers` array (Foundry applies them separately in its
// own sheet code), so mechanics-schema.js models them as their own fields
// rather than forcing them into the Modifier shape.
function mapArmorClass(armor) {
  if (!armor || !armor.type) return null;
  return {
    type: armor.type,
    eac: armor.eac ?? null,
    kac: armor.kac ?? null,
    maxDex: armor.dex ?? null,
    acp: armor.acp ?? null,
    speedAdjust: armor.speedAdjust ?? null,
    upgradeSlots: armor.upgradeSlots ?? null,
  };
}

// Shields carry their AC bonus outside `system.armor` entirely (a
// {aligned, wielded} pair — SF1e shields grant a smaller bonus at the
// ready and a larger one only while actively blocking), so they need
// their own mapping rather than reusing mapArmorClass().
function mapShieldClass(system) {
  if (system.bonus == null && system.dex == null && system.acp == null) return null;
  const wielded = system.bonus?.wielded ?? system.bonus?.aligned ?? null;
  return { type: "shield", eac: null, kac: wielded, maxDex: system.dex ?? null, acp: system.acp ?? null, speedAdjust: null, upgradeSlots: null };
}

function mapWeaponProperties(properties) {
  return Object.entries(properties || {})
    .filter(([, v]) => v && v.value)
    .map(([k, v]) => (v.extension ? `${WEAPON_PROPERTIES[k] || k} (${v.extension})` : WEAPON_PROPERTIES[k] || k));
}

function deriveSpellMechanics(system) {
  const m = blankMechanics();
  m.range = mapRange(system.range);
  m.area = mapArea(system.area);
  m.duration = mapDuration(system.duration);
  m.savingThrow = mapSave(system.save);
  m.spellResistance = typeof system.sr === "boolean" ? { applies: system.sr } : null;
  m.activation = mapActivation(system.activation);
  m.targeting = system.target?.value ? parseTargets(system.target.value) : (m.area ? { type: "area", count: "all", constraints: [] } : null);
  m.actions = mapDamageActions(system.damage, system.critical);
  m.modifiers = mapModifiers(system.modifiers);
  if (system.concentration) m.tags.push("concentration");
  if (system.dismissible) m.tags.push("dismissible");
  return m;
}

function deriveFeatMechanics(system, plainDescription) {
  const m = blankMechanics();
  const reqText = system.requirements || extractPrerequisitesFromText(plainDescription);
  m.requirements = parsePrerequisites(reqText);
  m.modifiers = mapModifiers(system.modifiers);
  m.actions = mapDamageActions(system.damage, system.critical);
  m.activation = mapActivation(system.activation);
  if (system.details?.combat) m.tags.push("combat");
  return m;
}

function deriveRaceMechanics(system) {
  const m = blankMechanics();
  m.abilityModifiers = mapAbilityMods(system.abilityMods);
  m.modifiers = mapModifiers(system.modifiers);
  if (system.type) m.tags.push(system.type);
  if (system.subtype) m.tags.push(system.subtype);
  return m;
}

function deriveClassMechanics(system) {
  const m = blankMechanics();
  m.modifiers = mapModifiers(system.modifiers);
  return m;
}

function deriveThemeMechanics(system) {
  const m = blankMechanics();
  if (system.abilityMod?.ability) m.abilityModifiers = [{ ability: ABILITY_NAMES[system.abilityMod.ability] || system.abilityMod.ability, value: system.abilityMod.mod ?? 1 }];
  m.modifiers = mapModifiers(system.modifiers);
  return m;
}

function deriveArchetypeMechanics(system) {
  const m = blankMechanics();
  m.requirements = parsePrerequisites(system.requirements || "");
  m.modifiers = mapModifiers(system.modifiers);
  return m;
}

// Conditions (Prone, Shaken, ...) and reusable Effects both use Foundry's
// `type: "effect"` — folder placement, not `system.type`, is what
// distinguishes them for us (see categoryFor()). Both carry a real
// `modifiers` array (e.g. Prone: -4 to melee attacks).
function deriveEffectMechanics(system) {
  const m = blankMechanics();
  m.modifiers = mapModifiers(system.modifiers);
  m.actions = mapDamageActions(system.damage, system.critical);
  if (system.activeDuration?.unit) m.duration = mapDuration({ units: system.activeDuration.unit, value: system.activeDuration.value });
  return m;
}

// Shared across every equipment-family Foundry type (weapon, augmentation,
// technological, magic, consumable, hybrid, upgrade, fusion, goods,
// ammunition, shield, weaponAccessory, container, and armor/gear via
// `type: "equipment"`) — they're all drawn from the same underlying schema,
// just with different subsets of fields populated.
function deriveEquipmentMechanics(system, foundryType) {
  const m = blankMechanics();
  m.range = mapRange(system.range);
  m.area = mapArea(system.area);
  m.duration = mapDuration(system.duration);
  m.savingThrow = mapSave(system.save);
  m.activation = mapActivation(system.activation);
  m.actions = mapDamageActions(system.damage, system.critical);
  m.modifiers = mapModifiers(system.modifiers);
  m.armorClass = foundryType === "shield" ? mapShieldClass(system) : mapArmorClass(system.armor);
  m.weaponProperties = mapWeaponProperties(system.properties);
  if (system.weaponType) m.tags.push(system.weaponType);
  if (system.weaponCategory) m.tags.push(system.weaponCategory);
  if (foundryType === "augmentation" && system.type) m.tags.push(system.type);
  if (system.consumableType) m.tags.push(system.consumableType);
  if (system.ammunitionType) m.tags.push(system.ammunitionType);
  return m;
}

export function deriveFoundryMechanics(type, system, plainDescription) {
  if (type === "spell") return deriveSpellMechanics(system);
  if (type === "feat") return deriveFeatMechanics(system, plainDescription);
  if (type === "race") return deriveRaceMechanics(system);
  if (type === "class") return deriveClassMechanics(system);
  if (type === "theme") return deriveThemeMechanics(system);
  if (type === "archetypes") return deriveArchetypeMechanics(system);
  if (type === "effect") return deriveEffectMechanics(system);
  if (EQUIPMENT_FOUNDRY_TYPES.has(type)) return deriveEquipmentMechanics(system, type);
  return blankMechanics();
}

const csk = (system) => Object.entries(system.csk || {}).filter(([, v]) => v).map(([k]) => SKILL_NAMES[k] || k).join(", ");
const savesText = (system) => `Fort: ${system.fort}, Ref: ${system.ref}, Will: ${system.will}`;

function buildEquipmentData(system, foundryType) {
  const data = {};
  if (system.level != null) data.level = system.level;
  if (system.price != null) data.price = system.price;
  if (system.bulk != null && system.bulk !== "") data.bulk = system.bulk;
  if (system.weaponType) data.weaponType = WEAPON_TYPES[system.weaponType] || system.weaponType;
  if (system.weaponCategory) data.weaponCategory = WEAPON_CATEGORIES[system.weaponCategory] || system.weaponCategory;
  const props = mapWeaponProperties(system.properties);
  if (props.length) data.properties = props.join(", ");
  if (system.armor?.type) {
    data.armorType = ARMOR_TYPES[system.armor.type] || system.armor.type;
    if (system.armor.eac != null) data.eacBonus = system.armor.eac;
    if (system.armor.kac != null) data.kacBonus = system.armor.kac;
    if (system.armor.dex != null) data.maxDexBonus = system.armor.dex;
    if (system.armor.acp != null) data.armorCheckPenalty = system.armor.acp;
  }
  if (foundryType === "augmentation" && system.type) data.augmentationType = AUGMENTATION_TYPES[system.type] || system.type;
  if (foundryType === "augmentation" && system.system) data.augmentationSystem = AUGMENTATION_SYSTEMS[system.system] || system.system;
  if (system.consumableType) data.consumableType = CONSUMABLE_TYPES[system.consumableType] || system.consumableType;
  if (system.ammunitionType) data.ammunitionType = AMMUNITION_TYPES[system.ammunitionType] || system.ammunitionType;
  if (system.useCapacity) data.useCapacity = system.useCapacity;
  if (foundryType === "shield") {
    const wielded = system.bonus?.wielded, aligned = system.bonus?.aligned;
    if (wielded != null || aligned != null) data.shieldBonus = `+${wielded ?? aligned} wielded${aligned != null && aligned !== wielded ? `, +${aligned} aligned` : ""}`;
    if (system.dex != null) data.maxDexBonus = system.dex;
    if (system.acp != null) data.armorCheckPenalty = system.acp;
  }
  if (system.capacity?.max) data.capacity = `${system.capacity.max}${system.usage?.per ? ` (${system.usage.value || 1}/${system.usage.per})` : ""}`;
  if (system.allowedArmorType) data.allowedArmorType = system.allowedArmorType;
  if (system.slots) data.upgradeSlotsUsed = system.slots;
  return data;
}

function buildData(type, system, plainDescription) {
  const data = { effect: plainDescription };
  if (type === "feat") {
    data.prerequisites = system.requirements || extractPrerequisitesFromText(plainDescription);
    if (system.details?.combat) data.combat = true;
  } else if (type === "spell") {
    if (system.school) data.school = SPELL_SCHOOLS[system.school] || system.school;
    if (system.level != null) data.level = system.level;
    if (system.range?.units) data.range = system.range.units;
    if (system.area?.shape) data.area = `${system.area.value ? system.area.value + " " : ""}${system.area.units || ""} ${system.area.shape}`.trim();
    if (system.duration?.units) data.duration = system.duration.value ? `${system.duration.value} ${system.duration.units}` : system.duration.units;
    if (system.save?.type) data.savingThrow = system.save.type;
    if (typeof system.sr === "boolean") data.spellResistance = system.sr ? "yes" : "no";
    if (system.target?.value) data.targets = system.target.value;
  } else if (type === "race") {
    const mods = mapAbilityMods(system.abilityMods);
    if (mods.length) data.abilityScores = mods.map((m) => `${m.value >= 0 ? "+" : ""}${m.value} ${m.ability}`).join(", ");
    if (system.hp?.value != null) data.hitPoints = system.hp.value;
    if (system.size || system.type) data.sizeAndType = [system.size, system.type, system.subtype ? `(${system.subtype})` : ""].filter(Boolean).join(" ");
  } else if (type === "class") {
    if (system.kas) data.keyAbilityScore = ABILITY_NAMES[system.kas] || system.kas;
    if (system.bab) data.baseAttackBonus = system.bab;
    if (system.fort && system.ref && system.will) data.savingThrows = savesText(system);
    if (system.hp?.value != null) data.hitPointsPerLevel = system.hp.value;
    if (system.sp?.value != null) data.staminaPointsPerLevel = system.sp.value;
    if (system.skillRanks?.value != null) data.skillRanksPerLevel = system.skillRanks.value;
    const skills = csk(system);
    if (skills) data.classSkills = skills;
  } else if (type === "theme") {
    if (system.abilityMod?.ability) data.abilityMod = `+${system.abilityMod.mod ?? 1} ${ABILITY_NAMES[system.abilityMod.ability] || system.abilityMod.ability}`;
    if (system.skill) data.themeSkill = SKILL_NAMES[system.skill] || system.skill;
  } else if (type === "archetypes") {
    data.requirements = system.requirements || "";
  } else if (type === "effect") {
    if (system.type) data.effectType = system.type;
  } else if (EQUIPMENT_FOUNDRY_TYPES.has(type)) {
    Object.assign(data, buildEquipmentData(system, type));
  }
  return data;
}

// Foundry `type` values that share the equipment schema (weapons, armor —
// via the generic "equipment" type, see categoryFor() — augmentations, and
// every other gear subtype). `type: "equipment"` itself splits into our
// "armor" or "gear" category based on whether `system.armor` is populated.
const EQUIPMENT_FOUNDRY_TYPES = new Set([
  "weapon", "equipment", "augmentation", "technological", "magic", "consumable",
  "hybrid", "upgrade", "fusion", "goods", "ammunition", "shield", "weaponAccessory", "container",
]);

// Decides our stored `category` for a raw Foundry item. Most types map
// 1:1 to their Foundry `type`, but: `type: "feat"` is reused by Foundry for
// actual feats AND every granted class/racial/archetype/theme/universal
// feature (folder placement disambiguates — pass `categoryOverride` from
// the CLI, keyed by source folder); `type: "effect"` is reused for both
// Conditions and reusable Effects (same deal); `type: "equipment"` covers
// both armor and generic gear, split here by content since both live in
// the same folder; `type: "archetypes"` (Foundry's own naming) is
// singularized to "archetype" for consistency with our other categories.
export function categoryFor(raw, categoryOverride) {
  if (categoryOverride) return categoryOverride;
  if (raw.type === "archetypes") return "archetype";
  if (raw.type === "equipment") return raw.system?.armor?.type ? "armor" : "gear";
  return raw.type;
}

const SUPPORTED_FOUNDRY_TYPES = new Set([
  "feat", "spell", "race", "class", "theme", "archetypes", "effect", ...EQUIPMENT_FOUNDRY_TYPES,
]);

// Converts one raw Foundry item JSON object (already parsed) into our
// aon-cache entry shape. Returns null for anything that isn't one of the
// types we support (or Foundry's own `_folders.json` metadata files, or
// off-type oddities living in a folder that's mostly something else —
// e.g. a handful of drone "chassis"/"mod" items mixed into class-features).
export function mapFoundryItem(raw, categoryOverride) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!SUPPORTED_FOUNDRY_TYPES.has(raw.type)) return null;
  const system = raw.system || {};
  const plainDescription = foundryTextToPlain(system.description?.value);
  const { book, page } = normalizeSource(system.source);

  return {
    category: categoryFor(raw, categoryOverride),
    name: raw.name,
    source: book,
    url: "",
    data: { ...buildData(raw.type, system, plainDescription), ...(page != null ? { sourcePage: page } : {}) },
    mechanics: deriveFoundryMechanics(raw.type, system, plainDescription),
    mechanicsSource: "foundry",
  };
}
