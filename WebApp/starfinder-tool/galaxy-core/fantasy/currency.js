// Coinage. A currency is a set of denominations valued in its own base unit
// (the smallest coin), plus `rate`: what one base unit is worth in the base
// unit of the reference currency (the first one), for exchanges between
// realms.
import { newId } from "./model.js";

export const METALS = {
  platinum: "#d9dde3", gold: "#e3b440", electrum: "#d8c78a", silver: "#c9cdd2", copper: "#c27a4a",
  bronze: "#b0874e", iron: "#8a8f96", brass: "#c9a64a", other: "#a49b8a",
};

export const PRESETS = {
  standard: {
    name: "Standard coinage (pp · gp · ep · sp · cp)",
    denominations: [
      { name: "Platinum piece", abbr: "pp", metal: "platinum", value: 1000 },
      { name: "Gold piece", abbr: "gp", metal: "gold", value: 100 },
      { name: "Electrum piece", abbr: "ep", metal: "electrum", value: 50 },
      { name: "Silver piece", abbr: "sp", metal: "silver", value: 10 },
      { name: "Copper piece", abbr: "cp", metal: "copper", value: 1 },
    ],
  },
  sterling: {
    name: "Pounds, shillings, pence (£1 = 20s = 240d)",
    denominations: [
      { name: "Pound", abbr: "£", metal: "gold", value: 240 },
      { name: "Crown", abbr: "cr", metal: "silver", value: 60 },
      { name: "Shilling", abbr: "s", metal: "silver", value: 12 },
      { name: "Groat", abbr: "gr", metal: "silver", value: 4 },
      { name: "Penny", abbr: "d", metal: "silver", value: 1 },
      { name: "Farthing", abbr: "f", metal: "copper", value: 0.25 },
    ],
  },
  florentine: {
    name: "Florentine (fiorino · lira · soldo · denaro)",
    denominations: [
      { name: "Fiorino d'oro", abbr: "fl", metal: "gold", value: 696 },
      { name: "Lira", abbr: "L", metal: "silver", value: 240 },
      { name: "Grosso", abbr: "gr", metal: "silver", value: 48 },
      { name: "Soldo", abbr: "s", metal: "silver", value: 12 },
      { name: "Denaro", abbr: "d", metal: "copper", value: 1 },
    ],
  },
  imperial: {
    name: "Imperial (crown · mark · penny)",
    denominations: [
      { name: "Gold crown", abbr: "GC", metal: "gold", value: 240 },
      { name: "Silver mark", abbr: "m", metal: "silver", value: 12 },
      { name: "Brass penny", abbr: "p", metal: "brass", value: 1 },
    ],
  },
};

export function makeCurrency(presetKey = "standard", name, rate = 1) {
  const p = PRESETS[presetKey] || PRESETS.standard;
  return {
    id: newId("c"), name: name || p.name.split(" (")[0], realm: "", rate, description: "",
    denominations: p.denominations.map((d) => ({ id: newId("d"), ...d })),
  };
}
export function defaultTreasury() {
  // the reference coin is the copper piece: 1 cp = 1; a sterling penny is
  // worth about a silver piece, so rate 10
  const std = makeCurrency("standard", "Standard coinage", 1);
  return { currencies: [std], feePct: 5 };
}

const sorted = (cur) => [...cur.denominations].sort((a, b) => b.value - a.value);

export function toBase(cur, counts) {
  return cur.denominations.reduce((a, d) => a + (Number(counts[d.id]) || 0) * d.value, 0);
}
// greedy change-making with the currency's coins (largest first)
export function breakdown(cur, base, allowed) {
  const out = [];
  let left = Math.round(base * 10000) / 10000;
  for (const d of sorted(cur)) {
    if (allowed && !allowed.includes(d.id)) continue;
    if (d.value <= 0) continue;
    const n = Math.floor(left / d.value + 1e-9);
    if (n > 0) { out.push({ d, n }); left = Math.round((left - n * d.value) * 10000) / 10000; }
  }
  return { coins: out, rest: left };
}
export function formatAmount(cur, base, allowed) {
  if (!cur) return String(base);
  const { coins, rest } = breakdown(cur, base, allowed);
  const s = coins.map(({ d, n }) => `${n.toLocaleString()} ${d.abbr}`).join(" ");
  return (s || `0 ${sorted(cur).at(-1)?.abbr || ""}`) + (rest > 0.001 ? ` (+${rest.toFixed(2)})` : "");
}
// base units of `from` → base units of `to`, minus a money-changer's fee
export function exchange(from, to, base, feePct = 0) {
  const ref = base * (from.rate || 1);
  return (ref / (to.rate || 1)) * (1 - feePct / 100);
}
