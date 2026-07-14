import { useState } from "react";
import { SECTOR_FOCI } from "../lib/project.js";

export default function SectorList({
  sectors,
  selectedSectorId,
  onSelect,
  onFocusChange,
  onDelete,
  pendingPoints,
  pendingClosed,
  onClosePending,
  onReopenPending,
  onCommitPending,
  onCancelPending,
}) {
  return (
    <aside className="gg-sectors">
      <h3>Sectors</h3>

      {pendingPoints && pendingPoints.length > 0 && (
        <PendingSectorForm
          pointCount={pendingPoints.length}
          closed={pendingClosed}
          onClose={onClosePending}
          onReopen={onReopenPending}
          onCommit={onCommitPending}
          onCancel={onCancelPending}
        />
      )}

      {sectors.length === 0 && !pendingPoints && (
        <p className="muted small">
          None yet. Switch to the Sector tool and draw a boundary — most of
          the galaxy stays unclaimed until you mark it colonized.
        </p>
      )}

      <ul className="gg-sector-list">
        {sectors.map((s) => (
          <li key={s.id} className={s.id === selectedSectorId ? "active" : ""}>
            <button className="gg-sector-select" onClick={() => onSelect(s.id)}>
              {s.name}
            </button>
            <select value={s.focus} onChange={(e) => onFocusChange(s.id, e.target.value)}>
              {SECTOR_FOCI.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button className="gg-danger" onClick={() => onDelete(s.id)} title="Delete sector">
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PendingSectorForm({ pointCount, closed, onClose, onReopen, onCommit, onCancel }) {
  const canClose = pointCount >= 3;

  if (!closed) {
    return (
      <div className="gg-new-form">
        <p className="small muted">
          Drawing boundary — {pointCount} point{pointCount === 1 ? "" : "s"} placed.
          {!canClose && " Need at least 3."}
        </p>
        <button disabled={!canClose} onClick={onClose}>
          Close boundary
        </button>
        <button className="gg-danger" onClick={onCancel} style={{ marginTop: 6 }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="gg-new-form">
      <p className="small muted">Boundary closed ({pointCount} vertices) — name it below.</p>
      <PendingFields onCommit={onCommit} />
      <div className="gg-tool-row">
        <button onClick={onReopen}>Edit boundary</button>
        <button className="gg-danger" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PendingFields({ onCommit }) {
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(SECTOR_FOCI[0]);
  return (
    <>
      <label className="small muted">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vast Expanse" autoFocus />
      <label className="small muted">Focus</label>
      <select value={focus} onChange={(e) => setFocus(e.target.value)}>
        {SECTOR_FOCI.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <button disabled={!name.trim()} onClick={() => onCommit(name.trim(), focus)}>
        Create sector
      </button>
    </>
  );
}
