import { GRID_SIZE, createGrid } from "./grid.js";

// Docs/10-galaxy-mapgen.md §2.2 — the five density fields, painted before
// any system exists. Colors are used for the heatmap overlay only.
export const FIELD_DEFS = [
  { key: "population", label: "Population density", color: "79,142,247" },
  { key: "export", label: "Commercial value (export)", color: "242,181,55" },
  { key: "import", label: "Commercial need (import)", color: "178,99,216" },
  { key: "hyperlane", label: "Hyperlane density", color: "64,200,150" },
  { key: "security", label: "Dominion security", color: "230,90,90" },
];

// Docs/10-galaxy-mapgen.md §5 — sector focus tags.
export const SECTOR_FOCI = [
  "mining",
  "agriculture",
  "industry",
  "research",
  "trade hub",
  "frontier",
  "administrative",
  "military",
  "residential",
  "logistics",
  "medical",
  "cultural",
];

function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

export function createDefaultProject(seed = randomSeed(), width = 1000, height = 1000) {
  return {
    version: 1,
    seed,
    bounds: { width, height },
    sectors: [],
    systems: [],
    hyperlanes: [],
    factions: [],
    fields: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, createGrid(GRID_SIZE)])),
  };
}

// Older saved projects (pre-system-generation, pre-hyperlane-generation, or
// pre-faction-generation) won't have a `systems`/`hyperlanes`/`factions`
// array — normalize on load/import so the rest of the app can assume they
// always exist.
export function normalizeProject(project) {
  return { systems: [], hyperlanes: [], factions: [], ...project };
}
