import { z } from "zod";
import { FIELD_DEFS } from "../../src/lib/project.js";
import { GRID_SIZE, paintGrid, gridToWorld, sampleBilinear } from "../../src/lib/grid.js";
import { pointInPolygon } from "../../src/lib/geometry.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { sector } from "../lib/refs.js";

const FIELD_KEYS = FIELD_DEFS.map((f) => f.key);

export function register(server) {
  server.tool(
    "paint_field",
    `A single brush stroke on one of the five density fields, same math as the Draw tab's brush (smoothstep falloff, strength scaled ~0.12/tick). Fields: ${FIELD_DEFS.map((f) => `${f.key} (${f.label})`).join(", ")}. For "paint this whole sector to a value" prefer fill_sector_field — it's exact and one call instead of many overlapping strokes.`,
    {
      field: z.enum(FIELD_KEYS),
      x: z.number().describe("World-space X of the brush center."),
      y: z.number().describe("World-space Y of the brush center."),
      radius: z.number().positive().default(80),
      strength: z.number().min(0).max(1).default(0.6),
      erase: z.boolean().default(false),
      sectorSlug: z.string().optional().describe("If given, only paints inside this sector's boundary."),
    },
    tool(({ field, x, y, radius, strength, erase, sectorSlug }) => {
      const project = state.requireProject();
      const grid = project.fields[field].slice();
      const containsPoint = sectorSlug
        ? (wx, wy) => pointInPolygon(wx, wy, sector(project, sectorSlug).points)
        : undefined;
      paintGrid(grid, GRID_SIZE, project.bounds, x, y, radius, strength, erase, containsPoint);
      state.setProject({ ...project, fields: { ...project.fields, [field]: grid } });
      return { field, paintedAt: { x, y }, radius };
    }),
  );

  server.tool(
    "fill_sector_field",
    "Sets a density field to an exact uniform value across every grid cell inside a sector's boundary — the fast, exact way to set up a sector's theme (e.g. a 'mining' sector at population 0.2 / export 0.8) instead of many overlapping brush strokes.",
    {
      sectorSlug: z.string(),
      field: z.enum(FIELD_KEYS),
      value: z.number().min(0).max(1),
    },
    tool(({ sectorSlug, field, value }) => {
      const project = state.requireProject();
      const sec = sector(project, sectorSlug);
      const grid = project.fields[field].slice();
      let touched = 0;
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const [wx, wy] = gridToWorld(gx + 0.5, gy + 0.5, project.bounds, GRID_SIZE);
          if (!pointInPolygon(wx, wy, sec.points)) continue;
          grid[gy * GRID_SIZE + gx] = value;
          touched++;
        }
      }
      state.setProject({ ...project, fields: { ...project.fields, [field]: grid } });
      return { field, sector: sectorSlug, value, cellsTouched: touched };
    }),
  );

  server.tool(
    "sample_field",
    "Bilinear-samples a density field at a world-space point — same read the generators themselves do, useful for checking what a sector's currently painted to before generating into it.",
    { field: z.enum(FIELD_KEYS), x: z.number(), y: z.number() },
    tool(({ field, x, y }) => {
      const project = state.requireProject();
      const value = sampleBilinear(project.fields[field], GRID_SIZE, x, y, project.bounds);
      return { field, x, y, value: Number(value.toFixed(4)) };
    }),
  );
}
