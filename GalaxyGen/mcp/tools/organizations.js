import { z } from "zod";
import * as state from "../lib/state.js";
import { tool } from "../lib/respond.js";
import { uniqueSlug, organization, replaceBySlug } from "../lib/refs.js";

export function register(server) {
  server.tool(
    "list_organizations",
    "List every organization (name, slug, ideology, parent faction, home system/sector) with its derived member count (actors whose affiliation points here).",
    {},
    tool(() => {
      const project = state.requireProject();
      return project.organizations.map((o) => ({
        slug: o.slug,
        name: o.name,
        ideology: o.ideology,
        parentFaction: o.parentFaction,
        homeSystem: o.homeSystem,
        memberCount: project.actors.filter((a) => a.affiliation === `party:${o.slug}`).length,
      }));
    }),
  );

  server.tool(
    "get_organization",
    "Full detail for one organization, plus its member list (derived from actors whose affiliation points here).",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      const org = organization(project, slug);
      const members = project.actors.filter((a) => a.affiliation === `party:${org.slug}`).map((a) => a.slug);
      return { ...org, members };
    }),
  );

  server.tool(
    "create_organization",
    "Author a new organization (a party — guild, cult, cell — distinct from a faction; §6.2). Membership is derived from actors' own affiliation field, not set here.",
    {
      name: z.string(),
      ideology: z.string(),
      parentFaction: z.string().describe("Faction slug this organization answers to (use 'dominion' if none)."),
      homeSystem: z.string().nullable().optional(),
      homeSector: z.string().nullable().optional(),
      localInfluence: z.number().min(0).max(1).default(0.1),
    },
    tool(({ name, ideology, parentFaction, homeSystem, homeSector, localInfluence }) => {
      const project = state.requireProject();
      const org = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(name, project.organizations),
        name,
        ideology,
        parentFaction,
        homeSystem: homeSystem ?? null,
        homeSector: homeSector ?? null,
        localInfluence,
        extraTags: [],
      };
      state.setProject({ ...project, organizations: [...project.organizations, org] });
      return org;
    }),
  );

  server.tool(
    "update_organization",
    "Edit an existing organization's fields.",
    {
      slug: z.string(),
      name: z.string().optional(),
      ideology: z.string().optional(),
      parentFaction: z.string().optional(),
      homeSystem: z.string().nullable().optional(),
      homeSector: z.string().nullable().optional(),
      localInfluence: z.number().min(0).max(1).optional(),
      extraTags: z.array(z.string()).optional(),
    },
    tool(({ slug, ...patch }) => {
      const project = state.requireProject();
      organization(project, slug);
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      state.setProject({ ...project, organizations: replaceBySlug(project.organizations, slug, cleanPatch) });
      return organization(state.requireProject(), slug);
    }),
  );

  server.tool(
    "delete_organization",
    "Delete an organization. Member actors' affiliation is left pointing at the now-deleted slug (matches the app; re-affiliate them by hand via update_actor if needed).",
    { slug: z.string() },
    tool(({ slug }) => {
      const project = state.requireProject();
      organization(project, slug);
      state.setProject({ ...project, organizations: project.organizations.filter((o) => o.slug !== slug) });
      return { deleted: slug };
    }),
  );
}
