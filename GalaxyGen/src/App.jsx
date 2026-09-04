import { useCallback, useEffect, useRef, useState } from "react";
import GalaxyCanvas from "./components/GalaxyCanvas.jsx";
import { DrawPanel, GeneratePanel, ProjectPanel } from "./components/Toolbar.jsx";
import SectorList from "./components/SectorList.jsx";
import AIPanel from "./components/AIPanel.jsx";
import OrreryView from "./components/OrreryView.jsx";
import { createDefaultProject, normalizeProject, FIELD_DEFS } from "./lib/project.js";
import { GRID_SIZE, paintGrid } from "./lib/grid.js";
import { pointInPolygon } from "./lib/geometry.js";
import { slugify } from "./lib/slug.js";
import { generateSystems, placeSystemAt, redistributeSystems, regeneratePlanets } from "./lib/systemGen.js";
import { generateHyperlanes, buildEdge } from "./lib/hyperlaneGen.js";
import { resolveFactions } from "./lib/factionGen.js";
import { generateBackgroundActors } from "./lib/actorGen.js";
import { applyEvent } from "./lib/effectEngine.js";
import { buildGalaxyIndexEnvelope } from "./lib/aiIndex.js";
import { queryGalaxyFull, resolveEntity } from "./lib/aiQuery.js";
import { runPass1, runPass2 } from "./lib/aiClient.js";
import {
  loadFromStorage,
  saveToStorage,
  downloadProjectJSON,
  downloadGalaxyIndex,
  importProjectFile,
  exportGalaxySDF,
  loadAISettings,
  saveAISettings,
} from "./lib/persistence.js";

const PANEL_WIDTHS_KEY = "galaxygen.panelWidths.v1";
const PANEL_MIN_WIDTH = 180;
const PANEL_MAX_WIDTH = 560;

// The app's single top-level mode switcher (replaces the old dual layout:
// one long-scrolling left toolbar with every section stacked at once, plus
// a second tab row buried inside the right sidebar). Selection state is
// independent of this — see the activeTab-driven auto-jump effect below
// and SectorList.jsx's always-rendered selection cards.
const TABS = [
  { key: "draw", label: "Draw" },
  { key: "generate", label: "Generate" },
  { key: "orrery", label: "Orrery" },
  { key: "sectors", label: "Sectors" },
  { key: "factions", label: "Factions" },
  { key: "actors", label: "Actors" },
  { key: "organizations", label: "Organizations" },
  { key: "events", label: "Events" },
  { key: "ai", label: "AI" },
  { key: "project", label: "Project" },
];

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

export default function App() {
  const [project, setProject] = useState(() => normalizeProject(loadFromStorage() || createDefaultProject()));
  const [activeTab, setActiveTab] = useState("draw");
  const [tool, setTool] = useState("brush");
  const [activeField, setActiveField] = useState(FIELD_DEFS[0].key);
  const [brush, setBrush] = useState({ radius: 80, strength: 0.6 });
  const [showSectors, setShowSectors] = useState(true);
  const [constrainToSector, setConstrainToSector] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [selectedFactionId, setSelectedFactionId] = useState(null);
  const [selectedActorId, setSelectedActorId] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
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

  // Resizable side panel — purely a UI layout preference (not galaxy or AI
  // data), so it gets its own small localStorage key rather than living in
  // `project` or `aiSettings`. Only one panel now (the tab bar replaced the
  // old dual left+right layout), so there's just one width to track.
  const [rightWidth, setRightWidth] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PANEL_WIDTHS_KEY))?.right ?? 280;
    } catch {
      return 280;
    }
  });
  const dragRef = useRef(null); // { startX, startWidth }

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify({ right: rightWidth }));
    } catch {
      // Not critical — panel width just resets to default next load.
    }
  }, [rightWidth]);

  const handlePanelResizeMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const next = drag.startWidth - delta;
    setRightWidth(Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, next)));
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", handlePanelResizeMove);
    window.removeEventListener("mouseup", handlePanelResizeEnd);
  }, [handlePanelResizeMove]);

  const handlePanelResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: rightWidth };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", handlePanelResizeMove);
      window.addEventListener("mouseup", handlePanelResizeEnd);
    },
    [rightWidth, handlePanelResizeMove, handlePanelResizeEnd],
  );

  // Autosave (debounced) so a reload never loses work.
  useEffect(() => {
    const t = setTimeout(() => saveToStorage(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  // Machine-local, never part of the project — saved on every change so a
  // GM doesn't have to re-enter their API base/key/model after a reload.
  useEffect(() => {
    saveAISettings(aiSettings);
  }, [aiSettings]);

  // A canvas action that's mid-flow (drawing a new sector, dropping a new
  // faction seed) or selects a sector jumps to the tab that can actually
  // show it — sectors have no persistent selection card the way system/
  // faction/actor/org do (SectorList.jsx), so without this, selecting one
  // via the Select tool would look like nothing happened. Existing-entity
  // selections for system/faction/actor/org deliberately do NOT jump tabs
  // any more — their cards are always visible regardless of which tab is
  // active, so there's nothing to jump to.
  useEffect(() => {
    if (pendingPoints && pendingPoints.length > 0) setActiveTab("sectors");
  }, [pendingPoints]);
  useEffect(() => {
    if (pendingFactionSeed) setActiveTab("factions");
  }, [pendingFactionSeed]);
  useEffect(() => {
    if (selectedSectorId) setActiveTab("sectors");
  }, [selectedSectorId]);

  const selectedSector = project.sectors.find((s) => s.id === selectedSectorId) || null;
  const selectedSystem = project.systems.find((s) => s.id === selectedSystemId) || null;
  const selectedFaction = project.factions.find((f) => f.id === selectedFactionId) || null;
  const selectedActor = project.actors.find((a) => a.id === selectedActorId) || null;
  const selectedOrg = project.organizations.find((o) => o.id === selectedOrgId) || null;

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

  return (
    <div className="galaxygen-app">
      <header className="gg-header">
        <h1>Galaxy MapGen</h1>
        <span className="muted small">Phase 6 — AI integration</span>
      </header>
      <nav className="gg-tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="gg-body" style={{ gridTemplateColumns: `1fr 6px ${rightWidth}px` }}>
        <GalaxyCanvas
          project={project}
          tool={tool}
          activeField={activeField}
          brush={brush}
          showSectors={showSectors}
          showFactions={showFactions}
          showFieldOverlay={showFieldOverlay}
          selectedSectorId={selectedSectorId}
          selectedSystemId={selectedSystemId}
          selectedFactionId={selectedFactionId}
          pendingPoints={pendingPoints}
          pendingClosed={pendingClosed}
          pendingFactionSeed={pendingFactionSeed}
          onPaint={handlePaint}
          onAddSectorPoint={handleAddSectorPoint}
          onCloseSectorDraft={handleCloseSectorDraft}
          onCancelSectorDraft={handleCancelSectorDraft}
          onAddFactionSeed={handleAddFactionSeed}
          onCancelFactionSeed={handleCancelFactionSeed}
          onPlaceSystem={handlePlaceSystem}
          onToggleHyperlane={handleToggleHyperlane}
          onSelectSector={(id) => { setSelectedSectorId(id); setSelectedSystemId(null); setSelectedFactionId(null); setSelectedActorId(null); setSelectedOrgId(null); }}
          onSelectSystem={(id) => { setSelectedSystemId(id); setSelectedSectorId(null); setSelectedFactionId(null); setSelectedActorId(null); setSelectedOrgId(null); }}
          onSelectFaction={(id) => { setSelectedFactionId(id); setSelectedSectorId(null); setSelectedSystemId(null); setSelectedActorId(null); setSelectedOrgId(null); }}
          onHover={(wx, wy, value) => setHoverInfo(wx == null ? null : { wx, wy, value })}
        />
        <div className="gg-resize-handle" onMouseDown={handlePanelResizeStart} />
        <aside className="gg-panel">
          {activeTab === "draw" && (
            <DrawPanel
              tool={tool}
              setTool={setTool}
              activeField={activeField}
              setActiveField={setActiveField}
              brush={brush}
              setBrush={setBrush}
              showFieldOverlay={showFieldOverlay}
              setShowFieldOverlay={setShowFieldOverlay}
              constrainToSector={constrainToSector}
              setConstrainToSector={setConstrainToSector}
              selectedSectorId={selectedSectorId}
              showSectors={showSectors}
              setShowSectors={setShowSectors}
              showFactions={showFactions}
              setShowFactions={setShowFactions}
            />
          )}
          {activeTab === "generate" && (
            <GeneratePanel
              spacing={spacing}
              setSpacing={setSpacing}
              systemCount={project.systems.length}
              onGenerateSystems={handleGenerateSystems}
              onRedistributeSystems={handleRedistributeSystems}
              onGeneratePlanets={handleGeneratePlanets}
              hyperlaneCount={project.hyperlanes.length}
              onGenerateHyperlanes={handleGenerateHyperlanes}
              factionCount={project.factions.length}
              onGenerateFactions={handleGenerateFactions}
              backgroundActorCount={project.actors.filter((a) => a.origin === "generated").length}
              onGenerateBackgroundActors={handleGenerateBackgroundActors}
              hasSectors={project.sectors.length > 0}
            />
          )}
          {activeTab === "orrery" && (
            <>
              <h3>Orrery</h3>
              {project.systems.length === 0 ? (
                <p className="muted small">No systems yet — generate some first (Generate tab).</p>
              ) : (
                <>
                  <label className="small muted">System</label>
                  <select
                    value={selectedSystemId || ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setSelectedSystemId(id);
                      setSelectedSectorId(null);
                      setSelectedFactionId(null);
                      setSelectedActorId(null);
                      setSelectedOrgId(null);
                    }}
                  >
                    <option value="">— pick a system —</option>
                    {project.systems.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {selectedSystem ? (
                    <OrreryView
                      key={selectedSystem.id}
                      system={selectedSystem}
                      onUpdateBodies={(bodies) => handleUpdateSystem(selectedSystem.id, { bodies, locked: true })}
                    />
                  ) : (
                    <p className="muted small">Pick a system above, or click one on the map (Select tool).</p>
                  )}
                </>
              )}
            </>
          )}
          {activeTab === "ai" && (
            <AIPanel
              settings={aiSettings}
              onSettingsChange={setAiSettings}
              onRunPass1={handleRunAIPass1}
              onRunPass2={handleRunAIPass2}
              onPreviewProposal={handlePreviewAIProposal}
              onConfirmProposal={handleConfirmAIProposal}
              resolveRefName={resolveRefName}
            />
          )}
          {activeTab === "project" && (
            <ProjectPanel
              project={project}
              hoverInfo={hoverInfo}
              activeField={activeField}
              onNewProject={handleNewProject}
              onDownloadProject={() => downloadProjectJSON(project)}
              onDownloadIndex={() => downloadGalaxyIndex(project)}
              onImportProject={handleImportProject}
              onExportSDF={handleExportSDF}
              exportStatus={exportStatus}
            />
          )}
          <SectorList
          activeTab={activeTab}
          sectors={project.sectors}
          selectedSectorId={selectedSectorId}
          onSelect={setSelectedSectorId}
          onFocusChange={handleFocusChange}
          onDelete={handleDeleteSector}
          selectedSystem={selectedSystem}
          onDeselectSystem={() => setSelectedSystemId(null)}
          onUpdateSystem={handleUpdateSystem}
          systems={project.systems}
          factions={project.factions}
          selectedFactionId={selectedFactionId}
          selectedFaction={selectedFaction}
          onSelectFaction={setSelectedFactionId}
          onDeselectFaction={() => setSelectedFactionId(null)}
          onUpdateFaction={handleUpdateFaction}
          onDeleteFaction={handleDeleteFaction}
          pendingFactionSeed={pendingFactionSeed}
          onCommitFaction={handleCommitFaction}
          onCancelFactionSeed={handleCancelFactionSeed}
          pendingPoints={pendingPoints}
          pendingClosed={pendingClosed}
          onClosePending={handleCloseSectorDraft}
          onReopenPending={handleReopenSectorDraft}
          onCommitPending={handleCommitSector}
          onCancelPending={handleCancelSectorDraft}
          actors={project.actors}
          selectedActorId={selectedActorId}
          selectedActor={selectedActor}
          onSelectActor={setSelectedActorId}
          onDeselectActor={() => setSelectedActorId(null)}
          onCreateActor={handleCreateActor}
          onUpdateActor={handleUpdateActor}
          onDeleteActor={handleDeleteActor}
          organizations={project.organizations}
          selectedOrgId={selectedOrgId}
          selectedOrg={selectedOrg}
          onSelectOrg={setSelectedOrgId}
          onDeselectOrg={() => setSelectedOrgId(null)}
          onCreateOrganization={handleCreateOrganization}
          onUpdateOrganization={handleUpdateOrganization}
          onDeleteOrganization={handleDeleteOrganization}
          events={project.events}
          onPreviewEvent={handlePreviewEvent}
          onCommitEvent={handleCommitEvent}
          onDeleteEvent={handleDeleteEvent}
          />
        </aside>
      </div>
    </div>
  );
}
