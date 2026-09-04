import { useState } from "react";
import { getSystemZones } from "../lib/planetGen.js";

// Docs/10-galaxy-mapgen.md §8 — a top-down, Elite-Dangerous-style system
// map: the star at center, the habitable-zone band and frost line drawn
// from the same real orbital-mechanics numbers planetGen.js placed bodies
// with, primaries on their actual orbit ring (log-scaled — real AU ranges
// span three orders of magnitude within one system, a linear scale would
// crush every inner planet into the star), and moons/stations fanned out
// next to their parent rather than on their own ring, since they orbit the
// planet, not the star. Not to scale for body *size* (a Jupiter-class
// giant drawn at its real size-to-orbit ratio would be an invisible dot) —
// orbit distance is the one dimension this actually renders proportionally.
const VIEW = 400;
const CENTER = VIEW / 2;
const MAX_R = 180;
const MIN_R = 14;

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

function auToR(au, maxAU) {
  if (au == null || au <= 0) return 0;
  const t = Math.log10(au + 1) / Math.log10(Math.max(maxAU, au) + 1);
  return MIN_R + t * (MAX_R - MIN_R);
}

export default function OrreryView({ system }) {
  const [selected, setSelected] = useState(null);
  const bodies = system.bodies || [];
  const zones = getSystemZones(system);

  const primaries = bodies.filter((b) => !b.parent);
  const satellites = bodies.filter((b) => b.parent);
  const satellitesByParent = new Map();
  for (const s of satellites) {
    if (!satellitesByParent.has(s.parent)) satellitesByParent.set(s.parent, []);
    satellitesByParent.get(s.parent).push(s);
  }

  const maxOrbit = Math.max(
    zones.hzOuter * 1.15,
    zones.remnant ? 1 : 0,
    ...primaries.map((b) => b.orbitAUOuter ?? b.orbitAU ?? 0),
    0.5,
  );

  const hzInnerR = auToR(zones.hzInner, maxOrbit);
  const hzOuterR = auToR(zones.hzOuter, maxOrbit);
  const frostR = auToR(zones.frostLine, maxOrbit);

  return (
    <div>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} style={{ width: "100%", height: "auto", background: "#0b1119", borderRadius: 6 }}>
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
          const angle = (b.orbitAngleDeg || 0) * (Math.PI / 180);
          const bx = CENTER + Math.cos(angle) * (isBelt ? (r + rOuter) / 2 : r);
          const by = CENTER + Math.sin(angle) * (isBelt ? (r + rOuter) / 2 : r);
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
                />
              ) : (
                <circle cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#26344a" strokeWidth="1" />
              )}
              {!isBelt && (
                <circle
                  cx={bx}
                  cy={by}
                  r={KIND_RADIUS[b.kind] || 4}
                  fill={b.habitable ? "#8fe3b0" : KIND_COLOR[b.kind]}
                  stroke={selected?.slug === b.slug ? "#fff" : b.habitable ? "#c8ffe0" : "none"}
                  strokeWidth={selected?.slug === b.slug ? 2 : 1}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(b)}
                />
              )}
              {kids.map((k, i) => {
                const fanAngle = angle + (i - (kids.length - 1) / 2) * 0.35;
                const kx = bx + Math.cos(fanAngle) * 10;
                const ky = by + Math.sin(fanAngle) * 10;
                return (
                  <circle
                    key={k.slug}
                    cx={kx}
                    cy={ky}
                    r={KIND_RADIUS[k.kind] || 2}
                    fill={k.habitable ? "#8fe3b0" : KIND_COLOR[k.kind]}
                    stroke={selected?.slug === k.slug ? "#fff" : "none"}
                    strokeWidth={selected?.slug === k.slug ? 2 : 0}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(k)}
                  />
                );
              })}
            </g>
          );
        })}

        <circle cx={CENTER} cy={CENTER} r={7} fill={zones.starColor} onClick={() => setSelected(null)} style={{ cursor: "pointer" }} />
      </svg>

      {zones.remnant && (
        <p className="small muted" style={{ marginTop: 4 }}>
          Remnant star — negligible habitable zone, every body irradiated; nothing here is colonizable.
        </p>
      )}

      <BodyDetail body={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

const STATUS_LABEL = { colonized: "colonized", extraction: "extraction site", untouched: "untouched" };

function BodyDetail({ body, onClose }) {
  if (!body) return <p className="small muted" style={{ marginTop: 6 }}>Click a body for details.</p>;
  return (
    <div className="small muted" style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <strong>{body.name}</strong> — {body.sizeClass || body.kind}
        {body.radiusKm ? ` (~${body.radiusKm.toLocaleString()} km radius)` : ""}
        {body.habitable ? ", habitable" : ""}
        {body.resources?.length > 0 ? `, ${body.resources.join("/")}` : ""}
        <br />
        {body.orbitAU != null ? `${body.orbitAU} AU orbit` : "orbits its parent body"}
        {body.orbitPeriodDays != null ? ` · ${body.orbitPeriodDays.toLocaleString()}-day year` : ""}
        {" · "}
        {STATUS_LABEL[body.status] || body.status}
        {body.population ? ` (${body.population})` : ""}
      </div>
      <button className="gg-danger" onClick={onClose} title="Deselect">×</button>
    </div>
  );
}
