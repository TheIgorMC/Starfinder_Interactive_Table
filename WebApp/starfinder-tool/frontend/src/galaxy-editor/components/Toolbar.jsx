import { useRef, useState } from "react";

// Project panel (Galaxy Editor → right rail → PROJECT): new galaxy, JSON
// import/export, SDF export, AI index download, field value under cursor.
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
      <details className="gg-section gg-status" open>
        <summary>Status</summary>
        <p className="small muted">Seed: {project.seed}</p>
        <p className="small muted">
          Bounds: {project.bounds.width} × {project.bounds.height}
        </p>
        <p className="small muted">
          {hoverInfo?.wx != null
            ? `Cursor: (${hoverInfo.wx.toFixed(0)}, ${hoverInfo.wy.toFixed(0)}) — ${activeField}: ${hoverInfo.value.toFixed(2)}`
            : "Cursor: —"}
        </p>
      </details>

      <details className="gg-section" open>
        <summary>Project</summary>
        <div className="gg-tool-row">
          <button onClick={() => setShowNewForm((s) => !s)}>New</button>
          <button onClick={onDownloadProject} title="Download a copy of the galaxy (it is already saved in SIT)">Download .json</button>
          <button onClick={() => fileInputRef.current?.click()} title="Replace the campaign's galaxy with a project file">Import .json</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && window.confirm("Replace the campaign's galaxy with this file? (Players see the change.)")) onImportProject(file);
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
      </details>

      <details className="gg-section">
        <summary>AI index</summary>
        <p className="small muted">
          A compact per-entity summary (name, tags, rough stats — no full
          records) for an LLM's broad/coherence pass (§9.3) to reason over
          before drilling into specifics. Written automatically as
          `index.json` alongside every "Export SDF", or grab it alone here
          to paste straight into a chat today.
        </p>
        <button onClick={onDownloadIndex}>Download AI index</button>
      </details>
    </>
  );
}
