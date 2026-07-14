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

// Writes the real SDF tree (sectors/<slug>/entry.json) via the File System
// Access API when the browser supports it (Chromium); otherwise falls back
// to a single combined JSON download the GM can split by hand.
export async function exportSectorsSDF(project) {
  if (project.sectors.length === 0) {
    return { mode: "none", count: 0 };
  }
  if ("showDirectoryPicker" in window) {
    const root = await window.showDirectoryPicker();
    const sectorsDir = await root.getDirectoryHandle("sectors", { create: true });
    for (const sector of project.sectors) {
      const dir = await sectorsDir.getDirectoryHandle(sector.slug, { create: true });
      const fileHandle = await dir.getFileHandle("entry.json", { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(sectorToEntry(sector), null, 2));
      await writable.close();
    }
    return { mode: "fs", count: project.sectors.length };
  }
  const combined = Object.fromEntries(
    project.sectors.map((s) => [s.slug, sectorToEntry(s)]),
  );
  triggerDownload("sectors-sdf.json", JSON.stringify(combined, null, 2));
  return { mode: "download", count: project.sectors.length };
}
