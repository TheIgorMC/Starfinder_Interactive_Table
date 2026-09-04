import { z } from "zod";
import { SECTOR_FOCI } from "../../src/lib/project.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { uniqueSlug, sector, replaceBySlug } from "../lib/refs.js";

const point = z.tuple([z.number(), z.number()]);

export function register(server) {
  server.tool(
    "list_sectors",
    "List every sector (name, slug, focus, vertex count) in the current project.",
    {},
    tool(() =>
      state.requireProject().sectors.map((s) => ({
        slug: s.slug,
        name: s.name,
        focus: s.focus,
        vertexCount: s.points.length,
      })),
    ),
  );

  server.tool(
    "get_sector",
    "Full detail for one sector, including its boundary polygon.",
    { slug: z.string() },
    tool(({ slug }) => sector(state.requireProject(), slug)),
  );

  server.tool(
    "create_sector",
    `Draw a new sector from an explicit boundary polygon (world-space [x, y] points, 3+ to form a shape — this is the programmatic equivalent of the Draw tab's Sector tool). Valid focus values: ${SECTOR_FOCI.join(", ")}.`,
    {
      name: z.string(),
      focus: z.enum(SECTOR_FOCI),
      points: z.array(point).min(3).describe("Boundary vertices in world-space coordinates, in order."),
    },
    tool(({ name, focus, points }) => {
      const project = state.requireProject();
      const sec = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(name, project.sectors),
        name,
        focus,
        points,
      };
      state.setProject({ ...project, sectors: [...project.sectors, sec] });
      return sec;
    }),
  );

  server.tool(
    "update_sector",
    "Rename a sector, change its focus, or replace its boundary polygon.",
    {
      slug: z.string(),
      name: z.string().optional(),
      focus: z.enum(SECTOR_FOCI).optional(),
      points: z.array(point).min(3).optional(),
    },
    tool(({ slug, ...patch }) => {
      const project = state.requireProject();
      sector(project, slug); // throws if missing
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      state.setProject({ ...project, sectors: replaceBySlug(project.sectors, slug, cleanPatch) });
      return sector(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_sector",
    "Delete a sector. Does not touch systems already placed inside it (same as the app — a system doesn't get removed just because its sector boundary does), but no new systems can be generated into the gap until a sector exists there again.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      sector(project, slug);
      state.setProject({ ...project, sectors: project.sectors.filter((s) => s.slug !== slug) });
      return { deleted: slug };
    }),
  );
}
