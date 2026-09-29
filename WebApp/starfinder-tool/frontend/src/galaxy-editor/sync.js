import { useCallback, useEffect, useRef, useState } from "react";
import { useWs } from "../api.js";

// Keeps the editor's in-memory project in sync with the one SIT stores
// (GET/PUT /api/galaxy/project). Saves are debounced — the project is
// several MB, so painting a field or dragging things around must not send a
// request per change — and versioned: a save based on an older version gets
// a 409 instead of overwriting edits made elsewhere (another tab, an MCP
// tool), and the GM chooses to reload or overwrite.
async function putProject(data, baseVersion) {
  const res = await fetch("/api/galaxy/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, baseVersion }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 409) return { conflict: true, version: body?.version };
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export async function fetchProject() {
  const res = await fetch("/api/galaxy/project");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// status: "saved" | "pending" | "saving" | "conflict" | "error"
export function useServerSync(project, setProject, initialVersion) {
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [remoteVersion, setRemoteVersion] = useState(null); // newer version seen over WS while we had local edits
  const version = useRef(initialVersion);
  const saved = useRef(initialVersion == null ? null : project); // last project the server has (null = brand-new galaxy, save it)
  const latest = useRef(project);
  const ownVersions = useRef(new Set());
  latest.current = project;

  const save = useCallback(async (overwrite) => {
    const data = latest.current;
    if (data === saved.current && !overwrite) return;
    setStatus("saving");
    try {
      const r = await putProject(data, overwrite ? overwrite : version.current);
      if (r.conflict) { setStatus("conflict"); setRemoteVersion(r.version ?? null); return; }
      version.current = r.version;
      ownVersions.current.add(r.version);
      saved.current = data;
      setError("");
      setRemoteVersion(null);
      setStatus(latest.current === data ? "saved" : "pending");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }, []);

  // no autosave: just flag unsaved changes
  useEffect(() => {
    if (project === saved.current || status === "conflict") return;
    setStatus((s) => (s === "saving" || s === "error" ? s : "pending"));
  }, [project, status]);

  // flush on unmount (switching GM tab) and warn on page unload
  useEffect(() => {
    const warn = (e) => { if (latest.current !== saved.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (latest.current !== saved.current) save();
    };
  }, [save]);

  const reload = useCallback(async () => {
    const p = await fetchProject();
    if (!p) return;
    version.current = p.version;
    saved.current = p.data;
    latest.current = p.data;
    setProject(p.data);
    setRemoteVersion(null);
    setStatus("saved");
  }, [setProject]);

  // someone else saved (MCP tool, another tab): pick it up silently if we
  // have nothing unsaved, otherwise flag it
  useWs((msg) => {
    if (msg.type !== "galaxy:updated") return;
    const v = msg.payload?.version;
    if (ownVersions.current.has(v) || v === version.current) return;
    if (latest.current === saved.current) reload();
    else setRemoteVersion(v ?? -1);
  });

  const overwrite = useCallback(async () => {
    const p = await fetchProject();
    await save(p ? p.version : undefined);
  }, [save]);

  return { status, error, remoteVersion, saveNow: () => save(), reload, overwrite, version: version.current };
}
