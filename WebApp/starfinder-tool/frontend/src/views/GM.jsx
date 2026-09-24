import React, { useEffect, useRef, useState } from "react";
import { api, useWs } from "../api.js";
import BattleMap from "../components/BattleMap.jsx";
import ScenePanel from "../components/ScenePanel.jsx";
import SourcesConfig from "../components/SourcesConfig.jsx";
import WealthLimitConfig from "../components/WealthLimitConfig.jsx";
import MediaLibrary from "../components/MediaLibrary.jsx";
import Campaign from "../components/Campaign.jsx";
import Characters from "../components/Characters.jsx";
import Sessions from "../components/Sessions.jsx";
import { useAuth } from "../auth.jsx";
import { useActiveSession, filterToSession } from "../lib/sessionFilter.js";
import { MusicPlayerProvider, useMusicPlayer } from "../lib/musicPlayer.jsx";

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

const TABS = [
  { key: "battlemap", label: "Battle Map" },
  { key: "scene", label: "Scene & Mood" },
  { key: "media", label: "Media Library" },
  { key: "campaign", label: "Campaign" },
  { key: "characters", label: "Characters" },
  { key: "sessions", label: "Sessions" },
  { key: "sources", label: "Sources" },
];

// The tracker/sync status and sign-out used to live in a full-width header
// bar of their own — permanently taking up vertical space for things a GM
// checks rarely (connect the tracker once per session) or glances at only
// when something's wrong. Folded into this on-demand modal instead, opened
// from a small gear button in the tab row.
function SettingsModal({ onClose, wsConnected, tracker, username, logout }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="link" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Sync</span>
            <span className={wsConnected ? "pill ok" : "pill bad"}>{wsConnected ? "live" : "down"}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Mini tracker</span>
            <span className={tracker.status === "connected" ? "pill ok" : "pill"}>{tracker.status}</span>
          </div>
          <div className="row">
            {tracker.status === "connected"
              ? <button onClick={tracker.disconnect}>Disconnect tracker</button>
              : <button onClick={tracker.connect}>Connect tracker</button>}
          </div>
          <div className="modal-footer-row">
            <span className="muted">Signed in as {username}</span>
            <button className="link" onClick={logout}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact, only takes up topbar space while something's actually playing —
// persists across tabs because it (and the playback engine behind it) live
// above the tab switch, see lib/musicPlayer.jsx.
function MiniPlayer() {
  const { current, playing, togglePlay, stop } = useMusicPlayer();
  if (!current) return null;
  return (
    <div className="mini-player" title={current.label || current.original_name || "Track"}>
      <button className="icon-button" onClick={togglePlay}>{playing ? "⏸" : "▶"}</button>
      <span className="mini-player-label">{current.label || current.original_name || "Track"}</span>
      <button className="icon-button" onClick={stop} title="Stop">✕</button>
    </div>
  );
}

function BattleMapTab({ session, sessions, loadSessions, loadSession, createSession, selectedToken, setSelectedToken, onCellClick }) {
  const [newLabel, setNewLabel] = useState("");
  const [newTrackerId, setNewTrackerId] = useState("");
  const [newTokenImage, setNewTokenImage] = useState("");
  const [tokenImages, setTokenImages] = useState([]);
  const [mapImages, setMapImages] = useState([]);
  const [pickedMap, setPickedMap] = useState("");
  const { active, setFilterEnabled } = useActiveSession();

  useEffect(() => {
    api("/media?category=token").then(setTokenImages).catch(() => {});
    api("/media?category=map").then(setMapImages).catch(() => {});
  }, []);

  const visibleSessions = filterToSession(sessions, active, "encounterIds");
  const visibleMapImages = filterToSession(mapImages, active, "mediaIds");
  const visibleTokenImages = filterToSession(tokenImages, active, "mediaIds");

  const addToken = async () => {
    if (!session || !newLabel) return;
    await api(`/battlemap/sessions/${session.id}/tokens`, {
      method: "POST",
      body: { label: newLabel, tracker_id: newTrackerId || null, image_url: newTokenImage || "" },
    });
    setNewLabel(""); setNewTrackerId(""); setNewTokenImage("");
    loadSession(session.id);
  };

  const setMap = async () => {
    if (!session || !pickedMap) return;
    await api(`/battlemap/sessions/${session.id}`, { method: "PATCH", body: { map_url: pickedMap } });
    loadSession(session.id);
  };

  return (
    <div className="gm-body">
      <aside>
        {active?.status === "active" && (
          <label className="checkbox-inline" style={{ marginBottom: 10 }} title={`Session: ${active.name}`}>
            <input type="checkbox" checked={active.filter_enabled} onChange={(e) => setFilterEnabled(e.target.checked)} />
            Filter to "{active.name}"
          </label>
        )}
        <h3>Sessions</h3>
        <button onClick={createSession}>+ New encounter</button>
        <ul>
          {visibleSessions.map((s) => (
            <li key={s.id}>
              <button className="link" onClick={() => loadSession(s.id)}>{s.name}</button>
            </li>
          ))}
          {visibleSessions.length === 0 && (
            <li className="muted">{active?.filter_enabled && sessions.length > 0 ? "None linked to this session." : "No encounters yet."}</li>
          )}
        </ul>

        {session && (
          <>
            <h3>Map image</h3>
            <div className="row">
              <select value={pickedMap} onChange={(e) => setPickedMap(e.target.value)}>
                <option value="">From media library…</option>
                {visibleMapImages.map((m) => <option key={m.id} value={m.url}>{m.label || m.original_name}</option>)}
              </select>
              <button onClick={setMap} disabled={!pickedMap}>Set</button>
            </div>

            <h3>Add token</h3>
            <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <input placeholder="Tracker ID (optional)" value={newTrackerId} onChange={(e) => setNewTrackerId(e.target.value)} />
            <select value={newTokenImage} onChange={(e) => setNewTokenImage(e.target.value)}>
              <option value="">No image (plain color)</option>
              {visibleTokenImages.map((m) => <option key={m.id} value={m.url}>{m.label || m.original_name}</option>)}
            </select>
            <button onClick={addToken}>Add</button>
            {selectedToken && <p className="muted">Moving "{selectedToken.label}" — click a cell.</p>}
          </>
        )}
      </aside>
      <main>
        <BattleMap session={session} onCellClick={onCellClick} onTokenClick={setSelectedToken} />
      </main>
    </div>
  );
}

export default function GM() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("battlemap");
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [focusCharacterId, setFocusCharacterId] = useState(null);
  const [focusEntryId, setFocusEntryId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
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
    if (msg.type === "session:updated" && msg.payload.id === s.id) {
      setSession((cur) => ({ ...cur, ...msg.payload }));
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

  const onCellClick = (x, y) => {
    if (!selectedToken || !session) return;
    api(`/battlemap/sessions/${session.id}/tokens/${selectedToken.id}/position`, {
      method: "POST", body: { x, y },
    });
    setSelectedToken(null);
  };

  return (
    <MusicPlayerProvider>
    <div className="gm">
      <nav className="gm-topbar">
        <h2>GM Console</h2>
        <div className="gm-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <MiniPlayer />
        <button
          className={`icon-button${!wsConnected ? " icon-button-alert" : ""}`}
          onClick={() => setShowSettings(true)}
          title="Settings"
        >⚙</button>
      </nav>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          wsConnected={wsConnected}
          tracker={tracker}
          username={user?.username}
          logout={logout}
        />
      )}

      <div className="gm-tab-content">
        {tab === "battlemap" && (
          <BattleMapTab
            session={session} sessions={sessions}
            loadSessions={loadSessions} loadSession={loadSession} createSession={createSession}
            selectedToken={selectedToken} setSelectedToken={setSelectedToken}
            onCellClick={onCellClick}
          />
        )}
        {tab === "scene" && <ScenePanel session={session} characters={characters} />}
        {tab === "media" && <MediaLibrary />}
        {tab === "campaign" && (
          <Campaign
            onOpenCharacter={(id) => { setFocusCharacterId(id); setTab("characters"); }}
            focusEntryId={focusEntryId}
            onFocusHandled={() => setFocusEntryId(null)}
          />
        )}
        {tab === "characters" && (
          <Characters
            focusCharacterId={focusCharacterId}
            onFocusHandled={() => setFocusCharacterId(null)}
            onOpenCampaignEntry={(id) => { setFocusEntryId(id); setTab("campaign"); }}
          />
        )}
        {tab === "sessions" && <Sessions />}
        {tab === "sources" && (
          <div className="gm-panel">
            <SourcesConfig />
            <WealthLimitConfig />
          </div>
        )}
      </div>
    </div>
    </MusicPlayerProvider>
  );
}
