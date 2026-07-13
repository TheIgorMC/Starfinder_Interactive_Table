import React, { useEffect, useRef, useState } from "react";
import { api, useWs } from "../api.js";
import BattleMap from "../components/BattleMap.jsx";

// Projector display: chrome-less. GM switches it between battle map
// and scenic media via the scene module.
export default function Display() {
  const [channel, setChannel] = useState({ mode: "battlemap", sessionId: null, mediaUrl: "", caption: "" });
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const loadSession = async (id) => {
    if (id) return setSession(await api(`/battlemap/sessions/${id}`));
    const sessions = await api("/battlemap/sessions");
    const active = sessions.find((s) => s.active) || sessions[0];
    if (active) setSession(await api(`/battlemap/sessions/${active.id}`));
  };

  useEffect(() => {
    api("/scene/state").then((s) => {
      setChannel(s.projector);
      if (s.projector.mode === "battlemap") loadSession(s.projector.sessionId);
    });
  }, []);

  useWs((msg) => {
    if (msg.type === "scene:channel" && msg.payload.channel === "projector") {
      setChannel(msg.payload.state);
      if (msg.payload.state.mode === "battlemap") loadSession(msg.payload.state.sessionId);
      return;
    }
    const s = sessionRef.current;
    if (msg.type === "session:created") { loadSession(null); return; }
    if (msg.type === "session:updated" && msg.payload.id === s?.id) { loadSession(s.id); return; }
    if (!s) return;
    if ((msg.type === "token:moved" || msg.type === "token:created") && msg.payload.session_id === s.id) {
      setSession((cur) => {
        const others = cur.tokens.filter((t) => t.id !== msg.payload.id);
        return { ...cur, tokens: [...others, msg.payload] };
      });
    }
    if (msg.type === "token:deleted" && msg.payload.session_id === s.id) {
      setSession((cur) => ({ ...cur, tokens: cur.tokens.filter((t) => t.id !== msg.payload.id) }));
    }
  });

  if (channel.mode === "scenic") {
    return (
      <div className="display-full scenic">
        {channel.mediaUrl && <img src={channel.mediaUrl} alt="" />}
        {channel.caption && <p className="caption">{channel.caption}</p>}
      </div>
    );
  }

  return (
    <div className="display-full">
      <BattleMap session={session} fit />
    </div>
  );
}
