# Starfinder Companion Tool — Iteration 1

## Deploy on Orange Pi (Dockge)

1. Clone the repo on the Pi (once): `git clone <repo-url> /mnt/data_ssd/repos/Starfinder_Interactive_Table`
2. Symlink this folder into Dockge's stacks root (Dockge doesn't scan nested subfolders):
   ```
   ln -s /mnt/data_ssd/repos/Starfinder_Interactive_Table/WebApp/starfinder-tool \
         /mnt/emmc/stacks/starfinder-tool
   ```
3. Create data dirs:
   ```
   sudo mkdir -p /mnt/data_ssd/nas_share/SIT/{db,uploads,aon-cache,content}
   ```
4. Copy `.env.example` → `.env` (inside `WebApp/starfinder-tool/`), set `DB_PASSWORD` **and `SESSION_SECRET`** (`openssl rand -hex 32`)
5. In Dockge: the stack appears automatically → Deploy
6. Create login accounts (see below) — nobody can use `/gm` or `/player` until you do
7. Open `http://<pi-ip>:7600`
8. To update: `git pull` in the repo, then redeploy the stack in Dockge

Note: `MapCreator/` elsewhere in the repo is a separate offline tool and is
not part of this stack — it doesn't run on the Pi.

## Accounts / login

`/gm` and `/player` (and `/compendium`) require signing in — there's no
self-registration UI, accounts are created via a CLI script run inside the
backend container:

```bash
# one GM account
docker compose exec backend node scripts/create-user.js gm alice "hunter2"

# one account per player — character gets linked automatically the first
# time they log in and create it (or pass an existing character id)
docker compose exec backend node scripts/create-user.js player bob "hunter2"
```

Rules: one GM account (sees/controls everything), one character per player
account (enforced server-side — a player can create exactly one character,
then it's permanently linked to their login). Re-running the script for an
existing username resets that user's password.

`/display` (projector) and `/tablet` (GM's mood board) are **not** behind
login — they're shared physical screens, not per-person devices, and only
show what the GM explicitly pushes to them (battle map, mood board, and a
GM-curated subset of character summaries — never full sheets or notes).

## Media library

Maps, mood-screen images, token art, character portraits, and music/SFX
(files or links — see "Music & SFX" below), uploaded from the GM console's
**Media Library** tab. Files land under the same `uploads/` volume already
mounted at `/app/uploads` (i.e.
`/mnt/data_ssd/nas_share/SIT/uploads/{map,mood,token,portrait,music,sfx}/`
on the Pi, subfolders created automatically on first upload to a category)
— no extra volume or setup needed. Uploaded images are served publicly
(no login) since the projector/tablet displaying them have none either;
nothing sensitive lives there.

## Campaign system

The GM console's **Campaign** tab is a small in-house wiki: events,
locations, NPCs ("People"), factions, quests, and objects, each with a
name/body (rendered as Markdown), an optional image (from the media
library, not required — plenty of lore entries are just text), and
relationships to other entries (e.g. "member of", "located in", "owned
by" — shown from both ends, added via a search-then-pick picker rather
than a flat dropdown). Every entry defaults to GM-only; a "visible to
players" checkbox reveals a specific one. Wrap GM-only asides anywhere in
an entry's body in `!!double bangs!!` — stripped automatically from
whatever a non-GM sees (the player view, the tablet, the API response
itself), so a secret can live inline in the same paragraph instead of a
separate hidden field.

Entries of the same type that reference each other with a recognized
hierarchy relation (e.g. "located in") nest into a real tree in the list
sidebar (`frontend/src/lib/campaignTree.js`), Goblin's-Notebook-style, with
natural-sort ordering and a manual drag-free reorder (▲▼ arrows, persisted
via `sort_order`) for anything that shouldn't sort alphabetically. A
**Find duplicates** tool catches near-identical entries (Unicode homoglyph/
diacritic folding included) for one-click merge or explicit dismissal.

**Importing from Goblin's Notebook**: Campaign → People can import a
`.tgn` export from Tangent/Goblin's Notebook — the app's internal name for
this format is still `tgn`/"Tangent" in code and comments, only the GM-
facing label changed. Imported NPCs land without a statblock; **"Convert
to character"** promotes one to a full stat sheet when needed, and **"+ New
passive NPC…"** (Characters tab) creates that lore-only kind directly,
alongside **"+ New NPC (statted)"** for a full stat block from scratch —
not every NPC needs one.

A **bulk portrait importer** (Media Library → Portraits) uploads many
images at once and proposes matches by filename against both statted
characters/NPCs (`characters.portrait_url`, the tablet's own art) and
lore-only People entries (`campaign_entries.image_id`, the Campaign
reader's picture) — two genuinely separate image slots, confirmed
per-file before applying. A related one-shot tool promotes any image link
already embedded in a People entry's body text into that entry's default
Campaign-reader image.

The **Characters** sub-tab covers both real PCs/statted NPCs (the
`characters` table, importable from Hephaistos below) and lore-only People
entries side by side, since both are "characters" from a GM's perspective;
a non-PC character can be deleted from here.

## Sessions

The GM console's **Sessions** tab plans and tracks individual game
sessions: a name, prep notes, and links to whichever Campaign entries and
media (maps, mood art, music/SFX tracks) are relevant to that session.
Media Library and the Campaign tab's "linked to session" filters both
read this to scope a busy campaign down to "what's relevant tonight."

## Music & SFX

Media Library's **Music** and **SFX** categories hold either an uploaded
audio file or a pasted link (YouTube, or a direct audio URL — Suno's own
share links can't be resolved without authentication, so record via
another tool and upload the file instead). Tracks get tags and a folder
(file-explorer-style sidebar, drag a track onto a folder or a tag chip
onto a track to file it), a loop toggle, and can be scoped to a specific
game session. A compact **now-playing control** sits in the GM topbar
itself (`frontend/src/lib/musicPlayer.jsx`'s `MusicPlayerProvider` +
`MiniPlayer`) so playback survives switching tabs — native `<audio>` for
files/direct links, an invisible mounted YouTube IFrame player for YouTube
links.

## Galaxy

One tool for the whole galaxy (the former standalone `GalaxyGen/` app was
merged in — see `Docs/10-galaxy-mapgen.md`):

- **Galaxy Editor** (GM console tab, or `/galaxy-editor` full screen, GM
  only) — the procedural generator/editor: sectors, density fields,
  systems, bodies, hyperlanes, factions, actors, organizations, ships,
  events, surface sites + city layouts, station/ship layouts. Same look as
  the viewer (it reuses its map and panels): MAP / SYSTEM / STATIONS
  workspaces, tool dock, a BUILD checklist for the pipeline. It edits the
  campaign's stored galaxy **in place** (`GET/PUT /api/galaxy/project`,
  manual save — SAVE button or Ctrl+S, no autosave — versioned: a save based on an older version is
  refused with a reload-or-overwrite choice instead of silently clobbering
  edits made elsewhere).
- **Galaxy Map** (`/galaxy`, any login; also a GM tab) — the Elite-style
  viewer: galaxy → system → planet → settlement, desktop and mobile
  (`frontend/src/galaxy/README.md`). Hidden districts never reach players.
- **Galaxy Data** tab — import/download a whole project file, and link
  galaxy entities to Campaign lore entries (`campaign_entries.galaxy_ref`,
  by hand or via the name-match **"Suggest links"** tool). The galaxy stays
  deliberately separate from the Campaign wiki: hundreds of systems and a
  thousand+ background actors should never all become lore entries.
- **MCP**: every generator/editing operation is also a `galaxy_*` tool on
  the SIT MCP server, executed by the backend on the same stored project.

The generators, settlement layout and MCP tool definitions live once in
`galaxy-core/` (no dependencies; imported by path from frontend via the
`@galaxy-core` vite alias, from backend and mcp-server by relative path).
Docker builds therefore use the stack root as build context.

## AI-driven management (MCP server)

`WebApp/starfinder-tool/mcp-server/` is a separate service exposing a
remote MCP server (Streamable HTTP + OAuth 2.1) so an AI client (primarily
a claude.ai custom connector) can read/edit campaign data, the Compendium
review workflow, characters, the mood tablet/projector and the galaxy
(`galaxy_*` tools), through the same backend REST API the web UI uses —
see its own README for the OAuth setup and available tools.

## Importing characters from Hephaistos

The GM console's Campaign → Characters tab can import a character JSON
exported from [Hephaistos](https://hephaistos.online), a popular SF1e
character builder — either upload the `.json` file or paste its contents.
Maps ability scores, HP/SP/RP, EAC/KAC, saves, BAB, initiative, speed,
skills (with ranks/ability/class-skill flag), feats, per-class spell slots
(known/per-day, all starting unused), full inventory (weapons/armor/
ammunition/gear with equip and stash state), credits, and conditions onto
our `characters` schema. Optionally assign the imported character directly
to an existing player account (skip this for NPCs, or when the player will
self-link it by logging in first).

## On "automatic" rule effects

The Compendium now surfaces a **structured mechanics** categorization
alongside the full rules text — targets/range/area/duration/saving
throw/requirements parsed out of the scraped fields into typed data (e.g.
Magic Missile's target count, its "no two more than 15 ft. apart"
constraint) — see `Docs/04-data-pipeline-aon.md` → "Structured mechanics"
and `backend/src/mechanics-schema.js`/`mechanics-parser.js`. This is the
categorization layer a character engine would read from.

It still does not **auto-apply** anything to a character sheet — e.g.
taking a feat with a skill bonus doesn't move the character's numbers on
its own, and the AoN-scraper parser only structures already-labeled scalar
fields (Range, Duration, Prerequisites, ...), not free-form Benefit/
Description prose. Reliably turning arbitrary rules prose into modifiers is
still a hard, open-ended problem for entries sourced that way.

For entries imported from Foundry instead (see "Foundry import" in
`Docs/04-data-pipeline-aon.md` — 8,921 entries across 26 categories: feats,
spells, races, classes, archetypes, themes, every class/racial/archetype/
theme feature, conditions, effects, and the full equipment family), the gap
is narrower: each one carries a real `mechanics.modifiers` array of
hand-designed, formula-capable bonuses (e.g. Deadly Aim's `-2` to attack
rolls, `max(1, floor(@attributes.baseAttackBonus.value/2))` to damage) —
actually evaluating those formulas against a character's attributes and
applying them live is still not built, but the structured data to do it
with, and a full glossary of the `@`-path/`effectType`/bonus-`type`
conventions those formulas use, now exists (see "The Modifiers system" in
`Docs/04-data-pipeline-aon.md`). `03-features-scope.md` still defers
"automated rules enforcement" past v1: state is tracked manually for now.
The `feats` JSONB column already exists on `characters` for storing which
feats a character has taken, but there's currently no UI to attach a
Compendium entry to a character — that's the natural next step if you want
manual-but-convenient tracking (effect text visible on the sheet) short of
full automation.

## Device roles

`/` is an **app launcher**: players pick an app (Character, Galaxy Map,
Compendium) and each app has a slim bar to switch or go back; the GM gets
everything as tabs in the GM console plus the full-screen/device views as
tiles. The list is one registry, `frontend/src/apps.jsx`.

| Route | Device |
|---|---|
| `/` | Any — app launcher (tiles depend on role; shared displays always listed). |
| `/galaxy` | Any device — galaxy viewer (map → system → planet → settlement), desktop + mobile layouts. **Any login required.** |
| `/fantasy` | Any device — Fantasy Atlas: medieval region maps. A separate public feature reached **only by direct link** (not in the launcher or the GM console): anyone sees a public map read-only, without login; the logged-in GM generates and edits. |
| `/galaxy-editor` | GM PC — Galaxy Editor full screen (also a GM-console tab). **GM login required.** |
| `/gm` | PC — GM console + "Connect tracker" button (Web Serial, Chrome/Edge). **GM login required.** |
| `/player` | Player tablet / mobile — character sheet, scoped to the logged-in player's own character. **Player login required.** |
| `/tablet` | GM tablet — mood board (scenario art, featured characters), driven from `/gm`. No login (shared screen). |
| `/display` | Projector — fullscreen read-only battle map, auto-follows the latest active session. No login (shared screen). |
| `/compendium` | Any device — searchable rules lookup (feats/spells/races/classes) over `/api/aon`, filterable by category and source book. **Any login required** (GM or player). |
| `/review` | GM only — hand-validate/correct `aon_entries` against the AoN source (see `Docs/04-data-pipeline-aon.md`). **GM login required.** |

## Mini tracker protocol (placeholder)

`/gm` reads the PCB over Web Serial at 115200 baud, expecting ASCII lines:

```
POS,<tracker_id>,<x>,<y>\n
```

Adjust the regex/parsing in `frontend/src/views/GM.jsx` (`useMiniTracker`)
when firmware protocol is finalized. Bind a physical mini to a token by
setting the token's *Tracker ID* when adding it. Coordinates are POSTed to
`/api/battlemap/tracker/position` and broadcast to all clients over WS.

## Local dev (no Docker)

```
# terminal 1 — needs a local Postgres, or: docker run -e POSTGRES_PASSWORD=sf -e POSTGRES_USER=sf -e POSTGRES_DB=sf -p 5432:5432 postgres:16-alpine
cd backend && DATABASE_URL=postgres://sf:sf@localhost:5432/sf SESSION_SECRET=dev-only npm run dev
node scripts/create-user.js gm gm gmpass   # then log in with gm/gmpass

# terminal 2
cd frontend && npm install && npm run dev   # Vite proxies /api and /ws to :3000
```

## Iteration 1 status (vs roadmap doc, historical)

- [x] Compose stack (backend, frontend, db) with SSD volume mapping
- [x] Express REST scaffold + WS broadcast
- [x] Postgres + migration runner
- [x] React routes `/gm` `/player` `/display` with live WS sync
- [x] Battle map grid, token add/move (click-to-move), projector auto-sync
- [x] Web Serial tracker hook + `/tracker/position` endpoint
- [x] Full character sheet — abilities/pools/defenses, skills (ranks/ability/class-skill), feats (benefit text), spells (per-class slots with cast/rest tracking), inventory (equip/stash toggles, live bulk total), equipped weapons with linked-ammo fire/reload, standalone ammo tracking, conditions checklist, notes; shared by the player's own sheet and the GM's read/write view from Campaign → Characters (`frontend/src/components/CharacterSheet.jsx`, `frontend/src/views/Player.jsx`, `008_character_sheet.sql`)
- [x] Scene module: projector/tablet channels, mood presets, ESP32 light node registry
- [x] Content module: serves SDF data packs (see docs/06-data-format-sdf.md)
- [x] AoN scraper + validator + importer, with per-entry source book/page and full rules text (`backend/scripts/`, Feats + Spells + Races + Classes; see docs/04-data-pipeline-aon.md)
- [x] `/api/aon` search endpoint — filter by category, source book (single or a set), name (`backend/src/routes/aon.js`)
- [x] `/api/settings` generic key/value store, used for the GM's "owned sourcebooks" config (`backend/src/routes/settings.js`, `003_settings.sql`)
- [x] Compendium view (`/compendium`): sectioned, sortable, filterable tables (Spells / Weapons / Armor & Shields / Ammunition / Feats / Class-Racial-Theme Features / Gear & Items / Races-Classes-Archetypes / Conditions & Effects / Rules / Setting & Lore / Random Tables) — click a column header to sort, click a row to expand its full rules text and mechanics inline, per-section facet filters (weapon type, melee/ranged, armor weight, spell school/level, rules chapter, ...), defaults to GM's owned sources (`frontend/src/views/Compendium.jsx`); Rules/Setting/Random Tables cover the core rulebook's reference glossary and Pact Worlds lore (see `Docs/04-data-pipeline-aon.md` → "Journal/table-shaped content") — not tested live end-to-end this session (no local Postgres available), verified via the importer's output + a clean frontend build only
- [x] GM "Owned sourcebooks" panel — sets the Compendium's default source filter (`frontend/src/components/SourcesConfig.jsx`)
- [x] Login system: one GM account + one account per player (auto-linked to their character), signed session cookies, server-side ownership checks on every character/battlemap/settings route (`backend/src/auth.js`, `004_users.sql`, `scripts/create-user.js`)
- [x] GM console restructured into tabs — Battle Map / Scene & Mood / Media Library / Campaign / Sources (`frontend/src/views/GM.jsx`; since expanded further, see "Since Iteration 1" below)
- [x] Media library: upload/browse/delete maps, mood-screen images, token art, character portraits (`backend/src/routes/media.js`, `frontend/src/components/MediaLibrary.jsx`); wired into map images, token art (rendered on the battle map), and character portraits
- [x] Campaign system: typed entries (events/locations/NPCs/factions/objects) with relationships between them, GM-only by default with a per-entry "visible to players" flag (`backend/src/routes/campaign.js`, `006_campaign.sql`, `frontend/src/components/Campaign.jsx`)
- [x] Hephaistos character import: GM can import a character JSON export from hephaistos.online, optionally assigning it straight to a player account (`backend/src/hephaistos.js`, `POST /api/characters/import/hephaistos`)
- [x] Structured mechanics categorization: targets/range/area/duration/saving throw/requirements parsed from scraped fields into typed data, shown in the Compendium (`backend/src/mechanics-schema.js`, `mechanics-parser.js`, `007_aon_mechanics.sql`; see docs/04-data-pipeline-aon.md)
- [x] Foundry import: 8,921 entries across 26 categories (feats, spells, races, classes, archetypes, themes, every class/racial/archetype/theme feature, conditions, effects, full equipment family) imported from a local FoundryVTT Starfinder system checkout instead of scraping — higher-fidelity range/duration/save/damage/armor-AC and a real `modifiers` array of pre-designed, formula-capable bonuses (`backend/src/foundry-import.js`, `scripts/import-foundry.js`; full field reference in docs/04-data-pipeline-aon.md)
- [ ] ESP32 firmware (spec in docs/07-modules-and-peripherals.md)
- [ ] Automatic rule effects (e.g. a feat's numeric bonus auto-applying to a character) — categorization exists, application to a character sheet doesn't yet, see note below

## Since Iteration 1

Everything below landed after the checklist above, roughly in order.
Sections higher up in this README already describe the current shape of
each — this is the changelog-style summary, kept short since the doc
sections do the explaining.

- [x] GM console grew three more tabs — **Characters** (PCs/statted NPCs
  split out of Campaign into their own view), **Sessions** (session
  planning, linked entries/media), and **Galaxy** (see below) —
  Battle Map / Scene & Mood / Media Library / Campaign / Galaxy /
  Characters / Sessions / Sources is the current tab set
  (`frontend/src/views/GM.jsx`)
- [x] Session planning module: name/notes plus linked Campaign entries and
  media per session, used to scope Media Library and Campaign's "this
  session" filters (`backend/src/routes/sessions.js`, `009_game_sessions.sql`,
  `frontend/src/components/Sessions.jsx`)
- [x] Data Review tool (`/review`, GM only): hand-validate/correct
  `aon_entries` against the AoN source, propose Compendium matches when
  reviewing a Hephaistos import (`backend/src/routes/review.js`,
  `010_aon_review.sql`, `frontend/src/views/ReviewTool.jsx`)
- [x] Campaign wiki, expanded: hierarchy tree with natural sort + manual
  reorder, search-based Related Entries linking (replacing a flat
  dropdown), cross-type duplicate detection/merge (with homoglyph/
  diacritic folding), Markdown rendering (incl. GFM tables) in entry
  bodies, `!!GM-only asides!!` stripped from any non-GM view, Goblin's
  Notebook (`.tgn`) import with "Convert to character" for statblock-less
  imports, passive NPC creation, non-PC character deletion, a bulk
  portrait importer matching both statted characters and lore-only People
  entries, and a tool promoting an entry's embedded image link into its
  default Campaign-reader image (`frontend/src/lib/campaignTree.js`,
  `frontend/src/components/Campaign.jsx`,
  `frontend/src/components/Characters.jsx`, `backend/src/tgn-import.js`,
  `backend/src/gm-notes.js`,
  `011_campaign_tgn_import.sql`, `012_character_lore_link.sql`,
  `013_drop_campaign_summary.sql`, `014_duplicate_dismissals.sql`,
  `019_campaign_sort_order.sql`)
- [x] Music & SFX library: uploaded files or pasted links (YouTube/direct),
  tags, folders (file-explorer-style sidebar with drag-and-drop), loop
  toggle, session scoping, and a persistent topbar "now playing" control
  that survives tab switches (`backend/src/routes/media.js`,
  `frontend/src/lib/musicPlayer.jsx`, `frontend/src/lib/youtube.js`,
  `frontend/src/components/MediaLibrary.jsx`, `015_music.sql`,
  `018_music_tags_folders.sql`)
- [x] Character sheet fixes: corrected ammo pack +/− semantics (magazine
  vs. reserve, not "pack is the magazine"), auto-delete on full depletion,
  Spells tab hidden for non-casters
  (`frontend/src/components/CharacterSheet.jsx`)
- [x] Galaxy tab: import a `GalaxyGen/`-generated project wholesale, link
  individual systems/factions/actors to Campaign lore entries via
  `campaign_entries.galaxy_ref` (by hand or via a bulk name-match
  suggester), a pan/zoom Map view rendering the imported sectors/
  hyperlanes/systems, and download-back-out for local mass-editing
  (`backend/src/routes/galaxy.js`, `frontend/src/components/Galaxy.jsx`,
  `020_galaxy_import.sql`; see "Galaxy" above and `Docs/10-galaxy-mapgen.md`)
- [x] Remote MCP server (`mcp-server/`): OAuth 2.1 + Streamable HTTP, lets
  an AI client manage campaign data, the Data Review workflow, characters,
  and the mood tablet/projector through the same backend REST API
  (`mcp-server/src/`, own README, own OAuth token tables)
- [x] Galaxy unified into SIT: GalaxyGen's editor as a GM tab editing the
  stored project in place (versioned saves), shared `galaxy-core/`, galaxy
  MCP tools on the SIT MCP server, galaxy viewer for everyone, app launcher
  navigation, ARTS look app-wide (`021_galaxy_edit_in_place.sql`,
  `frontend/src/galaxy-editor/`, `frontend/src/apps.jsx`)
