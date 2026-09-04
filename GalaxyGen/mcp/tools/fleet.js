import { z } from "zod";
import { generateShipModels, generateCompanies } from "../../src/lib/shipGen.js";
import { SHIP_ROLES, COMPANY_KINDS } from "../../src/lib/shipTypes.js";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { uniqueSlug, findBySlug, replaceBySlug, system } from "../lib/refs.js";

const COMPANY_KIND_VALUES = COMPANY_KINDS.map((k) => k.value);
const ROLE_BY_KIND = Object.fromEntries(COMPANY_KINDS.map((k) => [k.value, k.role]));

function shipModel(project, slug) {
  return findBySlug(project.shipModels, slug, "ship model");
}
function company(project, slug) {
  return findBySlug(project.companies, slug, "company");
}

export function register(server) {
  // --- Ship models ---------------------------------------------------

  server.tool(
    "list_ship_models",
    "List the galaxy-wide ship-model catalog (manufacturer + hull class, not placed per-system). Filter by role to see just one economy's models.",
    { role: z.enum(SHIP_ROLES).optional() },
    tool(({ role }) => {
      const project = state.requireProject();
      const list = role ? project.shipModels.filter((m) => m.role === role) : project.shipModels;
      return list.map((m) => ({
        slug: m.slug,
        name: m.name,
        manufacturer: m.manufacturer,
        hullClass: m.hullClass,
        role: m.role,
        sizeCategory: m.sizeCategory,
        combatRating: m.combatRating,
        cargoTons: m.cargoTons,
        costTier: m.costTier,
      }));
    }),
  );

  server.tool(
    "get_ship_model",
    "Full detail for one ship model.",
    { slug: z.string() },
    tool(({ slug }) => shipModel(state.requireProject(), slug)),
  );

  server.tool(
    "generate_ship_models",
    "(Re)generates the galaxy-wide ship-model catalog (a fixed-size reference table of manufacturer+hull combinations, scaled to sector count — see mcp/README or GalaxyGen/README for the hull/manufacturer vocabulary). Replaces the whole catalog. Companies reference models by slug, so regenerating after companies already exist leaves their fleets pointing at stale slugs until generate_companies is also re-run.",
    {},
    tool(() => {
      const project = state.requireProject();
      const shipModels = generateShipModels(project);
      state.setProject({ ...project, shipModels });
      return { modelCount: shipModels.length };
    }),
  );

  // --- Companies -------------------------------------------------------

  server.tool(
    "list_companies",
    "List every company (cargo lines, tourism operators, diplomatic couriers, private charters, military contractors) — name, kind, scale, home system, fleet total.",
    { sectorSlug: z.string().optional().describe("Filter to one sector.") },
    tool(({ sectorSlug }) => {
      const project = state.requireProject();
      const list = sectorSlug ? project.companies.filter((c) => c.homeSector === sectorSlug) : project.companies;
      return list.map((c) => ({
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        role: c.role,
        scale: c.scale,
        parentFaction: c.parentFaction,
        homeSystem: c.homeSystem,
        homeSector: c.homeSector,
        fleetTotal: c.fleet.reduce((n, f) => n + f.count, 0),
        notableShipCount: c.notableShips.length,
        origin: c.origin,
      }));
    }),
  );

  server.tool(
    "get_company",
    "Full detail for one company, including its aggregate fleet (model slug + count) and individually-named notable ships.",
    { slug: z.string() },
    tool(({ slug }) => company(state.requireProject(), slug)),
  );

  server.tool(
    "generate_companies",
    `Seeds ship-operating companies per sector (roughly one per 15 systems, min 1 max 4), kind biased by the sector's focus (${COMPANY_KIND_VALUES.join(", ")}), fleet sampled from the ship-model catalog. Requires generate_ship_models to have been run first. Only origin:"generated" companies are replaced — hand-authored ones (create_company) survive.`,
    {},
    tool(() => {
      const project = state.requireProject();
      if (project.shipModels.length === 0) throw new Error("No ship models — call generate_ship_models first.");
      if (project.systems.length === 0) throw new Error("No systems to seed companies into — generate systems first.");
      const authored = project.companies.filter((c) => c.origin === "authored");
      const generated = generateCompanies({ ...project, companies: authored }, project.shipModels);
      state.setProject({ ...project, companies: [...authored, ...generated] });
      return { generatedCount: generated.length, authoredCount: authored.length };
    }),
  );

  server.tool(
    "create_company",
    `Author a new company by hand. Starts with an empty fleet — build it up with add_fleet_entry / add_notable_ship. Valid kinds: ${COMPANY_KIND_VALUES.join(", ")}.`,
    {
      name: z.string(),
      kind: z.enum(COMPANY_KIND_VALUES),
      scale: z.enum(["small", "regional", "major"]).default("small"),
      parentFactionSlug: z.string().optional().describe("Omit for an independent company."),
      homeSystemSlug: z.string().optional(),
      homeSectorSlug: z.string().optional(),
    },
    tool(({ name, kind, scale, parentFactionSlug, homeSystemSlug, homeSectorSlug }) => {
      const project = state.requireProject();
      if (homeSystemSlug) system(project, homeSystemSlug);
      const c = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(name, project.companies),
        name,
        kind,
        role: ROLE_BY_KIND[kind],
        scale,
        parentFaction: parentFactionSlug ?? null,
        homeSystem: homeSystemSlug ?? null,
        homeSector: homeSectorSlug ?? null,
        fleet: [],
        notableShips: [],
        extraTags: [],
        origin: "authored",
      };
      state.setProject({ ...project, companies: [...project.companies, c] });
      return c;
    }),
  );

  server.tool(
    "update_company",
    "Edit a company's fields (rename, kind/scale, parent faction, home system/sector, extraTags). Use add_fleet_entry/remove_fleet_entry and add_notable_ship/remove_notable_ship for the fleet itself.",
    {
      slug: z.string(),
      name: z.string().optional(),
      kind: z.enum(COMPANY_KIND_VALUES).optional(),
      scale: z.enum(["small", "regional", "major"]).optional(),
      parentFaction: z.string().nullable().optional(),
      homeSystem: z.string().nullable().optional(),
      homeSector: z.string().nullable().optional(),
      extraTags: z.array(z.string()).optional(),
    },
    tool(({ slug, kind, ...patch }) => {
      const project = state.requireProject();
      company(project, slug);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (kind) {
        cleanPatch.kind = kind;
        cleanPatch.role = ROLE_BY_KIND[kind];
      }
      state.setProject({ ...project, companies: replaceBySlug(project.companies, slug, cleanPatch) });
      return company(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_company",
    "Delete a company outright.",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      company(project, slug);
      state.setProject({ ...project, companies: project.companies.filter((c) => c.slug !== slug) });
      return { deleted: slug };
    }),
  );

  server.tool(
    "add_fleet_entry",
    "Add hulls of a given ship model to a company's aggregate fleet (adds to an existing entry for that model if one exists, otherwise creates one).",
    { companySlug: z.string(), modelSlug: z.string(), count: z.number().int().positive() },
    tool(({ companySlug, modelSlug, count }) => {
      const project = state.requireProject();
      const c = company(project, companySlug);
      shipModel(project, modelSlug); // validate
      const existing = c.fleet.find((f) => f.modelSlug === modelSlug);
      const fleet = existing
        ? c.fleet.map((f) => (f.modelSlug === modelSlug ? { ...f, count: f.count + count } : f))
        : [...c.fleet, { modelSlug, count }];
      state.setProject({ ...project, companies: replaceBySlug(project.companies, companySlug, { fleet }) });
      return fleet;
    }),
  );

  server.tool(
    "remove_fleet_entry",
    "Remove a model entirely from a company's fleet (or reduce its count — pass count to reduce by that many, omit to remove the whole entry).",
    { companySlug: z.string(), modelSlug: z.string(), count: z.number().int().positive().optional() },
    tool(({ companySlug, modelSlug, count }) => {
      const project = state.requireProject();
      const c = company(project, companySlug);
      const existing = c.fleet.find((f) => f.modelSlug === modelSlug);
      if (!existing) throw new Error(`Company "${companySlug}" has no fleet entry for model "${modelSlug}".`);
      const remaining = count ? existing.count - count : 0;
      const fleet = remaining > 0
        ? c.fleet.map((f) => (f.modelSlug === modelSlug ? { ...f, count: remaining } : f))
        : c.fleet.filter((f) => f.modelSlug !== modelSlug);
      state.setProject({ ...project, companies: replaceBySlug(project.companies, companySlug, { fleet }) });
      return fleet;
    }),
  );

  server.tool(
    "add_notable_ship",
    "Add an individually-named, GM-relevant ship to a company's roster (a flagship, a PC-relevant hauler, ...).",
    {
      companySlug: z.string(),
      name: z.string(),
      modelSlug: z.string(),
      status: z.enum(["active", "lost", "impounded"]).default("active"),
      currentSystem: z.string().optional(),
      captainActorSlug: z.string().optional(),
    },
    tool(({ companySlug, name, modelSlug, status, currentSystem, captainActorSlug }) => {
      const project = state.requireProject();
      const c = company(project, companySlug);
      shipModel(project, modelSlug);
      if (currentSystem) system(project, currentSystem);
      const ship = {
        slug: uniqueSlug(`${companySlug}-${name}`, [...project.companies.flatMap((co) => co.notableShips)]),
        name,
        modelSlug,
        status,
        currentSystem: currentSystem ?? c.homeSystem ?? null,
        captainActor: captainActorSlug ?? null,
      };
      state.setProject({ ...project, companies: replaceBySlug(project.companies, companySlug, { notableShips: [...c.notableShips, ship] }) });
      return ship;
    }),
  );

  server.tool(
    "update_notable_ship",
    "Edit a notable ship's fields (rename, status, current location, captain).",
    {
      companySlug: z.string(),
      shipSlug: z.string(),
      name: z.string().optional(),
      status: z.enum(["active", "lost", "impounded"]).optional(),
      currentSystem: z.string().nullable().optional(),
      captainActorSlug: z.string().nullable().optional(),
    },
    tool(({ companySlug, shipSlug, currentSystem, captainActorSlug, ...patch }) => {
      const project = state.requireProject();
      const c = company(project, companySlug);
      if (!c.notableShips.some((s) => s.slug === shipSlug)) throw new Error(`No notable ship "${shipSlug}" on company "${companySlug}".`);
      if (currentSystem) system(project, currentSystem);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (currentSystem !== undefined) cleanPatch.currentSystem = currentSystem;
      if (captainActorSlug !== undefined) cleanPatch.captainActor = captainActorSlug;
      const notableShips = c.notableShips.map((s) => (s.slug === shipSlug ? { ...s, ...cleanPatch } : s));
      state.setProject({ ...project, companies: replaceBySlug(project.companies, companySlug, { notableShips }) });
      return notableShips.find((s) => s.slug === shipSlug);
    }),
  );

  server.tool(
    "remove_notable_ship",
    "Remove a notable ship from a company's roster.",
    { companySlug: z.string(), shipSlug: z.string() },
    tool(({ companySlug, shipSlug }) => {
      const project = state.requireProject();
      const c = company(project, companySlug);
      const notableShips = c.notableShips.filter((s) => s.slug !== shipSlug);
      state.setProject({ ...project, companies: replaceBySlug(project.companies, companySlug, { notableShips }) });
      return { removed: shipSlug };
    }),
  );
}
