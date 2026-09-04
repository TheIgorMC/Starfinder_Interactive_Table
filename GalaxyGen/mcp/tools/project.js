import { z } from "zod";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";

// Project-lifecycle tools — every other module assumes `requireProject()`
// already has something loaded, so this is the one file every session
// touches first. See mcp/README.md for the file-based (not live-app-sync)
// contract these operate under.
export function register(server) {
  server.tool(
    "new_project",
    "Start a brand-new, empty galaxy in memory (not saved to disk until save_project is called). Replaces whatever project is currently loaded.",
    {
      seed: z.string().optional().describe("Deterministic generation seed. Random if omitted."),
      width: z.number().positive().default(1000).describe("Galaxy bounds width."),
      height: z.number().positive().default(1000).describe("Galaxy bounds height."),
    },
    tool(({ seed, width, height }) => {
      const project = state.newProject(seed, width, height);
      return { seed: project.seed, bounds: project.bounds };
    }),
  );

  server.tool(
    "load_project",
    "Load a GalaxyGen project .json file from disk into memory, replacing whatever is currently loaded. This is the same file format the app's own 'Save .json' / 'Load .json' buttons use.",
    { path: z.string().describe("Path to the project .json file.") },
    tool(async ({ path: filePath }) => {
      const project = await state.loadProject(filePath);
      return summarize(project, filePath);
    }),
  );

  server.tool(
    "save_project",
    "Write the in-memory project to disk as a GalaxyGen project .json file. Nothing is persisted to disk until this is called — every other tool only mutates in-memory state.",
    {
      path: z
        .string()
        .optional()
        .describe("Destination path. Defaults to wherever the project was last loaded from/saved to."),
    },
    tool(async ({ path: filePath }) => {
      const saved = await state.saveProject(filePath);
      return { savedTo: saved };
    }),
  );

  server.tool(
    "project_info",
    "Summary of the currently loaded project: seed, bounds, entity counts, file path, and whether there are unsaved changes.",
    {},
    tool(() => summarize(state.requireProject(), state.getFilePath())),
  );
}

function summarize(project, filePath) {
  return {
    seed: project.seed,
    bounds: project.bounds,
    filePath: filePath ?? null,
    dirty: state.isDirty(),
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
