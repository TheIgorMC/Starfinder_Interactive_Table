import { useEffect, useState } from "react";
import { SECTOR_FOCI } from "../lib/project.js";
import AIPanel from "./AIPanel.jsx";

const TABS = [
  { key: "sectors", label: "Sectors" },
  { key: "factions", label: "Factions" },
  { key: "actors", label: "Actors" },
  { key: "organizations", label: "Organizations" },
  { key: "events", label: "Events" },
  { key: "ai", label: "AI" },
];

// Docs/10-galaxy-mapgen.md §9 — the closed effect-op vocabulary the event
// form can build, one entry per op naming which typed-ref fields it needs
// (so the form can render the right selects) and whether it takes a
// magnitude-envelope-clamped `delta`.
const EFFECT_SPECS = {
  adjust_control: { label: "Adjust control (system, faction, delta)", refs: [["target", "system"], ["faction", "faction"]], delta: true },
  set_owner: { label: "Set owner (flip ownership outright)", refs: [["target", "system"], ["faction", "faction"]], delta: true },
  set_system_status: { label: "Set system status", refs: [["target", "system"]], status: "system" },
  adjust_security: { label: "Adjust Dominion security", refs: [["target", "system"]], delta: true },
  adjust_relationship: { label: "Adjust faction relationship", refs: [["a", "faction"], ["b", "faction"]], delta: true },
  adjust_aggression: { label: "Adjust faction aggression", refs: [["faction", "faction"]], delta: true },
  adjust_focus: { label: "Adjust sector focus", refs: [["target", "sector"]], focus: true },
  adjust_influence: { label: "Adjust influence (actor or org)", refs: [["target", "actorOrOrg"]], delta: true },
  set_affiliation: { label: "Set actor affiliation", refs: [["target", "actor"]], affiliation: true },
  relocate: { label: "Relocate actor", refs: [["target", "actor"]], location: true },
  set_status: { label: "Set actor status", refs: [["target", "actor"]], actorStatus: true },
  adjust_reputation: { label: "Adjust actor reputation toward a faction", refs: [["actor", "actor"], ["faction", "faction"]], delta: true },
  add_tag: { label: "Add tag", refs: [["target", "any"]], tag: true },
  remove_tag: { label: "Remove tag", refs: [["target", "any"]], tag: true },
};
const SYSTEM_STATUSES = ["active", "destroyed", "quarantined", "uninhabitable"];
const ACTOR_STATUSES = ["active", "deceased", "disbanded", "unknown"];
const TIMESTEP_UNITS = ["day", "week", "month", "year"];
const MAGNITUDES = ["minor", "moderate", "major", "historic"];

function refOptions(kind, { sectors, systems, factions, actors, organizations }) {
  switch (kind) {
    case "sector": return sectors.map((s) => ({ value: `sector:${s.slug}`, label: s.name }));
    case "system": return systems.map((s) => ({ value: `system:${s.slug}`, label: s.name }));
    case "faction": return factions.map((f) => ({ value: `faction:${f.slug}`, label: f.name }));
    case "actor": return actors.map((a) => ({ value: `actor:${a.slug}`, label: a.name }));
    case "actorOrOrg":
      return [
        ...actors.map((a) => ({ value: `actor:${a.slug}`, label: `Actor: ${a.name}` })),
        ...organizations.map((o) => ({ value: `party:${o.slug}`, label: `Org: ${o.name}` })),
      ];
    case "any":
      return [
        ...sectors.map((s) => ({ value: `sector:${s.slug}`, label: `Sector: ${s.name}` })),
        ...systems.map((s) => ({ value: `system:${s.slug}`, label: `System: ${s.name}` })),
        ...factions.map((f) => ({ value: `faction:${f.slug}`, label: `Faction: ${f.name}` })),
        ...actors.map((a) => ({ value: `actor:${a.slug}`, label: `Actor: ${a.name}` })),
        ...organizations.map((o) => ({ value: `party:${o.slug}`, label: `Org: ${o.name}` })),
      ];
    default: return [];
  }
}

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
  events,
  onPreviewEvent,
  onCommitEvent,
  onDeleteEvent,
  aiSettings,
  onAISettingsChange,
  onRunAIPass1,
  onRunAIPass2,
  onPreviewAIProposal,
  onConfirmAIProposal,
  onResolveAIRefName,
}) {
  const [activeTab, setActiveTab] = useState("sectors");
  const [showBackgroundActors, setShowBackgroundActors] = useState(false);
  // Curated (`authored`) actors are the GM's hand-placed content and always
  // shown; background (`generated`) ones are bulk/cheap per §6.1 and stay
  // collapsed by default so they don't bury the curated list.
  const curatedActors = actors.filter((a) => a.origin !== "generated");
  const backgroundActors = actors.filter((a) => a.origin === "generated");

  // A selection or in-progress placement made on the canvas should jump the
  // sidebar to the tab that can actually show it, regardless of which tab
  // happened to be open.
  useEffect(() => {
    if (selectedSectorId || (pendingPoints && pendingPoints.length > 0)) setActiveTab("sectors");
  }, [selectedSectorId, pendingPoints]);
  useEffect(() => {
    if (selectedFactionId || pendingFactionSeed) setActiveTab("factions");
  }, [selectedFactionId, pendingFactionSeed]);
  useEffect(() => {
    if (selectedActorId) setActiveTab("actors");
  }, [selectedActorId]);
  useEffect(() => {
    if (selectedOrgId) setActiveTab("organizations");
  }, [selectedOrgId]);

  return (
    <aside className="gg-sectors">
      {selectedSystem && (
        <SystemCard system={selectedSystem} actors={actors} onClose={onDeselectSystem} onUpdate={onUpdateSystem} />
      )}

      <div className="gg-tab-row">
        {TABS.map((t) => (
          <button key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "sectors" && (
        <>
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
              None yet. Switch to the Sector tool and draw a boundary — most
              of the galaxy stays unclaimed until you mark it colonized.
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
        </>
      )}

      {activeTab === "factions" && (
        <>
          <h3>Factions</h3>

          {pendingFactionSeed && (
            <PendingFactionForm
              pendingFactionSeed={pendingFactionSeed}
              onCommit={onCommitFaction}
              onCancel={onCancelFactionSeed}
            />
          )}

          {factions.length === 0 && !pendingFactionSeed && (
            <p className="muted small">
              None yet. Switch to the Faction tool and click to drop a
              control seed for a major power — small border factions fill
              the gaps automatically when you generate.
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
            <FactionCard
              faction={selectedFaction}
              factions={factions}
              onUpdate={onUpdateFaction}
              onClose={onDeselectFaction}
            />
          )}
        </>
      )}

      {activeTab === "actors" && (
        <>
          <h3>Actors</h3>

          <NewActorForm factions={factions} organizations={organizations} systems={systems} onCreate={onCreateActor} />

          {actors.length === 0 && (
            <p className="muted small">
              None yet. Notable people/groups — a governor, a pirate
              captain, a corporation's local rep — give future events
              something specific to point at besides "a faction."
            </p>
          )}

          {curatedActors.length > 0 && <p className="muted small" style={{ marginBottom: 2 }}>Curated:</p>}
          <ul className="gg-sector-list">
            {curatedActors.map((a) => (
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

          {backgroundActors.length > 0 && (
            <>
              <button className="gg-link" onClick={() => setShowBackgroundActors((s) => !s)}>
                {showBackgroundActors ? "Hide" : "Show"} {backgroundActors.length} background actor
                {backgroundActors.length === 1 ? "" : "s"}
              </button>
              {showBackgroundActors && (
                <ul className="gg-sector-list">
                  {backgroundActors.map((a) => (
                    <li key={a.id} className={a.id === selectedActorId ? "active" : ""}>
                      <button className="gg-sector-select muted" onClick={() => onSelectActor(a.id)} title={a.role}>
                        {a.name}
                      </button>
                      <button className="gg-danger" onClick={() => onDeleteActor(a.id)} title="Delete actor">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

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
        </>
      )}

      {activeTab === "organizations" && (
        <>
          <h3>Organizations</h3>

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
              systems={systems}
              sectors={sectors}
              onUpdate={onUpdateOrganization}
              onClose={onDeselectOrg}
            />
          )}
        </>
      )}

      {activeTab === "events" && (
        <>
          <h3>Events</h3>
          <EventForm
            entities={{ sectors, systems, factions, actors, organizations }}
            onPreview={onPreviewEvent}
            onCommit={onCommitEvent}
          />
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>Journal</h4>
          {events.length === 0 && (
            <p className="muted small">
              None yet. The journal is an append-only log — every committed
              event stays here with the exact diff it applied, so the
              galaxy's history is always browsable.
            </p>
          )}
          <ul className="gg-sector-list" style={{ gap: 8 }}>
            {[...events].reverse().map((ev) => (
              <JournalEntry key={ev.id} event={ev} onDelete={() => onDeleteEvent(ev.id)} />
            ))}
          </ul>
        </>
      )}

      {activeTab === "ai" && (
        <>
          <h3>AI</h3>
          <AIPanel
            settings={aiSettings}
            onSettingsChange={onAISettingsChange}
            onRunPass1={onRunAIPass1}
            onRunPass2={onRunAIPass2}
            onPreviewProposal={onPreviewAIProposal}
            onConfirmProposal={onConfirmAIProposal}
            resolveRefName={onResolveAIRefName}
          />
        </>
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

function FactionCard({ faction, factions, onUpdate, onClose }) {
  const [newCrime, setNewCrime] = useState("");
  const toleratedCrimes = faction.toleratedCrimes || [];
  const relationships = faction.relationships || {};
  const others = factions.filter((f) => f.id !== faction.id);

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
        <>
          <p className="small muted">
            Home system: {faction.homeSystem} (held outright, no external contest)
          </p>
          <button
            style={{ width: "100%", marginBottom: 8 }}
            onClick={() => onUpdate(faction.id, { homeSystem: null })}
            title="Un-anchor — the system goes back into the normal control contest next time you generate factions"
          >
            Un-anchor from home system
          </button>
        </>
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

      <label className="small muted" style={{ marginTop: 8 }}>Tolerated crimes</label>
      <div className="gg-tag-row">
        {toleratedCrimes.map((crime) => (
          <span key={crime} className="gg-tag">
            {crime}
            <button
              onClick={() => onUpdate(faction.id, { toleratedCrimes: toleratedCrimes.filter((c) => c !== crime) })}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
        {toleratedCrimes.length === 0 && <span className="muted small">None set.</span>}
      </div>
      <div className="gg-tool-row">
        <input
          value={newCrime}
          onChange={(e) => setNewCrime(e.target.value)}
          placeholder="e.g. smuggling"
          style={{ flex: "1 1 auto" }}
        />
        <button
          disabled={!newCrime.trim() || toleratedCrimes.includes(newCrime.trim())}
          onClick={() => {
            onUpdate(faction.id, { toleratedCrimes: [...toleratedCrimes, newCrime.trim()] });
            setNewCrime("");
          }}
        >
          Add
        </button>
      </div>

      <label className="small muted" style={{ marginTop: 8 }}>
        Relationships (§9 — fed into future war-chance/event resolution)
      </label>
      {others.length === 0 && <p className="muted small">No other factions yet.</p>}
      {others.map((other) => {
        const value = relationships[other.slug] ?? 0;
        return (
          <div key={other.id}>
            <label className="small muted">
              {other.name} ({value.toFixed(2)})
            </label>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={value}
              onChange={(e) =>
                onUpdate(faction.id, { relationships: { ...relationships, [other.slug]: Number(e.target.value) } })
              }
            />
          </div>
        );
      })}
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

      <label className="small muted" style={{ marginTop: 8 }}>
        Reputation (per-faction standing — mirrors faction relationships)
      </label>
      {factions.length === 0 && <p className="muted small">No factions yet.</p>}
      {factions.map((f) => {
        const reputation = actor.reputation || {};
        const value = reputation[f.slug] ?? 0;
        return (
          <div key={f.id}>
            <label className="small muted">
              {f.name} ({value.toFixed(2)})
            </label>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={value}
              onChange={(e) => onUpdate(actor.id, { reputation: { ...reputation, [f.slug]: Number(e.target.value) } })}
            />
          </div>
        );
      })}
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
      <label className="small muted">Home system (optional — one of system/sector/neither)</label>
      <select
        value={homeSystem}
        onChange={(e) => {
          setHomeSystem(e.target.value);
          if (e.target.value) setHomeSector("");
        }}
      >
        <option value="">None</option>
        {systems.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      <label className="small muted">Home sector (optional — a sector-wide movement)</label>
      <select
        value={homeSector}
        onChange={(e) => {
          setHomeSector(e.target.value);
          if (e.target.value) setHomeSystem("");
        }}
      >
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

function OrgCard({ org, actors, factions, systems, sectors, onUpdate, onClose }) {
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
      <label className="small muted">Home system (optional — one of system/sector/neither)</label>
      <select
        value={org.homeSystem || ""}
        onChange={(e) => onUpdate(org.id, { homeSystem: e.target.value || null, homeSector: e.target.value ? null : org.homeSector })}
      >
        <option value="">None</option>
        {systems.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      <label className="small muted">Home sector (optional — a sector-wide movement)</label>
      <select
        value={org.homeSector || ""}
        onChange={(e) => onUpdate(org.id, { homeSector: e.target.value || null, homeSystem: e.target.value ? null : org.homeSystem })}
      >
        <option value="">None</option>
        {sectors.map((s) => (
          <option key={s.id} value={s.slug}>{s.name}</option>
        ))}
      </select>
      {!org.homeSystem && !org.homeSector && (
        <p className="small muted">Galaxy-spanning — no fixed base.</p>
      )}
      <p className="small muted">
        Members:{" "}
        {members.length > 0
          ? members.map((a) => a.name).join(", ")
          : "none yet — set an actor's affiliation to this organization"}
      </p>
    </div>
  );
}

function EffectRow({ effect, entities, onChange, onRemove }) {
  const spec = EFFECT_SPECS[effect.op] || EFFECT_SPECS.adjust_control;

  function setField(key, value) {
    onChange({ ...effect, [key]: value });
  }

  return (
    <div className="gg-new-form" style={{ marginBottom: 8 }}>
      <div className="gg-tool-row" style={{ justifyContent: "space-between" }}>
        {/* Resets to a bare { op } on switch — different ops have different
            fields, carrying over the old ones would just be stale leftovers. */}
        <select value={effect.op} onChange={(e) => onChange({ op: e.target.value })} style={{ flex: "1 1 auto" }}>
          {Object.entries(EFFECT_SPECS).map(([op, s]) => (
            <option key={op} value={op}>{s.label}</option>
          ))}
        </select>
        <button className="gg-danger" onClick={onRemove} title="Remove effect">×</button>
      </div>

      {spec.refs.map(([key, kind]) => (
        <select key={key} value={effect[key] || ""} onChange={(e) => setField(key, e.target.value)}>
          <option value="">Select {key}…</option>
          {refOptions(kind, entities).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}

      {spec.delta && (
        <>
          <label className="small muted">
            Delta ({Number(effect.delta ?? 0).toFixed(2)})
            {effect.op === "set_owner" && " — magnitude of the control shift being claimed"}
          </label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={effect.delta ?? 0}
            onChange={(e) => setField("delta", Number(e.target.value))}
          />
        </>
      )}
      {spec.status === "system" && (
        <select value={effect.status || "active"} onChange={(e) => setField("status", e.target.value)}>
          {SYSTEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {spec.actorStatus && (
        <select value={effect.status || "active"} onChange={(e) => setField("status", e.target.value)}>
          {ACTOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {spec.focus && (
        <select value={effect.focus || SECTOR_FOCI[0]} onChange={(e) => setField("focus", e.target.value)}>
          {SECTOR_FOCI.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      )}
      {spec.affiliation && (
        <select value={effect.affiliation || ""} onChange={(e) => setField("affiliation", e.target.value || null)}>
          {affiliationOptions(entities.factions, entities.organizations).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      {spec.location && (
        <select value={effect.location || ""} onChange={(e) => setField("location", e.target.value || null)}>
          <option value="">Unplaced</option>
          {entities.systems.map((s) => (
            <option key={s.id} value={`system:${s.slug}`}>{s.name}</option>
          ))}
        </select>
      )}
      {spec.tag && (
        <input value={effect.tag || ""} onChange={(e) => setField("tag", e.target.value)} placeholder="tag" />
      )}
    </div>
  );
}

function EventForm({ entities, onPreview, onCommit }) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [timestepAmount, setTimestepAmount] = useState(1);
  const [timestepUnit, setTimestepUnit] = useState("day");
  const [magnitude, setMagnitude] = useState("minor");
  const [scope, setScope] = useState([]);
  const [effects, setEffects] = useState([]);
  const [narrative, setNarrative] = useState("");
  const [preview, setPreview] = useState(null); // { diffs } | { error }
  const [status, setStatus] = useState("");

  const scopeOptions = refOptions("any", entities);
  const canSubmit = name.trim().length > 0 && effects.length > 0;
  const requiresReview = magnitude !== "minor";

  function buildDraft() {
    return {
      name: name.trim(),
      summary: summary.trim(),
      tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      timestamp: timestamp.trim(),
      timestep: { amount: Number(timestepAmount) || 1, unit: timestepUnit },
      mode: "authored",
      magnitude,
      scope,
      effects,
      narrative: narrative.trim(),
    };
  }

  function clearPreview() {
    setPreview(null);
  }

  function resetForm() {
    setName("");
    setSummary("");
    setTagsText("");
    setTimestamp("");
    setTimestepAmount(1);
    setTimestepUnit("day");
    setMagnitude("minor");
    setScope([]);
    setEffects([]);
    setNarrative("");
    setPreview(null);
  }

  function handlePreview() {
    try {
      const diffs = onPreview(buildDraft());
      setPreview({ diffs });
    } catch (err) {
      setPreview({ error: err.message });
    }
  }

  function handleCommit() {
    try {
      onCommit(buildDraft());
      setStatus(`Committed "${name.trim()}".`);
      resetForm();
    } catch (err) {
      setPreview({ error: err.message });
    }
  }

  return (
    <div className="gg-new-form">
      <label className="small muted">Name</label>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); clearPreview(); }}
        placeholder="e.g. Battle of Kreel's Reach"
        autoFocus
      />
      <label className="small muted">Summary</label>
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line — what happened" />
      <label className="small muted">Tags (comma-separated)</label>
      <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="e.g. conflict, border" />
      <label className="small muted">Timestamp (in-fiction date)</label>
      <input value={timestamp} onChange={(e) => setTimestamp(e.target.value)} placeholder="e.g. 3025-04-11" />
      <label className="small muted">Timestep (elapsed in-fiction time)</label>
      <div className="gg-tool-row">
        <input
          type="number"
          min="1"
          value={timestepAmount}
          onChange={(e) => setTimestepAmount(e.target.value)}
          style={{ width: 70 }}
        />
        <select value={timestepUnit} onChange={(e) => setTimestepUnit(e.target.value)}>
          {TIMESTEP_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <label className="small muted">Magnitude</label>
      <select value={magnitude} onChange={(e) => { setMagnitude(e.target.value); clearPreview(); }}>
        {MAGNITUDES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <p className="small muted">
        {magnitude === "minor"
          ? "Minor events auto-commit — no required review step (§9.2/§12), though Preview still works if you want to sanity-check first."
          : "This magnitude requires a successful Preview before Confirm commit unlocks (§9 pipeline step 3)."}
      </p>

      <label className="small muted">Scope (every entity this event touches)</label>
      <select
        multiple
        value={scope}
        onChange={(e) => { setScope(Array.from(e.target.selectedOptions, (o) => o.value)); clearPreview(); }}
        style={{ height: 100 }}
      >
        {scopeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label className="small muted" style={{ marginTop: 8 }}>Effects</label>
      {effects.length === 0 && <p className="muted small">None yet — add at least one below.</p>}
      {effects.map((effect, i) => (
        <EffectRow
          key={i}
          effect={effect}
          entities={entities}
          onChange={(next) => {
            setEffects((list) => list.map((e, j) => (j === i ? next : e)));
            clearPreview();
          }}
          onRemove={() => {
            setEffects((list) => list.filter((_, j) => j !== i));
            clearPreview();
          }}
        />
      ))}
      <button
        style={{ width: "100%", marginBottom: 8 }}
        onClick={() => { setEffects((list) => [...list, { op: "adjust_control", delta: 0 }]); clearPreview(); }}
      >
        + Add effect
      </button>

      <label className="small muted">Narrative (flavor/history — never read by the effect engine)</label>
      <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={3} />

      {preview?.error && <p className="small" style={{ color: "#e6a3a3", marginTop: 8 }}>{preview.error}</p>}
      {preview?.diffs && (
        <div className="gg-diff-box">
          {preview.diffs.length === 0 && <p className="small muted">No effects to apply.</p>}
          {preview.diffs.map((d, i) => (
            <p key={i} className="small muted">
              {d.op} · {d.ref} · {d.field}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
            </p>
          ))}
        </div>
      )}

      <div className="gg-tool-row" style={{ marginTop: 8 }}>
        <button disabled={!canSubmit} onClick={handlePreview}>Preview effects</button>
        <button disabled={!canSubmit || (requiresReview && !preview?.diffs)} onClick={handleCommit}>
          {magnitude === "minor" ? "Commit" : "Confirm commit"}
        </button>
      </div>
      {status && <p className="small muted">{status}</p>}
    </div>
  );
}

function JournalEntry({ event, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="gg-tool-row" style={{ justifyContent: "space-between" }}>
        <button className="gg-sector-select" onClick={() => setExpanded((e) => !e)} title={event.summary}>
          {event.name} · {event.magnitude} · {event.timestamp || "undated"}
        </button>
        <button className="gg-danger" onClick={onDelete} title="Remove from log — does not undo its effects">
          ×
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {event.summary && <p className="small muted">{event.summary}</p>}
          <p className="small muted">Scope: {event.scope?.length ? event.scope.join(", ") : "none"}</p>
          {(event.diffs || []).map((d, i) => (
            <p key={i} className="small muted">
              {d.op} · {d.ref} · {d.field}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
            </p>
          ))}
          {event.narrative && <p className="small muted">"{event.narrative}"</p>}
        </div>
      )}
    </li>
  );
}
