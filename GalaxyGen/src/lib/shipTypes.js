// Docs/10-galaxy-mapgen.md §8-adjacent — the ship/fleet economy layer.
// Vocabulary and rough numbers are drawn from SF1e's actual starship frame
// tables (size category, crew range, tactical speed in hexes, maneuverability
// class) so a hull class *reads* as a real Starfinder ship, but this stays a
// lightweight abstraction on purpose (see the design conversation this was
// scoped in): no arc-mounted weapons, no AC/TL/shield-point math, no exact
// damage dice. `combatRating` is a flavor-only 0-100 abstraction of overall
// combat capability, not a derived SF1e stat. A named, GM-relevant ship that
// actually needs to fight can always be hand-statted properly at the table —
// this layer exists to make "how many ships, what kind, whose" a solvable
// generation problem across a galaxy with hundreds of systems, not to replace
// the Starship Operations Manual.
export const SIZE_CATEGORIES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan", "Colossal"];
export const MANEUVERABILITY_CLASSES = ["clumsy", "average", "good", "perfect"];

// role: which of the five fleet economies (cargo/tourism/diplomacy/private/
// military) this hull primarily serves — drives both manufacturer bias and
// company fleet composition in shipGen.js. "Capital ship" isn't a separate
// axis: a Huge/Gargantuan/Colossal hull in any role already reads as
// capital-scale (a grand cruise liner is just as much a capital ship as a
// dreadnought), so sizeCategory alone carries that distinction.
export const HULL_CLASSES = [
  // Cargo
  { value: "system shuttle", role: "cargo", sizeCategory: "Tiny", maneuverability: "good", crew: [1, 2], cargoTons: [1, 6], speedHexes: [10, 14], combatRating: [1, 4] },
  { value: "light freighter", role: "cargo", sizeCategory: "Small", maneuverability: "average", crew: [2, 5], cargoTons: [15, 70], speedHexes: [8, 12], combatRating: [2, 8] },
  { value: "bulk hauler", role: "cargo", sizeCategory: "Large", maneuverability: "clumsy", crew: [6, 16], cargoTons: [200, 700], speedHexes: [5, 8], combatRating: [4, 12] },
  { value: "heavy bulk freighter", role: "cargo", sizeCategory: "Huge", maneuverability: "clumsy", crew: [10, 26], cargoTons: [900, 2400], speedHexes: [4, 6], combatRating: [6, 16] },

  // Tourism
  { value: "excursion skiff", role: "tourism", sizeCategory: "Tiny", maneuverability: "perfect", crew: [1, 3], cargoTons: [0, 3], speedHexes: [10, 14], combatRating: [0, 2] },
  { value: "pleasure yacht", role: "tourism", sizeCategory: "Small", maneuverability: "good", crew: [3, 8], cargoTons: [5, 25], speedHexes: [8, 12], combatRating: [1, 4] },
  { value: "luxury liner", role: "tourism", sizeCategory: "Large", maneuverability: "average", crew: [12, 30], cargoTons: [60, 200], speedHexes: [5, 8], combatRating: [2, 8] },
  { value: "grand cruise liner", role: "tourism", sizeCategory: "Gargantuan", maneuverability: "clumsy", crew: [30, 80], cargoTons: [300, 900], speedHexes: [3, 5], combatRating: [4, 12] },

  // Diplomacy
  { value: "courier cutter", role: "diplomacy", sizeCategory: "Tiny", maneuverability: "perfect", crew: [1, 3], cargoTons: [0, 4], speedHexes: [11, 15], combatRating: [1, 5] },
  { value: "diplomatic shuttle", role: "diplomacy", sizeCategory: "Small", maneuverability: "good", crew: [3, 7], cargoTons: [4, 20], speedHexes: [8, 11], combatRating: [2, 8] },
  { value: "envoy transport", role: "diplomacy", sizeCategory: "Medium", maneuverability: "average", crew: [6, 14], cargoTons: [15, 50], speedHexes: [6, 9], combatRating: [4, 12] },
  { value: "state barge", role: "diplomacy", sizeCategory: "Huge", maneuverability: "clumsy", crew: [16, 40], cargoTons: [40, 150], speedHexes: [4, 6], combatRating: [8, 22] },

  // Private
  { value: "runabout", role: "private", sizeCategory: "Tiny", maneuverability: "good", crew: [1, 2], cargoTons: [0, 3], speedHexes: [9, 13], combatRating: [0, 3] },
  { value: "racing yacht", role: "private", sizeCategory: "Small", maneuverability: "perfect", crew: [1, 3], cargoTons: [0, 6], speedHexes: [12, 16], combatRating: [1, 4] },
  { value: "personal cruiser", role: "private", sizeCategory: "Medium", maneuverability: "average", crew: [2, 6], cargoTons: [10, 40], speedHexes: [6, 9], combatRating: [2, 8] },
  { value: "armed private cutter", role: "private", sizeCategory: "Small", maneuverability: "good", crew: [2, 5], cargoTons: [5, 20], speedHexes: [8, 12], combatRating: [8, 18] },

  // Military
  { value: "picket scout", role: "military", sizeCategory: "Tiny", maneuverability: "perfect", crew: [1, 3], cargoTons: [0, 3], speedHexes: [11, 15], combatRating: [10, 22] },
  { value: "gunship", role: "military", sizeCategory: "Small", maneuverability: "good", crew: [3, 7], cargoTons: [2, 10], speedHexes: [9, 13], combatRating: [20, 38] },
  { value: "corvette", role: "military", sizeCategory: "Medium", maneuverability: "good", crew: [6, 14], cargoTons: [5, 25], speedHexes: [7, 10], combatRating: [32, 52] },
  { value: "frigate", role: "military", sizeCategory: "Large", maneuverability: "average", crew: [12, 28], cargoTons: [15, 60], speedHexes: [5, 8], combatRating: [45, 68] },
  { value: "destroyer", role: "military", sizeCategory: "Huge", maneuverability: "average", crew: [20, 45], cargoTons: [25, 90], speedHexes: [4, 7], combatRating: [58, 80] },
  { value: "carrier", role: "military", sizeCategory: "Gargantuan", maneuverability: "clumsy", crew: [40, 90], cargoTons: [60, 200], speedHexes: [3, 5], combatRating: [65, 88] },
  { value: "dreadnought", role: "military", sizeCategory: "Colossal", maneuverability: "clumsy", crew: [70, 160], cargoTons: [100, 300], speedHexes: [2, 4], combatRating: [80, 100] },
];

export const SHIP_ROLES = ["cargo", "tourism", "diplomacy", "private", "military"];

// Quality tier nudges a manufacturer's models above/below the hull's own
// baseline range (economy trims toward the low end and costs less; premium
// pushes toward the high end and costs more) — same spirit as a real
// shipwright's reputation, without inventing an actual currency/economy
// system this layer doesn't need yet.
export const QUALITY_TIERS = {
  economy: { statBias: -0.25, costTier: "economy" },
  standard: { statBias: 0, costTier: "standard" },
  premium: { statBias: 0.3, costTier: "premium" },
};

// Fictional shipwrights, not SF1e's real-world/Pact-Worlds manufacturer
// list — same "plausible, setting-appropriate, not a copy" approach the
// rest of GalaxyGen's flavor tables already take (star types, station
// classes, faction names). `specialty` biases which hull role a
// manufacturer's model catalog leans toward (shipGen.js), not an exclusive
// restriction — most yards build a little outside their lane too.
export const SHIP_MANUFACTURERS = [
  { value: "Kessho Dynamics", specialty: "cargo", tier: "standard" },
  { value: "Ashgrove Fabrication", specialty: "cargo", tier: "economy" },
  { value: "Ninth Horizon Fabricators", specialty: "cargo", tier: "premium" },
  { value: "Meridian Voyager Co.", specialty: "tourism", tier: "premium" },
  { value: "Sable Line Shipwrights", specialty: "tourism", tier: "standard" },
  { value: "Halcyon Envoy Works", specialty: "diplomacy", tier: "premium" },
  { value: "Threnn Diplomatic Works", specialty: "diplomacy", tier: "standard" },
  { value: "Ironwood Motorworks", specialty: "private", tier: "standard" },
  { value: "Corvane Independent Yards", specialty: "private", tier: "economy" },
  { value: "Vantage Aerospace", specialty: "military", tier: "premium" },
  { value: "Obsidia Heavy Industries", specialty: "military", tier: "standard" },
  { value: "Drexel Arms Consortium", specialty: "military", tier: "economy" },
];

// Docs/10-galaxy-mapgen.md §5-style sector-focus bias, mirrored for ship
// companies (shipGen.js's generateCompanies): which role a company kind
// pulls its fleet from, and which sector focuses tend to spawn that kind.
export const COMPANY_KINDS = [
  { value: "cargo-line", role: "cargo", foci: ["mining", "industry", "logistics", "agriculture"] },
  { value: "tourism-operator", role: "tourism", foci: ["residential", "cultural", "medical"] },
  { value: "diplomatic-courier", role: "diplomacy", foci: ["administrative"] },
  { value: "private-charter", role: "private", foci: ["frontier", "research"] },
  { value: "military-contractor", role: "military", foci: ["military"] },
];
