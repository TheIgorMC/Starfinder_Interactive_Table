import React, { useEffect, useState } from "react";
import { api, useWs } from "../api.js";

const isVideo = (url) => /\.(mp4|webm|mov|m4v)$/i.test(url || "");

// GM tablet: mood board. Four things it can show (driven entirely by the
// GM console's ScenePanel):
//  - idle: campaign/chapter homescreen (falls back to just the mood name
//    if no chapter is pushed)
//  - media: a scenic image, or a looping video
//  - npc_narrative: portrait(s) + name only if the GM revealed it
//  - npc_boss: portrait(s) + HP as a bar, percentage only — never numbers
export default function Tablet() {
  const [channel, setChannel] = useState({ mode: "idle", mediaUrl: "", caption: "", loop: false, characterIds: [], revealNames: false });
  const [mood, setMood] = useState({ color: "#202040", name: "" });
  const [featured, setFeatured] = useState([]);
  const [chapter, setChapter] = useState(null);

  const loadFeatured = () => api("/scene/tablet/characters").then(setFeatured);
  const loadChapter = () => api("/scene/tablet/chapter").then(setChapter);

  useEffect(() => {
    api("/scene/state").then((s) => { setChannel(s.tablet); setMood(s.mood); });
    loadFeatured();
    loadChapter();
  }, []);

  useWs((msg) => {
    if (msg.type === "scene:channel" && msg.payload.channel === "tablet") {
      setChannel(msg.payload.state);
      loadFeatured();
      loadChapter();
    }
    if (msg.type === "scene:mood") setMood(msg.payload);
    if (msg.type?.startsWith("character:")) loadFeatured();
  });

  return (
    <div className="tablet-mood" style={{ "--mood": mood.color }}>
      {channel.mode === "idle" && (
        <div className="center" key={chapter?.id ?? "mood"}>
          {chapter ? (
            <div className="tablet-chapter tablet-fade">
              {chapter.imageUrl && <img src={chapter.imageUrl} alt="" />}
              {chapter.type && <span className="tablet-chapter-type">{chapter.type}</span>}
              <h1>{chapter.name}</h1>
              {chapter.summary && <p className="caption">{chapter.summary}</p>}
            </div>
          ) : (
            <h1 className="tablet-fade">{mood.name || "Starfinder"}</h1>
          )}
        </div>
      )}

      {channel.mode === "media" && (
        <div className="center tablet-fade" key={channel.mediaUrl}>
          {channel.mediaUrl && (
            isVideo(channel.mediaUrl)
              ? <video src={channel.mediaUrl} autoPlay muted loop={channel.loop} playsInline />
              : <img src={channel.mediaUrl} alt="" />
          )}
          {channel.caption && <p className="caption">{channel.caption}</p>}
        </div>
      )}

      {channel.mode === "npc_narrative" && (
        <div className="char-strip tablet-fade" key={featured.map((c) => c.id).join(",")}>
          {featured.map((c) => (
            <div key={c.id} className="npc-card npc-narrative">
              {c.portrait_url && <img src={c.portrait_url} alt="" />}
              {c.name && <h3>{c.name}</h3>}
            </div>
          ))}
        </div>
      )}

      {channel.mode === "npc_boss" && (
        <div className="char-strip tablet-fade" key={featured.map((c) => c.id).join(",")}>
          {featured.map((c) => (
            <div key={c.id} className="npc-card npc-boss">
              {c.portrait_url && <img src={c.portrait_url} alt="" />}
              <h3>{c.name}</h3>
              <div className="npc-hp-bar">
                <div className="npc-hp-fill" style={{ width: `${c.hp_pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
