// Star types plus the astrophysical parameters planetGen.js needs to place
// bodies somewhere plausible: `luminosity` (solar units) drives the
// habitable-zone and frost-line distances (standard sqrt(L) scaling —
// Docs/10-galaxy-mapgen.md §8), `mass` (solar masses) drives orbital period
// via Kepler's third law, `color`/`tempK` are for the orrery view. Split
// into its own module (rather than living in systemGen.js, where it used
// to) so planetGen.js can depend on it without a systemGen.js <->
// planetGen.js import cycle, same reason populationBands.js exists.
export const STAR_TYPES = [
  { value: "O-type blue giant", weight: 1, luminosity: 20000, mass: 18, tempK: 30000, color: "#9bb0ff" },
  { value: "B-type blue-white", weight: 3, luminosity: 1000, mass: 7, tempK: 16000, color: "#aabfff" },
  { value: "A-type white", weight: 6, luminosity: 20, mass: 1.8, tempK: 8500, color: "#cad8ff" },
  { value: "F-type yellow-white", weight: 10, luminosity: 3, mass: 1.3, tempK: 6500, color: "#f8f7ff" },
  { value: "G-type yellow", weight: 16, luminosity: 1, mass: 1, tempK: 5800, color: "#fff4ea" },
  { value: "K-type orange", weight: 20, luminosity: 0.3, mass: 0.75, tempK: 4500, color: "#ffd2a1" },
  { value: "M-type red dwarf", weight: 30, luminosity: 0.02, mass: 0.3, tempK: 3200, color: "#ffcc6f" },
  { value: "binary pair", weight: 6, luminosity: 1.6, mass: 1.6, tempK: 5500, color: "#fff0d8", binary: true },
  // A neutron star's visible/thermal luminosity is negligible next to a
  // main-sequence star's — there's no meaningful "habitable zone" around
  // one, just intense radiation close in. Modeled as near-zero luminosity
  // (forces the HZ band to ~nothing) plus an explicit `remnant` flag
  // planetGen.js uses to force every body uninhabitable and un-colonizable
  // outright, rather than trusting the tiny-HZ math alone.
  { value: "neutron star remnant", weight: 2, luminosity: 0.0001, mass: 1.4, tempK: 600000, color: "#dce8ff", remnant: true },
];

const BY_VALUE = new Map(STAR_TYPES.map((s) => [s.value, s]));

export function getStarProfile(starTypeValue) {
  return BY_VALUE.get(starTypeValue) || STAR_TYPES[4]; // fall back to G-type/Sun-like
}
