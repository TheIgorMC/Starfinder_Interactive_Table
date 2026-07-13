import React from "react";

const CELL = 32;

export default function BattleMap({ session, onCellClick, onTokenClick, fit = false }) {
  if (!session) return <p className="muted">No active session.</p>;
  const { grid_w, grid_h, tokens = [], map_url } = session;
  const w = grid_w * CELL;
  const h = grid_h * CELL;

  return (
    <div className={fit ? "map-fit" : "map-scroll"}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={fit ? "100%" : w}
        height={fit ? "100%" : h}
        style={{ background: "#101418", display: "block" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {map_url && <image href={map_url} width={w} height={h} />}
        {/* grid */}
        {Array.from({ length: grid_w + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={h} stroke="#2a3138" strokeWidth="1" />
        ))}
        {Array.from({ length: grid_h + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * CELL} x2={w} y2={i * CELL} stroke="#2a3138" strokeWidth="1" />
        ))}
        {/* click layer */}
        {onCellClick && (
          <rect
            width={w} height={h} fill="transparent"
            onClick={(e) => {
              const pt = e.currentTarget.ownerSVGElement.createSVGPoint();
              pt.x = e.clientX; pt.y = e.clientY;
              const loc = pt.matrixTransform(e.currentTarget.ownerSVGElement.getScreenCTM().inverse());
              onCellClick(Math.floor(loc.x / CELL), Math.floor(loc.y / CELL));
            }}
          />
        )}
        {/* tokens */}
        {tokens.filter((t) => t.visible).map((t) => (
          <g
            key={t.id}
            transform={`translate(${t.x * CELL + CELL / 2}, ${t.y * CELL + CELL / 2})`}
            onClick={() => onTokenClick?.(t)}
            style={{ cursor: onTokenClick ? "pointer" : "default" }}
          >
            <circle r={CELL * 0.42} fill={t.color} stroke="#fff" strokeWidth="2" />
            <text y="4" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">
              {t.label.slice(0, 3).toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
