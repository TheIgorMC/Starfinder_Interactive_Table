import { ZONE_COLORS } from "@galaxy-core/lib/stationLibrary.js";

// Plan drawing of one library block, built from its primitives (zones, items,
// partitions, connectors, spine, hull) — the board look of the Station
// Interiors sheets. Coordinates are U with the block's NW corner at 0,0,
// unrotated; the caller positions/rotates it with a transform.
const C = { wall: "#e6ecef", part: "#9fb2bd", item: "#7f97a6", conn: "#f0a640", spine: "#52c4b5", hull: "#7fd3e6", dock: "#5fd3f3", label: "#e6ecef", solid: "#3a4a52" };

export function faceLine(face, W, D, off = 0) {
  if (face === "N") return [0, -off, W, -off];
  if (face === "S") return [0, D + off, W, D + off];
  if (face === "W") return [-off, 0, -off, D];
  return [W + off, 0, W + off, D];
}
function connRect(c, W, D, t = 0.06) {
  const a = c.at, w = c.w;
  if (c.face === "N") return [a, -t / 2, w, t];
  if (c.face === "S") return [a, D - t / 2, w, t];
  if (c.face === "W") return [-t / 2, a, t, w];
  return [W - t / 2, a, t, w];
}

export default function KitPlan({ block, labels = true, detail = true, selected, onPart }) {
  const [W, D] = block.size;
  const fs = (w, h) => Math.max(0.06, Math.min(0.14, Math.min(w, h) * 0.3));
  const hit = (kind, i) => (onPart ? { onPointerDown: (e) => { e.stopPropagation(); onPart(kind, i, e); }, style: { cursor: "move" } } : {});
  const sel = (kind, i) => selected && selected.kind === kind && selected.i === i;
  return (
    <g>
      <rect x={0} y={0} width={W} height={D} fill="#0e1316" />
      {(block.zones || []).map((z, i) => (
        <rect key={`z${i}`} x={z.r[0]} y={z.r[1]} width={z.r[2]} height={z.r[3]} fill={ZONE_COLORS[z.z] || "#262b30"}
          stroke={sel("zone", i) ? "#5fd3f3" : "none"} strokeWidth={0.04} {...hit("zone", i)} />
      ))}
      {detail && (block.items || []).map((it, i) => {
        const [x, y, w, h] = it.r;
        const s = sel("item", i) ? "#5fd3f3" : C.item;
        const sw = sel("item", i) ? 0.03 : 0.012;
        let shape;
        if (it.k === "round") shape = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={s} strokeWidth={sw} />;
        else if (it.k === "cross") shape = <g><rect x={x} y={y} width={w} height={h} fill="none" stroke={s} strokeWidth={sw} /><path d={`M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}`} stroke={s} strokeWidth={sw} /></g>;
        else if (it.k === "dash") shape = <rect x={x} y={y} width={w} height={h} fill="none" stroke={s} strokeWidth={sw} strokeDasharray="0.06 0.05" />;
        else if (it.k === "solid") shape = <rect x={x} y={y} width={w} height={h} fill={C.solid} stroke={s} strokeWidth={sw} />;
        else if (it.k === "bed") shape = <g><rect x={x} y={y} width={w} height={h} rx={0.03} fill="none" stroke={s} strokeWidth={sw} /><rect x={x + 0.04} y={y + 0.04} width={Math.min(0.2, w * 0.25)} height={h - 0.08} rx={0.02} fill="none" stroke={s} strokeWidth={sw} /></g>;
        else shape = <rect x={x} y={y} width={w} height={h} fill="none" stroke={s} strokeWidth={sw} />;
        return (
          <g key={`i${i}`} {...hit("item", i)}>
            {onPart && <rect x={x} y={y} width={w} height={h} fill="transparent" />}
            {shape}
            {labels && it.l && <text x={x + w / 2} y={y + h / 2} fontSize={fs(w, h)} textAnchor="middle" dominantBaseline="middle" fill={C.label} opacity=".85" style={{ fontFamily: "Oxanium, monospace", pointerEvents: "none" }}>{it.l}</text>}
          </g>
        );
      })}
      {(block.parts || []).map((p, i) => (
        <g key={`p${i}`} {...hit("part", i)}>
          {onPart && <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke="transparent" strokeWidth={0.18} />}
          <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke={sel("part", i) ? "#5fd3f3" : C.part} strokeWidth={sel("part", i) ? 0.05 : 0.025} />
        </g>
      ))}
      {/* module walls, spine, hull */}
      <rect x={0} y={0} width={W} height={D} fill="none" stroke={C.wall} strokeWidth={0.03} />
      {["N", "E", "S", "W"].includes(block.spine) && (() => { const l = faceLine(block.spine, W, D, 0.07); return <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={C.spine} strokeWidth={0.025} strokeDasharray="0.07 0.05" />; })()}
      {block.hull && (() => { const l = faceLine(block.hull, W, D, 0); return <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={C.hull} strokeWidth={0.06} />; })()}
      {(block.conns || []).map((c, i) => {
        const [x, y, w, h] = connRect(c, W, D, c.type === "dock" ? 0.1 : 0.07);
        const col = c.type === "dock" || c.type === "platform" ? C.dock : C.conn;
        return (
          <g key={`c${i}`} {...hit("conn", i)}>
            {onPart && <rect x={x - 0.08} y={y - 0.08} width={w + 0.16} height={h + 0.16} fill="transparent" />}
            <rect x={x} y={y} width={w} height={h} fill={c.opt ? "none" : col} stroke={sel("conn", i) ? "#5fd3f3" : col} strokeWidth={c.opt || sel("conn", i) ? 0.02 : 0} strokeDasharray={c.opt ? "0.04 0.03" : undefined} />
          </g>
        );
      })}
      {(block.height || 1) > 1 && labels && (
        <text x={W - 0.08} y={0.2} fontSize={0.16} textAnchor="end" fill="#ffb866" style={{ fontFamily: "Oxanium, monospace", pointerEvents: "none" }}>{block.height}U</text>
      )}
    </g>
  );
}

// transform that draws a block (drawn at 0,0 unrotated) rotated k×90° cw into
// the world rect whose NW corner is (x, y)
export function placeTransform(x, y, W, D, k) {
  if (k === 1) return `translate(${x + D} ${y}) rotate(90)`;
  if (k === 2) return `translate(${x + W} ${y + D}) rotate(180)`;
  if (k === 3) return `translate(${x} ${y + W}) rotate(270)`;
  return `translate(${x} ${y})`;
}
