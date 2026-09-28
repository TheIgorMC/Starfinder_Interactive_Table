import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";

// SIT as a set of "apps" (Docs/08-ui-tabs.md → navigation). Players land
// on a launcher and open one app at a time (each with a slim app bar to
// switch or go back); the GM gets everything as tabs in the GM console,
// plus the same launcher for the full-screen / device views. One registry
// drives both, so a new app is one entry here.
//
// roles: who sees the tile — "gm", "player", or "public" (no login needed:
// shared physical displays).
export const APPS = [
  { key: "gm", name: "GM Console", desc: "Everything, as tabs: battle map, scene, campaign, galaxy, characters…", path: "/gm", roles: ["gm"], icon: "console" },
  { key: "player", name: "Character", desc: "Your character sheet", path: "/player", roles: ["player"], icon: "character" },
  { key: "galaxy", name: "Galaxy Map", desc: "Systems, planets and cities of the campaign", path: "/galaxy", roles: ["gm", "player"], icon: "galaxy" },
  { key: "galaxy-editor", name: "Galaxy Editor", desc: "Generate and edit the galaxy (full screen)", path: "/galaxy-editor", roles: ["gm"], icon: "editor" },
  { key: "compendium", name: "Compendium", desc: "Rules lookup: feats, spells, gear…", path: "/compendium", roles: ["gm", "player"], icon: "book" },
  { key: "review", name: "Data Review", desc: "Hand-validate imported rules data", path: "/review", roles: ["gm"], icon: "review" },
  { key: "tablet", name: "Mood Display", desc: "GM tablet: mood, media, NPCs", path: "/tablet", roles: ["public"], icon: "tablet" },
  { key: "display", name: "Battle Map Display", desc: "Projector view", path: "/display", roles: ["public"], icon: "display" },
];

export function appsFor(user) {
  const role = user?.role;
  return APPS.filter((a) => a.roles.includes("public") || (role && a.roles.includes(role)));
}

const sv = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true };
const ICONS = {
  console: <svg {...sv}><rect x="3" y="4" width="18" height="16" /><path d="M3 9h18M8 4v5M13 4v5" /></svg>,
  character: <svg {...sv}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>,
  galaxy: <svg {...sv}><circle cx="12" cy="12" r="9" strokeOpacity=".5" /><ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(-28 12 12)" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>,
  editor: <svg {...sv}><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /><circle cx="18" cy="18" r="2" /></svg>,
  book: <svg {...sv}><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z" /><path d="M12 6v14" /></svg>,
  review: <svg {...sv}><path d="M5 12l4 4 10-10" /><rect x="3" y="3" width="18" height="18" strokeOpacity=".5" /></svg>,
  tablet: <svg {...sv}><rect x="5" y="3" width="14" height="18" /><path d="M10 18h4" /></svg>,
  display: <svg {...sv}><rect x="3" y="4" width="18" height="12" /><path d="M8 20h8M12 16v4" /></svg>,
};

export const Logo = ({ s = 30 }) => (
  <svg width={s} height={s} viewBox="0 0 34 34" fill="none" stroke="#ff9a3c" strokeWidth="1.4" aria-hidden>
    <circle cx="17" cy="17" r="15" strokeOpacity=".45" />
    <ellipse cx="17" cy="17" rx="15" ry="5.5" transform="rotate(-28 17 17)" />
    <circle cx="17" cy="17" r="3" fill="#ff9a3c" />
  </svg>
);

// "/" — the app launcher.
export function Launcher() {
  const { user, logout } = useAuth();
  if (user === undefined) return <div className="sit-launcher" />;
  const apps = appsFor(user);
  const mine = apps.filter((a) => !a.roles.includes("public"));
  const shared = apps.filter((a) => a.roles.includes("public"));
  return (
    <div className="sit-launcher">
      <header className="sit-launcher-head">
        <Logo s={40} />
        <div>
          <div className="t">STARFINDER INTERACTIVE TABLE</div>
          <div className="s">
            {user ? <>SIGNED IN AS {user.username.toUpperCase()} · {user.role.toUpperCase()} · <button className="sit-textbtn" onClick={logout}>SIGN OUT</button></> : <Link to="/login">SIGN IN</Link>}
          </div>
        </div>
      </header>
      {mine.length > 0 && <AppGrid title={user?.role === "gm" ? "GM" : "YOUR APPS"} apps={mine} />}
      <AppGrid title="SHARED DISPLAYS" apps={shared} />
    </div>
  );
}

function AppGrid({ title, apps }) {
  return (
    <section>
      <h2 className="sit-launcher-label">{title}</h2>
      <div className="sit-launcher-grid">
        {apps.map((a) => (
          <Link key={a.key} to={a.path} className="sit-app-tile">
            <span className="ic">{ICONS[a.icon]}</span>
            <span className="n">{a.name}</span>
            <span className="d">{a.desc}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// Slim bar on top of a single app (player side): back to the launcher,
// app name, and a switcher to jump straight to another app.
export function AppFrame({ app, children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const cur = APPS.find((a) => a.key === app);
  const others = appsFor(user).filter((a) => a.key !== app && !a.roles.includes("public"));
  return (
    <>
      <nav className="sit-appbar" ref={ref}>
        <Link to="/" className="sit-appbar-home" aria-label="All apps"><Logo s={24} /></Link>
        <span className="sit-appbar-name">{cur?.name.toUpperCase()}</span>
        <span style={{ flexGrow: 1 }} />
        {others.length > 0 && (
          <button className="sit-appbar-btn" aria-expanded={open} onClick={() => setOpen(!open)}>APPS ▾</button>
        )}
        {user && <button className="sit-appbar-btn" onClick={logout}>SIGN OUT</button>}
        {open && (
          <div className="sit-appbar-menu">
            {others.map((a) => (
              <Link key={a.key} to={a.path}><span className="ic">{ICONS[a.icon]}</span>{a.name}</Link>
            ))}
          </div>
        )}
      </nav>
      {children}
    </>
  );
}
