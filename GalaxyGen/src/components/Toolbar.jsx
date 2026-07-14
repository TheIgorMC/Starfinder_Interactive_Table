import { useRef, useState } from "react";
import { FIELD_DEFS } from "../lib/project.js";

const TOOLS = [
  { key: "brush", label: "Brush" },
  { key: "sector", label: "Sector" },
  { key: "select", label: "Select" },
  { key: "pan", label: "Pan" },
];

export default function Toolbar({
  project,
  tool,
  setTool,
  activeField,
  setActiveField,
  brush,
  setBrush,
  showSectors,
  setShowSectors,
  constrainToSector,
  setConstrainToSector,
  selectedSectorId,
  hoverInfo,
  onNewProject,
  onDownloadProject,
  onImportProject,
  onExportSDF,
  exportStatus,
}) {
  const fileInputRef = useRef(null);
  const [newSeed, setNewSeed] = useState(project.seed);
  const [newWidth, setNewWidth] = useState(project.bounds.width);
  const [newHeight, setNewHeight] = useState(project.bounds.height);
  const [showNewForm, setShowNewForm] = useState(false);

  return (
    <aside className="gg-toolbar">
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
            "Click to place vertices (3+). Green ring = click to close the shape; amber ring = snaps onto a neighboring sector's vertex. Then name & create it in the Sectors panel. Escape cancels."}
          {tool === "select" && "Click a sector to select it."}
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
      </section>

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
          Export sectors (SDF)
        </button>
        {exportStatus && <p className="small muted">{exportStatus}</p>}
      </section>
    </aside>
  );
}
