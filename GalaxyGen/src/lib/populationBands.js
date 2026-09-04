// Ordered low → high population; index is chosen from the painted
// population field (+noise) in systemGen.js, not picked independently of
// it. Split into its own module (rather than living in systemGen.js) so
// planetGen.js can depend on it without a systemGen.js <-> planetGen.js
// import cycle now that system generation calls into planet generation.
export const POPULATION_BANDS = [
  { value: "uninhabited / automated only", stationOnly: true },
  { value: "outpost (< 500)", stationOnly: true },
  { value: "small colony (500 - 50,000)", stationOnly: false },
  { value: "colony (50,000 - 1 million)", stationOnly: false },
  { value: "major colony (1 - 50 million)", stationOnly: false },
  { value: "core world (50 million+)", stationOnly: false },
];
