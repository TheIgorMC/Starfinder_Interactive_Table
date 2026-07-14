import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

// GM-side config: starting credits for a brand-new PC joining the table.
// Saved as a global setting (`new_pc_wealth_limit`) so the character
// creation wizard's equipment step can default to something other than the
// core rulebook's flat 1,000cr — useful once a campaign is already running
// and new players should start with wealth in line with the current party
// rather than a fresh 1st-level default. See docs/09-character-creation-flow.md §3.
const DEFAULT_CREDITS = 1000;

export default function WealthLimitConfig() {
  const [mode, setMode] = useState("manual");
  const [credits, setCredits] = useState(DEFAULT_CREDITS);
  const [suggested, setSuggested] = useState(null);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api("/settings/new_pc_wealth_limit").then((s) => {
      const v = s.value || {};
      setMode(v.mode || "manual");
      setCredits(v.credits ?? DEFAULT_CREDITS);
    });
  };

  useEffect(() => { load(); }, []);
  useWs((msg) => { if (msg.type === "settings:updated" && msg.payload.key === "new_pc_wealth_limit") load(); });

  // "Auto" suggestion: average credits currently held across all PCs (GM-only
  // read). The GM still has to accept/edit and Save — nothing here writes on
  // its own, matching the "GM decides, app doesn't auto-enforce" stance.
  const computeSuggestion = async () => {
    const chars = await api("/characters");
    if (!chars.length) { setSuggested(0); return; }
    const avg = Math.round(chars.reduce((sum, c) => sum + (c.credits || 0), 0) / chars.length);
    setSuggested(avg);
    setCredits(avg);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    await api("/settings/new_pc_wealth_limit", { method: "PUT", body: { value: { mode, credits: Number(credits) || 0 } } });
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="sources-config">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} New PC starting credits ({credits.toLocaleString()})
      </button>
      {open && (
        <div className="sources-config-body">
          <p className="muted">
            Starting credits offered to a brand-new character in the wizard's
            equipment step. Core default is 1,000 for a fresh 1st-level party —
            raise this once the campaign has progressed so new PCs aren't
            under-funded relative to the group.
          </p>
          <div className="row">
            <label className="checkbox-inline">
              <input type="radio" checked={mode === "manual"} onChange={() => { setMode("manual"); setDirty(true); }} />
              Manual
            </label>
            <label className="checkbox-inline">
              <input type="radio" checked={mode === "auto"} onChange={() => { setMode("auto"); setDirty(true); }} />
              Suggest from current party
            </label>
          </div>
          {mode === "auto" && (
            <div className="row">
              <button onClick={computeSuggestion}>Compute suggestion</button>
              {suggested != null && <span className="muted">avg. party credits: {suggested.toLocaleString()}</span>}
            </div>
          )}
          <input
            type="number" min="0" value={credits}
            onChange={(e) => { setCredits(Number(e.target.value) || 0); setDirty(true); }}
          />
          <button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
