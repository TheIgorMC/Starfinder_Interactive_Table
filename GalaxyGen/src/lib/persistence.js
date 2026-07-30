const STORAGE_KEY = "galaxygen.project.v1";

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveToStorage(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Storage full/unavailable — not critical, explicit export still works.
  }
}

function triggerDownload(filename, contents, type = "application/json") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProjectJSON(project) {
  triggerDownload(`galaxy-${project.seed}.json`, JSON.stringify(project, null, 2));
}

export async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.fields || !parsed.bounds) {
    throw new Error("Not a recognized GalaxyGen project file.");
  }
  return parsed;
}

// Docs/10-galaxy-mapgen.md §7 — sectors/<slug>/entry.json shape.
function sectorToEntry(sector) {
  return {
    sdf: 1,
    type: "sector",
    name: sector.name,
    summary: `${sector.focus} sector.`,
    tags: [sector.focus],
    data: {
      boundary: sector.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
      focus: sector.focus,
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — systems/<slug>/entry.json shape. `control`/
// `war_chance`/faction security are `null` until "Generate factions" has
// run at least once; `bodies` fills in with the future planet-gen phase.
function systemToEntry(system) {
  return {
    sdf: 1,
    type: "system",
    name: system.name,
    summary: `${system.starType} system (${system.population}).`,
    tags: system.tags,
    data: {
      position: { x: Math.round(system.position.x), y: Math.round(system.position.y) },
      star_type: system.starType,
      population: system.population,
      station_only: system.stationOnly,
      export: system.export,
      import: system.import,
      sector: system.sector,
      control: system.control
        ? { owner: system.control.owner, contested_by: system.control.contestedBy }
        : null,
      security: { dominion: system.security.dominion, faction: system.security.faction ?? null },
      hyperlanes: system.hyperlanes,
      war_chance: system.warChance,
      important: Math.max(0, Math.min(1, Number(system.important) || 0)),
      bodies: [],
      ...(system.note ? { note: system.note } : {}),
    },
  };
}

// Docs/10-galaxy-mapgen.md §7 — factions/<slug>/entry.json shape. The
// Dominion itself is never exported here — it's the implicit baseline
// represented only via `security.dominion` on systems (§4).
function factionToEntry(faction) {
  return {
    sdf: 1,
    type: "faction",
    name: faction.name,
    summary: `${faction.government} faction.`,
    tags: [faction.government, faction.origin === "generated" ? "auto-seeded" : "authored"],
    data: {
      color: faction.color,
      government: faction.government,
      aggression: faction.aggression,
      strength: faction.strength,
      control_seed: { x: Math.round(faction.seed.x), y: Math.round(faction.seed.y) },
      home_system: faction.homeSystem ?? null,
      tolerated_crimes: faction.toleratedCrimes,
      relationships: faction.relationships,
    },
  };
}

// Writes the real SDF tree (sectors/<slug>/entry.json, systems/<slug>/entry.json)
// via the File System Access API when the browser supports it (Chromium);
// otherwise falls back to a single combined JSON download the GM can split
// by hand.
export async function exportGalaxySDF(project) {
  const sectorCount = project.sectors.length;
  const systemCount = project.systems.length;
  const factionCount = project.factions.length;
  if (sectorCount === 0 && systemCount === 0 && factionCount === 0) {
    return { mode: "none", sectorCount, systemCount, factionCount };
  }

  if ("showDirectoryPicker" in window) {
    const root = await window.showDirectoryPicker();
    if (sectorCount > 0) {
      const sectorsDir = await root.getDirectoryHandle("sectors", { create: true });
      for (const sector of project.sectors) {
        const dir = await sectorsDir.getDirectoryHandle(sector.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(sectorToEntry(sector), null, 2));
        await writable.close();
      }
    }
    if (systemCount > 0) {
      const systemsDir = await root.getDirectoryHandle("systems", { create: true });
      for (const system of project.systems) {
        const dir = await systemsDir.getDirectoryHandle(system.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(systemToEntry(system), null, 2));
        await writable.close();
      }
    }
    if (factionCount > 0) {
      const factionsDir = await root.getDirectoryHandle("factions", { create: true });
      for (const faction of project.factions) {
        const dir = await factionsDir.getDirectoryHandle(faction.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(factionToEntry(faction), null, 2));
        await writable.close();
      }
    }
    return { mode: "fs", sectorCount, systemCount, factionCount };
  }

  const combined = {
    sectors: Object.fromEntries(project.sectors.map((s) => [s.slug, sectorToEntry(s)])),
    systems: Object.fromEntries(project.systems.map((s) => [s.slug, systemToEntry(s)])),
    factions: Object.fromEntries(project.factions.map((f) => [f.slug, factionToEntry(f)])),
  };
  triggerDownload("galaxy-sdf.json", JSON.stringify(combined, null, 2));
  return { mode: "download", sectorCount, systemCount, factionCount };
}
