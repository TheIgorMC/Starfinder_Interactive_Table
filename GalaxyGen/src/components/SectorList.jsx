import { useState } from "react";
import { SECTOR_FOCI } from "../lib/project.js";

export default function SectorList({
  sectors,
  selectedSectorId,
  onSelect,
  onFocusChange,
  onDelete,
  selectedSystem,
  onDeselectSystem,
  onUpdateSystem,
  factions,
  selectedFactionId,
  selectedFaction,
  onSelectFaction,
  onDeselectFaction,
  onUpdateFaction,
  onDeleteFaction,
  pendingFactionSeed,
  onCommitFaction,
  onCancelFactionSeed,
  pendingPoints,
  pendingClosed,
  onClosePending,
  onReopenPending,
  onCommitPending,
  onCancelPending,
}) {
  return (
    <aside className="gg-sectors">
      {selectedSystem && (
        <SystemCard system={selectedSystem} onClose={onDeselectSystem} onUpdate={onUpdateSystem} />
      )}

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

      <h3 style={{ marginTop: 18 }}>Factions</h3>

      {pendingFactionSeed && (
        <PendingFactionForm
          pendingFactionSeed={pendingFactionSeed}
          onCommit={onCommitFaction}
          onCancel={onCancelFactionSeed}
        />
      )}

      {factions.length === 0 && !pendingFactionSeed && (
        <p className="muted small">
          None yet. Switch to the Faction tool and click to drop a control
          seed for a major power — small border factions fill the gaps
          automatically when you generate.
        </p>
      )}

      <ul className="gg-sector-list">
        {factions.map((f) => (
          <li key={f.id} className={f.id === selectedFactionId ? "active" : ""}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 3,
                background: f.color,
                flex: "0 0 auto",
              }}
            />
            <button className="gg-sector-select" onClick={() => onSelectFaction(f.id)} title={f.government}>
              {f.name}{f.origin === "generated" ? " (auto)" : ""}
            </button>
            <button className="gg-danger" onClick={() => onDeleteFaction(f.id)} title="Delete faction">
              ×
            </button>
          </li>
        ))}
      </ul>

      {selectedFaction && (
        <FactionCard faction={selectedFaction} onUpdate={onUpdateFaction} onClose={onDeselectFaction} />
      )}
    </aside>
  );
}

function SystemCard({ system, onClose, onUpdate }) {
  return (
    <div className="gg-new-form">
      <div className="gg-tool-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <input
          value={system.name}
          onChange={(e) => onUpdate(system.id, { name: e.target.value, locked: true })}
          style={{ flex: "1 1 auto", margin: 0, fontWeight: 600 }}
          title="Rename this system — handy for hand-curating a specific system rather than leaving it procedurally named"
        />
        <button className="gg-danger" onClick={onClose} title="Deselect">×</button>
      </div>
      <label className="gg-checkbox">
        <input
          type="checkbox"
          checked={!!system.locked}
          onChange={(e) => onUpdate(system.id, { locked: e.target.checked })}
        />
        Locked (survives "Generate systems" — position, name, everything
        stays put; new systems just fill in around it)
      </label>
      <label className="small muted">
        Importance ({(Number(system.important) || 0).toFixed(2)}) — higher
        shows its label at a lower zoom; 1.00 always shows it
      </label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={Number(system.important) || 0}
        onChange={(e) => onUpdate(system.id, { important: Number(e.target.value), locked: true })}
      />
      <button
        style={{ width: "100%", marginBottom: 8 }}
        onClick={() => onUpdate(system.id, { important: 1, locked: true })}
      >
        Mark as landmark (1.00)
      </button>
      <p className="small muted">
        {system.starType} · {system.population}
        {system.stationOnly ? " · station/outpost, no colony" : ""}
      </p>
      <p className="small muted">Sector: {system.sector}</p>
      <p className="small muted">Dominion security: {system.security.dominion.toFixed(2)}</p>
      {system.control && (
        <p className="small muted">
          Control:{" "}
          {system.control.owner
            ? system.control.owner === "dominion"
              ? "Dominion (uncontested)"
              : system.control.owner
            : system.control.contestedBy.length > 0
              ? `contested — ${system.control.contestedBy.map((c) => `${c.faction} ${(c.share * 100).toFixed(0)}%`).join(", ")}`
              : "unclaimed"}
        </p>
      )}
      {system.security.faction != null && (
        <p className="small muted">Faction security: {system.security.faction.toFixed(2)}</p>
      )}
      {system.warChance != null && (
        <p className="small muted">War chance: {(system.warChance * 100).toFixed(0)}%</p>
      )}
      <p className="small muted">Export: {system.export.join(", ")}</p>
      <p className="small muted">Import: {system.import.join(", ")}</p>
      <p className="small muted">
        Hyperlanes: {system.hyperlanes.length > 0 ? system.hyperlanes.join(", ") : "none yet"}
      </p>
      {system.note && <p className="small muted">{system.note}</p>}
    </div>
  );
}

function FactionCard({ faction, onUpdate, onClose }) {
  return (
    <div className="gg-new-form">
      <div className="gg-tool-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{faction.name}</strong>
        <button className="gg-danger" onClick={onClose} title="Deselect">×</button>
      </div>
      <p className="small muted">
        {faction.government}{faction.origin === "generated" ? " · auto-seeded border faction" : ""}
      </p>
      {faction.homeSystem && (
        <p className="small muted">
          Home system: {faction.homeSystem} (held outright, no external contest)
        </p>
      )}
      <label className="small muted">Aggression ({faction.aggression.toFixed(2)})</label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={faction.aggression}
        onChange={(e) => onUpdate(faction.id, { aggression: Number(e.target.value) })}
      />
      <label className="small muted">Strength ({faction.strength.toFixed(2)})</label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={faction.strength}
        onChange={(e) => onUpdate(faction.id, { strength: Number(e.target.value) })}
      />
      <p className="small muted">
        Changes here don't move existing borders until you click Generate
        factions again.
      </p>
    </div>
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

function PendingFactionForm({ pendingFactionSeed, onCommit, onCancel }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4f8ef7");
  const [government, setGovernment] = useState("");
  const [aggression, setAggression] = useState(0.3);
  const [strength, setStrength] = useState(0.5);
  return (
    <div className="gg-new-form">
      <p className="small muted">
        {pendingFactionSeed.homeSystem
          ? `Anchored to ${pendingFactionSeed.homeSystemName} — this faction will hold that system outright. Name it below.`
          : "Faction seed placed — name it below."}
      </p>
      <label className="small muted">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Free Traders Coalition" autoFocus />
      <label className="small muted">Color</label>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <label className="small muted">Government (flavor tag)</label>
      <input value={government} onChange={(e) => setGovernment(e.target.value)} placeholder="e.g. confederation" />
      <label className="small muted">Aggression ({aggression.toFixed(2)})</label>
      <input type="range" min="0" max="1" step="0.05" value={aggression} onChange={(e) => setAggression(Number(e.target.value))} />
      <label className="small muted">Strength/reach ({strength.toFixed(2)})</label>
      <input type="range" min="0" max="1" step="0.05" value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
      <div className="gg-tool-row">
        <button
          disabled={!name.trim()}
          onClick={() => onCommit(name.trim(), color, government.trim() || "unspecified", aggression, strength)}
        >
          Create faction
        </button>
        <button className="gg-danger" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
