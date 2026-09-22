import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { youtubeId } from "./youtube.js";

// One playback engine shared by the whole GM console, mounted once above
// the tab switch (see GM.jsx) so starting a track in the Music tab keeps
// playing — and stays controllable from the compact topbar widget — while
// the GM works the battle map, campaign, whatever. A per-tab <audio>/
// <iframe> (the old approach) got torn down and restarted every time the
// tab it lived in unmounted.
//
// A direct/uploaded track plays through a single persisted <audio>
// element. A YouTube track plays through the YouTube IFrame Player API in
// a 1x1, practically-invisible mount (real DOM, not display:none — some
// browsers throttle/stop audio in a display:none iframe) so it can be
// driven the same way (play/pause/stop) without ever showing YouTube's
// own UI or "up next" screen. The API has no built-in single-video loop
// switch, so looping is done by hand: replay from 0 on ENDED.
const MusicPlayerContext = createContext(null);
export const useMusicPlayer = () => useContext(MusicPlayerContext);

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!window.__sitYtApiPromise) {
    window.__sitYtApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }
  return window.__sitYtApiPromise;
}

const isYoutube = (track) => !!(track?.url && !track.filename && youtubeId(track.url));

export function MusicPlayerProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const ytMountRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(null); // promise, resolves to the YT.Player once created
  const currentRef = useRef(null); // live copy for use inside YT event closures

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ""; };
  }, []);

  const ensureYtPlayer = useCallback(() => {
    if (ytReadyRef.current) return ytReadyRef.current;
    ytReadyRef.current = loadYouTubeApi().then((YT) => new Promise((resolve) => {
      const player = new YT.Player(ytMountRef.current, {
        height: "1",
        width: "1",
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { ytPlayerRef.current = player; resolve(player); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              if (currentRef.current?.loop) { player.seekTo(0); player.playVideo(); }
              else setPlaying(false);
            } else if (e.data === YT.PlayerState.PLAYING) setPlaying(true);
            else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
          },
        },
      });
    }));
    return ytReadyRef.current;
  }, []);

  const play = useCallback(async (track) => {
    audioRef.current?.pause();
    ytPlayerRef.current?.stopVideo();
    currentRef.current = track;
    setCurrent(track);

    const ytId = isYoutube(track) ? youtubeId(track.url) : null;
    if (ytId) {
      const player = await ensureYtPlayer();
      player.loadVideoById(ytId);
    } else {
      audioRef.current.src = track.url;
      audioRef.current.loop = !!track.loop;
      audioRef.current.play().catch(() => {});
    }
  }, [ensureYtPlayer]);

  const togglePlay = useCallback(() => {
    if (!currentRef.current) return;
    if (isYoutube(currentRef.current)) {
      if (!ytPlayerRef.current) return;
      if (playing) ytPlayerRef.current.pauseVideo(); else ytPlayerRef.current.playVideo();
    } else if (audioRef.current) {
      if (playing) audioRef.current.pause(); else audioRef.current.play().catch(() => {});
    }
  }, [playing]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    ytPlayerRef.current?.stopVideo();
    currentRef.current = null;
    setCurrent(null);
    setPlaying(false);
  }, []);

  // Called after a track's `loop` field is PATCHed, so a track already
  // playing picks up the change immediately instead of only on its next play().
  const setLoop = useCallback((trackId, loop) => {
    if (currentRef.current?.id !== trackId) return;
    currentRef.current = { ...currentRef.current, loop };
    setCurrent(currentRef.current);
    if (audioRef.current && !isYoutube(currentRef.current)) audioRef.current.loop = loop;
  }, []);

  return (
    <MusicPlayerContext.Provider value={{ current, playing, play, togglePlay, stop, setLoop }}>
      {children}
      <div style={{ position: "fixed", width: 1, height: 1, overflow: "hidden", opacity: 0.01, bottom: 0, right: 0, pointerEvents: "none" }}>
        <div ref={ytMountRef} />
      </div>
    </MusicPlayerContext.Provider>
  );
}
