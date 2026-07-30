import { useCallback, useEffect, useState } from "react";
import GalaxyCanvas from "./components/GalaxyCanvas.jsx";
import Toolbar from "./components/Toolbar.jsx";
import SectorList from "./components/SectorList.jsx";
import { createDefaultProject, normalizeProject, FIELD_DEFS } from "./lib/project.js";
import { GRID_SIZE, paintGrid } from "./lib/grid.js";
import { pointInPolygon } from "./lib/geometry.js";
import { slugify } from "./lib/slug.js";
import { generateSystems } from "./lib/systemGen.js";
import { generateHyperlanes } from "./lib/hyperlaneGen.js";
import { resolveFactions } from "./lib/factionGen.js";
import {
  loadFromStorage,
  saveToStorage,
  downloadProjectJSON,
  importProjectFile,
  exportGalaxySDF,
} from "./lib/persistence.js";

function uniqueSlug(base, sectors) {
  const existing = new Set(sectors.map((s) => s.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export default function App() {
  const [project, setProject] = useState(() => normalizeProject(loadFromStorage() || createDefaultProject()));
  const [tool, setTool] = useState("brush");
  const [activeField, setActiveField] = useState(FIELD_DEFS[0].key);
  const [brush, setBrush] = useState({ radius: 80, strength: 0.6 });
  const [showSectors, setShowSectors] = useState(true);
  const [constrainToSector, setConstrainToSector] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [selectedFactionId, setSelectedFactionId] = useState(null);
  const [pendingPoints, setPendingPoints] = useState(null);
  const [pendingClosed, setPendingClosed] = useState(false);
  const [pendingFactionSeed, setPendingFactionSeed] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [exportStatus, setExportStatus] = useState("");
  const [spacing, setSpacing] = useState({ min: 20, max: 70 });
  const [showFactions, setShowFactions] = useState(true);
  const [showFieldOverlay, setShowFieldOverlay] = useState(true);

  // Autosave (debounced) so a reload never loses work.
  useEffect(() => {
    const t = setTimeout(() => saveToStorage(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  const selectedSector = project.sectors.find((s) => s.id === selectedSectorId) || null;
  const selectedSystem = project.systems.find((s) => s.id === selectedSystemId) || null;
  const selectedFaction = project.factions.find((f) => f.id === selectedFactionId) || null;

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
      };
    });
    setSelectedSystemId(null);
  }, [project.systems, spacing]);

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

  const handleNewProject = useCallback((seed, width, height) => {
    const hasWork = project.sectors.length > 0;
    if (hasWork && !window.confirm("Discard the current galaxy and start a new one?")) return;
    setProject(createDefaultProject(seed || undefined, Number(width) || 1000, Number(height) || 1000));
    setSelectedSectorId(null);
    setSelectedSystemId(null);
    setSelectedFactionId(null);
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
        setExportStatus(`Wrote ${result.sectorCount} sector(s), ${result.systemCount} system(s), and ${result.factionCount} faction(s) to content/.`);
      } else {
        setExportStatus(`Downloaded galaxy-sdf.json (${result.sectorCount} sector(s), ${result.systemCount} system(s), ${result.factionCount} faction(s)) — split by hand for now.`);
      }
    } catch (err) {
      if (err?.name !== "AbortError") setExportStatus(`Export failed: ${err.message}`);
    }
  }, [project]);

  return (
    <div className="galaxygen-app">
      <header className="gg-header">
        <h1>Galaxy MapGen</h1>
        <span className="muted small">Phase 3 — factions &amp; war-chance</span>
      </header>
      <div className="gg-body">
        <Toolbar
          project={project}
          tool={tool}
          setTool={setTool}
          activeField={activeField}
          setActiveField={setActiveField}
          brush={brush}
          setBrush={setBrush}
          showSectors={showSectors}
          setShowSectors={setShowSectors}
          showFactions={showFactions}
          setShowFactions={setShowFactions}
          showFieldOverlay={showFieldOverlay}
          setShowFieldOverlay={setShowFieldOverlay}
          constrainToSector={constrainToSector}
          setConstrainToSector={setConstrainToSector}
          selectedSectorId={selectedSectorId}
          hoverInfo={hoverInfo}
          spacing={spacing}
          setSpacing={setSpacing}
          systemCount={project.systems.length}
          onGenerateSystems={handleGenerateSystems}
          hyperlaneCount={project.hyperlanes.length}
          onGenerateHyperlanes={handleGenerateHyperlanes}
          factionCount={project.factions.length}
          onGenerateFactions={handleGenerateFactions}
          onNewProject={handleNewProject}
          onDownloadProject={() => downloadProjectJSON(project)}
          onImportProject={handleImportProject}
          onExportSDF={handleExportSDF}
          exportStatus={exportStatus}
        />
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
          onSelectSector={(id) => { setSelectedSectorId(id); setSelectedSystemId(null); setSelectedFactionId(null); }}
          onSelectSystem={(id) => { setSelectedSystemId(id); setSelectedSectorId(null); setSelectedFactionId(null); }}
          onSelectFaction={(id) => { setSelectedFactionId(id); setSelectedSectorId(null); setSelectedSystemId(null); }}
          onHover={(wx, wy, value) => setHoverInfo(wx == null ? null : { wx, wy, value })}
        />
        <SectorList
          sectors={project.sectors}
          selectedSectorId={selectedSectorId}
          onSelect={setSelectedSectorId}
          onFocusChange={handleFocusChange}
          onDelete={handleDeleteSector}
          selectedSystem={selectedSystem}
          onDeselectSystem={() => setSelectedSystemId(null)}
          onUpdateSystem={handleUpdateSystem}
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
        />
      </div>
    </div>
  );
}
