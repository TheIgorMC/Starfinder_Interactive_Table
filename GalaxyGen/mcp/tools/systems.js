import { z } from "zod";
import { generateSystems, placeSystemAt, redistributeSystems } from "../../src/lib/systemGen.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { system, replaceBySlug } from "../lib/refs.js";

const spacingShape = {
  minSpacing: z.number().positive().default(20),
  maxSpacing: z.number().positive().default(70),
};

export function register(server) {
  server.tool(
    "list_systems",
    "List every system (name, slug, sector, star type, population band, position, lock state) — omits bodies/hyperlanes for brevity, use get_system for full detail on one.",
    { sectorSlug: z.string().optional().describe("Filter to one sector.") },
    tool(({ sectorSlug }) => {
      const project = state.requireProject();
      const list = sectorSlug ? project.systems.filter((s) => s.sector === sectorSlug) : project.systems;
      return list.map((s) => ({
        slug: s.slug,
        name: s.name,
        sector: s.sector,
        starType: s.starType,
        population: s.population,
        position: s.position,
        locked: s.locked,
        bodyCount: s.bodies?.length || 0,
        control: s.control?.owner ?? null,
      }));
    }),
  );

  server.tool(
    "get_system",
    "Full detail for one system, including its bodies, tags, trade goods, and hyperlane neighbor list.",
    { slug: z.string() },
    tool(({ slug }) => system(state.requireProject(), slug)),
  );

  server.tool(
    "generate_systems",
    "Poisson-disc-places systems inside every drawn sector, biased by the painted population field, then rolls each one's star type/population/trade goods/bodies. Replaces every *unlocked* system; locked ones (renamed, hand-tuned, or explicitly locked) are left exactly as they are and still count as spacing obstacles for new placements.",
    spacingShape,
    tool(({ minSpacing, maxSpacing }) => {
      const project = state.requireProject();
      const systems = generateSystems(project, { minSpacing, maxSpacing });
      const keptIds = new Set(systems.map((s) => s.id));
      const keptSlugs = new Set(systems.map((s) => s.slug));
      state.setProject({
        ...project,
        systems,
        hyperlanes: project.hyperlanes.filter((e) => keptIds.has(e.a) && keptIds.has(e.b)),
        factions: project.factions.map((f) =>
          f.homeSystem && !keptSlugs.has(f.homeSystem) ? { ...f, homeSystem: null } : f,
        ),
        actors: project.actors.map((a) => (a.location && !keptSlugs.has(a.location) ? { ...a, location: null } : a)),
      });
      return { systemCount: systems.length };
    }),
  );

  server.tool(
    "redistribute_systems",
    "Re-scatters every unlocked system's position within its own sector (same spacing rules as generate_systems) without touching name, slug, star type, population, trade goods, bodies, control, or security. Keeps the system count exactly fixed — nothing is added, removed, or re-rolled, only moved. Locked systems never move. Hyperlane edge length/risk/capacity are recomputed against the new positions.",
    spacingShape,
    tool(({ minSpacing, maxSpacing }) => {
      const project = state.requireProject();
      if (project.systems.length === 0) return { moved: 0 };
      const { systems, hyperlanes } = redistributeSystems(project, { minSpacing, maxSpacing });
      state.setProject({ ...project, systems, hyperlanes });
      return { systemCount: systems.length };
    }),
  );

  server.tool(
    "place_system",
    "Hand-place a single system at an exact world-space point inside an existing sector, rolled from whatever's painted there. Locked immediately (same curation contract as clicking with the System tool in the app) so future generate_systems/redistribute_systems calls never touch it.",
    { x: z.number(), y: z.number() },
    tool(({ x, y }) => {
      const project = state.requireProject();
      const sys = placeSystemAt(project, x, y);
      if (!sys) throw new Error(`(${x}, ${y}) isn't inside any drawn sector — nowhere to place a system.`);
      state.setProject({ ...project, systems: [...project.systems, sys] });
      return sys;
    }),
  );

  server.tool(
    "update_system",
    "Rename a system, toggle its lock, adjust its importance (0-1), or set extraTags — the hand-curation fields, not the rolled generation output (use reroll_system_bodies for bodies).",
    {
      slug: z.string(),
      name: z.string().optional(),
      locked: z.boolean().optional(),
      important: z.number().min(0).max(1).optional(),
      extraTags: z.array(z.string()).optional(),
    },
    tool(({ slug, ...patch }) => {
      const project = state.requireProject();
      system(project, slug);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      state.setProject({ ...project, systems: replaceBySlug(project.systems, slug, cleanPatch) });
      return system(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_system",
    "Remove a system outright, along with any hyperlane edges touching it. Faction home-system anchors and actor locations pointing at it are cleared rather than left dangling.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      const sys = system(project, slug);
      state.setProject({
        ...project,
        systems: project.systems.filter((s) => s.slug !== slug),
        hyperlanes: project.hyperlanes.filter((e) => e.a !== sys.id && e.b !== sys.id),
        factions: project.factions.map((f) => (f.homeSystem === slug ? { ...f, homeSystem: null } : f)),
        actors: project.actors.map((a) => (a.location === slug ? { ...a, location: null } : a)),
      });
      return { deleted: slug };
    }),
  );
}
