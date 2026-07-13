import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import GM from "./views/GM.jsx";
import Player from "./views/Player.jsx";
import Display from "./views/Display.jsx";
import Tablet from "./views/Tablet.jsx";
import Compendium from "./views/Compendium.jsx";
import "./styles.css";

function Home() {
  return (
    <div className="home">
      <h1>Starfinder Companion</h1>
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
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/gm" element={<GM />} />
      <Route path="/player" element={<Player />} />
      <Route path="/tablet" element={<Tablet />} />
      <Route path="/display" element={<Display />} />
      <Route path="/compendium" element={<Compendium />} />
    </Routes>
  </BrowserRouter>
);
