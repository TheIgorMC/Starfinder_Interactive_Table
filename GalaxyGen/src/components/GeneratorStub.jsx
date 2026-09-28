// Placeholder tabs for the upcoming City Gen / Station Gen generators
// (Docs/15-settlement-generators.md). They only describe what's coming so
// the workflow slot exists; the generators live in lib/cityGen.js and
// lib/stationGen.js (stubs for now).
const INFO = {
  city: {
    title: "City generator",
    intro: "Functional, procedural cities for real settlements on planets and city-planets. The current Cities-tab layout (domes) stays for small outposts only.",
    inputs: ["Target body + site (style: city)", "Seed", "Size class / density", "Street pattern (grid, radial, organic, vertical)", "Zone mix (government, commerce, habitation, industry, port…)", "Transit arteries (maglev, metro, shuttle)"],
    outputs: ["Blocks + arteries geometry", "Districts = zones (keeps hidden/GM-only districts and SIT refs)", "Written to site.layout, rendered by the SIT viewer"],
  },
  station: {
    title: "Station generator",
    intro: "Procedural orbital stations (ring, spindle or modular hulls), then split into zones with the same district logic as outposts and cities.",
    inputs: ["Target station body", "Seed", "Hull type + length", "Docks / berth class", "Services (from the station's data)", "Zone mix"],
    outputs: ["Modules, rings, spokes, docks", "Districts = functional zones", "Written to site.layout, rendered by the SIT viewer"],
  },
};

export default function GeneratorStub({ kind }) {
  const i = INFO[kind];
  return (
    <div className="gg-city">
      <h3>{i.title}</h3>
      <p className="gg-stub-badge">NOT BUILT YET · SKELETON TAB</p>
      <p className="small">{i.intro}</p>
      <h4>Planned inputs</h4>
      <ul className="small gg-stub-list">{i.inputs.map((x) => <li key={x}>{x}</li>)}</ul>
      <h4>Output</h4>
      <ul className="small gg-stub-list">{i.outputs.map((x) => <li key={x}>{x}</li>)}</ul>
      <button disabled>Generate</button>
      <p className="muted small">Design: Docs/15-settlement-generators.md</p>
    </div>
  );
}
