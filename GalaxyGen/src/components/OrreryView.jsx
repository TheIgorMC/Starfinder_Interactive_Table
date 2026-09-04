import { useEffect, useRef, useState } from "react";
import { getSystemZones } from "../lib/planetGen.js";
import { POPULATION_BANDS } from "../lib/populationBands.js";
import { slugify } from "../lib/slug.js";

// Docs/10-galaxy-mapgen.md §8 — a top-down, Elite-Dangerous-style system
// map AND its editor, now living in its own top-level tab (App.jsx) rather
// than embedded in the system inspector card. The star sits at center, the
// habitable-zone band and frost line are drawn from the same real
// orbital-mechanics numbers planetGen.js placed bodies with, primaries sit
// on their actual orbit ring (log-scaled — real AU ranges span three
// orders of magnitude within one system), and moons/stations fan out next
// to their parent using their OWN `orbitAngleDeg` (not an auto-fanned
// index) so they're each independently draggable. Not to scale for body
// *size* — orbit distance is the one dimension this actually renders
// proportionally.
const VIEW = 400;
const CENTER = VIEW / 2;
const MAX_R = 180;
const MIN_R = 14;
const SATELLITE_OFFSET = 14;

const KIND_COLOR = {
  "rocky planet": "#c9a27a",
  "terrestrial world": "#5fbf88",
  "ice world": "#9fd8ff",
  "gas giant": "#e8b86d",
  "asteroid belt": "#8a8f98",
  moon: "#cfd8dc",
  "orbital station": "#ffd166",
};
const KIND_RADIUS = {
  "rocky planet": 4,
  "terrestrial world": 4.5,
  "ice world": 4,
  "gas giant": 7,
  moon: 2.2,
  "orbital station": 3,
};
const BODY_KINDS = ["rocky planet", "terrestrial world", "ice world", "gas giant", "asteroid belt", "moon", "orbital station"];
const STATUSES = ["untouched", "extraction", "colonized"];
const COLONIZABLE_BANDS = POPULATION_BANDS.filter((b) => !b.stationOnly).map((b) => b.value);

function auToR(au, maxAU) {
  if (au == null || au <= 0) return 0;
  const t = Math.log10(au + 1) / Math.log10(Math.max(maxAU, au) + 1);
  return MIN_R + t * (MAX_R - MIN_R);
}

// Inverse of auToR — used to turn a dragged pixel radius back into AU.
// Clamped to a sane ceiling (a body can be dragged well past the drawn
// habitable-zone/frost-line ring, but not to an absurd value).
function rToAu(r, maxAU) {
  const t = Math.max(0, (r - MIN_R) / (MAX_R - MIN_R));
  const au = 10 ** (t * Math.log10(maxAU + 1)) - 1;
  return Math.min(Math.max(0, au), maxAU * 4);
}

function uniqueBodySlug(base, bodies) {
  if (!bodies.some((b) => b.slug === base)) return base;
  let i = 2;
  while (bodies.some((b) => b.slug === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function blankBody(system, bodies, kind, parentSlug, defaultOrbitAU) {
  const label = kind === "orbital station" ? "New Station" : kind === "moon" ? "New Moon" : "New Body";
  const slug = uniqueBodySlug(slugify(`${system.slug}-${label}`), bodies);
  return {
    slug,
    name: label,
    kind,
    parent: parentSlug || null,
    orbitAU: parentSlug ? null : Number(defaultOrbitAU.toFixed(3)),
    orbitAUOuter: null,
    orbitAngleDeg: Math.round(Math.random() * 360),
    orbitPeriodDays: null,
    sizeClass: null,
    radiusKm: null,
    habitable: false,
    resources: [],
    status: "untouched",
    population: null,
    tags: [],
  };
}

export default function OrreryView({ system, onUpdateBodies }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // { slug, isPrimary, isBelt }
  const [selectedSlug, setSelectedSlug] = useState(null);

  const bodies = system.bodies || [];
  const zones = getSystemZones(system);
  const primaries = bodies.filter((b) => !b.parent);
  const satellitesByParent = new Map();
  for (const s of bodies.filter((b) => b.parent)) {
    if (!satellitesByParent.has(s.parent)) satellitesByParent.set(s.parent, []);
    satellitesByParent.get(s.parent).push(s);
  }
  const selected = bodies.find((b) => b.slug === selectedSlug) || null;

  const maxOrbit = Math.max(
    zones.hzOuter * 1.15,
    zones.remnant ? 1 : 0,
    ...primaries.map((b) => b.orbitAUOuter ?? b.orbitAU ?? 0),
    0.5,
  );

  function updateBody(slug, patch) {
    onUpdateBodies(bodies.map((b) => (b.slug === slug ? { ...b, ...patch } : b)));
  }

  function deleteBody(slug) {
    const removeSlugs = new Set([slug, ...bodies.filter((b) => b.parent === slug).map((b) => b.slug)]);
    onUpdateBodies(bodies.filter((b) => !removeSlugs.has(b.slug)));
    if (selectedSlug && removeSlugs.has(selectedSlug)) setSelectedSlug(null);
  }

  function addBody(kind, parentSlug) {
    const body = blankBody(system, bodies, kind, parentSlug, maxOrbit * 0.3);
    onUpdateBodies([...bodies, body]);
    setSelectedSlug(body.slug);
  }

  function primaryScreenPos(b) {
    const isBelt = b.kind === "asteroid belt";
    const r = auToR(b.orbitAU, maxOrbit);
    const rOuter = isBelt ? auToR(b.orbitAUOuter, maxOrbit) : r;
    const angle = (b.orbitAngleDeg || 0) * (Math.PI / 180);
    const rr = isBelt ? (r + rOuter) / 2 : r;
    return { x: CENTER + Math.cos(angle) * rr, y: CENTER + Math.sin(angle) * rr };
  }

  function satelliteScreenPos(sat, parentPos) {
    const angle = (sat.orbitAngleDeg || 0) * (Math.PI / 180);
    return { x: parentPos.x + Math.cos(angle) * SATELLITE_OFFSET, y: parentPos.y + Math.sin(angle) * SATELLITE_OFFSET };
  }

  function screenToSvgPoint(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return { x: CENTER, y: CENTER };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: CENTER, y: CENTER };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function handleDragMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = screenToSvgPoint(e.clientX, e.clientY);
    if (drag.isPrimary) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const r = Math.hypot(dx, dy);
      const angleDeg = Number((((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360).toFixed(1));
      const au = Math.max(0.01, rToAu(r, maxOrbit));
      const body = bodies.find((b) => b.slug === drag.slug);
      if (!body) return;
      if (drag.isBelt) {
        const oldCenter = ((body.orbitAU || 0) + (body.orbitAUOuter || body.orbitAU || 0)) / 2;
        const delta = au - oldCenter;
        updateBody(drag.slug, {
          orbitAU: Math.max(0.01, Number((body.orbitAU + delta).toFixed(3))),
          orbitAUOuter: Math.max(0.02, Number((body.orbitAUOuter + delta).toFixed(3))),
          orbitAngleDeg: angleDeg,
        });
      } else {
        updateBody(drag.slug, { orbitAU: Number(au.toFixed(3)), orbitAngleDeg: angleDeg });
      }
    } else {
      const body = bodies.find((b) => b.slug === drag.slug);
      const parent = bodies.find((b) => b.slug === body?.parent);
      if (!parent) return;
      const ppos = primaryScreenPos(parent);
      const angleDeg = Number((((Math.atan2(y - ppos.y, x - ppos.x) * 180) / Math.PI + 360) % 360).toFixed(1));
      updateBody(drag.slug, { orbitAngleDeg: angleDeg });
    }
  }

  function handleDragEnd() {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
  }

  function handleDragStart(e, body) {
    e.stopPropagation();
    dragRef.current = { slug: body.slug, isPrimary: !body.parent, isBelt: body.kind === "asteroid belt" };
    setSelectedSlug(body.slug);
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  }

  const hzInnerR = auToR(zones.hzInner, maxOrbit);
  const hzOuterR = auToR(zones.hzOuter, maxOrbit);
  const frostR = auToR(zones.frostLine, maxOrbit);

  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Drag a body to reposition it (orbit distance + angle for planets/
        belts, just angle around its parent for moons/stations). Click one
        for the editor below.
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        style={{ width: "100%", maxWidth: 480, height: "auto", background: "#0b1119", borderRadius: 6, userSelect: "none" }}
      >
        {!zones.remnant && hzOuterR > 0 && (
          <>
            <circle cx={CENTER} cy={CENTER} r={hzOuterR} fill="rgba(95,191,136,0.10)" stroke="rgba(95,191,136,0.35)" strokeWidth="1" />
            <circle cx={CENTER} cy={CENTER} r={hzInnerR} fill="#0b1119" stroke="rgba(95,191,136,0.35)" strokeWidth="1" />
          </>
        )}
        {frostR > 0 && frostR < MAX_R + 10 && (
          <circle cx={CENTER} cy={CENTER} r={frostR} fill="none" stroke="#5a6b8c" strokeWidth="1" strokeDasharray="2,3" />
        )}

        {primaries.map((b) => {
          const isBelt = b.kind === "asteroid belt";
          const r = auToR(b.orbitAU, maxOrbit);
          const rOuter = isBelt ? auToR(b.orbitAUOuter, maxOrbit) : r;
          const pos = primaryScreenPos(b);
          const kids = satellitesByParent.get(b.slug) || [];

          return (
            <g key={b.slug}>
              {isBelt ? (
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={(r + rOuter) / 2}
                  fill="none"
                  stroke={KIND_COLOR[b.kind]}
                  strokeWidth={Math.max(1, rOuter - r)}
                  strokeDasharray="1,2.5"
                  opacity="0.55"
                  style={{ cursor: "grab" }}
                  onMouseDown={(e) => handleDragStart(e, b)}
                />
              ) : (
                <>
                  <circle cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#26344a" strokeWidth="1" />
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={KIND_RADIUS[b.kind] || 4}
                    fill={b.habitable ? "#8fe3b0" : KIND_COLOR[b.kind]}
                    stroke={selectedSlug === b.slug ? "#fff" : b.habitable ? "#c8ffe0" : "none"}
                    strokeWidth={selectedSlug === b.slug ? 2 : 1}
                    style={{ cursor: "grab" }}
                    onMouseDown={(e) => handleDragStart(e, b)}
                  />
                </>
              )}
              {kids.map((k) => {
                const kpos = satelliteScreenPos(k, pos);
                return (
                  <circle
                    key={k.slug}
                    cx={kpos.x}
                    cy={kpos.y}
                    r={KIND_RADIUS[k.kind] || 2}
                    fill={k.habitable ? "#8fe3b0" : KIND_COLOR[k.kind]}
                    stroke={selectedSlug === k.slug ? "#fff" : "none"}
                    strokeWidth={selectedSlug === k.slug ? 2 : 0}
                    style={{ cursor: "grab" }}
                    onMouseDown={(e) => handleDragStart(e, k)}
                  />
                );
              })}
            </g>
          );
        })}

        <circle cx={CENTER} cy={CENTER} r={7} fill={zones.starColor} onClick={() => setSelectedSlug(null)} style={{ cursor: "pointer" }} />
      </svg>

      {zones.remnant && (
        <p className="small muted" style={{ marginTop: 4 }}>
          Remnant star — negligible habitable zone, every body irradiated; nothing here is colonizable.
        </p>
      )}

      {selected ? (
        <BodyEditor
          key={selected.slug}
          body={selected}
          bodies={bodies}
          onChange={(patch) => updateBody(selected.slug, patch)}
          onDelete={() => deleteBody(selected.slug)}
        />
      ) : (
        <p className="small muted">No body selected — click one above, or add a new one below.</p>
      )}

      <AddBodyRow
        bodies={primaries}
        onAdd={addBody}
        // Clicking a body to select it should also prime "attach a moon/
        // station to" with that same body — a satellite has no primaries
        // of its own to host anything, so default to *its* parent instead,
        // same as clicking the parent directly would.
        defaultHostSlug={selected ? selected.parent || selected.slug : ""}
      />
    </div>
  );
}

function BodyEditor({ body, bodies, onChange, onDelete }) {
  const [newResource, setNewResource] = useState("");
  const isSatellite = !!body.parent;
  const hostOptions = bodies.filter((b) => !b.parent && b.slug !== body.slug);
  const resources = body.resources || [];

  return (
    <div className="gg-new-form">
      <div className="gg-tool-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <input
          value={body.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ flex: "1 1 auto", margin: 0, fontWeight: 600 }}
        />
        <button className="gg-danger" onClick={onDelete} title="Delete this body (and any moons/stations attached to it)">
          Delete
        </button>
      </div>

      <label className="small muted">Kind</label>
      <select value={body.kind} onChange={(e) => onChange({ kind: e.target.value })}>
        {BODY_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>

      {isSatellite ? (
        <>
          <label className="small muted">Orbits (host body)</label>
          <select value={body.parent} onChange={(e) => onChange({ parent: e.target.value })}>
            {hostOptions.map((h) => (
              <option key={h.slug} value={h.slug}>{h.name}</option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className="small muted">Orbit distance ({body.orbitAU} AU)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={body.orbitAU ?? 0}
            onChange={(e) => onChange({ orbitAU: Number(e.target.value) })}
          />
          {body.kind === "asteroid belt" && (
            <>
              <label className="small muted">Outer edge ({body.orbitAUOuter} AU)</label>
              <input
                type="number"
                step="0.01"
                min={body.orbitAU ?? 0.01}
                value={body.orbitAUOuter ?? body.orbitAU ?? 0}
                onChange={(e) => onChange({ orbitAUOuter: Number(e.target.value) })}
              />
            </>
          )}
        </>
      )}

      <label className="gg-checkbox">
        <input type="checkbox" checked={!!body.habitable} onChange={(e) => onChange({ habitable: e.target.checked })} />
        Habitable
      </label>

      <label className="small muted">Status</label>
      <select
        value={body.status}
        onChange={(e) => {
          const status = e.target.value;
          onChange({ status, population: status === "colonized" ? (body.population || COLONIZABLE_BANDS[0]) : null });
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {body.status === "colonized" && (
        <>
          <label className="small muted">Population</label>
          <select value={body.population || COLONIZABLE_BANDS[0]} onChange={(e) => onChange({ population: e.target.value })}>
            {COLONIZABLE_BANDS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </>
      )}

      <label className="small muted" style={{ marginTop: 8 }}>Resources</label>
      <div className="gg-tag-row">
        {resources.map((r) => (
          <span key={r} className="gg-tag">
            {r}
            <button onClick={() => onChange({ resources: resources.filter((x) => x !== r) })} title="Remove">×</button>
          </span>
        ))}
        {resources.length === 0 && <span className="muted small">None.</span>}
      </div>
      <div className="gg-tool-row">
        <input
          value={newResource}
          onChange={(e) => setNewResource(e.target.value)}
          placeholder="e.g. rare minerals"
          style={{ flex: "1 1 auto" }}
        />
        <button
          disabled={!newResource.trim() || resources.includes(newResource.trim())}
          onClick={() => {
            onChange({ resources: [...resources, newResource.trim()] });
            setNewResource("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function AddBodyRow({ bodies, onAdd, defaultHostSlug }) {
  const [hostSlug, setHostSlug] = useState(defaultHostSlug);
  // Re-primes whenever the orrery's own selection changes (a click on a
  // different body) — but doesn't fight a manual pick made in between two
  // selection changes, since this only runs when defaultHostSlug itself
  // changes.
  useEffect(() => {
    setHostSlug(defaultHostSlug);
  }, [defaultHostSlug]);
  return (
    <div className="gg-new-form">
      <label className="small muted" style={{ marginTop: 0 }}>Add</label>
      <div className="gg-tool-row">
        <button onClick={() => onAdd("rocky planet", null)}>+ Planet</button>
        <button onClick={() => onAdd("asteroid belt", null)}>+ Belt</button>
      </div>
      <label className="small muted">Attach a moon or station to</label>
      <select value={hostSlug} onChange={(e) => setHostSlug(e.target.value)}>
        <option value="">— pick a body —</option>
        {bodies.map((b) => (
          <option key={b.slug} value={b.slug}>{b.name}</option>
        ))}
      </select>
      <div className="gg-tool-row">
        <button disabled={!hostSlug} onClick={() => onAdd("moon", hostSlug)}>+ Moon</button>
        <button disabled={!hostSlug} onClick={() => onAdd("orbital station", hostSlug)}>+ Station</button>
      </div>
    </div>
  );
}
