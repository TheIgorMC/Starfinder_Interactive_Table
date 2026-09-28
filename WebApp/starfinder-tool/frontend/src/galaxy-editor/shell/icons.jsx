// Editor icons, drawn in the viewer's icon language (galaxy/ui.jsx: 20px,
// 1.5 stroke, currentColor).
const sv = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true };

export const EIcon = {
  // tools
  select: () => <svg {...sv}><path d="M5 3l10 7-4.5 1L13 17l-2 1-2.5-6L5 15z" /></svg>,
  paint: () => <svg {...sv}><path d="M14 3l3 3-7 7-3-3z" /><path d="M7 10c-2 0-3.5 1.5-3.5 3.5 0 1.5-.5 2.5-1.5 3.5 3 0 6.5-.5 6.5-4" /></svg>,
  sector: () => <svg {...sv}><path d="M4 6l6-3 7 4-2 9-9 1z" strokeDasharray="3 2" /><circle cx="4" cy="6" r="1.4" fill="currentColor" /><circle cx="10" cy="3" r="1.4" fill="currentColor" /><circle cx="17" cy="7" r="1.4" fill="currentColor" /></svg>,
  system: () => <svg {...sv}><circle cx="9" cy="11" r="3" /><path d="M9 3v3M9 16v3M1 11h3M14 11h3" /><path d="M16 1v5M13.5 3.5h5" /></svg>,
  lane: () => <svg {...sv}><circle cx="4" cy="15" r="2" /><circle cx="16" cy="5" r="2" /><path d="M5.5 13.5l9-7" /></svg>,
  faction: () => <svg {...sv}><path d="M4 18V3" /><path d="M4 4h11l-2.5 3.5L15 11H4" /></svg>,
  // panel sections
  build: () => <svg {...sv}><path d="M10 2l8 4-8 4-8-4z" /><path d="M2 10l8 4 8-4" /><path d="M2 14l8 4 8-4" /></svg>,
  systems: () => <svg {...sv}><circle cx="5" cy="5" r="1.6" fill="currentColor" /><circle cx="5" cy="10" r="1.6" fill="currentColor" /><circle cx="5" cy="15" r="1.6" fill="currentColor" /><path d="M9 5h8M9 10h8M9 15h8" /></svg>,
  factions: () => <svg {...sv}><path d="M4 18V3" /><path d="M4 4h11l-2.5 3.5L15 11H4" /></svg>,
  people: () => <svg {...sv}><circle cx="7" cy="7" r="3" /><circle cx="14" cy="8" r="2.2" /><path d="M2 17c0-3 2.2-5 5-5s5 2 5 5M12 17c0-2 1-3.5 2.5-3.5S18 15 18 17" /></svg>,
  fleets: () => <svg {...sv}><path d="M2 10l6-4h7l3 4-3 4H8z" /><path d="M8 6v8M5 8l-3-2M5 12l-3 2" /></svg>,
  events: () => <svg {...sv}><circle cx="10" cy="10" r="7.5" /><path d="M10 5v5l3 2" /></svg>,
  ai: () => <svg {...sv}><path d="M10 2l1.8 4.7L16.5 8.5l-4.7 1.8L10 15l-1.8-4.7L3.5 8.5l4.7-1.8z" /><path d="M16 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>,
  project: () => <svg {...sv}><circle cx="10" cy="10" r="2.6" /><path d="M10 1.8v2.6M10 15.6v2.6M1.8 10h2.6M15.6 10h2.6M4.2 4.2l1.8 1.8M14 14l1.8 1.8M4.2 15.8L6 14M14 6l1.8-1.8" /></svg>,
  field: () => <svg {...sv}><rect x="3" y="3" width="14" height="14" /><path d="M3 8h14M3 13h14M8 3v14M13 3v14" strokeOpacity=".5" /><rect x="8" y="8" width="5" height="5" fill="currentColor" fillOpacity=".5" /></svg>,
  // workspaces
  map: () => <svg {...sv}><circle cx="10" cy="10" r="7.5" strokeOpacity=".5" /><ellipse cx="10" cy="10" rx="7.5" ry="2.8" transform="rotate(-28 10 10)" /><circle cx="10" cy="10" r="1.6" fill="currentColor" /></svg>,
  orrery: () => <svg {...sv}><circle cx="10" cy="10" r="2.2" fill="currentColor" /><circle cx="10" cy="10" r="5.5" strokeOpacity=".6" /><circle cx="10" cy="10" r="8.5" strokeOpacity=".35" /><circle cx="15.5" cy="10" r="1.3" fill="currentColor" /></svg>,
  station: () => <svg {...sv}><rect x="7" y="7" width="6" height="6" /><path d="M1 10h6M13 10h6M10 1v6M10 13v6" /><rect x="1" y="8" width="3" height="4" /><rect x="16" y="8" width="3" height="4" /></svg>,
  back: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M13 8H3M7 4L3 8l4 4" /></svg>,
  close: () => <svg width="14" height="14" viewBox="0 0 14 14" stroke="#b8b2a6" strokeWidth="1.6" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>,
  check: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2 7.5l3 3 7-7" /></svg>,
  lock: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><rect x="2.5" y="6" width="9" height="6.5" /><path d="M4.5 6V4a2.5 2.5 0 015 0v2" /></svg>,
  star: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden><path d="M7 1l1.7 3.9 4.3.4-3.2 2.9.9 4.2L7 10.2 3.3 12.4l.9-4.2L1 5.3l4.3-.4z" /></svg>,
  pin: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M7 13s4.5-4.2 4.5-7.5a4.5 4.5 0 00-9 0C2.5 8.8 7 13 7 13z" /><circle cx="7" cy="5.5" r="1.5" /></svg>,
};
