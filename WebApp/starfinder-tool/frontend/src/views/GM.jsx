import React, { useEffect, useRef, useState } from "react";
import { api, useWs } from "../api.js";
import BattleMap from "../components/BattleMap.jsx";
import ScenePanel from "../components/ScenePanel.jsx";

/*
 * Mini tracker protocol (placeholder — adjust to real PCB firmware):
 * newline-terminated ASCII frames over USB CDC:
 *   POS,<tracker_id>,<x>,<y>\n
 * Example: POS,mini01,12,7
 */
function useMiniTracker(onPosition) {
  const [status, setStatus] = useState("disconnected");
  const readerRef = useRef(null);
  const portRef = useRef(null);

  const connect = async () => {
    if (!("serial" in navigator)) {
      setStatus("Web Serial unsupported (use Chrome/Edge)");
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setStatus("connected");
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;
      let buf = "";
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              const m = line.match(/^POS,([^,]+),(\d+),(\d+)$/);
              if (m) onPosition(m[1], parseInt(m[2], 10), parseInt(m[3], 10));
            }
          }
        } catch { /* port closed */ }
        setStatus("disconnected");
      })();
    } catch (e) {
      setStatus(`error: ${e.message}`);
    }
  };

  const disconnect = async () => {
    try { await readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    setStatus("disconnected");
  };

  return { status, connect, disconnect };
}

export default function GM() {
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [newLabel, setNewLabel] = useState("");
  const [newTrackerId, setNewTrackerId] = useState("");
  const [characters, setCharacters] = useState([]);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const wsConnected = useWs((msg) => {
    const s = sessionRef.current;
    if (!s) return;
    if (msg.type === "token:moved" || msg.type === "token:created") {
      if (msg.payload.session_id !== s.id) return;
      setSession((cur) => {
        const others = cur.tokens.filter((t) => t.id !== msg.payload.id);
        return { ...cur, tokens: [...others, msg.payload] };
      });
    }
    if (msg.type === "token:deleted" && msg.payload.session_id === s.id) {
      setSession((cur) => ({ ...cur, tokens: cur.tokens.filter((t) => t.id !== msg.payload.id) }));
    }
  });

  const tracker = useMiniTracker((trackerId, x, y) => {
    api("/battlemap/tracker/position", { method: "POST", body: { tracker_id: trackerId, x, y } })
      .catch(() => { /* unbound tracker id — ignore */ });
  });

  const loadSessions = () => api("/battlemap/sessions").then(setSessions);
  const loadSession = (id) => api(`/battlemap/sessions/${id}`).then(setSession);

  useEffect(() => { loadSessions(); api("/characters").then(setCharacters); }, []);

  const createSession = async () => {
    const s = await api("/battlemap/sessions", { method: "POST", body: { name: `Encounter ${sessions.length + 1}` } });
    await loadSessions();
    await loadSession(s.id);
  };

  const addToken = async () => {
    if (!session || !newLabel) return;
    await api(`/battlemap/sessions/${session.id}/tokens`, {
      method: "POST",
      body: { label: newLabel, tracker_id: newTrackerId || null },
    });
    setNewLabel(""); setNewTrackerId("");
    loadSession(session.id);
  };

  const onCellClick = (x, y) => {
    if (!selectedToken || !session) return;
    api(`/battlemap/sessions/${session.id}/tokens/${selectedToken.id}/position`, {
      method: "POST", body: { x, y },
    });
    setSelectedToken(null);
  };

  return (
    <div className="gm">
      <header>
        <h2>GM Console</h2>
        <span className={wsConnected ? "pill ok" : "pill bad"}>{wsConnected ? "sync live" : "sync down"}</span>
        <span className={tracker.status === "connected" ? "pill ok" : "pill"}>tracker: {tracker.status}</span>
        {tracker.status === "connected"
          ? <button onClick={tracker.disconnect}>Disconnect tracker</button>
          : <button onClick={tracker.connect}>Connect tracker</button>}
      </header>

      <div className="gm-body">
        <aside>
          <h3>Sessions</h3>
          <button onClick={createSession}>+ New encounter</button>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <button className="link" onClick={() => loadSession(s.id)}>{s.name}</button>
              </li>
            ))}
          </ul>

          {session && (
            <>
              <h3>Add token</h3>
              <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <input placeholder="Tracker ID (optional)" value={newTrackerId} onChange={(e) => setNewTrackerId(e.target.value)} />
              <button onClick={addToken}>Add</button>
              {selectedToken && <p className="muted">Moving “{selectedToken.label}” — click a cell.</p>}
            </>
          )}
          <ScenePanel session={session} characters={characters} />
        </aside>

        <main>
          <BattleMap
            session={session}
            onCellClick={onCellClick}
            onTokenClick={setSelectedToken}
          />
        </main>
      </div>
    </div>
  );
}
