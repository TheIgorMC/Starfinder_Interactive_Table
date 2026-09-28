import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompact } from "../../galaxy-core/lib/compact.js";

const project = {
  seed: "abc",
  bounds: { width: 1000, height: 1000 },
  factions: [{ slug: "f1", name: "F1", color: "#ff0000" }],
  sectors: [{ name: "A", focus: "mining", points: [[0, 0], [10.04, 0], [0, 10]] }],
  fields: { security: [0.123], population: [0.456] },
  systems: [
    {
      id: "i1", slug: "one", name: "One", position: { x: 1.26, y: 2 }, important: 0.5, starType: "G-type yellow",
      sector: "A", population: "outpost (< 500)", stationOnly: false,
      control: { owner: null, contestedBy: [{ faction: "f1", share: 0.6 }] },
      security: { dominion: 0.8, faction: 0.2 }, warChance: 0.1, tags: [], export: [], import: [],
      bodies: [{
        kind: "terrestrial world", name: "B", slug: "b", parent: null, status: "colonized", orbitAU: 1, tags: ["capital", "junk"],
        sites: [{ slug: "c", name: "C", districts: [{ name: "Open" }, { name: "Secret", hidden: true }] }],
      }],
    },
    { id: "i2", slug: "two", name: "Two", position: { x: 5, y: 5 }, control: {}, security: {} },
  ],
  hyperlanes: [
    { a: "i1", b: "i2", capacity: "major trade route", risk: 0.2 },
    { a: "x", b: "y", aSlug: "one", bSlug: "two", capacity: null, risk: 0 },
    { a: "x", b: "y", aSlug: "one", bSlug: "missing" },
  ],
};

test("maps systems, lanes and bodies to the compact shape", () => {
  const c = buildCompact(project);
  assert.equal(c.sys.length, 2);
  assert.equal(c.sys[0].x, 1.3);
  assert.deepEqual(c.sys[0].cb, [["f1", 0.6]]);
  assert.deepEqual(c.ln, [[0, 1, 2, 0.2], [0, 1, 1, 0]]);
  assert.deepEqual(c.sys[0].b[0].t, ["capital"]);
  assert.equal(c.fld.security[0], 0.12);
  assert.equal(c.sec[0].p[1][0], 10);
});

test("hidden districts only reach the GM", () => {
  assert.equal(buildCompact(project, { gm: true }).sys[0].b[0].sites[0].districts.length, 2);
  assert.deepEqual(buildCompact(project, { gm: false }).sys[0].b[0].sites[0].districts.map((d) => d.name), ["Open"]);
});
