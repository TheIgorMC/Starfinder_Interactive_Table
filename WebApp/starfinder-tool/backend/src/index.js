import express from "express";
import http from "node:http";
import { migrate } from "./db.js";
import { initWs } from "./ws.js";
import { attachUser } from "./auth.js";
import authRoutes from "./routes/auth.js";
import characters from "./routes/characters.js";
import battlemap from "./routes/battlemap.js";
import scene from "./routes/scene.js";
import content from "./routes/content.js";
import aon from "./routes/aon.js";
import settings from "./routes/settings.js";
import media from "./routes/media.js";
import campaign from "./routes/campaign.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(attachUser); // parses the session cookie into req.user; never blocks

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/characters", characters);
app.use("/api/battlemap", battlemap);
app.use("/api/scene", scene);
app.use("/api/content", content);
app.use("/api/aon", aon);
app.use("/api/settings", settings);
app.use("/api/media", media);
app.use("/api/campaign", campaign);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const server = http.createServer(app);
initWs(server);

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => server.listen(PORT, () => console.log(`sf-backend on :${PORT}`)))
  .catch((e) => {
    console.error("migration failed", e);
    process.exit(1);
  });
