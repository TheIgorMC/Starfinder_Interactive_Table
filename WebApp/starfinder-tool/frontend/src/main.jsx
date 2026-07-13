import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import GM from "./views/GM.jsx";
import Player from "./views/Player.jsx";
import Display from "./views/Display.jsx";
import Tablet from "./views/Tablet.jsx";
import Compendium from "./views/Compendium.jsx";
import Login from "./views/Login.jsx";
import { AuthProvider, RequireAuth, useAuth } from "./auth.jsx";
import "./styles.css";

function Home() {
  const { user, logout } = useAuth();
  return (
    <div className="home">
      <h1>Starfinder Companion</h1>
      {user === undefined ? null : user ? (
        <p className="muted">
          Signed in as <strong>{user.username}</strong> ({user.role}) —{" "}
          <button className="link" onClick={logout}>sign out</button>
        </p>
      ) : (
        <p className="muted"><Link to="/login">Sign in</Link></p>
      )}
      <nav>
        <Link to="/gm">GM Console (PC)</Link>
        <Link to="/player">Player View (tablet/phone)</Link>
        <Link to="/tablet">Mood Display (GM tablet)</Link>
        <Link to="/display">Battle Map Display (projector)</Link>
        <Link to="/compendium">Compendium (rules lookup)</Link>
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        {/* GM console: full access, GM login only */}
        <Route path="/gm" element={<RequireAuth role="gm"><GM /></RequireAuth>} />
        {/* Player sheet: scoped server-side to the logged-in player's own character */}
        <Route path="/player" element={<RequireAuth role="player"><Player /></RequireAuth>} />
        {/* Rules lookup: any logged-in user, GM or player */}
        <Route path="/compendium" element={<RequireAuth role="any"><Compendium /></RequireAuth>} />
        {/* Public, unauthenticated: shared physical displays, not per-person devices */}
        <Route path="/tablet" element={<Tablet />} />
        <Route path="/display" element={<Display />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
