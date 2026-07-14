import { useState } from "react";
import { SECTOR_FOCI } from "../lib/project.js";

export default function SectorList({
  sectors,
  selectedSectorId,
  onSelect,
  onFocusChange,
  onDelete,
  pendingPoints,
  onCommitPending,
  onCancelPending,
}) {
  return (
    <aside className="gg-sectors">
      <h3>Sectors</h3>

      {pendingPoints && pendingPoints.length > 0 && (
        <PendingSectorForm
          pointCount={pendingPoints.length}
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

function PendingSectorForm({ pointCount, onCommit, onCancel }) {
  const canFinish = pointCount >= 3;
  return (
    <div className="gg-new-form">
      <p className="small muted">
        Drawing boundary — {pointCount} point{pointCount === 1 ? "" : "s"} placed.
        {!canFinish && " Need at least 3."}
      </p>
      <PendingFields onCommit={onCommit} canFinish={canFinish} />
      <button className="gg-danger" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function PendingFields({ onCommit, canFinish }) {
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(SECTOR_FOCI[0]);
  return (
    <>
      <label className="small muted">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vast Expanse" />
      <label className="small muted">Focus</label>
      <select value={focus} onChange={(e) => setFocus(e.target.value)}>
        {SECTOR_FOCI.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <button disabled={!canFinish || !name.trim()} onClick={() => onCommit(name.trim(), focus)}>
        Create sector
      </button>
    </>
  );
}
