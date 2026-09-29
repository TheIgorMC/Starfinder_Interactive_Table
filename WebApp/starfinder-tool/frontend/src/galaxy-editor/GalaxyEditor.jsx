import "../galaxy/galaxy.css";
import "./editor.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerSync, fetchProject } from "./sync.js";
import { ProjectPanel } from "./components/Toolbar.jsx";
import SectorList, { PendingSectorForm, PendingFactionForm, FactionCard, ActorCard, OrgCard, CompanyCard } from "./components/SectorList.jsx";
import AIPanel from "./components/AIPanel.jsx";
import StationGen, { stationKey } from "./components/StationGen.jsx";
import ModuleDesigner from "./kit/ModuleDesigner.jsx";
import { EditorMap } from "./map/editor-map.js";
import BuildPanel from "./shell/BuildPanel.jsx";
import SystemWorkspace from "./shell/SystemWorkspace.jsx";
import { Head, SystemInspector, SectorInspector, SystemsPanel } from "./shell/Inspectors.jsx";
import { EIcon } from "./shell/icons.jsx";
import { MODES, prepGalaxy, POPL } from "../galaxy/common.js";
import { Icon } from "../galaxy/ui.jsx";
import { Legend } from "../galaxy/GalaxyMapPage.jsx";
import { buildCompact } from "@galaxy-core/lib/compact.js";
import { generateBodies } from "@galaxy-core/lib/planetGen.js";
import { createRng } from "@galaxy-core/lib/rng.js";
import { createDefaultProject, normalizeProject, FIELD_DEFS } from "@galaxy-core/lib/project.js";
import { GRID_SIZE, paintGrid } from "@galaxy-core/lib/grid.js";
import { pointInPolygon } from "@galaxy-core/lib/geometry.js";
import { slugify } from "@galaxy-core/lib/slug.js";
import { generateSystems, placeSystemAt, redistributeSystems, regeneratePlanets, settleGalaxy } from "@galaxy-core/lib/systemGen.js";
import { generateHyperlanes, buildEdge } from "@galaxy-core/lib/hyperlaneGen.js";
import { resolveFactions } from "@galaxy-core/lib/factionGen.js";
import { generateBackgroundActors } from "@galaxy-core/lib/actorGen.js";
import { generateShipModels, generateCompanies } from "@galaxy-core/lib/shipGen.js";
import { applyEvent } from "@galaxy-core/lib/effectEngine.js";
import { buildGalaxyIndexEnvelope } from "@galaxy-core/lib/aiIndex.js";
import { queryGalaxyFull, resolveEntity } from "@galaxy-core/lib/aiQuery.js";
import { runPass1, runPass2 } from "@galaxy-core/lib/aiClient.js";
import {
  downloadProjectJSON,
  downloadGalaxyIndex,
  importProjectFile,
  exportGalaxySDF,
  loadAISettings,
  saveAISettings,
} from "./persistence.js";

const PANEL_WIDTHS_KEY = "galaxygen.panelWidths.v1";
const PANEL_MIN_WIDTH = 180;
const PANEL_MAX_WIDTH = 560;

// Layout (Docs/10-galaxy-mapgen.md, editor): three workspaces — MAP (the
// viewer's galaxy map + editing tools), SYSTEM (orrery, bodies, cities),
// STATIONS (station/ship layouts). On the map, tools sit in a dock at the
// bottom, map layers on the left (as in the viewer), and the right panel
// holds the pipeline and the entity lists — or the inspector of whatever is
// selected.
const TOOLS = [
  { key: "select", label: "SELECT", key1: "V", hint: "Click a star, a faction seed or a sector to inspect it · drag to pan · double-click to zoom" },
  { key: "paint", label: "PAINT", key1: "B", hint: "Drag to paint the field · Shift-drag erases · right-drag or Space-drag pans" },
  { key: "sector", label: "SECTOR", key1: "S", hint: "Click to add corners (they snap to other sectors) · click the first corner or press Enter to close · Esc cancels" },
  { key: "system", label: "SYSTEM", key1: "P", hint: "Click inside a sector to place a new system there — it is marked curated" },
  { key: "lane", label: "LANE", key1: "L", hint: "Click two systems to add or remove the hyperlane between them" },
  { key: "faction", label: "FACTION", key1: "F", hint: "Click to drop a faction's seed — on a star it holds that system outright" },
];
const SECTIONS = [
  { key: "build", label: "BUILD" },
  { key: "systems", label: "SYSTEMS" },
  { key: "factions", label: "FACTIONS" },
  { key: "people", label: "PEOPLE" },
  { key: "fleets", label: "FLEETS" },
  { key: "events", label: "EVENTS" },
  { key: "ai", label: "AI" },
  { key: "project", label: "PROJECT" },
];
const MODE_KEYS = ["factions", "security", "conflict", "sectors", "population", "trade"];

function uniqueSlug(base, sectors) {
  const existing = new Set(sectors.map((s) => s.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function stripRefPrefix(ref) {
  if (!ref) return ref;
  const idx = ref.indexOf(":");
  return idx < 0 ? ref : ref.slice(idx + 1);
}

// Docs/11-AI-integration.md §6.3/6.4/6.5 — converts an AI tool-call's typed-
// ref arguments into the exact field shapes App.jsx's existing create/commit
// handlers already expect (the same ones the manual forms build) — an AI
// proposal is never a separate code path from a hand-authored one, just a
// different source for the same fields.
function actorProposalToFields(args) {
  return {
    name: args.name,
    kind: args.kind || "individual",
    role: args.role || "unspecified",
    affiliation: args.affiliation || null,
    location: args.location ? stripRefPrefix(args.location) : null,
    mobile: !!args.mobile,
    influence: typeof args.influence === "number" ? args.influence : 0.2,
  };
}

function organizationProposalToFields(args) {
  return {
    name: args.name,
    ideology: args.ideology || "unspecified",
    parentFaction: args.parent_faction === "dominion" ? "dominion" : stripRefPrefix(args.parent_faction),
    homeSystem: args.home_system ? stripRefPrefix(args.home_system) : null,
    homeSector: args.home_sector ? stripRefPrefix(args.home_sector) : null,
    localInfluence: typeof args.local_influence === "number" ? args.local_influence : 0.2,
  };
}

function eventProposalToDraft(args) {
  return {
    name: args.name,
    summary: args.summary || "",
    tags: args.tags || [],
    timestamp: args.timestamp || "",
    timestep: args.timestep || { amount: 1, unit: "day" },
    mode: "authored",
    magnitude: args.magnitude,
    scope: args.scope || [],
    effects: args.effects || [],
    narrative: args.narrative || "",
  };
}

// The Galaxy Editor (formerly the standalone GalaxyGen app), now part of
// SIT: it edits the campaign's stored galaxy in place (see sync.js) — the
// same project the galaxy viewer renders and the galaxy MCP tools operate on.
function EditorApp({ initialProject, initialVersion, embedded, active = true }) {
  const [project, setProject] = useState(() => normalizeProject(initialProject));
  const sync = useServerSync(project, setProject, initialVersion);
  const [workspace, setWorkspace] = useState("map");
  const [section, setSection] = useState("build"); // right panel; null = collapsed
  const [tool, setToolRaw] = useState("select");
  const [mapMode, setMapMode] = useState("sectors");
  const [showLanes, setShowLanes] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [stationTarget, setStationTarget] = useState(null);
  const [laneFrom, setLaneFrom] = useState(null);
  const [search, setSearch] = useState("");
  const [activeField, setActiveField] = useState(FIELD_DEFS[0].key);
  const [brush, setBrush] = useState({ radius: 80, strength: 0.6 });
  const [constrainToSector, setConstrainToSector] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [selectedFactionId, setSelectedFactionId] = useState(null);
  const [selectedActorId, setSelectedActorId] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [pendingPoints, setPendingPoints] = useState(null);
  const [pendingClosed, setPendingClosed] = useState(false);
  const [pendingFactionSeed, setPendingFactionSeed] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [exportStatus, setExportStatus] = useState("");
  const [spacing, setSpacing] = useState({ min: 20, max: 70 });
  // Both default off — a fresh view shows the plain map, not a wash of
  // field/territory color; the GM opts into color layers deliberately.
  const [showFactions, setShowFactions] = useState(false);
  const [showFieldOverlay, setShowFieldOverlay] = useState(false);
  const [aiSettings, setAiSettings] = useState(() => loadAISettings());

  // Machine-local, never part of the project — saved on every change so a
  // GM doesn't have to re-enter their API base/key/model after a reload.
  useEffect(() => {
    saveAISettings(aiSettings);
  }, [aiSettings]);

  const selectedSector = project.sectors.find((s) => s.id === selectedSectorId) || null;
  const selectedSystem = project.systems.find((s) => s.id === selectedSystemId) || null;
  const selectedFaction = project.factions.find((f) => f.id === selectedFactionId) || null;
  const selectedActor = project.actors.find((a) => a.id === selectedActorId) || null;
  const selectedOrg = project.organizations.find((o) => o.id === selectedOrgId) || null;
  const selectedCompany = project.companies.find((c) => c.id === selectedCompanyId) || null;

  const handlePaint = useCallback(
    (wx, wy, erase) => {
      setProject((p) => {
        const grid = p.fields[activeField].slice();
        const sector = constrainToSector ? selectedSector : null;
        paintGrid(
          grid,
          GRID_SIZE,
          p.bounds,
          wx,
          wy,
          brush.radius,
          brush.strength,
          erase,
          sector ? (x, y) => pointInPolygon(x, y, sector.points) : null,
        );
        return { ...p, fields: { ...p.fields, [activeField]: grid } };
      });
    },
    [activeField, brush, constrainToSector, selectedSector],
  );

  const handleAddSectorPoint = useCallback((wx, wy) => {
    setPendingPoints((pts) => [...(pts || []), [wx, wy]]);
  }, []);

  const handleCloseSectorDraft = useCallback(() => {
    setPendingPoints((pts) => {
      if (pts && pts.length >= 3) setPendingClosed(true);
      return pts;
    });
  }, []);

  const handleReopenSectorDraft = useCallback(() => setPendingClosed(false), []);

  const handleCancelSectorDraft = useCallback(() => {
    setPendingPoints(null);
    setPendingClosed(false);
  }, []);

  const handleCommitSector = useCallback(
    (name, focus) => {
      setProject((p) => {
        const slug = uniqueSlug(slugify(name), p.sectors);
        const sector = {
          id: crypto.randomUUID(),
          slug,
          name,
          focus,
          points: pendingPoints,
        };
        setSelectedSectorId(sector.id);
        return { ...p, sectors: [...p.sectors, sector] };
      });
      setPendingPoints(null);
      setPendingClosed(false);
      setTool("select");
    },
    [pendingPoints],
  );

  const handleFocusChange = useCallback((id, focus) => {
    setProject((p) => ({
      ...p,
      sectors: p.sectors.map((s) => (s.id === id ? { ...s, focus } : s)),
    }));
  }, []);
  const handleUpdateSector = useCallback((id, patch) => {
    setProject((p) => ({ ...p, sectors: p.sectors.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }, []);

  // Used for rename + the "important" flag — slug stays put either way, so
  // hyperlane/control references elsewhere (which key off slug, not name)
  // never go stale.
  const handleUpdateSystem = useCallback((id, patch) => {
    setProject((p) => ({
      ...p,
      systems: p.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const handleDeleteSector = useCallback(
    (id) => {
      setProject((p) => {
        const sector = p.sectors.find((s) => s.id === id);
        const systems = sector ? p.systems.filter((sys) => sys.sector !== sector.slug) : p.systems;
        const keptIds = new Set(systems.map((s) => s.id));
        const removedSlugs = new Set(p.systems.filter((s) => !keptIds.has(s.id)).map((s) => s.slug));
        return {
          ...p,
          sectors: p.sectors.filter((s) => s.id !== id),
          // Drop that sector's generated systems too, rather than leaving
          // orphaned entries pointing at a sector slug that no longer exists,
          // and strip any hyperlane that referenced one of them.
          systems: systems.map((s) => ({
            ...s,
            hyperlanes: s.hyperlanes.filter((slug) => !removedSlugs.has(slug)),
          })),
          hyperlanes: p.hyperlanes.filter((e) => keptIds.has(e.a) && keptIds.has(e.b)),
          // Un-anchor any faction whose home system just got removed with it.
          factions: p.factions.map((f) =>
            f.homeSystem && removedSlugs.has(f.homeSystem) ? { ...f, homeSystem: null } : f,
          ),
          // Actors are anchored to a system (§6) — if theirs is gone, mark
          // them unplaced rather than deleting the curated actor outright.
          actors: p.actors.map((a) =>
            a.location && removedSlugs.has(a.location) ? { ...a, location: null } : a,
          ),
        };
      });
      if (selectedSectorId === id) setSelectedSectorId(null);
    },
    [selectedSectorId],
  );

  const handleGenerateSystems = useCallback(() => {
    const hasUnlocked = project.systems.some((s) => !s.locked);
    if (hasUnlocked && !window.confirm("Regenerate systems? This replaces every unlocked system — locked ones (renamed/hand-tuned) stay exactly as they are, new ones just fill in the gaps around them.")) {
      return;
    }
    // Locked systems keep their id/slug/position, so hyperlanes and faction
    // anchors pointing at them are still valid after this — only ones tied
    // to a swept-away unlocked system need clearing.
    setProject((p) => {
      const systems = generateSystems(p, spacing);
      const keptIds = new Set(systems.map((s) => s.id));
      const keptSlugs = new Set(systems.map((s) => s.slug));
      return {
        ...p,
        systems,
        hyperlanes: p.hyperlanes.filter((e) => keptIds.has(e.a) && keptIds.has(e.b)),
        factions: p.factions.map((f) =>
          f.homeSystem && !keptSlugs.has(f.homeSystem) ? { ...f, homeSystem: null } : f,
        ),
        actors: p.actors.map((a) =>
          a.location && !keptSlugs.has(a.location) ? { ...a, location: null } : a,
        ),
      };
    });
    setSelectedSystemId(null);
  }, [project.systems, spacing]);

  // Position-only reshuffle — every unlocked system keeps its name, slug,
  // star type, population, trade goods, bodies, control, and security;
  // only where it sits on the map changes. No id/slug ever changes here,
  // so unlike a full regen this never needs to clean up faction anchors,
  // actor locations, or drop hyperlane edges — it only refreshes each
  // edge's cached length/risk/capacity to match the new positions.
  const handleRedistributeSystems = useCallback(() => {
    if (project.systems.length === 0) return;
    const { systems, hyperlanes } = redistributeSystems(project, spacing);
    setProject((p) => ({ ...p, systems, hyperlanes }));
  }, [project, spacing]);

  // Bulk reroll of every unlocked system's bodies — separate from "Generate
  // systems" (which would also reshuffle positions/names) so a GM can pull
  // an existing galaxy onto a corrected planetGen.js model, or just get a
  // fresh set of planets, without touching anything else.
  const handleGeneratePlanets = useCallback(() => {
    if (project.systems.length === 0) return;
    if (!window.confirm("Reroll every unlocked system's bodies? Locked systems' bodies are left exactly as they are.")) {
      return;
    }
    setProject((p) => ({ ...p, systems: regeneratePlanets(p) }));
  }, [project.systems.length]);

  const [settleStatus, setSettleStatus] = useState("");
  const handleSettleGalaxy = useCallback((integrateCurated) => {
    const { systems, changed } = settleGalaxy(project, { integrateCurated });
    setSettleStatus(changed ? `Updated ${changed} system(s).` : "Nothing to change — every system already follows the rules.");
    if (changed) setProject((p) => ({ ...p, systems }));
  }, [project]);

  const handleGenerateHyperlanes = useCallback(() => {
    if (project.systems.length < 2) return;
    if (project.hyperlanes.length > 0 && !window.confirm("Regenerate hyperlanes? This replaces the existing hyperlane graph.")) {
      return;
    }
    setProject((p) => {
      const { edges, systems } = generateHyperlanes(p);
      return { ...p, systems, hyperlanes: edges };
    });
  }, [project.systems.length, project.hyperlanes.length]);

  // §3 stage 4's other half — a single hand-placed system, rolled from
  // whatever's painted at that exact point and locked immediately since
  // placing it by hand is itself a curation decision.
  const handlePlaceSystem = useCallback(
    (wx, wy) => {
      const system = placeSystemAt(project, wx, wy);
      if (!system) return; // clicked outside every sector — nothing to place into
      setProject((p) => ({ ...p, systems: [...p.systems, system] }));
      setSelectedSystemId(system.id);
    },
    [project],
  );

  // Hyperlane tool: click two systems to toggle a direct edge between them,
  // independent of a full "Generate hyperlanes" regen. Keeps both the
  // inspectable `project.hyperlanes` edge list and each system's exported
  // `hyperlanes` slug array in sync.
  const handleToggleHyperlane = useCallback((systemIdA, systemIdB) => {
    setProject((p) => {
      const a = p.systems.find((s) => s.id === systemIdA);
      const b = p.systems.find((s) => s.id === systemIdB);
      if (!a || !b) return p;
      const existingIdx = p.hyperlanes.findIndex(
        (e) => (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id),
      );
      const connected = existingIdx >= 0;
      const hyperlanes = connected
        ? p.hyperlanes.filter((_, i) => i !== existingIdx)
        : [...p.hyperlanes, buildEdge(p, a, b)];
      const systems = p.systems.map((s) => {
        if (s.id === a.id) {
          return {
            ...s,
            hyperlanes: connected ? s.hyperlanes.filter((slug) => slug !== b.slug) : [...s.hyperlanes, b.slug].sort(),
          };
        }
        if (s.id === b.id) {
          return {
            ...s,
            hyperlanes: connected ? s.hyperlanes.filter((slug) => slug !== a.slug) : [...s.hyperlanes, a.slug].sort(),
          };
        }
        return s;
      });
      return { ...p, systems, hyperlanes };
    });
  }, []);

  // homeSystemSlug/homeSystemName are set when the click snapped onto an
  // existing system (Faction tool anchoring, §4 "seed IN a system") — null
  // for a plain seed placed on open ground.
  const handleAddFactionSeed = useCallback((wx, wy, homeSystemSlug = null, homeSystemName = null) => {
    setPendingFactionSeed({ x: wx, y: wy, homeSystem: homeSystemSlug, homeSystemName });
  }, []);

  const handleCancelFactionSeed = useCallback(() => setPendingFactionSeed(null), []);

  const handleCommitFaction = useCallback(
    (name, color, government, aggression, strength) => {
      setProject((p) => {
        const slug = uniqueSlug(slugify(name), p.factions);
        const faction = {
          id: crypto.randomUUID(),
          slug,
          name,
          color,
          government,
          aggression,
          strength,
          seed: { x: pendingFactionSeed.x, y: pendingFactionSeed.y },
          // A faction anchored to a system holds it outright, no matter what
          // the usual distance-based contest would say (§4) — see
          // resolveFactions in factionGen.js.
          homeSystem: pendingFactionSeed.homeSystem ?? null,
          toleratedCrimes: [],
          relationships: {},
          extraTags: [],
          origin: "authored",
        };
        setSelectedFactionId(faction.id);
        return { ...p, factions: [...p.factions, faction] };
      });
      setPendingFactionSeed(null);
      setTool("select");
    },
    [pendingFactionSeed],
  );

  const handleUpdateFaction = useCallback((id, patch) => {
    setProject((p) => ({
      ...p,
      factions: p.factions.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }, []);

  const handleDeleteFaction = useCallback(
    (id) => {
      setProject((p) => {
        const faction = p.factions.find((f) => f.id === id);
        if (!faction) return p;
        return {
          ...p,
          factions: p.factions.filter((f) => f.id !== id),
          // Strip stale references so the export/inspector never points at
          // a faction that no longer exists; a full "Generate factions"
          // re-run will properly re-resolve control around the gap this
          // leaves behind.
          systems: p.systems.map((s) => {
            if (!s.control) return s;
            const owner = s.control.owner === faction.slug ? null : s.control.owner;
            const contestedBy = (s.control.contestedBy || []).filter((c) => c.faction !== faction.slug);
            return { ...s, control: { owner, contestedBy } };
          }),
          // Actors affiliated straight to this faction fall back to
          // unaffiliated; organizations fall back to the Dominion (§6.2 —
          // every organization must resolve to *some* existing faction).
          actors: p.actors.map((a) =>
            a.affiliation === `faction:${faction.slug}` ? { ...a, affiliation: null } : a,
          ),
          organizations: p.organizations.map((o) =>
            o.parentFaction === faction.slug ? { ...o, parentFaction: "dominion" } : o,
          ),
        };
      });
      if (selectedFactionId === id) setSelectedFactionId(null);
    },
    [selectedFactionId],
  );

  const handleGenerateFactions = useCallback(() => {
    if (project.systems.length === 0) return;
    const hasResolved = project.systems.some((s) => s.control) || project.factions.some((f) => f.origin === "generated");
    if (hasResolved && !window.confirm("Regenerate factions? This re-seeds border factions and recomputes control/security/war-chance for every system.")) {
      return;
    }
    setProject((p) => {
      const authored = p.factions.filter((f) => f.origin === "authored");
      const { factions, systems } = resolveFactions(p, authored);
      return { ...p, factions, systems };
    });
  }, [project.systems.length, project.factions]);

  // §6.1 — background (`origin: "generated"`) actors are fully automatic
  // and freely re-rollable; curated (`origin: "authored"`) actors are never
  // touched by this pass, so a GM's hand-placed people survive every reroll.
  const handleGenerateBackgroundActors = useCallback(() => {
    if (project.systems.length === 0) return;
    const hasGenerated = project.actors.some((a) => a.origin === "generated");
    if (
      hasGenerated &&
      !window.confirm(
        "Regenerate background actors? This rerolls every auto-seeded actor from scratch — actors you've added by hand are untouched.",
      )
    ) {
      return;
    }
    setProject((p) => {
      const curated = p.actors.filter((a) => a.origin === "authored");
      const generated = generateBackgroundActors({ ...p, actors: curated });
      return { ...p, actors: [...curated, ...generated] };
    });
  }, [project.systems.length, project.actors]);

  // Actors are anchored to an existing system (§6) — placing one there is
  // a hand-curation signal just like renaming, so lock that system too.
  const handleCreateActor = useCallback((fields) => {
    setProject((p) => {
      const slug = uniqueSlug(slugify(fields.name), p.actors);
      const actor = {
        id: crypto.randomUUID(),
        slug,
        name: fields.name,
        kind: fields.kind,
        role: fields.role,
        affiliation: fields.affiliation || null,
        location: fields.location || null,
        mobile: fields.mobile,
        influence: fields.influence,
        status: "active",
        reputation: {},
        extraTags: [],
        origin: "authored",
      };
      setSelectedActorId(actor.id);
      return {
        ...p,
        actors: [...p.actors, actor],
        systems: fields.location
          ? p.systems.map((s) => (s.slug === fields.location ? { ...s, locked: true } : s))
          : p.systems,
      };
    });
  }, []);

  const handleUpdateActor = useCallback((id, patch) => {
    setProject((p) => ({
      ...p,
      actors: p.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      // Relocating an actor onto a system locks it too, same as creation.
      systems: patch.location
        ? p.systems.map((s) => (s.slug === patch.location ? { ...s, locked: true } : s))
        : p.systems,
    }));
  }, []);

  const handleDeleteActor = useCallback(
    (id) => {
      setProject((p) => ({ ...p, actors: p.actors.filter((a) => a.id !== id) }));
      if (selectedActorId === id) setSelectedActorId(null);
    },
    [selectedActorId],
  );

  const handleCreateOrganization = useCallback((fields) => {
    setProject((p) => {
      const slug = uniqueSlug(slugify(fields.name), p.organizations);
      const org = {
        id: crypto.randomUUID(),
        slug,
        name: fields.name,
        ideology: fields.ideology,
        parentFaction: fields.parentFaction,
        homeSystem: fields.homeSystem || null,
        homeSector: fields.homeSector || null,
        localInfluence: fields.localInfluence,
        extraTags: [],
      };
      setSelectedOrgId(org.id);
      return { ...p, organizations: [...p.organizations, org] };
    });
  }, []);

  const handleUpdateOrganization = useCallback((id, patch) => {
    setProject((p) => ({
      ...p,
      organizations: p.organizations.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  }, []);

  const handleDeleteOrganization = useCallback(
    (id) => {
      setProject((p) => {
        const org = p.organizations.find((o) => o.id === id);
        if (!org) return p;
        return {
          ...p,
          organizations: p.organizations.filter((o) => o.id !== id),
          // Members fall back to unaffiliated rather than pointing at a
          // party slug that no longer exists.
          actors: p.actors.map((a) =>
            a.affiliation === `party:${org.slug}` ? { ...a, affiliation: null } : a,
          ),
        };
      });
      if (selectedOrgId === id) setSelectedOrgId(null);
    },
    [selectedOrgId],
  );

  // §8-adjacent ship/fleet economy — regenerates the galaxy-wide ship-model
  // catalog (manufacturer + hull combinations, not placed per-system).
  // Companies reference a model by slug, so regenerating models after
  // companies already exist leaves their `fleet`/`notableShips` pointing at
  // stale slugs — same "you did that, not us" contract as any other
  // slug-stable-across-rename entity in this app; re-run generate companies
  // afterward if that happens.
  const handleGenerateShipModels = useCallback(() => {
    if (
      project.shipModels.length > 0 &&
      !window.confirm("Regenerate the ship-model catalog? Existing companies' fleets will still reference the old model slugs until you also regenerate companies.")
    ) {
      return;
    }
    setProject((p) => ({ ...p, shipModels: generateShipModels(p) }));
  }, [project.shipModels.length]);

  // Seeds ship-operating companies per sector (cargo lines, tourism
  // operators, diplomatic couriers, private charters, military
  // contractors) — needs the ship-model catalog to already exist. Only
  // `origin: "generated"` companies are replaced; hand-authored ones (once
  // added) would survive, same convention as factions/actors.
  const handleGenerateCompanies = useCallback(() => {
    if (project.shipModels.length === 0) {
      window.alert("Generate the ship-model catalog first (Generate tab).");
      return;
    }
    if (project.systems.length === 0) return;
    const hasGenerated = project.companies.some((c) => c.origin === "generated");
    if (hasGenerated && !window.confirm("Regenerate companies? This rerolls every auto-seeded company's fleet and roster from scratch.")) {
      return;
    }
    setProject((p) => {
      const authored = p.companies.filter((c) => c.origin === "authored");
      const generated = generateCompanies({ ...p, companies: authored }, p.shipModels);
      return { ...p, companies: [...authored, ...generated] };
    });
  }, [project.shipModels.length, project.systems.length, project.companies]);

  // Hand-authored companies start with an empty fleet/notableShips — the
  // GM builds them up via update_company (or the future fleet editor);
  // `origin: "authored"` is what keeps them exempt from
  // handleGenerateCompanies's full-reroll pass, same convention as
  // authored factions/actors.
  const handleCreateCompany = useCallback((fields) => {
    setProject((p) => {
      const slug = uniqueSlug(slugify(fields.name), p.companies);
      const company = {
        id: crypto.randomUUID(),
        slug,
        name: fields.name,
        kind: fields.kind,
        role: fields.role,
        scale: fields.scale,
        parentFaction: fields.parentFaction || null,
        homeSystem: fields.homeSystem || null,
        homeSector: fields.homeSector || null,
        fleet: [],
        notableShips: [],
        extraTags: [],
        origin: "authored",
      };
      setSelectedCompanyId(company.id);
      return { ...p, companies: [...p.companies, company] };
    });
  }, []);

  // Hand-authored one-of-a-kind ship models (city-ships etc.) — `custom: true`
  // is what keeps them through "Generate ship models".
  const handleCreateShipModel = useCallback((fields) => {
    setProject((p) => ({
      ...p,
      shipModels: [
        ...p.shipModels,
        { id: crypto.randomUUID(), slug: uniqueSlug(slugify(fields.name), p.shipModels), ...fields, custom: true },
      ],
    }));
  }, []);

  const handleDeleteShipModel = useCallback(
    (id) => {
      const model = project.shipModels.find((m) => m.id === id);
      if (!model) return;
      const users = project.companies.filter(
        (c) => c.fleet.some((f) => f.modelSlug === model.slug) || c.notableShips.some((s) => s.modelSlug === model.slug),
      );
      if (users.length > 0 && !window.confirm(`${users.map((c) => c.name).join(", ")} still use "${model.name}" — delete anyway? Their fleets will show a missing model.`)) {
        return;
      }
      setProject((p) => ({ ...p, shipModels: p.shipModels.filter((m) => m.id !== id) }));
    },
    [project.shipModels, project.companies],
  );

  const handleUpdateCompany = useCallback((id, patch) => {
    setProject((p) => ({ ...p, companies: p.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }, []);

  const handleDeleteCompany = useCallback(
    (id) => {
      setProject((p) => ({ ...p, companies: p.companies.filter((c) => c.id !== id) }));
      if (selectedCompanyId === id) setSelectedCompanyId(null);
    },
    [selectedCompanyId],
  );

  // §9 pipeline step 4 — computes an event's effect diff without
  // committing anything, so the Events tab can show a review gate for
  // moderate+ events before the GM confirms (minor events skip straight to
  // commit, §9.2/§12). Throws on an invalid effect (bad ref, envelope
  // violation, ownership-flip gate not cleared, ...) for the caller to
  // catch and surface — nothing here ever touches `project`.
  const handlePreviewEvent = useCallback((draft) => applyEvent(project, draft).diffs, [project]);

  // §9 pipeline step 5 — commits an event: applies its effects (throws,
  // untouched, if any effect is invalid) and appends the event itself
  // (with its resolved diffs and a commit timestamp) to the append-only
  // log in the same state update.
  const handleCommitEvent = useCallback(
    (draft) => {
      const { project: nextProject, diffs } = applyEvent(project, draft);
      const slug = uniqueSlug(slugify(draft.name), project.events);
      const event = { id: crypto.randomUUID(), slug, ...draft, diffs, committedAt: new Date().toISOString() };
      setProject({ ...nextProject, events: [...nextProject.events, event] });
      return event;
    },
    [project],
  );

  // Removes an event from the log only — it does NOT revert the effects it
  // already applied (there's no replay/undo engine yet, §10 of the design
  // doc's roadmap notes this as a future "drop the last event, re-fold"
  // capability, not something Phase 5 implements).
  const handleDeleteEvent = useCallback((id) => {
    setProject((p) => ({ ...p, events: p.events.filter((e) => e.id !== id) }));
  }, []);

  // §9.3 Pass 1 (broad/coherence): compact index + request in, a shortlist
  // of typed refs out. Pure orchestration — building the index and calling
  // the AI client are the only things this does.
  const handleRunAIPass1 = useCallback(
    (requestText) => runPass1(aiSettings, buildGalaxyIndexEnvelope(project), requestText),
    [project, aiSettings],
  );

  // Typed refs (§6) are stable identifiers, not display text — a renamed
  // system keeps its original slug on purpose (handleUpdateSystem above),
  // so "system:kreel-1" stops looking anything like the system's current
  // name once it's been renamed. Rather than churn every stored reference
  // on rename (which would silently invalidate any past event's scope/
  // effects — an append-only history log should keep pointing at whatever
  // it pointed at when committed), the AI panel just looks up each ref's
  // *current* display name live for whatever it's showing the GM, so a
  // proposal referencing "system:kreel-1" can be shown as "Vraxis
  // (system:kreel-1)" without the underlying ref ever having to change.
  const resolveRefName = useCallback((ref) => resolveEntity(project, ref)?.entry?.name ?? null, [project]);

  // §9.3 Pass 2 (deep detail): resolves the shortlist to full SDF-shaped
  // entries (§6.2 "full" mode) plus recent event history, then asks the AI
  // to produce exactly one tool call from the real create/event tools.
  const handleRunAIPass2 = useCallback(
    (requestText, shortlist) => runPass2(aiSettings, queryGalaxyFull(project, shortlist), requestText),
    [project, aiSettings],
  );

  // Only `apply_event` proposals have anything to preview — reuses the
  // exact same effect-engine validation/clamping the manual Events form
  // does, so an AI-drafted event gets no less scrutiny than a hand-typed
  // one.
  const handlePreviewAIProposal = useCallback(
    (proposal) => handlePreviewEvent(eventProposalToDraft(proposal.arguments)),
    [handlePreviewEvent],
  );

  // Dispatches an accepted proposal onto the exact same handlers the manual
  // forms use — an AI proposal is just a different source for the same
  // fields, never a separate write path.
  const handleConfirmAIProposal = useCallback(
    (proposal) => {
      if (proposal.name === "create_actor") {
        handleCreateActor(actorProposalToFields(proposal.arguments));
      } else if (proposal.name === "create_organization") {
        handleCreateOrganization(organizationProposalToFields(proposal.arguments));
      } else if (proposal.name === "apply_event") {
        handleCommitEvent(eventProposalToDraft(proposal.arguments));
      } else {
        throw new Error(`Unknown proposal type: ${proposal.name}`);
      }
    },
    [handleCreateActor, handleCreateOrganization, handleCommitEvent],
  );

  const handleNewProject = useCallback((seed, width, height) => {
    const hasWork = project.sectors.length > 0;
    if (hasWork && !window.confirm("Discard the current galaxy and start a new one?")) return;
    setProject(createDefaultProject(seed || undefined, Number(width) || 1000, Number(height) || 1000));
    setSelectedSectorId(null);
    setSelectedSystemId(null);
    setSelectedFactionId(null);
    setSelectedActorId(null);
    setSelectedOrgId(null);
    setPendingPoints(null);
    setPendingClosed(false);
    setPendingFactionSeed(null);
  }, [project.sectors.length]);

  const handleImportProject = useCallback(async (file) => {
    try {
      const imported = normalizeProject(await importProjectFile(file));
      setProject(imported);
      setSelectedSectorId(null);
      setSelectedSystemId(null);
      setSelectedFactionId(null);
      setSelectedActorId(null);
      setSelectedOrgId(null);
      setPendingPoints(null);
      setPendingClosed(false);
      setPendingFactionSeed(null);
    } catch (err) {
      window.alert(`Could not load project: ${err.message}`);
    }
  }, []);

  const handleExportSDF = useCallback(async () => {
    try {
      const result = await exportGalaxySDF(project);
      if (result.mode === "none") setExportStatus("Nothing to export yet.");
      else if (result.mode === "fs") {
        setExportStatus(`Wrote ${result.sectorCount} sector(s), ${result.systemCount} system(s), ${result.factionCount} faction(s), ${result.actorCount} actor(s), ${result.organizationCount} organization(s), ${result.eventCount} event(s), and index.json to content/.`);
      } else {
        setExportStatus(`Downloaded galaxy-sdf.json (${result.sectorCount} sector(s), ${result.systemCount} system(s), ${result.factionCount} faction(s), ${result.actorCount} actor(s), ${result.organizationCount} organization(s), ${result.eventCount} event(s), plus a compact index) — split by hand for now.`);
      }
    } catch (err) {
      if (err?.name !== "AbortError") setExportStatus(`Export failed: ${err.message}`);
    }
  }, [project]);

  // ---------------------------------------------------------------------------
  // Shell: selection routing, the map instance, keyboard shortcuts.
  const setTool = useCallback((t) => {
    setToolRaw(t);
    setLaneFrom(null);
    if (t !== "select") setWorkspace("map");
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedSectorId(null); setSelectedSystemId(null); setSelectedFactionId(null);
    setSelectedActorId(null); setSelectedOrgId(null); setSelectedCompanyId(null);
  }, []);
  const selectOnly = useCallback((kind, id) => {
    clearSelection();
    if (kind === "system") setSelectedSystemId(id);
    else if (kind === "sector") setSelectedSectorId(id);
    else if (kind === "faction") setSelectedFactionId(id);
    else if (kind === "actor") setSelectedActorId(id);
    else if (kind === "org") setSelectedOrgId(id);
    else if (kind === "company") setSelectedCompanyId(id);
  }, [clearSelection]);

  // compact data shared by the map and the panels (the viewer's format)
  const D = useMemo(() => prepGalaxy(buildCompact(project)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.systems, project.hyperlanes, project.factions, project.sectors, project.bounds]);

  const cvRef = useRef(null);
  const mapRef = useRef(null);
  const live = useRef({});
  const fieldAt = (wx, wy) => {
    const b = project.bounds, g = project.fields[activeField];
    if (!g || wx < 0 || wy < 0 || wx > b.width || wy > b.height) { setHoverInfo(null); return; }
    const gx = Math.min(GRID_SIZE - 1, Math.floor((wx / b.width) * GRID_SIZE)), gy = Math.min(GRID_SIZE - 1, Math.floor((wy / b.height) * GRID_SIZE));
    setHoverInfo({ wx, wy, value: g[gy * GRID_SIZE + gx] });
  };
  live.current = { fieldAt, selectOnly, handlePaint, handleAddSectorPoint, handleCloseSectorDraft, handlePlaceSystem, handleAddFactionSeed, handleToggleHyperlane, laneFrom, setLaneFrom, section, clearSelection };
  const layoutRef = useRef({}); layoutRef.current = { panelOpen: section != null || !!(selectedSystemId || selectedSectorId || selectedFactionId || selectedActorId || selectedOrgId || selectedCompanyId) };
  useEffect(() => {
    const m = new EditorMap(cvRef.current, project, D, {
      onPick: (hit) => { if (hit) live.current.selectOnly(hit.kind, hit.id); else live.current.clearSelection(); },
      onHover: () => {},
      onPaint: (x, y, erase) => live.current.handlePaint(x, y, erase),
      onCursor: (x, y) => live.current.fieldAt(x, y),
      onSectorPoint: (x, y) => live.current.handleAddSectorPoint(x, y),
      onSectorClose: () => live.current.handleCloseSectorDraft(),
      onPlaceSystem: (x, y) => live.current.handlePlaceSystem(x, y),
      onFactionSeed: (x, y, slug, name) => live.current.handleAddFactionSeed(x, y, slug, name),
      onLane: (id) => {
        const L = live.current;
        if (!id || id === L.laneFrom) L.setLaneFrom(null);
        else if (!L.laneFrom) L.setLaneFrom(id);
        else { L.handleToggleHyperlane(L.laneFrom, id); L.setLaneFrom(null); }
      },
      keepOut: (W, H) => [[0, 0, W, 84], [0, 84, 104, H], [W - (layoutRef.current.panelOpen ? 504 : 96), 84, W, H], [W / 2 - 300, H - 150, W / 2 + 300, H]],
      scaleY: (H) => H - 118,
    });
    mapRef.current = m;
    return () => { m.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { mapRef.current?.setProject(project, D); }, [project, D]);
  useEffect(() => { mapRef.current?.setMode(mapMode); }, [mapMode]);
  useEffect(() => { mapRef.current?.setLanes(showLanes); }, [showLanes]);
  useEffect(() => { mapRef.current?.setLabels(showNames); }, [showNames]);
  useEffect(() => { mapRef.current?.selectSystemId(selectedSystemId); }, [selectedSystemId, D]);
  useEffect(() => { if (mapRef.current) mapRef.current.paused = !active || workspace !== "map"; }, [workspace, active]);
  useEffect(() => {
    mapRef.current?.setEd({
      tool, field: activeField, showField: showFieldOverlay, brush,
      selSector: selectedSectorId, selFaction: selectedFactionId,
      pending: pendingPoints, pendingClosed, pendingSeed: pendingFactionSeed, laneFrom,
    });
  }, [tool, activeField, showFieldOverlay, brush, selectedSectorId, selectedFactionId, pendingPoints, pendingClosed, pendingFactionSeed, laneFrom]);

  // keyboard: tools, Esc / Enter
  useEffect(() => {
    const onKey = (e) => {
      if (!active || workspace !== "map" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.key !== "Escape") return;
      const t = TOOLS.find((x) => x.key1.toLowerCase() === e.key.toLowerCase());
      if (t) { setTool(t.key); return; }
      if (e.key === "Enter" && pendingPoints?.length >= 3 && !pendingClosed) handleCloseSectorDraft();
      if (e.key === "Escape") {
        if (pendingPoints) handleCancelSectorDraft();
        else if (pendingFactionSeed) handleCancelFactionSeed();
        else if (laneFrom) setLaneFrom(null);
        else if (tool !== "select") setTool("select");
        else clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, workspace, tool, pendingPoints, pendingClosed, pendingFactionSeed, laneFrom, setTool, clearSelection, handleCloseSectorDraft, handleCancelSectorDraft, handleCancelFactionSeed]);

  const flyTo = (id) => { selectOnly("system", id); setWorkspace("map"); setTimeout(() => mapRef.current?.focusSystemId(id), 0); };
  const openSystem = (id) => { if (id) selectOnly("system", id); setWorkspace("system"); };
  const openStation = (system, body) => { setStationTarget(stationKey("body", system.slug, body.slug)); setWorkspace("stations"); };
  const rerollBodies = (sys) => {
    if (!window.confirm(`Reroll every body of ${sys.name}? Hand edits to its planets are lost.`)) return;
    handleUpdateSystem(sys.id, { bodies: generateBodies(createRng(`manual:${crypto.randomUUID()}`), sys), locked: true });
  };

  const matches = useMemo(() => {
    const qq = search.trim().toLowerCase();
    if (!qq) return [];
    return project.systems.filter((s) => s.name.toLowerCase().includes(qq))
      .sort((a, b) => (Number(b.name.toLowerCase().startsWith(qq)) - Number(a.name.toLowerCase().startsWith(qq))) || (b.important || 0) - (a.important || 0))
      .slice(0, 7);
  }, [project.systems, search]);

  // what the right panel shows
  const inspecting = selectedSystem || selectedSector || selectedFaction || selectedActor || selectedOrg || selectedCompany;
  const panelOpen = section != null || !!inspecting;
  const pickSection = (k) => { if (inspecting) { clearSelection(); setSection(k); } else setSection(section === k ? null : k); };

  const sl = {
    sectors: project.sectors, selectedSectorId, onSelect: (id) => selectOnly("sector", id), onFocusChange: handleFocusChange, onDelete: handleDeleteSector,
    selectedSystem: null, onDeselectSystem: () => {}, onUpdateSystem: handleUpdateSystem, systems: project.systems,
    factions: project.factions, selectedFactionId, selectedFaction: null, onSelectFaction: (id) => selectOnly("faction", id), onDeselectFaction: () => {},
    onUpdateFaction: handleUpdateFaction, onDeleteFaction: handleDeleteFaction, pendingFactionSeed: null, onCommitFaction: handleCommitFaction, onCancelFactionSeed: handleCancelFactionSeed,
    pendingPoints: null, pendingClosed, onClosePending: handleCloseSectorDraft, onReopenPending: handleReopenSectorDraft, onCommitPending: handleCommitSector, onCancelPending: handleCancelSectorDraft,
    actors: project.actors, selectedActorId, selectedActor: null, onSelectActor: (id) => selectOnly("actor", id), onDeselectActor: () => {},
    onCreateActor: handleCreateActor, onUpdateActor: handleUpdateActor, onDeleteActor: handleDeleteActor,
    organizations: project.organizations, selectedOrgId, selectedOrg: null, onSelectOrg: (id) => selectOnly("org", id), onDeselectOrg: () => {},
    onCreateOrganization: handleCreateOrganization, onUpdateOrganization: handleUpdateOrganization, onDeleteOrganization: handleDeleteOrganization,
    companies: project.companies, shipModels: project.shipModels, selectedCompanyId, selectedCompany: null, onSelectCompany: (id) => selectOnly("company", id), onDeselectCompany: () => {},
    onCreateCompany: handleCreateCompany, onUpdateCompany: handleUpdateCompany, onDeleteCompany: handleDeleteCompany, onCreateShipModel: handleCreateShipModel, onDeleteShipModel: handleDeleteShipModel,
    events: project.events, onPreviewEvent: handlePreviewEvent, onCommitEvent: handleCommitEvent, onDeleteEvent: handleDeleteEvent,
  };

  const systemInspector = selectedSystem && (
    <SystemInspector D={D} system={selectedSystem} actors={project.actors} onUpdate={handleUpdateSystem} onClose={clearSelection}
      onOpenSystem={() => openSystem(selectedSystem.id)}
      onPickSystem={(slug) => { const s = project.systems.find((x) => x.slug === slug); if (s) flyTo(s.id); }}
      onReroll={() => rerollBodies(selectedSystem)} />
  );

  let inspector = null;
  if (selectedSystem) inspector = systemInspector;
  else if (selectedSector) inspector = <SectorInspector sector={selectedSector} project={project} onUpdate={handleUpdateSector} onDelete={handleDeleteSector} onClose={clearSelection} constrain={constrainToSector} setConstrain={setConstrainToSector} />;
  else if (selectedFaction) inspector = (<><Head kind={`FACTION${selectedFaction.origin === "generated" ? " · AUTO-SEEDED" : ""}`} dot={selectedFaction.color} title={selectedFaction.name} editable onRename={(name) => handleUpdateFaction(selectedFaction.id, { name })} onClose={clearSelection} sub={selectedFaction.government} /><div className="gx-sec ge-form"><FactionCard faction={selectedFaction} factions={project.factions} onUpdate={handleUpdateFaction} onClose={clearSelection} /></div><div className="gx-sec"><button className="ge-btn danger" onClick={() => window.confirm(`Delete faction ${selectedFaction.name}?`) && handleDeleteFaction(selectedFaction.id)}>Delete faction</button></div></>);
  else if (selectedActor) inspector = (<><Head kind={`ACTOR · ${selectedActor.role || ""}`.toUpperCase()} title={selectedActor.name} onClose={clearSelection} /><div className="gx-sec ge-form"><ActorCard actor={selectedActor} factions={project.factions} organizations={project.organizations} companies={project.companies} systems={project.systems} onUpdate={handleUpdateActor} onClose={clearSelection} /></div></>);
  else if (selectedOrg) inspector = (<><Head kind="ORGANIZATION" title={selectedOrg.name} onClose={clearSelection} sub={selectedOrg.ideology} /><div className="gx-sec ge-form"><OrgCard org={selectedOrg} actors={project.actors} factions={project.factions} systems={project.systems} sectors={project.sectors} onUpdate={handleUpdateOrganization} onClose={clearSelection} /></div></>);
  else if (selectedCompany) inspector = (<><Head kind={`COMPANY · ${selectedCompany.kind}`.toUpperCase()} title={selectedCompany.name} onClose={clearSelection} sub={`${selectedCompany.scale} · ${selectedCompany.fleet.reduce((n, f) => n + f.count, 0)} hulls`} /><div className="gx-sec ge-form"><CompanyCard company={selectedCompany} shipModels={project.shipModels} factions={project.factions} systems={project.systems} sectors={project.sectors} onUpdate={handleUpdateCompany} onClose={clearSelection} /></div></>);

  const sectionBody = {
    build: (
      <BuildPanel p={project} tool={tool} setTool={setTool} field={activeField} setField={setActiveField} showField={showFieldOverlay} setShowField={setShowFieldOverlay}
        spacing={spacing} setSpacing={setSpacing} settleStatus={settleStatus}
        act={{ systems: handleGenerateSystems, redistribute: handleRedistributeSystems, planets: handleGeneratePlanets, settle: handleSettleGalaxy, lanes: handleGenerateHyperlanes, factions: handleGenerateFactions, shipModels: handleGenerateShipModels, companies: handleGenerateCompanies, actors: handleGenerateBackgroundActors }} />
    ),
    systems: (
      <>
        <SystemsPanel project={project} selectedId={selectedSystemId} onPick={flyTo} />
        <div className="ge-sub-h">SECTORS · {project.sectors.length}</div>
        <div className="ge-rows">
          {project.sectors.map((s) => (
            <button key={s.id} className="gx-gbtn gx-row" onClick={() => selectOnly("sector", s.id)}>
              <span className="gx-ox" style={{ color: "#ff9a3c", minWidth: 28 }}>{s.name}</span>
              <span className="t"><span className="b" style={{ color: "#9a958b" }}>{s.focus} · {project.systems.filter((x) => x.sector === s.slug).length} systems</span></span>
            </button>
          ))}
        </div>
        <button className={"ge-btn" + (tool === "sector" ? " on" : "")} onClick={() => setTool("sector")}>{EIcon.sector()} Draw a new sector</button>
      </>
    ),
    factions: (
      <>
        <button className={"ge-btn primary" + (tool === "faction" ? " on" : "")} onClick={() => setTool("faction")}>{EIcon.faction()} Place a faction on the map</button>
        <div className="ge-form"><SectorList {...sl} activeTab="factions" /></div>
      </>
    ),
    people: <div className="ge-form"><SectorList {...sl} activeTab="actors" /><SectorList {...sl} activeTab="organizations" /></div>,
    fleets: <div className="ge-form"><SectorList {...sl} activeTab="companies" /></div>,
    events: <div className="ge-form"><SectorList {...sl} activeTab="events" /></div>,
    ai: <div className="ge-form"><AIPanel settings={aiSettings} onSettingsChange={setAiSettings} onRunPass1={handleRunAIPass1} onRunPass2={handleRunAIPass2} onPreviewProposal={handlePreviewAIProposal} onConfirmProposal={handleConfirmAIProposal} resolveRefName={resolveRefName} /></div>,
    project: (
      <div className="ge-form">
        <ProjectPanel project={project} hoverInfo={hoverInfo} activeField={activeField} onNewProject={handleNewProject}
          onDownloadProject={() => downloadProjectJSON(project)} onDownloadIndex={() => downloadGalaxyIndex(project)}
          onImportProject={handleImportProject} onExportSDF={handleExportSDF} exportStatus={exportStatus} />
      </div>
    ),
  };
  const SECTION_TITLES = { build: ["PIPELINE", "Build the galaxy"], systems: ["INDEX", "Systems & sectors"], factions: ["POWERS", "Factions"], people: ["CAST", "People & organizations"], fleets: ["SHIPPING", "Companies & ships"], events: ["HISTORY", "Events & journal"], ai: ["ASSISTANT", "AI"], project: ["FILE", "Project"] };

  const toolDef = TOOLS.find((t) => t.key === tool);
  const toolOptions = (() => {
    if (tool === "paint") {
      const fd = FIELD_DEFS.find((f) => f.key === activeField);
      return (
        <>
          <div className="ge-opt-row">
            <label className="ge-lbl">Field
              <select className="ge-in" value={activeField} onChange={(e) => { setActiveField(e.target.value); setShowFieldOverlay(true); }}>
                {FIELD_DEFS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <label className="ge-lbl">Radius <b>{brush.radius}</b><input type="range" min="10" max="250" value={brush.radius} onChange={(e) => setBrush({ ...brush, radius: Number(e.target.value) })} /></label>
            <label className="ge-lbl">Strength <b>{brush.strength.toFixed(2)}</b><input type="range" min="0.05" max="1" step="0.05" value={brush.strength} onChange={(e) => setBrush({ ...brush, strength: Number(e.target.value) })} /></label>
          </div>
          <div className="ge-opt-row">
            <label className="ge-check"><input type="checkbox" checked={showFieldOverlay} onChange={(e) => setShowFieldOverlay(e.target.checked)} /> Show <i className="ge-sw" style={{ background: `rgb(${fd?.color})` }} /> on the map</label>
            <label className="ge-check" title={selectedSector ? "" : "Select a sector first (Select tool)"}><input type="checkbox" disabled={!selectedSector} checked={constrainToSector && !!selectedSector} onChange={(e) => setConstrainToSector(e.target.checked)} /> Only inside {selectedSector ? selectedSector.name : "the selected sector"}</label>
            {hoverInfo && hoverInfo.value != null && <span className="gx-lore">value here: {hoverInfo.value.toFixed(2)}</span>}
          </div>
        </>
      );
    }
    if (tool === "sector" && pendingPoints?.length) {
      return <div className="ge-form"><PendingSectorForm pointCount={pendingPoints.length} closed={pendingClosed} onClose={handleCloseSectorDraft} onReopen={handleReopenSectorDraft} onCommit={handleCommitSector} onCancel={handleCancelSectorDraft} /></div>;
    }
    if (tool === "faction" && pendingFactionSeed) {
      return <div className="ge-form"><PendingFactionForm pendingFactionSeed={pendingFactionSeed} onCommit={handleCommitFaction} onCancel={handleCancelFactionSeed} /></div>;
    }
    if (tool === "lane" && laneFrom) {
      return <div className="gx-lore">From <b style={{ color: "#5fd3f3" }}>{project.systems.find((s) => s.id === laneFrom)?.name}</b> — now click the other end (Esc cancels).</div>;
    }
    return null;
  })();

  return (
    <div className={"gx ge" + (embedded ? " embedded" : "") + (panelOpen ? "" : " ge-closed")}>
      <canvas ref={cvRef} className="gx-canvas" style={{ visibility: workspace === "map" ? "visible" : "hidden", cursor: tool === "select" ? undefined : "crosshair" }} />

      {/* top bar */}
      <div className="gx-top ge-top">
        <a href={embedded ? undefined : "/"} className="gx-brand" style={{ textDecoration: "none" }}>
          {Icon.logo()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="gx-brand-t">GALAXY EDITOR</div>
            <div className="gx-brand-s">SEED {String(project.seed).toUpperCase()}</div>
          </div>
        </a>
        <div role="tablist" aria-label="Workspace" className="gx-group ge-ws">
          {[["map", "MAP", EIcon.map()], ["system", "SYSTEM", EIcon.orrery()], ["stations", "STATIONS", EIcon.station()], ["modules", "MODULES", EIcon.modules()]].map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={workspace === k} className={"gx-tbtn" + (workspace === k ? " on" : "")} onClick={() => setWorkspace(k)}>{ic}{l}</button>
          ))}
        </div>
        {workspace === "map" && (
          <div className="gx-search ge-search">
            {Icon.search()}
            <input type="search" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a system…"
              onKeyDown={(e) => { if (e.key === "Enter" && matches.length) { flyTo(matches[0].id); setSearch(""); e.currentTarget.blur(); } if (e.key === "Escape") { setSearch(""); e.currentTarget.blur(); } }} />
            {matches.length > 0 && (
              <div className="gx-matches">
                {matches.map((s) => (
                  <button key={s.id} className="gx-gbtn" onClick={() => { flyTo(s.id); setSearch(""); }}>
                    <span className="n">{s.name}</span>
                    <span className="m">{(s.sector === "core" ? "CORE" : "SECTOR " + s.sector).toUpperCase()} · {(POPL[s.population] || s.population || "").toUpperCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="gx-grow" style={{ pointerEvents: "none" }} />
        {workspace === "map" && <div className="gx-stats ge-stats"><span><b>{project.systems.length}</b> SYSTEMS</span><span><b>{project.hyperlanes.length}</b> LANES</span><span><b>{project.factions.length}</b> FACTIONS</span></div>}
        <SaveStatus sync={sync} />
        <a className="ge-toplink" href="/galaxy" target={embedded ? "_blank" : undefined} rel="noreferrer">VIEWER ↗</a>
      </div>
      {(sync.status === "conflict" || sync.remoteVersion != null) && (
        <div className="ge-banner">
          <span>The galaxy was changed elsewhere (another tab or an MCP tool){sync.status === "conflict" ? " — your last save was not applied." : "."}</span>
          <button className="ge-btn" onClick={sync.reload}>Reload theirs</button>
          <button className="ge-btn" onClick={sync.overwrite}>Keep mine (overwrite)</button>
        </div>
      )}

      {workspace === "map" && (
        <>
          <nav aria-label="Map layers" className="gx-rail">
            {MODE_KEYS.map((m) => (
              <button key={m} className={"gx-mbtn" + (mapMode === m ? " on" : "")} aria-pressed={mapMode === m} onClick={() => setMapMode(m)}>{Icon[m]()}<span>{MODES[m].t}</span></button>
            ))}
            <div className="gx-rail-sep" />
            <button className={"gx-mbtn short" + (showLanes ? " on" : "")} aria-pressed={showLanes} onClick={() => setShowLanes(!showLanes)}>{Icon.lanes()}<span>LANES</span></button>
            <button className={"gx-mbtn short" + (showNames ? " on" : "")} aria-pressed={showNames} onClick={() => setShowNames(!showNames)}>{Icon.labels()}<span>NAMES</span></button>
            <button className={"gx-mbtn short" + (showFieldOverlay ? " on" : "")} aria-pressed={showFieldOverlay} onClick={() => setShowFieldOverlay(!showFieldOverlay)} title={FIELD_DEFS.find((f) => f.key === activeField)?.label}>{EIcon.field()}<span>FIELD</span></button>
          </nav>
          <div className="gx-zoom">
            <button className="gx-mbtn" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>{Icon.plus()}</button>
            <button className="gx-mbtn" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>{Icon.minus()}</button>
            <button className="gx-mbtn" aria-label="Reset view" onClick={() => mapRef.current?.reset()}>{Icon.reset()}</button>
          </div>
          <div className="gx-legend ge-legend">
            <div className="gx-legend-h"><span className="t">{MODES[mapMode].t}</span><span className="s">{MODES[mapMode].sub}</span></div>
            <Legend mode={mapMode} D={D} />
          </div>

          {/* tool dock */}
          <div className="ge-dockwrap">
            {(toolOptions || tool !== "select") && (
              <div className="ge-toolopts">
                <div className="ge-toolopts-h"><span className="t">{toolDef.label}</span><span className="s">{toolDef.hint}</span></div>
                {toolOptions}
              </div>
            )}
            <div className="ge-dock" role="toolbar" aria-label="Tools">
              {TOOLS.map((t) => (
                <button key={t.key} className={"gx-mbtn" + (tool === t.key ? " on" : "")} aria-pressed={tool === t.key} onClick={() => setTool(t.key)} title={`${t.hint} (${t.key1})`}>
                  {EIcon[t.key]()}<span>{t.label}</span><kbd>{t.key1}</kbd>
                </button>
              ))}
            </div>
          </div>

          {/* right rail + panel */}
          <nav aria-label="Panels" className="ge-rrail">
            {SECTIONS.map((sct) => (
              <button key={sct.key} className={"gx-mbtn" + (!inspecting && section === sct.key ? " on" : "")} aria-pressed={!inspecting && section === sct.key} onClick={() => pickSection(sct.key)}>{EIcon[sct.key]()}<span>{sct.label}</span></button>
            ))}
          </nav>
          {panelOpen && (
            <aside className="gx-panel gx-scroll ge-panel" aria-label={inspecting ? "Inspector" : "Panel"}>
              {inspecting ? inspector : (
                <>
                  <Head kind={SECTION_TITLES[section][0]} title={SECTION_TITLES[section][1]} onClose={() => setSection(null)} />
                  <div className="gx-sec ge-secbody">{sectionBody[section]}</div>
                </>
              )}
            </aside>
          )}
        </>
      )}

      {workspace === "system" && (
        <SystemWorkspace project={project} system={selectedSystem}
          onPickSystem={(id) => selectOnly("system", id)}
          onUpdateSystem={handleUpdateSystem}
          onOpenStation={openStation}
          systemInspector={systemInspector && React.cloneElement(systemInspector, { inWorkspace: true, onClose: undefined })} />
      )}
      {workspace === "stations" && <StationGen project={project} setProject={setProject} initialTarget={stationTarget} />}
      {workspace === "modules" && <ModuleDesigner project={project} setProject={setProject} />}
    </div>
  );
}

const STATUS_TEXT = { saved: "SAVED", pending: "UNSAVED CHANGES", saving: "SAVING…", conflict: "CONFLICT", error: "SAVE FAILED" };
function SaveStatus({ sync }) {
  return (
    <button className={"gg-save gg-save-" + sync.status} onClick={sync.saveNow} title={sync.error || "Saved to SIT automatically — click to save now"}>
      <span className="dot" />{STATUS_TEXT[sync.status]}{sync.status === "saved" && sync.version ? ` · V${sync.version}` : ""}
    </button>
  );
}

// Loads the campaign's galaxy from SIT; offers to start one if none exists.
export default function GalaxyEditor({ embedded = false, active = true }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    fetchProject().then((p) => setState(p ? { project: p } : { empty: true }), (e) => setState({ error: e.message }));
  }, []);
  if (state.project) return <EditorApp initialProject={state.project.data} initialVersion={state.project.version} embedded={embedded} active={active} />;
  return (
    <div className={"gx ge" + (embedded ? " embedded" : "")}>
      <div className="gx-center-msg">
        {state.loading && <p>LOADING GALAXY…</p>}
        {state.error && <p>Could not load the galaxy: {state.error}</p>}
        {state.empty && (
          <>
            <h1>NO GALAXY YET</h1>
            <p className="muted" style={{ letterSpacing: 0, fontFamily: "Barlow Semi Condensed, sans-serif", fontSize: 15 }}>Start an empty one here (it's saved to SIT as you work), or import an existing GalaxyGen project from the Project panel.</p>
            <button className="gx-cta" style={{ width: 280 }} onClick={() => setState({ project: { data: createDefaultProject(), version: undefined } })}>Create a new galaxy</button>
          </>
        )}
      </div>
    </div>
  );
}
