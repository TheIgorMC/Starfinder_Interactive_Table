import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultProject, normalizeProject } from "../../src/lib/project.js";

// Single mutable in-memory project shared by every tool call in this MCP
// server process (one server = one GM session working on one galaxy at a
// time, same as the browser app's own single-`project` model) — no
// database, no multi-project juggling. Tools never touch `state.project`
// directly; they go through the getters/setters below so every mutation
// path agrees on what "loaded"/"dirty" mean.
const state = {
  project: null,
  filePath: null,
  dirty: false,
};

export function hasProject() {
  return state.project != null;
}

export function requireProject() {
  if (!state.project) {
    throw new Error(
      "No project loaded. Call new_project (to start fresh) or load_project (to open a .json file) first.",
    );
  }
  return state.project;
}

export function getFilePath() {
  return state.filePath;
}

export function isDirty() {
  return state.dirty;
}

// Every mutating tool ends by calling this with the *next* project value —
// same immutable-update discipline the browser app's own `lib/*Gen.js`
// functions already follow (return a new project, never mutate in place),
// so this is just the one place that commits it into shared state and
// flips the dirty flag.
export function setProject(nextProject) {
  state.project = nextProject;
  state.dirty = true;
  return state.project;
}

export function newProject(seed, width, height) {
  state.project = normalizeProject(createDefaultProject(seed, width, height));
  state.filePath = null;
  state.dirty = true;
  return state.project;
}

export async function loadProject(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.fields || !parsed.bounds) {
    throw new Error(`${resolved} doesn't look like a GalaxyGen project file (missing fields/bounds).`);
  }
  state.project = normalizeProject(parsed);
  state.filePath = resolved;
  state.dirty = false;
  return state.project;
}

// `filePath` optional on every save after the first — defaults to wherever
// this project was last loaded from/saved to, mirroring the browser app's
// own "Save .json" always writing to the same download rather than asking
// each time. Passing an explicit path is a "Save As."
export async function saveProject(filePath) {
  const project = requireProject();
  const target = path.resolve(filePath || state.filePath || "galaxy.json");
  await writeFile(target, JSON.stringify(project, null, 2), "utf8");
  state.filePath = target;
  state.dirty = false;
  return target;
}
