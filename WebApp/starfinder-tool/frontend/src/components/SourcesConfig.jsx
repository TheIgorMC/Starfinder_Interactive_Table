import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

// GM-side config: which sourcebooks does this table actually own? Saved as
// a global setting (`owned_sources`) that the Compendium uses as its
// default filter — see docs/04-data-pipeline-aon.md.
export default function SourcesConfig() {
  const [allSources, setAllSources] = useState([]);
  const [owned, setOwned] = useState(new Set());
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api("/aon/sources").then((rows) => setAllSources(rows.map((r) => r.source).filter(Boolean)));
    api("/settings/owned_sources").then((s) => setOwned(new Set(s.value || [])));
  };

  useEffect(() => { load(); }, []);
  useWs((msg) => { if (msg.type === "settings:updated" && msg.payload.key === "owned_sources") load(); });

  const toggle = (source) => {
    const next = new Set(owned);
    next.has(source) ? next.delete(source) : next.add(source);
    setOwned(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    await api("/settings/owned_sources", { method: "PUT", body: { value: [...owned] } });
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="sources-config">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Owned sourcebooks ({owned.size}/{allSources.length})
      </button>
      {open && (
        <div className="sources-config-body">
          <p className="muted">
            Compendium defaults to these sources. Uncheck all to show everything.
          </p>
          <ul className="sources-checklist">
            {allSources.map((s) => (
              <li key={s}>
                <label>
                  <input type="checkbox" checked={owned.has(s)} onChange={() => toggle(s)} />
                  {s}
                </label>
              </li>
            ))}
          </ul>
          <button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
