import { buildGalaxyIndexEnvelope } from "@galaxy-core/lib/aiIndex.js";
import {
  sectorToEntry,
  systemToEntry,
  factionToEntry,
  actorToEntry,
  organizationToEntry,
  shipModelToEntry,
  companyToEntry,
  eventToEntry,
} from "@galaxy-core/lib/sdf.js";

const STORAGE_KEY = "galaxygen.project.v1";
// Separate key, deliberately never part of `project` — an API base
// URL/key/model is a machine-local setting, not galaxy data, so it must
// never end up in a saved project file or SDF export that gets shared.
const AI_SETTINGS_KEY = "galaxygen.aiSettings.v1";

export function loadAISettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { baseUrl: "", apiKey: "", model: "" };
  } catch {
    return { baseUrl: "", apiKey: "", model: "" };
  }
}

export function saveAISettings(settings) {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not critical — settings just won't persist across reloads.
  }
}

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

// A standalone download of just the compact index (Docs/11-AI-integration.md
// §6.2) — lets a GM hand it straight to an LLM chat today (paste it in as
// context) without needing the full SDF tree or any backend/tool-calling
// wiring to exist yet.
export function downloadGalaxyIndex(project) {
  triggerDownload(`galaxy-index-${project.seed}.json`, JSON.stringify(buildGalaxyIndexEnvelope(project), null, 2));
}

export async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.fields || !parsed.bounds) {
    throw new Error("Not a recognized GalaxyGen project file.");
  }
  return parsed;
}

// Writes the real SDF tree (sectors/<slug>/entry.json, systems/<slug>/entry.json)
// via the File System Access API when the browser supports it (Chromium);
// otherwise falls back to a single combined JSON download the GM can split
// by hand.
export async function exportGalaxySDF(project) {
  const sectorCount = project.sectors.length;
  const systemCount = project.systems.length;
  const factionCount = project.factions.length;
  const actorCount = project.actors.length;
  const organizationCount = project.organizations.length;
  const eventCount = project.events.length;
  const companyCount = project.companies?.length || 0;
  const shipModelCount = project.shipModels?.length || 0;
  if (
    sectorCount === 0 &&
    systemCount === 0 &&
    factionCount === 0 &&
    actorCount === 0 &&
    organizationCount === 0 &&
    eventCount === 0 &&
    companyCount === 0 &&
    shipModelCount === 0
  ) {
    return { mode: "none", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
  }

  if ("showDirectoryPicker" in window) {
    const root = await window.showDirectoryPicker();
    // Docs/11-AI-integration.md §6.2 — the compact index a future AI
    // layer's Pass 1 (broad/coherence, §9.3) reasons over, written once at
    // the tree root rather than a per-category file since it spans all of
    // them.
    {
      const fileHandle = await root.getFileHandle("index.json", { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(buildGalaxyIndexEnvelope(project), null, 2));
      await writable.close();
    }
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
    if (actorCount > 0) {
      const actorsDir = await root.getDirectoryHandle("actors", { create: true });
      for (const actor of project.actors) {
        const dir = await actorsDir.getDirectoryHandle(actor.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(actorToEntry(actor), null, 2));
        await writable.close();
      }
    }
    if (organizationCount > 0) {
      const orgsDir = await root.getDirectoryHandle("organizations", { create: true });
      for (const org of project.organizations) {
        const dir = await orgsDir.getDirectoryHandle(org.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(organizationToEntry(org, project.actors), null, 2));
        await writable.close();
      }
    }
    if (eventCount > 0) {
      const eventsDir = await root.getDirectoryHandle("events", { create: true });
      for (const event of project.events) {
        const dir = await eventsDir.getDirectoryHandle(event.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(eventToEntry(event), null, 2));
        await writable.close();
      }
    }
    if (shipModelCount > 0) {
      const modelsDir = await root.getDirectoryHandle("ship_models", { create: true });
      for (const model of project.shipModels) {
        const dir = await modelsDir.getDirectoryHandle(model.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(shipModelToEntry(model), null, 2));
        await writable.close();
      }
    }
    if (companyCount > 0) {
      const companiesDir = await root.getDirectoryHandle("companies", { create: true });
      for (const company of project.companies) {
        const dir = await companiesDir.getDirectoryHandle(company.slug, { create: true });
        const fileHandle = await dir.getFileHandle("entry.json", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(companyToEntry(company), null, 2));
        await writable.close();
      }
    }
    return { mode: "fs", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
  }

  const combined = {
    index: buildGalaxyIndexEnvelope(project),
    sectors: Object.fromEntries(project.sectors.map((s) => [s.slug, sectorToEntry(s)])),
    systems: Object.fromEntries(project.systems.map((s) => [s.slug, systemToEntry(s)])),
    factions: Object.fromEntries(project.factions.map((f) => [f.slug, factionToEntry(f)])),
    actors: Object.fromEntries(project.actors.map((a) => [a.slug, actorToEntry(a)])),
    organizations: Object.fromEntries(project.organizations.map((o) => [o.slug, organizationToEntry(o, project.actors)])),
    events: Object.fromEntries(project.events.map((e) => [e.slug, eventToEntry(e)])),
    ship_models: Object.fromEntries((project.shipModels || []).map((m) => [m.slug, shipModelToEntry(m)])),
    companies: Object.fromEntries((project.companies || []).map((c) => [c.slug, companyToEntry(c)])),
  };
  triggerDownload("galaxy-sdf.json", JSON.stringify(combined, null, 2));
  return { mode: "download", sectorCount, systemCount, factionCount, actorCount, organizationCount, eventCount, companyCount, shipModelCount };
}
