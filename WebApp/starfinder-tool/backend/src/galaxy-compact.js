// Node port of the galaxy-viewer handoff's tools/build_compact.py — turns a
// full GalaxyGen project (a few MB) into the short-keyed payload the
// frontend galaxy viewer (frontend/src/galaxy/) renders (~600 KB). Straight
// field mapping; see the key legend in frontend/src/galaxy/README.md.
//
// `gm: false` strips hidden districts (e.g. a secret base) so players never
// receive them at all — gating happens here, not in the UI.

const KEEP_BODY_TAGS = new Set(["ecumenopolis", "capital", "ring-station", "capital-of-colonized-systems", "seat-of-government"]);
const CAP = { "major trade route": 2, "backwater spur": 0 };

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => Math.round(v * 100) / 100;

function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

function compactSites(sites, gm) {
  if (!Array.isArray(sites) || !sites.length) return null;
  return sites.map((s) => ({
    ...s,
    districts: (s.districts || []).filter((d) => gm || !d.hidden),
  }));
}

export function buildCompact(d, { gm = true } = {}) {
  const S = d.systems || [];
  const byId = new Map(S.map((s, i) => [s.id, i]));
  const bySlug = new Map(S.map((s, i) => [s.slug, i]));
  const fields = d.fields || {};

  const out = {
    seed: d.seed || "",
    w: d.bounds?.width || 1000,
    h: d.bounds?.height || 1000,
    f: (d.factions || []).map((f) => ({ s: f.slug, n: f.name, c: f.color, g: f.government || null })),
    sec: (d.sectors || []).map((x) => ({ n: x.name, fo: x.focus || "", p: (x.points || []).map(([a, b]) => [r1(a), r1(b)]) })),
    sys: [],
    ln: [],
    fld: Object.fromEntries(["security", "population"].map((k) => [k, (fields[k] || []).map(r2)])),
  };

  for (const s of S) {
    const bodies = (s.bodies || []).map((b) =>
      prune({
        k: b.kind, n: b.name, s: b.slug, p: b.parent, st: b.status,
        au: b.orbitAU, auo: b.orbitAUOuter, a: b.orbitAngleDeg, pd: b.orbitPeriodDays,
        r: b.radiusKm, hab: b.habitable, res: b.resources, sz: b.sizeClass,
        pp: b.population, sv: b.services, dk: b.docks, dc: b.dockClass,
        gh: b.goodsHandled, lm: b.lengthM,
        t: (b.tags || []).filter((t) => KEEP_BODY_TAGS.has(t)),
        sites: compactSites(b.sites, gm),
      })
    );
    out.sys.push({
      s: s.slug, n: s.name, x: r1(s.position?.x ?? 0), y: r1(s.position?.y ?? 0),
      i: s.important || 0, st: s.starType || "", sc: s.sector || "", pop: s.population || null, so: !!s.stationOnly,
      ow: s.control?.owner || null,
      cb: (s.control?.contestedBy || []).map((c) => [c.faction, c.share]),
      sd: s.security?.dominion ?? 0.5, sf: s.security?.faction ?? 0, war: s.warChance ?? 0,
      t: s.tags || [], note: s.note || null, ex: s.export || [], im: s.import || [], b: bodies,
    });
  }

  for (const h of d.hyperlanes || []) {
    let a = byId.get(h.a), b = byId.get(h.b);
    if (a == null || b == null) { a = bySlug.get(h.aSlug); b = bySlug.get(h.bSlug); }
    if (a == null || b == null) continue;
    out.ln.push([a, b, CAP[h.capacity] ?? 1, h.risk ?? 0]);
  }
  return out;
}
