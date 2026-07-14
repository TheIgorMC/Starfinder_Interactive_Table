import { useCallback, useEffect, useState } from "react";
import GalaxyCanvas from "./components/GalaxyCanvas.jsx";
import Toolbar from "./components/Toolbar.jsx";
import SectorList from "./components/SectorList.jsx";
import { createDefaultProject, FIELD_DEFS } from "./lib/project.js";
import { GRID_SIZE, paintGrid } from "./lib/grid.js";
import { pointInPolygon } from "./lib/geometry.js";
import { slugify } from "./lib/slug.js";
import {
  loadFromStorage,
  saveToStorage,
  downloadProjectJSON,
  importProjectFile,
  exportSectorsSDF,
} from "./lib/persistence.js";

function uniqueSlug(base, sectors) {
  const existing = new Set(sectors.map((s) => s.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export default function App() {
  const [project, setProject] = useState(() => loadFromStorage() || createDefaultProject());
  const [tool, setTool] = useState("brush");
  const [activeField, setActiveField] = useState(FIELD_DEFS[0].key);
  const [brush, setBrush] = useState({ radius: 80, strength: 0.6 });
  const [showSectors, setShowSectors] = useState(true);
  const [constrainToSector, setConstrainToSector] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState(null);
  const [pendingPoints, setPendingPoints] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [exportStatus, setExportStatus] = useState("");

  // Autosave (debounced) so a reload never loses work.
  useEffect(() => {
    const t = setTimeout(() => saveToStorage(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  const selectedSector = project.sectors.find((s) => s.id === selectedSectorId) || null;

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

  const handleCancelSectorDraft = useCallback(() => setPendingPoints(null), []);

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

  const handleDeleteSector = useCallback(
    (id) => {
      setProject((p) => ({ ...p, sectors: p.sectors.filter((s) => s.id !== id) }));
      if (selectedSectorId === id) setSelectedSectorId(null);
    },
    [selectedSectorId],
  );

  const handleNewProject = useCallback((seed, width, height) => {
    const hasWork = project.sectors.length > 0;
    if (hasWork && !window.confirm("Discard the current galaxy and start a new one?")) return;
    setProject(createDefaultProject(seed || undefined, Number(width) || 1000, Number(height) || 1000));
    setSelectedSectorId(null);
    setPendingPoints(null);
  }, [project.sectors.length]);

  const handleImportProject = useCallback(async (file) => {
    try {
      const imported = await importProjectFile(file);
      setProject(imported);
      setSelectedSectorId(null);
      setPendingPoints(null);
    } catch (err) {
      window.alert(`Could not load project: ${err.message}`);
    }
  }, []);

  const handleExportSDF = useCallback(async () => {
    try {
      const result = await exportSectorsSDF(project);
      if (result.mode === "none") setExportStatus("No sectors to export yet.");
      else if (result.mode === "fs") setExportStatus(`Wrote ${result.count} sector(s) to content/sectors/.`);
      else setExportStatus(`Downloaded sectors-sdf.json (${result.count} sector(s)) — split by hand for now.`);
    } catch (err) {
      if (err?.name !== "AbortError") setExportStatus(`Export failed: ${err.message}`);
    }
  }, [project]);

  return (
    <div className="galaxygen-app">
      <header className="gg-header">
        <h1>Galaxy MapGen</h1>
        <span className="muted small">Phase 1 — fields &amp; sectors, no generation yet</span>
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
          constrainToSector={constrainToSector}
          setConstrainToSector={setConstrainToSector}
          selectedSectorId={selectedSectorId}
          hoverInfo={hoverInfo}
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
          selectedSectorId={selectedSectorId}
          pendingPoints={pendingPoints}
          onPaint={handlePaint}
          onAddSectorPoint={handleAddSectorPoint}
          onCancelSectorDraft={handleCancelSectorDraft}
          onSelectSector={setSelectedSectorId}
          onHover={(wx, wy, value) => setHoverInfo(wx == null ? null : { wx, wy, value })}
        />
        <SectorList
          sectors={project.sectors}
          selectedSectorId={selectedSectorId}
          onSelect={setSelectedSectorId}
          onFocusChange={handleFocusChange}
          onDelete={handleDeleteSector}
          pendingPoints={pendingPoints}
          onCommitPending={handleCommitSector}
          onCancelPending={handleCancelSectorDraft}
        />
      </div>
    </div>
  );
}
