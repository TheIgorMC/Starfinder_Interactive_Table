import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import GM from "./views/GM.jsx";
import Player from "./views/Player.jsx";
import Display from "./views/Display.jsx";
import Tablet from "./views/Tablet.jsx";
import Compendium from "./views/Compendium.jsx";
import ReviewTool from "./views/ReviewTool.jsx";
import Login from "./views/Login.jsx";
import GalaxyMapPage from "./galaxy/GalaxyMapPage.jsx";
import SystemPage from "./galaxy/SystemPage.jsx";
import PlanetPage from "./galaxy/PlanetPage.jsx";
import SettlementPage from "./galaxy/SettlementPage.jsx";
import { AuthProvider, RequireAuth } from "./auth.jsx";
import { Launcher, AppFrame } from "./apps.jsx";
import "./fonts.js";
import "./styles.css";
import "./galaxy/galaxy.css";

// Only the GM ever loads the editor code.
const GalaxyEditor = React.lazy(() => import("./galaxy-editor/GalaxyEditor.jsx"));
const FantasyApp = React.lazy(() => import("./fantasy/FantasyApp.jsx"));

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Launcher />} />
        <Route path="/login" element={<Login />} />
        {/* GM console: full access, GM login only */}
        <Route path="/gm" element={<RequireAuth role="gm"><GM /></RequireAuth>} />
        {/* Player sheet: scoped server-side to the logged-in player's own character */}
        <Route path="/player" element={<RequireAuth role="player"><AppFrame app="player"><Player /></AppFrame></RequireAuth>} />
        {/* Rules lookup: any logged-in user, GM or player */}
        <Route path="/compendium" element={<RequireAuth role="any"><AppFrame app="compendium"><Compendium /></AppFrame></RequireAuth>} />
        {/* Galaxy viewer: any login; hidden districts are stripped server-side for players */}
        <Route path="/galaxy" element={<RequireAuth role="any"><GalaxyMapPage /></RequireAuth>} />
        <Route path="/galaxy/system/:sys" element={<RequireAuth role="any"><SystemPage /></RequireAuth>} />
        <Route path="/galaxy/system/:sys/:body" element={<RequireAuth role="any"><PlanetPage /></RequireAuth>} />
        <Route path="/galaxy/system/:sys/:body/:site" element={<RequireAuth role="any"><SettlementPage /></RequireAuth>} />
        {/* Data Review: GM-only hand-validation workbench over aon_entries */}
        <Route path="/review" element={<RequireAuth role="gm"><AppFrame app="review"><ReviewTool /></AppFrame></RequireAuth>} />
        {/* Galaxy Editor full screen (also a GM-console tab) */}
        <Route path="/galaxy-editor" element={<RequireAuth role="gm"><React.Suspense fallback={null}><GalaxyEditor /></React.Suspense></RequireAuth>} />
        {/* Public, unauthenticated: shared physical displays, not per-person devices */}
        {/* public, stand-alone, reached by direct link only (not in the launcher) */}
        <Route path="/fantasy" element={<React.Suspense fallback={null}><FantasyApp /></React.Suspense>} />

        <Route path="/tablet" element={<Tablet />} />
        <Route path="/display" element={<Display />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
