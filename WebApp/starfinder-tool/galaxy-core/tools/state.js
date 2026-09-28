import { normalizeProject } from "../lib/project.js";

// The project a tool call operates on. The host (SIT backend,
// routes/galaxy.js) loads the stored project into this before each call and
// reads it back afterwards — calls are serialized there, so one module-level
// slot is enough. Tools never touch `state.project` directly: they go
// through requireProject()/setProject(), same immutable-update discipline as
// the generators (return a new project, never mutate in place).
const state = { project: null, dirty: false };

export function load(project) {
  state.project = project ? normalizeProject(project) : null;
  state.dirty = false;
}

// Returns { project, dirty } and clears the slot.
export function take() {
  const out = { project: state.project, dirty: state.dirty };
  state.project = null;
  state.dirty = false;
  return out;
}

export function hasProject() {
  return state.project != null;
}

export function requireProject() {
  if (!state.project) throw new Error("No galaxy project exists yet — the GM creates one from the Galaxy Editor.");
  return state.project;
}

export function isDirty() {
  return state.dirty;
}

export function setProject(nextProject) {
  state.project = nextProject;
  state.dirty = true;
  return state.project;
}
