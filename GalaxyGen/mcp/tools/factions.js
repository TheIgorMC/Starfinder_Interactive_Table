import { z } from "zod";
import { resolveFactions } from "../../src/lib/factionGen.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { uniqueSlug, faction, system, replaceBySlug } from "../lib/refs.js";

export function register(server) {
  server.tool(
    "list_factions",
    "List every faction (name, slug, government, aggression/strength, origin).",
    {},
    tool(() =>
      state.requireProject().factions.map((f) => ({
        slug: f.slug,
        name: f.name,
        government: f.government,
        aggression: f.aggression,
        strength: f.strength,
        homeSystem: f.homeSystem,
        origin: f.origin,
      })),
    ),
  );

  server.tool(
    "get_faction",
    "Full detail for one faction.",
    { slug: z.string() },
    tool(({ slug }) => faction(state.requireProject(), slug)),
  );

  server.tool(
    "create_faction",
    "Author a new faction with a control seed at a world-space point, or anchored to hold an existing system outright (pass homeSystemSlug instead of/alongside x/y — an anchored faction holds that system no matter what the distance-based contest would say).",
    {
      name: z.string(),
      color: z.string().describe("Hex color, e.g. #7fb2ff."),
      government: z.string(),
      aggression: z.number().min(0).max(1),
      strength: z.number().min(0).max(1),
      x: z.number().optional(),
      y: z.number().optional(),
      homeSystemSlug: z.string().optional().describe("Anchor to this system's position and hold it outright."),
    },
    tool(({ name, color, government, aggression, strength, x, y, homeSystemSlug }) => {
      const project = state.requireProject();
      let seed = { x: x ?? 0, y: y ?? 0 };
      if (homeSystemSlug) {
        const sys = system(project, homeSystemSlug);
        seed = { x: sys.position.x, y: sys.position.y };
      } else if (x == null || y == null) {
        throw new Error("Provide either homeSystemSlug or both x and y.");
      }
      const f = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(name, project.factions),
        name,
        color,
        government,
        aggression,
        strength,
        seed,
        homeSystem: homeSystemSlug ?? null,
        toleratedCrimes: [],
        relationships: {},
        extraTags: [],
        origin: "authored",
      };
      state.setProject({ ...project, factions: [...project.factions, f] });
      return f;
    }),
  );

  server.tool(
    "update_faction",
    "Edit an existing faction's fields (rename, recolor, adjust government/aggression/strength/toleratedCrimes/relationships/extraTags).",
    {
      slug: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      government: z.string().optional(),
      aggression: z.number().min(0).max(1).optional(),
      strength: z.number().min(0).max(1).optional(),
      toleratedCrimes: z.array(z.string()).optional(),
      relationships: z.record(z.string(), z.number().min(-1).max(1)).optional(),
      extraTags: z.array(z.string()).optional(),
    },
    tool(({ slug, ...patch }) => {
      const project = state.requireProject();
      faction(project, slug);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      state.setProject({ ...project, factions: replaceBySlug(project.factions, slug, cleanPatch) });
      return faction(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_faction",
    "Delete a faction. Clears it from any system's control/contest, falls affiliated actors back to unaffiliated, and falls affiliated organizations back to the Dominion.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      const f = faction(project, slug);
      state.setProject({
        ...project,
        factions: project.factions.filter((x) => x.slug !== slug),
        systems: project.systems.map((s) => {
          if (!s.control) return s;
          const owner = s.control.owner === f.slug ? null : s.control.owner;
          const contestedBy = (s.control.contestedBy || []).filter((c) => c.faction !== f.slug);
          return { ...s, control: { owner, contestedBy } };
        }),
        actors: project.actors.map((a) => (a.affiliation === `faction:${f.slug}` ? { ...a, affiliation: null } : a)),
        organizations: project.organizations.map((o) => (o.parentFaction === f.slug ? { ...o, parentFaction: "dominion" } : o)),
      });
      return { deleted: slug };
    }),
  );

  server.tool(
    "generate_factions",
    "Auto-seeds small border factions into any low-coverage gap and recomputes every system's control/security/war-chance from the combined set. Only authored (hand-created) factions carry over between runs — generated border minors are always rebuilt from scratch.",
    {},
    tool(() => {
      const project = state.requireProject();
      if (project.systems.length === 0) throw new Error("No systems to resolve control for — generate systems first.");
      const authored = project.factions.filter((f) => f.origin === "authored");
      const { factions, systems } = resolveFactions(project, authored);
      state.setProject({ ...project, factions, systems });
      return { factionCount: factions.length, generatedCount: factions.filter((f) => f.origin === "generated").length };
    }),
  );
}
