import { z } from "./zod.js";
import { buildGalaxyIndexEnvelope } from "../lib/aiIndex.js";
import * as state from "./state.js";
import { tool } from "./respond.js";

export function register(server) {
  server.tool(
    "get_ai_index",
    "The compact per-entity summary (name, tags, rough stats — no full records) built for an LLM's broad/coherence pass to reason over before drilling into specifics via get_system/get_faction/etc. Same content as the app's 'Download AI index' button.",
    {},
    tool(() => buildGalaxyIndexEnvelope(state.requireProject())),
  );

  server.tool(
    "get_raw_project",
    "The entire in-memory project as raw JSON — every sector, system (with bodies), hyperlane, faction, actor, organization, and event, and the painted density fields. Large for a big galaxy; prefer the more targeted list_*/get_* tools unless you actually need everything at once .",
    { includeFields: z.boolean().default(false).describe("Include the 5 density-field grids (128x128 floats each) — large, usually not needed.") },
    tool(({ includeFields }) => {
      const project = state.requireProject();
      if (includeFields) return project;
      const { fields, ...rest } = project;
      return rest;
    }),
  );
}
