// City generator — SKELETON (Docs/15-settlement-generators.md).
// Will produce a functional, procedural city layout (blocks, arteries,
// zoning) for sites whose style is "city". Output follows the shared
// `site.layout` contract so the SIT viewer can render it; districts stay
// the unit of navigation (one district = one zone).
//
// generateCity(body, site, options) -> site.layout | null
//   options (planned): { seed, sizeClass, density, gridPattern, zones: [{type, weight}], transit }
export function generateCity(/* body, site, options */) {
  return null; // not implemented yet — viewer falls back to the provisional outpost layout
}
