# SIT Modules & Peripherals

## Module architecture

SIT is organized as independent modules. Each module owns:
- one backend route file (`backend/src/routes/<module>.js`) mounted at `/api/<module>`
- its own DB tables (or in-memory state if ephemeral)
- its WS event namespace: `<module>:<event>` (e.g. `token:moved`, `scene:mood`)
- frontend views/components that consume only its API + events

Current modules:

| Module | API | State | Purpose |
|---|---|---|---|
| characters | `/api/characters` | DB | Character sheets |
| battlemap | `/api/battlemap` | DB | Sessions, tokens, tracker input |
| scene | `/api/scene` | in-memory | Display channels (projector/tablet), mood, light nodes |
| content | `/api/content` | filesystem (SDF) | Read-only data packs from offline tools |

Adding a module = new route file + `app.use()` line + optional view. No
cross-module imports except `db.js` and `ws.js` (shared infrastructure).

## Display channels

Physical screens subscribe to a named channel via the scene module:

| Channel | Route | Modes |
|---|---|---|
| `projector` | `/display` | `battlemap` (live synced map) · `scenic` (media + caption) |
| `tablet` | `/tablet` | `idle` · `media` · `characters` (featured character cards) |

GM drives all channels from `/gm` (ScenePanel). Channel state is ephemeral
and broadcast over WS as `scene:channel`.

## ESP32 mood lights — integration spec

Design goal: firmware stays trivial — plain HTTP polling, no WS, no TLS.

### Node lifecycle
1. ESP32 boots, joins LAN Wi-Fi.
2. Every ~10 s: `POST http://<pi>:7600/api/scene/lights/register`
   ```json
   { "id": "esp32-01", "name": "Table strip" }
   ```
   (Keeps the node listed as online in the GM console.)
3. Every 1–2 s: `GET http://<pi>:7600/api/scene/lights/mood`
   ```json
   { "color": "#801515", "brightness": 200, "effect": "pulse", "name": "Combat" }
   ```
4. Firmware maps the response to its LEDs:
   - `color`: hex RGB target color
   - `brightness`: 0–255 master brightness
   - `effect`: `static` | `pulse` (slow sine) | `flicker` (random dips) | `storm` (blue-white flashes)

### Firmware notes
- HTTP client: `HTTPClient.h` (Arduino) or `esp_http_client` (IDF).
- Parse with ArduinoJson; payload < 128 bytes.
- Effects run locally between polls — the server only sets the target state,
  never streams frames.
- Adding new effects: extend the enum in `scene.js` MOOD state +
  `ScenePanel.jsx` presets + firmware switch-case. Unknown effects should
  fall back to `static` on-device.

### Future (optional)
- WS push to nodes for instant transitions (requires more firmware work).
- Per-node addressing (`/api/scene/lights/mood?id=esp32-01`) for zones —
  the registry already stores per-node identity, so this is backend-only work.
