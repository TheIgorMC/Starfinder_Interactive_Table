import { z } from "zod";
import { generateBodies, getSystemZones, STATION_CLASSES } from "../../src/lib/planetGen.js";
import { regeneratePlanets } from "../../src/lib/systemGen.js";
import { createRng } from "../../src/lib/rng.js";
import { slugify } from "../../src/lib/slug.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { system, replaceBySlug } from "../lib/refs.js";

const BODY_KINDS = ["rocky planet", "terrestrial world", "ice world", "gas giant", "asteroid belt", "moon", "orbital station"];
const STATUSES = ["untouched", "extraction", "colonized"];
const STATION_CLASS_VALUES = STATION_CLASSES.map((c) => c.value);

function uniqueBodySlug(base, bodies) {
  if (!bodies.some((b) => b.slug === base)) return base;
  let i = 2;
  while (bodies.some((b) => b.slug === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function register(server) {
  server.tool(
    "generate_planets",
    "Bulk-rerolls every *unlocked* system's bodies (planets, moons, belts, stations) in place — positions/names/everything else untouched. Seeded off the project seed (`${seed}:bodies:<slug>`), so this is reproducible: running it again with nothing else changed produces the same result. Locked systems' bodies are never touched.",
    {},
    tool(() => {
      const project = state.requireProject();
      if (project.systems.length === 0) return { rerolled: 0 };
      const before = new Map(project.systems.map((s) => [s.slug, s.bodies?.length || 0]));
      const systems = regeneratePlanets(project);
      state.setProject({ ...project, systems });
      const rerolled = systems.filter((s) => !s.locked).length;
      return { rerolledSystems: rerolled, lockedSystemsSkipped: systems.length - rerolled };
    }),
  );

  server.tool(
    "reroll_system_bodies",
    "Rerolls just one system's bodies, not seeded off the project seed (so it won't reproduce the same way generate_planets does) — same as the app's per-system 'Reroll bodies' button. Locks the system afterward so future generate_systems/generate_planets calls leave it alone.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      const sys = system(project, slug);
      const bodies = generateBodies(createRng(`manual:${crypto.randomUUID()}`), sys);
      state.setProject({ ...project, systems: replaceBySlug(project.systems, slug, { bodies, locked: true }) });
      return { system: slug, bodyCount: bodies.length };
    }),
  );

  server.tool(
    "get_system_bodies",
    "Full body list for one system (planets, moons, belts, stations), plus the star's habitable-zone/frost-line numbers the orbits were placed relative to.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      const sys = system(project, slug);
      return { bodies: sys.bodies || [], zones: getSystemZones(sys) };
    }),
  );

  server.tool(
    "update_body",
    "Edit one field or several on a single body by slug — rename, reposition (orbitAU/orbitAUOuter/orbitAngleDeg), recolonize (status/population/habitable), re-host onto a different parent, or edit station-only fields (sizeClass/population/lengthM/docks/dockClass/services/goodsHandled). Same shape the Orrery tab's body editor writes.",
    {
      systemSlug: z.string(),
      bodySlug: z.string(),
      name: z.string().optional(),
      kind: z.enum(BODY_KINDS).optional(),
      parent: z.string().nullable().optional().describe("Host body slug for a moon/station, or null to detach."),
      orbitAU: z.number().nullable().optional(),
      orbitAUOuter: z.number().nullable().optional(),
      orbitAngleDeg: z.number().optional(),
      habitable: z.boolean().optional(),
      status: z.enum(STATUSES).optional(),
      population: z.union([z.string(), z.number()]).nullable().optional(),
      resources: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      sizeClass: z.string().optional().describe(`For a station, one of: ${STATION_CLASS_VALUES.join(", ")}. Free text for a planet's size class.`),
      lengthM: z.number().nullable().optional().describe("Station-only: physical length in meters."),
      docks: z.number().nullable().optional().describe("Station-only: dock count."),
      dockClass: z.string().nullable().optional().describe("Station-only, e.g. 'shuttle & light-freighter berths'."),
      services: z.array(z.string()).optional().describe("Station-only."),
      goodsHandled: z.array(z.string()).optional().describe("Station-only."),
    },
    tool(({ systemSlug, bodySlug, ...patch }) => {
      const project = state.requireProject();
      const sys = system(project, systemSlug);
      const bodies = sys.bodies || [];
      if (!bodies.some((b) => b.slug === bodySlug)) throw new Error(`No body "${bodySlug}" in system "${systemSlug}".`);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const nextBodies = bodies.map((b) => (b.slug === bodySlug ? { ...b, ...cleanPatch } : b));
      state.setProject({ ...project, systems: replaceBySlug(project.systems, systemSlug, { bodies: nextBodies }) });
      return nextBodies.find((b) => b.slug === bodySlug);
    }),
  );

  server.tool(
    "add_body",
    "Hand-add a new body to a system — a planet/belt orbiting the star directly, or a moon/station attached to an existing primary (pass parentSlug). Starts with sane defaults (a station starts as a mid-tier 'waystation'), same as the Orrery tab's Add row; use update_body to fill in the rest.",
    {
      systemSlug: z.string(),
      kind: z.enum(BODY_KINDS),
      parentSlug: z.string().optional().describe("Required for moon/orbital station — the primary body it orbits."),
      orbitAU: z.number().positive().optional().describe("Star-orbit distance for a planet/belt. Ignored for moon/station."),
    },
    tool(({ systemSlug, kind, parentSlug, orbitAU }) => {
      const project = state.requireProject();
      const sys = system(project, systemSlug);
      const bodies = sys.bodies || [];
      const isSatellite = kind === "moon" || kind === "orbital station";
      if (isSatellite) {
        if (!parentSlug) throw new Error(`kind "${kind}" needs parentSlug.`);
        if (!bodies.some((b) => b.slug === parentSlug)) throw new Error(`No body "${parentSlug}" in system "${systemSlug}" to attach to.`);
      }
      const isStation = kind === "orbital station";
      const label = kind === "orbital station" ? "New Station" : kind === "moon" ? "New Moon" : "New Body";
      const slug = uniqueBodySlug(slugify(`${sys.slug}-${label}`), bodies);
      const body = {
        slug,
        name: label,
        kind,
        parent: isSatellite ? parentSlug : null,
        orbitAU: isSatellite ? null : Number((orbitAU ?? 1).toFixed(3)),
        orbitAUOuter: null,
        orbitAngleDeg: Math.round(Math.random() * 360),
        orbitPeriodDays: null,
        sizeClass: isStation ? "waystation" : null,
        radiusKm: null,
        habitable: false,
        resources: [],
        status: isStation ? "colonized" : "untouched",
        population: isStation ? 150 : null,
        lengthM: isStation ? 250 : null,
        docks: isStation ? 3 : null,
        dockClass: isStation ? "shuttle & light-freighter berths" : null,
        services: isStation ? ["refueling"] : [],
        goodsHandled: [],
        tags: isStation ? ["orbital-infrastructure"] : [],
      };
      state.setProject({ ...project, systems: replaceBySlug(project.systems, systemSlug, { bodies: [...bodies, body] }) });
      return body;
    }),
  );

  server.tool(
    "delete_body",
    "Delete a body from a system. Cascades to any moons/stations attached to it (same as the Orrery tab's Delete button).",
    { systemSlug: z.string(), bodySlug: z.string() },
    tool(({ systemSlug, bodySlug }) => {
      const project = state.requireProject();
      const sys = system(project, systemSlug);
      const bodies = sys.bodies || [];
      const removeSlugs = new Set([bodySlug, ...bodies.filter((b) => b.parent === bodySlug).map((b) => b.slug)]);
      const nextBodies = bodies.filter((b) => !removeSlugs.has(b.slug));
      state.setProject({ ...project, systems: replaceBySlug(project.systems, systemSlug, { bodies: nextBodies }) });
      return { deleted: [...removeSlugs] };
    }),
  );
}
