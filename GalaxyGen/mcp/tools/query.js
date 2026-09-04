import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGalaxyIndexEnvelope } from "../../src/lib/aiIndex.js";
import {
  sectorToEntry,
  systemToEntry,
  factionToEntry,
  actorToEntry,
  organizationToEntry,
  eventToEntry,
} from "../../src/lib/persistence.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";

export function register(server) {
  server.tool(
    "get_ai_index",
    "The compact per-entity summary (name, tags, rough stats — no full records) built for an LLM's broad/coherence pass to reason over before drilling into specifics via get_system/get_faction/etc. Same content as the app's 'Download AI index' button.",
    {},
    tool(() => buildGalaxyIndexEnvelope(state.requireProject())),
  );

  server.tool(
    "get_raw_project",
    "The entire in-memory project as raw JSON — every sector, system (with bodies), hyperlane, faction, actor, organization, and event, and the painted density fields. Large for a big galaxy; prefer the more targeted list_*/get_* tools unless you actually need everything at once (e.g. before a save_project diff check).",
    { includeFields: z.boolean().default(false).describe("Include the 5 density-field grids (128x128 floats each) — large, usually not needed.") },
    tool(({ includeFields }) => {
      const project = state.requireProject();
      if (includeFields) return project;
      const { fields, ...rest } = project;
      return rest;
    }),
  );

  server.tool(
    "export_sdf",
    "Writes the real SDF tree (Docs/10-galaxy-mapgen.md §7: sectors/<slug>/entry.json, systems/<slug>/entry.json, ..., plus a top-level index.json) to a directory on disk — the same shape the app's browser-only 'Export SDF' produces, done here via plain filesystem writes since there's no browser File System Access API in this server.",
    { dir: z.string().describe("Destination directory — created if it doesn't exist.") },
    tool(async ({ dir }) => {
      const project = state.requireProject();
      const root = path.resolve(dir);
      await mkdir(root, { recursive: true });
      await writeJson(root, "index.json", buildGalaxyIndexEnvelope(project));

      await writeEntries(root, "sectors", project.sectors, sectorToEntry);
      await writeEntries(root, "systems", project.systems, systemToEntry);
      await writeEntries(root, "factions", project.factions, factionToEntry);
      await writeEntries(root, "actors", project.actors, actorToEntry);
      await writeEntries(root, "organizations", project.organizations, (o) => organizationToEntry(o, project.actors));
      await writeEntries(root, "events", project.events, eventToEntry);

      return {
        dir: root,
        counts: {
          sectors: project.sectors.length,
          systems: project.systems.length,
          factions: project.factions.length,
          actors: project.actors.length,
          organizations: project.organizations.length,
          events: project.events.length,
        },
      };
    }),
  );
}

async function writeJson(root, relPath, data) {
  const target = path.join(root, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(data, null, 2), "utf8");
}

async function writeEntries(root, category, list, toEntry) {
  if (list.length === 0) return;
  for (const item of list) {
    await writeJson(root, path.join(category, item.slug, "entry.json"), toEntry(item));
  }
}
