import { z } from "zod";
import { generateHyperlanes, buildEdge } from "../../src/lib/hyperlaneGen.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { system } from "../lib/refs.js";

export function register(server) {
  server.tool(
    "list_hyperlanes",
    "List every hyperlane edge (endpoints by slug, length, risk, capacity tag).",
    {},
    tool(() => {
      const project = state.requireProject();
      const byId = new Map(project.systems.map((s) => [s.id, s.slug]));
      return project.hyperlanes.map((e) => ({
        id: e.id,
        a: byId.get(e.a) ?? e.a,
        b: byId.get(e.b) ?? e.b,
        length: e.length,
        risk: e.risk,
        capacity: e.capacity,
      }));
    }),
  );

  server.tool(
    "generate_hyperlanes",
    "Rebuilds the whole hyperlane graph from scratch (Delaunay triangulation, Gabriel-graph pruning for a natural look, thickened where the painted hyperlane-density field is high, with a connectivity guarantee) — replaces every existing edge.",
    {},
    tool(() => {
      const project = state.requireProject();
      if (project.systems.length < 2) throw new Error("Need at least 2 systems to generate hyperlanes.");
      const { edges, systems } = generateHyperlanes(project);
      state.setProject({ ...project, systems, hyperlanes: edges });
      return { edgeCount: edges.length };
    }),
  );

  server.tool(
    "toggle_hyperlane",
    "Add a direct hyperlane between two systems if none exists, or remove it if one does — same as the Draw tab's Hyperlane tool clicking two systems.",
    { aSlug: z.string(), bSlug: z.string() },
    tool(({ aSlug, bSlug }) => {
      const project = state.requireProject();
      const a = system(project, aSlug);
      const b = system(project, bSlug);
      const existing = project.hyperlanes.find(
        (e) => (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id),
      );
      if (existing) {
        state.setProject({
          ...project,
          hyperlanes: project.hyperlanes.filter((e) => e.id !== existing.id),
          systems: project.systems.map((s) =>
            s.id === a.id || s.id === b.id ? { ...s, hyperlanes: s.hyperlanes.filter((slug) => slug !== a.slug && slug !== b.slug) } : s,
          ),
        });
        return { removed: existing.id };
      }
      const edge = buildEdge(project, a, b);
      state.setProject({
        ...project,
        hyperlanes: [...project.hyperlanes, edge],
        systems: project.systems.map((s) => {
          if (s.id === a.id) return { ...s, hyperlanes: [...s.hyperlanes, b.slug].sort() };
          if (s.id === b.id) return { ...s, hyperlanes: [...s.hyperlanes, a.slug].sort() };
          return s;
        }),
      });
      return edge;
    }),
  );
}
