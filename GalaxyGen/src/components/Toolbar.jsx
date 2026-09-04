import { useRef, useState } from "react";
import { FIELD_DEFS } from "../lib/project.js";

const TOOLS = [
  { key: "brush", label: "Brush" },
  { key: "sector", label: "Sector" },
  { key: "system", label: "System" },
  { key: "faction", label: "Faction" },
  { key: "hyperlane", label: "Hyperlane" },
  { key: "select", label: "Select" },
  { key: "pan", label: "Pan" },
];

// Split out of one long-scrolling sidebar (Tool/Field/Brush/Generate/
// Hyperlanes/Factions/Background actors/Layers/Status/Project/AI index all
// stacked at once) into panels behind the app's top-level tab bar — each
// one shows only what's relevant to what the GM is doing right now.
export function DrawPanel({
  tool,
  setTool,
  activeField,
  setActiveField,
  brush,
  setBrush,
  showFieldOverlay,
  setShowFieldOverlay,
  constrainToSector,
  setConstrainToSector,
  selectedSectorId,
  showSectors,
  setShowSectors,
  showFactions,
  setShowFactions,
}) {
  return (
    <>
      <section>
        <h3>Tool</h3>
        <div className="gg-tool-row">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              className={tool === t.key ? "active" : ""}
              onClick={() => setTool(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {tool === "brush" && "Left-drag to paint, Shift+drag to erase."}
          {tool === "sector" &&
            "Click to place vertices (3+). Amber ring = snaps onto a neighboring sector's vertex. Click the green-ringed first point (or Enter, or \"Close boundary\" in the Sectors tab) to finish the shape — then name it and confirm its focus. Escape cancels."}
          {tool === "system" &&
            "Click inside a drawn sector to hand-place a single new system there, rolled from the painted fields at that point and locked immediately (won't be touched by \"Generate systems\"). Clicking outside every sector does nothing."}
          {tool === "faction" &&
            "Click to drop a faction's control seed — click again to reposition before naming it in the Factions tab. Click near an existing system (violet ring) to anchor the faction there instead: an anchored faction holds that one system outright, no contest."}
          {tool === "hyperlane" &&
            "Click a system (cyan ring), then click a second one to toggle a direct hyperlane between them — click the same system twice, or click empty space, to cancel. Escape also cancels."}
          {tool === "select" && "Click a system, faction seed, or a sector to select it (systems, then factions, take priority when close together)."}
          {tool === "pan" && "Left-drag to pan. (Middle-drag pans in any tool.)"}
        </p>
      </section>

      <section>
        <h3>Field</h3>
        <select value={activeField} onChange={(e) => setActiveField(e.target.value)}>
          {FIELD_DEFS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <label className="gg-checkbox">
          <input
            type="checkbox"
            checked={showFieldOverlay}
            onChange={(e) => setShowFieldOverlay(e.target.checked)}
          />
          Show field heatmap
        </label>
      </section>

      {tool === "brush" && (
        <section>
          <h3>Brush</h3>
          <label className="small muted">Radius ({brush.radius.toFixed(0)} units)</label>
          <input
            type="range"
            min="10"
            max="400"
            value={brush.radius}
            onChange={(e) => setBrush((b) => ({ ...b, radius: Number(e.target.value) }))}
          />
          <label className="small muted">Strength ({brush.strength.toFixed(2)})</label>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={brush.strength}
            onChange={(e) => setBrush((b) => ({ ...b, strength: Number(e.target.value) }))}
          />
          <label className="gg-checkbox">
            <input
              type="checkbox"
              checked={constrainToSector}
              disabled={!selectedSectorId}
              onChange={(e) => setConstrainToSector(e.target.checked)}
            />
            Constrain to selected sector
          </label>
          {!selectedSectorId && (
            <p className="muted small">Select a sector first to enable constraining.</p>
          )}
        </section>
      )}

      <section>
        <h3>Layers</h3>
        <label className="gg-checkbox">
          <input type="checkbox" checked={showSectors} onChange={(e) => setShowSectors(e.target.checked)} />
          Show sector boundaries
        </label>
        <label className="gg-checkbox">
          <input type="checkbox" checked={showFactions} onChange={(e) => setShowFactions(e.target.checked)} />
          Show faction territory
        </label>
      </section>
    </>
  );
}

export function GeneratePanel({
  spacing,
  setSpacing,
  systemCount,
  onGenerateSystems,
  hyperlaneCount,
  onGenerateHyperlanes,
  factionCount,
  onGenerateFactions,
  backgroundActorCount,
  onGenerateBackgroundActors,
  onRedistributeSystems,
  onGeneratePlanets,
  shipModelCount,
  onGenerateShipModels,
  companyCount,
  onGenerateCompanies,
  hasSectors,
}) {
  return (
    <>
      <section>
        <h3>Systems</h3>
        <label className="small muted">Min spacing ({spacing.min} units)</label>
        <input
          type="range"
          min="5"
          max={spacing.max - 5}
          value={spacing.min}
          onChange={(e) => setSpacing((s) => ({ ...s, min: Number(e.target.value) }))}
        />
        <label className="small muted">Max spacing ({spacing.max} units)</label>
        <input
          type="range"
          min={spacing.min + 5}
          max="200"
          value={spacing.max}
          onChange={(e) => setSpacing((s) => ({ ...s, max: Number(e.target.value) }))}
        />
        <p className="small muted">
          Spacing between systems, densest (population 1.0) to sparsest
          (population 0). Placement only happens inside drawn sectors.
        </p>
        <button disabled={!hasSectors} onClick={onGenerateSystems}>
          Generate systems
        </button>
        <p className="small muted">{systemCount} system{systemCount === 1 ? "" : "s"} placed.</p>
        <button
          disabled={systemCount === 0}
          onClick={onRedistributeSystems}
          title="Re-scatters every unlocked system's position using the spacing above — name, star type, population, trade goods, bodies, control, and security are all untouched. Locked systems never move."
        >
          Redistribute positions
        </button>
      </section>

      <section>
        <h3>Planets</h3>
        <p className="small muted">
          Rerolls every unlocked system's bodies (planets, moons, belts,
          stations) in place — positions, names, and every other rolled
          field stay untouched. Locked systems' bodies are never touched.
        </p>
        <button disabled={systemCount === 0} onClick={onGeneratePlanets}>
          Generate planets
        </button>
      </section>

      <section>
        <h3>Hyperlanes</h3>
        <p className="small muted">
          Delaunay + Gabriel-graph pruning between systems, thickened in
          areas where the Hyperlane density field is painted high, with a
          connectivity guarantee so nothing is stranded.
        </p>
        <button disabled={systemCount < 2} onClick={onGenerateHyperlanes}>
          Generate hyperlanes
        </button>
        <p className="small muted">{hyperlaneCount} hyperlane{hyperlaneCount === 1 ? "" : "s"}.</p>
      </section>

      <section>
        <h3>Factions</h3>
        <p className="small muted">
          Place major faction seeds with the Faction tool (Draw tab), then
          generate to auto-seed small border factions in any low-coverage
          gaps and recompute every system's control, security, and
          war-chance.
        </p>
        <button disabled={systemCount === 0} onClick={onGenerateFactions}>
          Generate factions
        </button>
        <p className="small muted">{factionCount} faction{factionCount === 1 ? "" : "s"}.</p>
      </section>

      <section>
        <h3>Background actors</h3>
        <p className="small muted">
          Auto-seeds cheap background people (§6.1) — density scales with
          each system's population and any faction contest there. Run this
          after generating factions. Curated actors you've added by hand are
          never touched or removed by this pass.
        </p>
        <button disabled={systemCount === 0} onClick={onGenerateBackgroundActors}>
          Generate background actors
        </button>
        <p className="small muted">
          {backgroundActorCount} background actor{backgroundActorCount === 1 ? "" : "s"}.
        </p>
      </section>

      <section>
        <h3>Fleets</h3>
        <p className="small muted">
          Ship models are a galaxy-wide catalog (manufacturer + hull), not
          placed per-system — generate this first. Companies (cargo lines,
          tourism operators, diplomatic couriers, private charters, military
          contractors) then seed per sector, each with an aggregate fleet
          drawn from the catalog plus a few individually-named notable
          ships.
        </p>
        <div className="gg-tool-row">
          <button onClick={onGenerateShipModels}>Generate ship models</button>
          <button disabled={systemCount === 0} onClick={onGenerateCompanies}>
            Generate companies
          </button>
        </div>
        <p className="small muted">
          {shipModelCount} ship model{shipModelCount === 1 ? "" : "s"} · {companyCount} compan{companyCount === 1 ? "y" : "ies"}.
        </p>
      </section>
    </>
  );
}

export function ProjectPanel({
  project,
  hoverInfo,
  activeField,
  onNewProject,
  onDownloadProject,
  onImportProject,
  onExportSDF,
  exportStatus,
  onDownloadIndex,
}) {
  const fileInputRef = useRef(null);
  const [newSeed, setNewSeed] = useState(project.seed);
  const [newWidth, setNewWidth] = useState(project.bounds.width);
  const [newHeight, setNewHeight] = useState(project.bounds.height);
  const [showNewForm, setShowNewForm] = useState(false);

  return (
    <>
      <section className="gg-status">
        <h3>Status</h3>
        <p className="small muted">Seed: {project.seed}</p>
        <p className="small muted">
          Bounds: {project.bounds.width} × {project.bounds.height}
        </p>
        <p className="small muted">
          {hoverInfo?.wx != null
            ? `Cursor: (${hoverInfo.wx.toFixed(0)}, ${hoverInfo.wy.toFixed(0)}) — ${activeField}: ${hoverInfo.value.toFixed(2)}`
            : "Cursor: —"}
        </p>
      </section>

      <section>
        <h3>Project</h3>
        <div className="gg-tool-row">
          <button onClick={() => setShowNewForm((s) => !s)}>New</button>
          <button onClick={onDownloadProject}>Save .json</button>
          <button onClick={() => fileInputRef.current?.click()}>Load .json</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportProject(file);
            e.target.value = "";
          }}
        />
        {showNewForm && (
          <div className="gg-new-form">
            <label className="small muted">Seed</label>
            <input value={newSeed} onChange={(e) => setNewSeed(e.target.value)} />
            <label className="small muted">Width</label>
            <input type="number" value={newWidth} onChange={(e) => setNewWidth(Number(e.target.value))} />
            <label className="small muted">Height</label>
            <input type="number" value={newHeight} onChange={(e) => setNewHeight(Number(e.target.value))} />
            <button
              onClick={() => {
                onNewProject(newSeed, newWidth, newHeight);
                setShowNewForm(false);
              }}
            >
              Create (discards current work)
            </button>
          </div>
        )}
        <button onClick={onExportSDF} style={{ marginTop: 8 }}>
          Export SDF
        </button>
        {exportStatus && <p className="small muted">{exportStatus}</p>}
      </section>

      <section>
        <h3>AI index</h3>
        <p className="small muted">
          A compact per-entity summary (name, tags, rough stats — no full
          records) for an LLM's broad/coherence pass (§9.3) to reason over
          before drilling into specifics. Written automatically as
          `index.json` alongside every "Export SDF", or grab it alone here
          to paste straight into a chat today.
        </p>
        <button onClick={onDownloadIndex}>Download AI index</button>
      </section>
    </>
  );
}
