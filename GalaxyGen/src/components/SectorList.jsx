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
  systems,
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
  actors,
  selectedActorId,
  selectedActor,
  onSelectActor,
  onDeselectActor,
  onCreateActor,
  onUpdateActor,
  onDeleteActor,
  organizations,
  selectedOrgId,
  selectedOrg,
  onSelectOrg,
  onDeselectOrg,
  onCreateOrganization,
  onUpdateOrganization,
  onDeleteOrganization,
}) {
  return (
    <aside className="gg-sectors">
      {selectedSystem && (
        <SystemCard system={selectedSystem} actors={actors} onClose={onDeselectSystem} onUpdate={onUpdateSystem} />
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

      <h3 style={{ marginTop: 18 }}>Actors</h3>

      <NewActorForm factions={factions} organizations={organizations} systems={systems} onCreate={onCreateActor} />

      {actors.length === 0 && (
        <p className="muted small">
          None yet. Notable people/groups — a governor, a pirate captain, a
          corporation's local rep — give future events something specific
          to point at besides "a faction."
        </p>
      )}

      <ul className="gg-sector-list">
        {actors.map((a) => (
          <li key={a.id} className={a.id === selectedActorId ? "active" : ""}>
            <button className="gg-sector-select" onClick={() => onSelectActor(a.id)} title={a.role}>
              {a.name}
            </button>
            <button className="gg-danger" onClick={() => onDeleteActor(a.id)} title="Delete actor">
              ×
            </button>
          </li>
        ))}
      </ul>

      {selectedActor && (
        <ActorCard
          actor={selectedActor}
          factions={factions}
          organizations={organizations}
          systems={systems}
          onUpdate={onUpdateActor}
          onClose={onDeselectActor}
        />
      )}

      <h3 style={{ marginTop: 18 }}>Organizations</h3>

      <NewOrgForm factions={factions} sectors={sectors} systems={systems} onCreate={onCreateOrganization} />

      {organizations.length === 0 && (
        <p className="muted small">
          None yet. Local parties, guilds, or movements that don't hold
          territory — affiliate an actor to one from their card above.
        </p>
      )}

      <ul className="gg-sector-list">
        {organizations.map((o) => (
          <li key={o.id} className={o.id === selectedOrgId ? "active" : ""}>
            <button className="gg-sector-select" onClick={() => onSelectOrg(o.id)} title={o.ideology}>
              {o.name}
            </button>
            <button className="gg-danger" onClick={() => onDeleteOrganization(o.id)} title="Delete organization">
              ×
            </button>
          </li>
        ))}
      </ul>

      {selectedOrg && (
        <OrgCard
          org={selectedOrg}
          actors={actors}
          factions={factions}
          onUpdate={onUpdateOrganization}
          onClose={onDeselectOrg}
        />
      )}
    </aside>
  );
}

function SystemCard({ system, actors, onClose, onUpdate }) {
  const localActors = actors.filter((a) => a.location === system.slug);
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
      {localActors.length > 0 && (
        <p className="small muted">
          Actors here: {localActors.map((a) => a.name).join(", ")}
        </p>
      )}
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

// `party:<slug>` is added onto the faction-only affiliation options every
// actor/organization-editing form shares (Docs/10-galaxy-mapgen.md §6.2 —
// `affiliation` is a typed slug reference, `faction:` or `party:`).
function affiliationOptions(factions, organizations) {
  return [
    { value: "", label: "Unaffiliated" },
    ...factions.map((f) => ({ value: `faction:${f.slug}`, label: `Faction: ${f.name}` })),
    ...organizations.map((o) => ({ value: `party:${o.slug}`, label: `Organization: ${o.name}` })),
  ];
}

function NewActorForm({ factions, organizations, systems, onCreate }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("individual");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [mobile, setMobile] = useState(false);
  const [influence, setInfluence] = useState(0.2);

  if (!show) {
    return (
      <button style={{ width: "100%", marginBottom: 8 }} onClick={() => setShow(true)}>
        + New Actor
      </button>
    );
  }

  return (
    <div className="gg-new-form">
      <label className="small muted">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Governor Yeselle Tarn" autoFocus />
      <label className="small muted">Kind</label>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="individual">Individual</option>
        <option value="group">Group</option>
      </select>
      <label className="small muted">Role (flavor tag)</label>
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. garrison-captain" />
      <label className="small muted">Location (system)</label>
      <select value={location} onChange={(e) => setLocation(e.target.value)}>
        <option value="">Unplaced</option>
        {systems.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      <label className="small muted">Affiliation</label>
      <select value={affiliation} onChange={(e) => setAffiliation(e.target.value)}>
        {affiliationOptions(factions, organizations).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <label className="gg-checkbox">
        <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} />
        Mobile (location is last-known, not fixed)
      </label>
      <label className="small muted">Influence ({influence.toFixed(2)})</label>
      <input type="range" min="0" max="1" step="0.05" value={influence} onChange={(e) => setInfluence(Number(e.target.value))} />
      <div className="gg-tool-row">
        <button
          disabled={!name.trim()}
          onClick={() => {
            onCreate({
              name: name.trim(),
              kind,
              role: role.trim() || "unspecified",
              location: location || null,
              affiliation: affiliation || null,
              mobile,
              influence,
            });
            setName("");
            setRole("");
            setLocation("");
            setAffiliation("");
            setMobile(false);
            setInfluence(0.2);
            setShow(false);
          }}
        >
          Create actor
        </button>
        <button className="gg-danger" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  );
}

function ActorCard({ actor, factions, organizations, systems, onUpdate, onClose }) {
  const locationSystem = systems.find((s) => s.slug === actor.location);
  return (
    <div className="gg-new-form">
      <div className="gg-tool-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <input
          value={actor.name}
          onChange={(e) => onUpdate(actor.id, { name: e.target.value })}
          style={{ flex: "1 1 auto", margin: 0, fontWeight: 600 }}
        />
        <button className="gg-danger" onClick={onClose} title="Deselect">×</button>
      </div>
      <p className="small muted">
        {actor.kind} · {actor.role}{actor.origin === "generated" ? " · background" : ""}
      </p>
      <label className="small muted">Location</label>
      <select value={actor.location || ""} onChange={(e) => onUpdate(actor.id, { location: e.target.value || null })}>
        <option value="">Unplaced</option>
        {systems.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      {actor.location && !locationSystem && (
        <p className="small muted">Last known location "{actor.location}" no longer exists.</p>
      )}
      <label className="gg-checkbox">
        <input
          type="checkbox"
          checked={!!actor.mobile}
          onChange={(e) => onUpdate(actor.id, { mobile: e.target.checked })}
        />
        Mobile (location is last-known, not fixed)
      </label>
      <label className="small muted">Affiliation</label>
      <select
        value={actor.affiliation || ""}
        onChange={(e) => onUpdate(actor.id, { affiliation: e.target.value || null })}
      >
        {affiliationOptions(factions, organizations).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <label className="small muted">Influence ({actor.influence.toFixed(2)})</label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={actor.influence}
        onChange={(e) => onUpdate(actor.id, { influence: Number(e.target.value) })}
      />
      <label className="small muted">Status</label>
      <select value={actor.status} onChange={(e) => onUpdate(actor.id, { status: e.target.value })}>
        <option value="active">Active</option>
        <option value="deceased">Deceased</option>
        <option value="disbanded">Disbanded</option>
        <option value="unknown">Unknown</option>
      </select>
    </div>
  );
}

function NewOrgForm({ factions, sectors, systems, onCreate }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [ideology, setIdeology] = useState("");
  const [parentFaction, setParentFaction] = useState("dominion");
  const [homeSystem, setHomeSystem] = useState("");
  const [homeSector, setHomeSector] = useState("");
  const [localInfluence, setLocalInfluence] = useState(0.2);

  if (!show) {
    return (
      <button style={{ width: "100%", marginBottom: 8 }} onClick={() => setShow(true)}>
        + New Organization
      </button>
    );
  }

  return (
    <div className="gg-new-form">
      <label className="small muted">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vernak Libertarian Party" autoFocus />
      <label className="small muted">Ideology (flavor tag)</label>
      <input value={ideology} onChange={(e) => setIdeology(e.target.value)} placeholder="e.g. libertarian" />
      <label className="small muted">Parent faction (whose sphere it operates within)</label>
      <select value={parentFaction} onChange={(e) => setParentFaction(e.target.value)}>
        <option value="dominion">Dominion</option>
        {factions.map((f) => (
          <option key={f.id} value={f.slug}>{f.name}</option>
        ))}
      </select>
      <label className="small muted">Home system (optional)</label>
      <select value={homeSystem} onChange={(e) => setHomeSystem(e.target.value)}>
        <option value="">None</option>
        {systems.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      <label className="small muted">Home sector (optional — a sector-wide movement)</label>
      <select value={homeSector} onChange={(e) => setHomeSector(e.target.value)}>
        <option value="">None</option>
        {sectors.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      <label className="small muted">Local influence ({localInfluence.toFixed(2)})</label>
      <input type="range" min="0" max="1" step="0.05" value={localInfluence} onChange={(e) => setLocalInfluence(Number(e.target.value))} />
      <div className="gg-tool-row">
        <button
          disabled={!name.trim()}
          onClick={() => {
            onCreate({
              name: name.trim(),
              ideology: ideology.trim() || "unspecified",
              parentFaction,
              homeSystem: homeSystem || null,
              homeSector: homeSector || null,
              localInfluence,
            });
            setName("");
            setIdeology("");
            setParentFaction("dominion");
            setHomeSystem("");
            setHomeSector("");
            setLocalInfluence(0.2);
            setShow(false);
          }}
        >
          Create organization
        </button>
        <button className="gg-danger" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  );
}

function OrgCard({ org, actors, factions, onUpdate, onClose }) {
  const members = actors.filter((a) => a.affiliation === `party:${org.slug}`);
  return (
    <div className="gg-new-form">
      <div className="gg-tool-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <input
          value={org.name}
          onChange={(e) => onUpdate(org.id, { name: e.target.value })}
          style={{ flex: "1 1 auto", margin: 0, fontWeight: 600 }}
        />
        <button className="gg-danger" onClick={onClose} title="Deselect">×</button>
      </div>
      <p className="small muted">{org.ideology}</p>
      <label className="small muted">Parent faction</label>
      <select value={org.parentFaction} onChange={(e) => onUpdate(org.id, { parentFaction: e.target.value })}>
        <option value="dominion">Dominion</option>
        {factions.map((f) => (
          <option key={f.id} value={f.slug}>{f.name}</option>
        ))}
      </select>
      <label className="small muted">Local influence ({org.localInfluence.toFixed(2)})</label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={org.localInfluence}
        onChange={(e) => onUpdate(org.id, { localInfluence: Number(e.target.value) })}
      />
      <p className="small muted">
        Home: {org.homeSystem || org.homeSector || "galaxy-spanning (no fixed base)"}
      </p>
      <p className="small muted">
        Members:{" "}
        {members.length > 0
          ? members.map((a) => a.name).join(", ")
          : "none yet — set an actor's affiliation to this organization"}
      </p>
    </div>
  );
}
