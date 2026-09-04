import { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

// The currently active game session (session planning — see
// backend/src/routes/sessions.js), if any, plus the ids it scopes the rest
// of the GM console down to when its own `filter_enabled` flag is on.
// Shared by every picker that should narrow to "what's prepped for
// tonight" once a session is started: Media Library, the battle map's
// encounter/map/token pickers, and the Campaign NPC list.
export function useActiveSession() {
  const [active, setActive] = useState(undefined); // undefined = loading, null = none active

  const load = () => api("/sessions/active").then(setActive).catch(() => setActive(null));
  useEffect(() => { load(); }, []);
  useWs((msg) => { if (msg.type?.startsWith("game_session:")) load(); });

  const setFilterEnabled = (enabled) => {
    if (!active) return Promise.resolve();
    return api(`/sessions/${active.id}`, { method: "PATCH", body: { filter_enabled: enabled } }).then(setActive);
  };

  return { active, setFilterEnabled };
}

// `idsKey` is one of "entryIds" | "mediaIds" | "encounterIds" on `active`.
export function filterToSession(items, active, idsKey, idOf = (it) => it.id) {
  if (!active || !active.filter_enabled) return items;
  const ids = new Set(active[idsKey] || []);
  return items.filter((it) => ids.has(idOf(it)));
}
