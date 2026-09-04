import { z } from "zod";
import { generateBackgroundActors } from "../../src/lib/actorGen.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { uniqueSlug, actor, system, replaceBySlug } from "../lib/refs.js";

export function register(server) {
  server.tool(
    "list_actors",
    "List every actor (name, slug, kind, role, affiliation, location, origin).",
    { locationSlug: z.string().optional().describe("Filter to actors at one system.") },
    tool(({ locationSlug }) => {
      const project = state.requireProject();
      const list = locationSlug ? project.actors.filter((a) => a.location === locationSlug) : project.actors;
      return list.map((a) => ({
        slug: a.slug,
        name: a.name,
        kind: a.kind,
        role: a.role,
        affiliation: a.affiliation,
        location: a.location,
        origin: a.origin,
      }));
    }),
  );

  server.tool(
    "get_actor",
    "Full detail for one actor.",
    { slug: z.string() },
    tool(({ slug }) => actor(state.requireProject(), slug)),
  );

  server.tool(
    "create_actor",
    "Author a new named actor (individual or crew, per the design doc's §6 named-actor model). Placing one at a system locks that system, same curation contract as renaming it.",
    {
      name: z.string(),
      kind: z.string().describe("e.g. individual, crew."),
      role: z.string().describe("e.g. senator, garrison-captain, merchant-broker."),
      affiliation: z.string().nullable().optional().describe("Typed ref: 'faction:<slug>' or 'party:<slug>'."),
      location: z.string().nullable().optional().describe("System slug this actor is at."),
      mobile: z.boolean().default(false),
      influence: z.number().min(0).max(1).default(0.1),
    },
    tool(({ name, kind, role, affiliation, location, mobile, influence }) => {
      const project = state.requireProject();
      if (location) system(project, location); // validate ref
      const a = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(name, project.actors),
        name,
        kind,
        role,
        affiliation: affiliation ?? null,
        location: location ?? null,
        mobile,
        influence,
        status: "active",
        reputation: {},
        extraTags: [],
        origin: "authored",
      };
      state.setProject({
        ...project,
        actors: [...project.actors, a],
        systems: location ? project.systems.map((s) => (s.slug === location ? { ...s, locked: true } : s)) : project.systems,
      });
      return a;
    }),
  );

  server.tool(
    "update_actor",
    "Edit an existing actor's fields. Relocating (location) locks the destination system.",
    {
      slug: z.string(),
      name: z.string().optional(),
      role: z.string().optional(),
      affiliation: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      mobile: z.boolean().optional(),
      influence: z.number().min(0).max(1).optional(),
      status: z.enum(["active", "deceased", "disbanded", "unknown"]).optional(),
      extraTags: z.array(z.string()).optional(),
    },
    tool(({ slug, ...patch }) => {
      const project = state.requireProject();
      actor(project, slug);
      if (patch.location) system(project, patch.location);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      state.setProject({
        ...project,
        actors: replaceBySlug(project.actors, slug, cleanPatch),
        systems: patch.location ? project.systems.map((s) => (s.slug === patch.location ? { ...s, locked: true } : s)) : project.systems,
      });
      return actor(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_actor",
    "Delete an actor.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      actor(project, slug);
      state.setProject({ ...project, actors: project.actors.filter((a) => a.slug !== slug) });
      return { deleted: slug };
    }),
  );

  server.tool(
    "generate_background_actors",
    "Auto-seeds cheap background people scaled to each system's population and faction contest. Run after generate_factions. Curated (hand-authored) actors are never touched or removed.",
    {},
    tool(() => {
      const project = state.requireProject();
      if (project.systems.length === 0) throw new Error("No systems to seed actors into — generate systems first.");
      const curated = project.actors.filter((a) => a.origin === "authored");
      const generated = generateBackgroundActors({ ...project, actors: curated });
      state.setProject({ ...project, actors: [...curated, ...generated] });
      return { generatedCount: generated.length, curatedCount: curated.length };
    }),
  );
}
