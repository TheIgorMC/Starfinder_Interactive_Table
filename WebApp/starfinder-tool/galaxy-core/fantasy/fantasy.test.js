// node --test galaxy-core/fantasy/fantasy.test.js — pure JS, no browser needed
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap } from "./generate.js";
import { buildWorld } from "./model.js";
import { computeRoute, schedule } from "./travel.js";
import { makeCurrency, toBase, formatAmount, exchange } from "./currency.js";

const strip = (m) => JSON.stringify({ ...m, settlements: m.settlements.map(({ id, ...s }) => s), roads: m.roads.map(({ id, from, to, ...r }) => r), rivers: m.rivers.map(({ id, ...r }) => r), pois: m.pois.map(({ id, ...p }) => p), labels: m.labels.map(({ id, ...l }) => l) });

test("same seed, same map", () => {
  const a = generateMap({ seed: "t1", size: "small" }), b = generateMap({ seed: "t1", size: "small" });
  assert.equal(strip(a), strip(b));
  assert.equal(a.terrain.b.length, a.w * a.h);
});

test("every template yields a capital, roads and rivers", () => {
  for (const template of ["coast", "peninsula", "island", "archipelago", "inland", "highlands"]) {
    const m = generateMap({ seed: "t2", template, size: "small" });
    assert.equal(m.settlements.filter((s) => s.type === "capital").length, 1, template);
    assert.ok(m.roads.length > 0, template);
    assert.ok(m.rivers.length > 0, template);
  }
});

test("travel: riders beat walkers, carts keep to passable ground", () => {
  const m = generateMap({ seed: "t3", template: "inland", size: "small" });
  const w = buildWorld(m);
  const [a, b] = m.settlements.filter((s) => s.type === "capital" || s.type === "city");
  const pts = [[a.x, a.y], [b.x, b.y]];
  const foot = computeRoute(w, pts, "foot"), horse = computeRoute(w, pts, "horse");
  assert.ok(foot.ok && horse.ok);
  assert.ok(horse.hours < foot.hours);
  assert.ok(schedule(foot.hours, "foot", "slow").days > schedule(foot.hours, "foot", "fast").days);
});

test("coins: totals, change and exchange", () => {
  const std = makeCurrency("standard");
  const d = Object.fromEntries(std.denominations.map((x) => [x.abbr, x.id]));
  const base = toBase(std, { [d.gp]: 3, [d.sp]: 17, [d.cp]: 5 });
  assert.equal(base, 475);
  assert.equal(formatAmount(std, base), "4 gp 1 ep 2 sp 5 cp");
  const ster = makeCurrency("sterling", "Sterling", 10);
  assert.equal(exchange(std, ster, 240, 0), 24);
});
