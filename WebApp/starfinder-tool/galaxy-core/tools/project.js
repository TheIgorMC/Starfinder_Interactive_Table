import * as state from "./state.js";
import { tool } from "./respond.js";

// The project itself is the one SIT stores (edited in place by the Galaxy
// Editor and by every mutating tool) — there's no load/save/new here.
export function register(server) {
  server.tool(
    "project_info",
    "Summary of the campaign's galaxy project: seed, bounds and entity counts.",
    {},
    tool(() => summarize(state.requireProject())),
  );
}

function summarize(project) {
  return {
    seed: project.seed,
    bounds: project.bounds,
    counts: {
      sectors: project.sectors.length,
      systems: project.systems.length,
      hyperlanes: project.hyperlanes.length,
      factions: project.factions.length,
      actors: project.actors.length,
      organizations: project.organizations.length,
      events: project.events.length,
      bodies: project.systems.reduce((n, s) => n + (s.bodies?.length || 0), 0),
      shipModels: project.shipModels?.length || 0,
      companies: project.companies?.length || 0,
    },
  };
}
