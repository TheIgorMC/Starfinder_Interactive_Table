# Galaxy MapGen

Procedural galaxy/star-system/hyperlane generator for the Starfinder
Companion Tool (`../WebApp/starfinder-tool`). See
`../Docs/10-galaxy-mapgen.md` for the full design doc (data model,
generation pipeline, brush/faction/sector system, export schemas, delivery
roadmap) — this app is being built phase by phase against that doc.

Runs on a workstation — not part of the Orange Pi deployment, not included
in the Dockge stack. Stack decisions are independent of `../MapCreator`
(whose own future is undecided). Exports content following
`../Docs/06-data-format-sdf.md`.

## Status: Phase 6 underway (client-side AI integration), plus planet/body generation delivered out of order (§13 of the design doc)

**Phase 1** — canvas, density fields, sectors:
- Pan/zoom 2D canvas over the galaxy bounds
- Sector polygon drawing tool (click to place vertices, name + assign a
  focus tag, delete)
- Brush tool painting the five density fields (population, export, import,
  hyperlane density, Dominion security) onto a 128×128 grid per field,
  rendered as a heatmap; optional "constrain to selected sector"
- Autosave to browser `localStorage`, plus explicit Save/Load of a project
  `.json` file

**Phase 2 (system & hyperlane generation, done)**:
- Variable-density Poisson-disc placement of systems inside sector
  polygons only, weighted by the painted population field (denser →
  tighter spacing) — GM-tunable min/max spacing
- Per-system detail rolls: star type, population band (also decides
  station-only vs. colonized), and export/import goods biased by the
  sector's focus tag (e.g. `mining` → ore/metals; `administrative` →
  diplomatic delegations, flagged high-security-transit, since it trades
  in people, not cargo)
- Hyperlane graph: Delaunay triangulation over system positions, pruned to
  a Gabriel graph for a natural look, with pruned edges added back in
  areas where the painted Hyperlane density field is high, and a
  connectivity guarantee (single connected component) as a safety net
- Click a system (Select tool) to inspect it in the sidebar, including its
  connected hyperlanes
- "Export SDF" now writes both `sectors/` and `systems/` entry trees

**Phase 3 (factions, control, security, war-chance, done)**:
- Faction tool: click to drop a control seed, name it, pick a color, set a
  government flavor tag, and roll aggression/strength — GM-authored major
  powers
- Control-field resolution (§4): a weighted-Voronoi-style contest where
  every faction's influence peaks at 1 at its own seed and falls off with
  distance at a rate set by its strength (bigger strength = bigger
  territory, not a stronger claim at the core). A system is owned only
  where one faction clears ~85% share; anywhere else with meaningful
  presence is contested, not owned; nothing meaningful present falls back
  to plain Dominion territory
- Border-fragmentation auto-seed pass: fully automatic, no per-faction
  approval — finds contiguous colonized regions where no authored faction
  clears a 50% share and scatters small local factions across each region
  (roughly one per ~900 uncovered grid cells, spread out via farthest-point
  sampling so a single huge gap gets several minors, not one giant "minor"
  faction swallowing the whole thing), tagged "(auto)" in the list
- Dual security + war-chance (§4): faction security derives from how
  solidly the locally dominant faction holds a point and how strong it is
  overall; `war_chance` combines the two top contesting factions'
  aggression (average + differential, so two calm factions abutting stays
  calm) against combined Dominion + faction security (well-secured points
  stay stable even between aggressive neighbors)
- Territory overlay (Layers toggle) — a soft, per-faction-colored heatmap
  read of the live control contest, plus a dashed amber ring on any
  contested system right on the map
- Click a faction seed (Select tool) to inspect/tune its aggression and
  strength inline, or delete it
- "Export SDF" now also writes a `factions/` entry tree
- System names are now editable inline in the inspector (slug stays fixed,
  so hyperlane/control references elsewhere never go stale) — lets a GM
  hand-curate any generated system without full manual placement tooling
- A "Show field heatmap" toggle (Field section) hides the density-field
  overlay so the map underneath — sectors, systems, hyperlanes, faction
  territory — reads cleanly without the paint layer in the way
- Faction seeds can anchor directly to a system: click near an existing
  system with the Faction tool (violet ring) instead of open ground. An
  anchored faction holds that one system outright — `control.owner` is
  forced to that faction, no external contest, regardless of how strong a
  rival seed sits nearby — matching a deliberately-placed capital rather
  than just "closest/strongest seed wins the point" (§4). Un-anchored
  automatically if its home system is ever removed (sector deletion or a
  full system regen)
- Systems carry an `important` value (0–1, slider in the inspector, "Mark
  as landmark" sets it straight to 1.0): the zoom level needed to reveal a
  system's name label scales down with importance, so a 1.0 landmark
  always shows its label, a 0.0 system needs several times the initial
  zoom-to-fit view before it appears, and everything between graduates
  smoothly — keeps a big galaxy from turning into a wall of overlapping
  names at the default view while still giving higher-importance systems
  priority as you zoom in. The threshold scales off the actual fit-to-
  bounds zoom rather than a fixed number, so it holds regardless of galaxy
  size or window size. System dots are small to begin with, and dim
  further once their label is showing (unless selected) so the name reads
  cleanly instead of competing with a bright dot underneath it. System
  generation also rolls a realistic importance
  value per system automatically (mostly low, occasional standouts, biased
  up slightly by population band), with a spatial pass that dampens a
  system's roll near an already-important neighbor so landmarks don't
  cluster next to each other
- Systems can be **locked** (checkbox in the inspector — renaming or
  tuning importance sets it automatically): a locked system's position,
  name, and every other field survive a future "Generate systems" regen
  untouched, and any hyperlane or faction anchor pointing at it survives
  too, since its id/slug never change. Regeneration only replaces unlocked
  systems and places new ones in the gaps around locked ones — hand
  curation is no longer wiped out by every regen

**Phase 4 (notable actors & organizations, curated + background, done)**:
- Actors (§6): notable people/groups that never hold territory but matter
  for future event targeting — a governor, a pirate captain, a
  corporation's local rep. Created via a form (name, individual/group,
  role flavor tag, location anchored to an existing system, affiliation,
  mobile flag, influence) — no canvas placement tool, since an actor's
  "position" is just whatever system it's based at
- Organizations (§6.2): non-territorial parties/guilds/movements — name,
  ideology tag, a required parent faction (or Dominion) whose sphere they
  operate within, an optional home system or sector (or neither, for a
  galaxy-spanning movement), and local influence. No control field, no
  aggression — they never enter the Faction contest (§4)
- An actor's `affiliation` points at either `faction:<slug>` or
  `party:<slug>` (or neither) — this is the single source of truth for
  membership; an organization's member list is always derived by scanning
  actors for it, so the two can never drift out of sync
- Placing/relocating an actor onto a system locks that system too (same
  "hand-curation protects it from regen" rule as renaming), and deleting a
  faction/organization gracefully falls back any actor's affiliation or
  organization's parent-faction reference rather than leaving it dangling
- A small green dot marks any system with 1+ actors on the map itself; the
  system inspector lists who's there. It's full-weight/bright if any
  curated (`authored`) actor is there, dimmed/smaller if only background
  (`generated`) presence exists, per §3 stage 10
- "Export SDF" now also writes `actors/` and `organizations/` entry trees
- **Background actors (§6.1, the follow-up slice)**: a "Generate background
  actors" pass in the toolbar auto-seeds cheap, procedurally-named
  `origin: "generated"` actors — density scales with **both** a system's
  population band (more populous → more officials/merchants/functionaries)
  and any faction contest there (the system's owner, plus every faction
  with a meaningful contested share, each gets its own local rep on top of
  the population-driven baseline). Fully automatic, no per-actor review.
  Re-running it rerolls every background actor from scratch but never
  touches curated (`authored`) ones — the sidebar's Actors list keeps
  curated actors visible and collapses background ones behind a "Show N
  background actors" toggle so a populated galaxy's curated content isn't
  buried

**Navigation & phase cleanup pass**:
- The sidebar is now tabbed (Sectors / Factions / Actors / Organizations)
  instead of one long scroll — selecting something on the canvas, or
  starting to draw/place one, jumps to the right tab automatically.
- Field heatmap and faction territory overlays now default **off** — a
  fresh project shows the plain map; color is opt-in via the Layers/Field
  checkboxes, not the default view.
- Faction cards now have editable **relationships** (per-other-faction
  slider, -1 to 1, §9) and **tolerated crimes** (free-text tag list) —
  previously data-shape-only fields with no UI.
- Actor cards now have editable **reputation** (per-faction slider, -1 to
  1, mirrors faction relationships) — same previous gap.
- A faction anchored to a home system can now be **un-anchored** via a
  button on its card, without deleting and recreating it.
- An organization's home system/sector are now mutually exclusive in the
  UI — setting one clears the other, matching the design doc's
  one-or-the-other-or-neither framing.
- New **System tool**: click inside a drawn sector to hand-place a single
  new system there (rolled from the painted fields at that point, locked
  immediately) — §3 stage 4's other half, previously only reachable by
  locking/renaming an already-generated system.
- New **Hyperlane tool**: click two systems to toggle a direct edge
  between them, independent of a full "Generate hyperlanes" regen.
- `Docs/11-AI-integration.md` §6 now specifies the exact
  `query_galaxy`/`create_actor`/`create_organization`/`apply_event`/
  `project_timestep` request/response shapes and the closed effect-op
  vocabulary, matched field-for-field against the current SDF export —
  nothing implemented yet, but Phase 6 has a frozen contract to build
  against instead of re-deriving it from the design doc each time.
- **First real slice of that contract is implemented**: `query_galaxy`'s
  compact `"index"` mode (`GalaxyGen/src/lib/aiIndex.js`) — a per-entity
  `{ ref, name, tags, summary, stats }` row for every sector/system/
  faction/actor/organization, small enough to hand an LLM the whole
  galaxy's shape at once for the broad/coherence pass (§9.3) before it
  drills into anything specific. "Export SDF" now writes it to
  `index.json` automatically; a standalone **Download AI index** button
  (toolbar) grabs just that file to paste into any LLM chat today, no
  backend required.

**Phase 5 (manual event log & effect engine, no AI yet, done)**:
- New **Events** tab: an event-authoring form (name, summary, tags,
  in-fiction timestamp, elapsed timestep, magnitude, scope, one or more
  effects, free-text narrative) plus a chronological, append-only
  **Journal** of everything committed so far, each entry expandable to see
  exactly what it changed.
- A closed **effect vocabulary** (`GalaxyGen/src/lib/effectEngine.js`),
  matching §9/§9.2 and `Docs/11-AI-integration.md` §6.5 exactly: `adjust_control`,
  `set_owner`, `set_system_status`, `adjust_security`, `adjust_relationship`,
  `adjust_aggression`, `adjust_focus`, `adjust_influence`, `set_affiliation`,
  `relocate`, `set_status`, `adjust_reputation`, `add_tag`, `remove_tag` —
  nothing outside this list can be expressed as an effect.
- **Magnitude envelopes**: every numeric effect's delta is clamped to a
  per-op, per-magnitude ceiling (`minor` caps small, `historic` allows the
  full range) before it's applied — a GM can propose whatever number they
  want, the engine enforces the actual ceiling.
- **Ownership-flip gate** (§9.2): `set_owner` requires *both* the normal
  envelope *and* a separate fixed minimum control-shift (0.15 by default)
  — verified live: a 0.10 shift under `major` magnitude is rejected with an
  explicit error, a 0.5 shift succeeds and flips the system outright.
- **Review gate** (§9 pipeline step 3): `minor` events commit immediately;
  `moderate`/`major`/`historic` events require a successful **Preview**
  (showing the exact diff) before **Confirm commit** unlocks.
- **Cascading `set_system_status`**: marking a system `destroyed`/
  `quarantined` severs every hyperlane edge touching it (both ends) and
  re-derives control/security/war-chance for every former neighbor against
  the live faction set — verified live end-to-end.
- Adjust-control/set-owner effects work as a hand-tunable *second layer* on
  top of the geometric control contest, reusing the exact same ownership-
  threshold/security/war-chance formulas `resolveFactions` uses (now
  exported from `factionGen.js`), the same precedent as home-system
  anchoring already overriding the geometric result outright.
- Every entity type (system/faction/actor/organization) now has a stored
  `extraTags` array so the generic `add_tag`/`remove_tag` ops have
  somewhere to write — systems additionally got a stored `status` field
  (`active | destroyed | quarantined | uninhabitable`).
- "Export SDF" now also writes an `events/` entry tree; deleting a journal
  entry only removes it from the log, it does not revert its effects
  (there's no replay/undo engine yet — see known simplifications).

**Phase 6 (AI integration, underway)**:
- New **AI** tab, styled as a chat window (scrolling message history,
  Enter-to-send input, collapsible settings) — type a plain-language
  request, and it runs the full §9.3 two-pass loop as an evolving
  assistant message: Pass 1 shortlists relevant entities from the compact
  index, Pass 2 gets those entities' full records plus recent event
  history and proposes exactly one tool call (`create_actor`,
  `create_organization`, or `apply_event`), rendered as a proposal card in
  the thread — against **any OpenAI-compatible `/chat/completions`
  endpoint** (a local Ollama server, or a cloud provider), called directly
  from the browser via `fetch`. There is no separate backend — GalaxyGen
  is both the "Application Host" crafting prompts and the caller of the
  inference endpoint.
- **No new write path**: an accepted proposal is converted (typed refs →
  the exact bare-slug/field shapes the app already uses internally) and
  handed to the *same* `handleCreateActor`/`handleCreateOrganization`/
  `handleCommitEvent` functions the manual forms call. An AI proposal gets
  no special privileges — `apply_event` proposals go through the identical
  effect-engine validation, magnitude clamping, and ownership-flip gate a
  hand-typed event does, with the same Preview-then-Confirm review step.
- `query_galaxy`'s missing **"full" mode** is now implemented
  (`GalaxyGen/src/lib/aiQuery.js`) — resolves Pass 1's shortlisted typed
  refs into the exact SDF entry shape "Export SDF" writes, plus recent
  event slugs touching that scope, with zero duplicated logic from
  `persistence.js`.
- AI settings (API base URL, key, model) live in their own `localStorage`
  key, deliberately never part of `project` — they're a machine-local
  credential/config, not galaxy data, so they can never leak into a saved
  project file or SDF export.
- Verified end-to-end with a mocked chat-completions endpoint: Pass 1 →
  Pass 2 → diff preview → commit for both a `create_actor` and an
  `apply_event` proposal, plus malformed-JSON and network-failure error
  paths.
- **Fixed against real-world testing** (a real galaxy against a real local
  Qwen3 8B/Ollama setup, not just mocks): Pass 1 now bounds the compact
  index to a character budget with lexical pre-filtering instead of
  dumping the whole galaxy (was blowing a 45k-token prompt past a 4k
  context and silently truncating before the model saw the request at
  all); Pass 1 falls back to parsing refs out of free text when a model
  ignores a forced tool call (confirmed happening with this real setup);
  and Pass 2 now sends every entity as an explicit `ref => entry` pair
  instead of just the entry — the entry alone carries no ref/slug field,
  so the model had to *derive* one from the entity's name, which silently
  breaks for any renamed system (renaming intentionally keeps the
  original slug). All three confirmed fixed against the exact scenario
  that surfaced them.
- **`adjust_control`/`adjust_security` confusion, confirmed live**: asked
  to "increase X's control over system Y," a real response picked
  `adjust_security` (Dominion security/crime level) instead of
  `adjust_control` (territorial ownership share, §4) — different fields
  entirely, and since security was already maxed the diff correctly
  rendered as a no-op, which was at least a visible tell. The
  `apply_event` tool schema now carries an explicit one-line-per-op
  cheat-sheet distinguishing every effect (not just those two) instead of
  only pointing at this doc's §6.5 table, which no model actually reads.
  A prompt-quality improvement, not a guarantee — always check a
  proposal's diff for a plausible before/after before confirming.
- **Pass 2 ignoring `auto` tool_choice, confirmed live**: asked to add an
  actor, a real response wrote a plain-text JSON object shaped like an
  exported SDF entity record (`{"type":"actor","name":...,"data":{...}}`)
  instead of actually calling `create_actor` — Pass 2 uses `auto` tool
  choice (unlike Pass 1's forced `shortlist`), so nothing stopped the
  model from answering in free text. `runPass2` now has the same kind of
  fallback Pass 1 already had: on no tool call, it scans the response text
  for a JSON object and, if its shape looks like an actor/organization/
  event record, remaps it into the matching tool call's argument shape.
  Verified against the exact response text that surfaced this. Best
  effort, same caveat as Pass 1's fallback — a model that answers in an
  unrecognized shape still fails outright.
- **Bare names in ref fields**: that same reconstructed proposal had
  `location: "Banelor"` instead of `system:banelor` — a display name, not
  a typed ref, which nothing downstream would ever match against a real
  system. Since `fullContext.entities` already pairs every shortlisted
  entity's name with its real ref, `runPass2` now resolves any bare name
  in a ref-shaped field (`affiliation`, `location`, `parent_faction`,
  `home_system`, `home_sector`, and every `apply_event` effect's
  `target`/`faction`/`a`/`b`/`actor`) against that list before returning —
  applied to every proposal, not just fallback-parsed ones, since nothing
  stops a real tool call from doing the same thing. An already-valid typed
  ref passes through unchanged; a name matching nothing in the shortlist
  is left as-is so the existing "no longer exists" UI still catches it.
- **Refs vs. names in the AI tab**: every ref shown to the GM ("Considered:
  ...", an `apply_event` diff's target, `create_actor`'s affiliation/
  location, `create_organization`'s parent faction) used to render as a
  bare typed ref like `system:kreel-1`. Fine until a system's been renamed
  — a system's slug intentionally never changes on rename (App.jsx, so
  hyperlane/control references never go stale), so a renamed system's ref
  stops resembling its current name at all, and a galaxy with several
  manually-renamed systems made every AI proposal read like a wall of
  meaningless slugs. Rather than churn every stored reference (including
  past events' scope/effects, which would silently rewrite history) on
  every rename, the AI panel now resolves each ref's *current* display
  name live wherever it renders one, so "system:kreel-1" shows as "Vraxis
  (system:kreel-1)" without the underlying ref ever changing. Verified the
  resolver (`resolveEntity` from `aiQuery.js`, already used by Pass 2)
  against a renamed system: correctly returns the live name from the ref.
- **Crashed on first real proposal, confirmed live**: the ref-name display
  above initially crashed the whole AI tab (`Function components cannot
  have string refs`) the moment a proposal with an affiliation/location
  showed up — the label component's prop was named `ref`, which React
  reserves for its own ref-forwarding and never actually passes through to
  a plain function component's props. Renamed the prop (`refId`) and
  reproduced the exact crashing scenario (a `create_actor` proposal with a
  faction affiliation) against a live mocked proposal to confirm the fix:
  renders `Aria Valeran — individual, senator, affiliated with Gammon
  Family (faction:gammon-family)` with no console errors, confirm-and-
  commit included.

**Name variety**: background-actor names were colliding constantly at
real scale (confirmed live: "Sonya Ombric 2," "Mira Herrick 3" — the
old 24×20 first/last pool only had 480 combinations). `names.js`'s pools
are now ~3x bigger (70 first names, 70 last names, 71 system-name roots,
36 place words, 30 faction suffixes) plus occasional hyphenated compound
names (first or last, ~6-10% of the time) for further variety without
hand-writing hundreds more words. Verified: 2000 generated actor names
and 2000 generated system names, zero collisions in both (the old pool
would have been almost entirely numbered fallbacks by that volume).

**Phase 7 (planet/body generation, done — delivered out of §13's original
order, straight off a GM request rather than waiting on Phase 6/7 first)**:
- First cut just rolled a body's kind/habitability/resources independent
  of any physical placement. A follow-up GM request — an Elite-Dangerous-
  style orrery view, plus "reasonable" planets (habitable strip, sizes,
  orbits) — meant that model couldn't just be extended, it had to be
  rebuilt on real orbital mechanics:
  - Every star type (`GalaxyGen/src/lib/starTypes.js`) now carries real
    astrophysical parameters (luminosity/mass in solar units, temperature,
    a render color), and a system's **habitable zone** and **frost line**
    are derived from that luminosity via the standard conservative sqrt(L)
    scaling — a K-type orange star's HZ sits close in, an O-type blue
    giant's sits absurdly far out, a neutron star remnant gets forced
    zero-HZ, every body irradiated and uncolonizable outright.
  - Bodies get an actual **orbital distance** (`orbitAU`, geometric
    progression outward from the star), and **a body's kind is chosen by
    where that orbit falls** — rocky/scorched close in, terrestrial
    candidates only inside the habitable zone, ice/gas/belts beyond the
    frost line. **Habitability is now gated on position** — only a body
    actually in the habitable zone can roll habitable, fixing the original
    model's fully independent roll (which could place a "habitable" world
    right next to the star).
  - **Moons attach to their planet, not the star** (`parent: <primary
    slug>`, no orbit of their own) — gas giants get more moon slots than
    rocky worlds. **Stations only attach to a body that's actually
    colonized or being worked for resources**, never floating at a
    purposeless random orbit.
  - Sizes come from per-kind size classes with realistic-order-of-
    magnitude radii (a "Jupiter-class gas giant" rolls 50,000-75,000 km;
    a "small rocky world" rolls 3,200-5,800 km), and **orbital period is
    genuinely computed from Kepler's third law**, not flavor text.
  - Deterministic per system (seeded off `${project.seed}:bodies:<slug>`,
    independent of every other system's rolls) — verified across every
    star type × every population band × 30 trials each: zero bodies with
    a bad moon/station parent, zero habitable bodies outside their star's
    habitable zone, zero NaNs, byte-identical output on a reroll of the
    same seed.
- An **orrery view** (`GalaxyGen/src/components/OrreryView.jsx`) replaced
  the plain text list in the system inspector's Bodies section: the star
  at center, the habitable zone as a shaded band and the frost line as a
  dashed ring (the exact numbers bodies were placed with), primaries on
  their real orbit ring (log-scaled — one system's AU range can span three
  orders of magnitude), moons/stations fanned next to their parent. Click
  a body for its detail (kind, size, radius, orbit, period, habitability,
  resources, colonization status). Verified live: generated a real
  53-system galaxy through the actual UI, inspected multiple systems
  across different star types, clicked both a primary and an attached
  station and confirmed the detail panel updated correctly, no console
  errors. (One snag caught along the way, not a regression from this
  change: `window.confirm()` dialogs — used by "Generate systems" and a
  few other regen actions to warn before replacing unlocked entities — are
  silently dismissed in this sandboxed browser tooling, which made
  regeneration look like a no-op until traced to the confirm; unrelated to
  GalaxyGen itself, just a testing-environment quirk worth remembering.)
- Colonization still resolves to `colonized` (population capped at the
  parent system's own band), `extraction` (resource-rich, automated/
  minimal-crew), or `untouched` — unchanged from the first cut. A body
  still has no typed ref of its own and isn't addressable by the AI
  event-effect surface (§9); `persistence.js`'s `systemToEntry` exports
  the full new field set (`orbit_au`, `orbit_period_days`, `size_class`,
  `radius_km`, `parent`, etc.) as a leaf list on the parent system's SDF
  entry.
- Not yet built: still-deferred per §8 — actually assigning bodies a
  government/settlement identity beyond the population-band string, and
  surface maps (settlements/roads on a colonized body, a separate
  smaller-scale generation pass).

Not yet built: `project_timestep` (the projection-mode tool — decomposing
a duration into several linked events), broadcasts, surface maps for
colonized bodies — see §13 for the full phase breakdown.

**UI reorganization (top tab bar, persistent selection)**: a GM asked for
"a more refined and less cluttered UI" — the app had grown two permanent
side panels by this point (a left toolbar with ten sections stacked in one
long scroll: Tool, Field, Brush, Generate, Hyperlanes, Factions,
Background actors, Layers, Status, Project, AI index; a right sidebar with
its own separate tab row for Sectors/Factions/Actors/Organizations/Events/
AI). Replaced with a single top-level tab bar (`App.jsx`) — Draw, Generate,
Sectors, Factions, Actors, Organizations, Events, AI, Project — and one
side panel whose content is entirely driven by the active tab, freeing up
real map space (`Toolbar.jsx` split into `DrawPanel`/`GeneratePanel`/
`ProjectPanel`, `SectorList.jsx` lost its own internal tab row). The other
half of the request — "if I click a system it'll keep it as selected for
other tools, even in other tabs" — was already halfway true (the system
inspector card rendered regardless of the old right-sidebar's active tab)
but not for faction/actor/org, whose cards only showed while their own tab
was open; all four are now rendered unconditionally, so picking any one of
them and then switching to a completely unrelated tab (Draw, AI, whatever)
never loses it. Sectors are the one exception — no standalone inspector
card exists for one (its list row *is* its editor), so selecting a sector
still jumps to the Sectors tab, same as before. Verified live: selected a
system, switched to the AI tab, confirmed its card (including the Bodies
orrery) was still rendered underneath the chat panel; no console errors
across the whole tab set.

**Orrery tab + body editor, and less uniform system spacing**: a follow-up
GM request. The read-only orrery embedded in the system card moved to its
own top-level **Orrery** tab (`OrreryView.jsx`) with a system picker
(shared selection state — pick one there or on the map, either way it's
the same "selected system"), and it's now a real editor, not just a
visualization:
- **Drag a body** to reposition it — for a planet/belt, drag distance from
  the star to change `orbitAU` and drag angle to change `orbitAngleDeg`
  (a belt's inner/outer edges shift together, preserving its width); for a
  moon/station, drag angle around its parent. Implemented via
  `getScreenCTM()`-based screen-to-SVG-space conversion, not a drag-and-
  drop library. Verified live: dragged a planet from 0.169 AU to 2.066 AU
  at a new angle, confirmed the new position persisted after the
  autosave's debounce.
- **Click a body** for a full edit form below the map: rename, change
  kind, habitable toggle, colonization status (population band appears
  only when "colonized," mirroring `planetGen.js`'s own generation rule),
  a resources tag editor (add/remove, same pattern as a faction's
  tolerated-crimes list), re-host a moon/station onto a different parent
  body, and delete (cascades to any moons/stations attached to it).
- **Add** a new planet, belt, moon, or station by hand — a moon/station
  picks its host from a dropdown of the system's current primaries.
  Verified live: added a station to a renamed, newly-colonized body and
  confirmed it attached with the correct `parent` slug.
- The system inspector card (still shown persistently across every tab)
  now just shows a body count + the Reroll button, pointing at the Orrery
  tab for the actual map/editor, rather than duplicating a second copy of
  the SVG.
- **System spacing had too little variance, confirmed live**: pure
  Poisson-disc ("blue noise") sampling deliberately avoids both clumping
  and large gaps, which is exactly why a galaxy generated over a flat/
  lightly-painted population field looked almost perfectly evenly spaced —
  a GM reported systems reading as "equal distanced." `systemGen.js`'s
  `radiusAt` now applies a bounded ±20% jitter to each candidate's own
  effective spacing, clamped to never drop below `minSpacing` (the same
  absolute floor the unjittered field math already guaranteed at full
  population density), so `poisson.js`'s overlap check is exactly as safe
  as before. Verified: regenerated a 44-system galaxy and measured every
  system's nearest-neighbor distance — min 63.7, max 106.9, mean 80.3,
  stdDev 10.5 (previously a near-uniform distribution over a flat field).

**Redistribute positions**: a new button (Generate tab) that re-scatters
every *unlocked* system's position within its own sector — same spacing/
jitter as fresh generation — without touching name, slug, star type,
population, trade goods, bodies, control, or security (`redistributeSystems`
in `systemGen.js`). Unlike "Generate systems," it keeps the system count
exactly fixed (rejection-samples one new position per existing system
rather than filling the polygon with however many points fit), so nothing
ever gets added, removed, or re-rolled — locked systems still never move.
Existing hyperlane edges keep their endpoints (ids never change) and have
their cached length/risk/capacity recomputed against the new positions, so
nothing goes stale. Verified live on a 44-system/94-hyperlane galaxy: 0
name/star-type/population/body-count changes, 38 systems actually moved,
0 locked systems moved, minimum distance between any two systems 47.85
(no overlap), 93/94 hyperlane lengths recomputed.

**Stations now read like an actual "city in orbit," sized to the local
economy**: a GM asked for population, docks, size, etc. that are
"reasonable to the economy and sector of the galaxy they are in — heavy
extraction industry? massive stations with lots of cargo docks. smaller
outpost? simple refuelling." `planetGen.js`'s `rollStation` was rebuilt on
a `STATION_CLASSES` table (role + rough size bundled, same spirit as the
per-kind `SIZE_CLASSES` planets already use) — `refueling outpost` /
`waystation` / `mining platform` / `research outpost` / `trade station` /
`cargo terminal` / `orbital shipyard` / `orbital fortress` / `megastation`,
each with `[min, max]` ranges for population, docks, and physical length
(meters):
- **Class selection is economy-driven, not flat-random.** A body a system
  is actively working for resources (`status: "extraction"`) rolls against
  a mining/cargo-terminal/refueling-outpost weighting regardless of the
  sector's overall focus (that's about *that body's* local economy). A
  fully colonized body instead rolls against a per-sector-focus weighting
  table mirroring `systemGen.js`'s existing `FOCUS_TRADE` (mining →
  mining-platform-heavy, industry → shipyard/cargo-terminal-heavy,
  military → fortress-heavy, frontier → refueling-outpost-heavy, etc.), and
  `megastation` is filtered out entirely unless the system's own population
  band is major-colony-or-better — no lucky roll plants one over a
  backwater.
- **Size scales with the system's population band**, not just its class —
  population/docks/length are all lerped toward the top of their class's
  range as the system's own population band index rises, so a "trade
  station" over a core world reads bigger than one over a small colony.
- Also rolls a **dock class** (shuttle/light-freighter berths → freighter-
  capable → capital-ship dry dock, by size tier), a handful of **services**
  (refueling, repairs, medical bay, cargo brokerage, shipyard services,
  diplomatic offices, ... — pool widens with tier) and the **goods it
  handles** (sampled from the parent system's own `export`/`import` lists,
  so a station's cargo actually matches what its system trades). Station
  names now reflect their role (`"<host> Mining Platform"`,
  `"<host> Fuel Depot"`, etc.) instead of a generic `"<host> Station"`.
  `persistence.js`'s `systemToEntry` exports the new fields (`length_m`,
  `docks`, `dock_class`, `services`, `goods_handled`) alongside the
  existing body fields. `OrreryView.jsx`'s body editor grew a
  station-specific form (class dropdown, population/length/dock number
  inputs, dock-class dropdown, services and goods-handled tag editors) in
  place of the planet-only habitable/colonization-status fields, and a
  hand-added station now starts pre-filled as a mid-tier waystation instead
  of a blank shell. Verified: a standalone sweep across every sector focus
  × every population band × 20 trials (281 stations) found zero bad
  population/docks/length values, zero missing classes, zero premature
  megastations, and zero stations without a valid parent; live in the app,
  regenerated a mining-focus sector's systems and confirmed the resulting
  stations skewed small (17-385 population, 1-3 docks) and mining/
  refueling-flavored, matching a low-population mining sector's economy,
  then edited a station's population/services/goods through the new editor
  and confirmed the change persisted through the autosave.

**Fixed orbit distribution — planets were clustering entirely interior to
the HZ**: a GM caught it live ("they often are all before the HZ, while gas
giants, ice bodies and rocky bodies can be both close and far from the
star"). Root cause: `rollOrbits` walked outward from a tiny `minOrbit`
(~0.03-0.06 AU) by a fixed ×1.3-2.2 step per body — with the common 2-4-body
count (`primaryCount` skews low), that walk never reached even the
habitable zone (~1 AU) before running out of bodies, let alone the frost
line (~2.7 AU for a sun-like star), so nearly every system's primaries
ended up crowded in the inner system regardless of star type. Rewrote it to
log-space the whole body count across the *entire* span from `minOrbit` out
to a system-wide outer edge (2.2x-4.5x the frost line), with per-body
multiplicative jitter — guarantees a spread across close/HZ/far every time,
even for a 2-body system, rather than depending on count to eventually walk
that far. `pickKind`'s existing position-based weighting already let gas
giants/rocky planets show up both close-in (rare "hot Jupiter"/scorched
edge cases) and far out, and ice worlds only ever past the frost line — the
bug was that orbits essentially never *reached* far out in the first place.
Also added a **"Generate planets" button** (Generate tab, `systemGen.js`'s
`regeneratePlanets`) that bulk-rerolls every unlocked system's bodies in
place — same seeding as a fresh galaxy generation (`${seed}:bodies:<slug>`,
reproducible), so an existing galaxy can be re-rolled onto this corrected
model without touching system positions, names, or anything else. Verified:
a standalone sweep (12 star types × 6 population bands × 40 trials, 6,009
primaries) found 0 bad orbits, 61.9% inner / 3.5% HZ / 34.6% past the frost
line, and **100% of systems now have at least one body past the frost
line** (previously effectively 0 for low-body-count systems); confirmed
gas giants land both close (413 inner) and far (720 outer), rocky planets
both close (2,246) and rarely far (186), ice worlds far-only (688, 0
inner/HZ). Live in the app: clicked "Generate planets" on a 52-system test
galaxy, confirmed a gas giant landed at 0.033 AU in one system and 16.185
AU in another, and the orrery rendered the wider spread correctly with no
console errors.

## Ships & fleet economy (new layer, §8-adjacent — not yet in the design doc's numbered sections)

A GM asked for the galaxy to model traffic, not just territory: cargo,
tourism, diplomacy, private, and military ships, owned by companies (not
factions — a courier line doesn't contest system ownership the way a
warlord domain does), with real ship manufacturers/models scoped to SF1e's
own vocabulary. Scoped explicitly before building (three forking decisions,
each with a recommendation and a clear tradeoff):

- **Lightweight stats, not full SF1e stat blocks.** A ship model carries
  role/size-category/maneuverability/crew/cargo tons/speed (hexes)/an
  abstract 0-100 combat rating — real SF1e frame vocabulary and rough
  numbers, but no arc-mounted weapons, AC/TL, shield points, or damage
  dice. A GM who needs an actual combat stat block for a named ship still
  builds it by hand at the table; this layer's job is "how many ships,
  what kind, whose," not starship combat.
- **Fleet aggregates + named notables, not one entity per hull.** A
  company's `fleet` is `[{modelSlug, count}]`, not one full entity per
  ship — at 375-system-galaxy scale that's the difference between a sane
  project file/AI index and one bloated with thousands of near-identical
  entries. A handful of individually-named `notableShips` per company (a
  flagship, a PC-relevant hauler) cover the GM-relevant cases.
- **Companies are their own entity type, not a faction subtype.** Mirrors
  how organizations already sit apart from factions — a company can be
  independent, a subsidiary of a faction (`parentFaction`), or (once an
  AI/GM sets it) state-owned, but it never contests system ownership the
  way `resolveFactions` models territorial control.

**Data model** (`src/lib/shipTypes.js`, `src/lib/shipGen.js`):
- `HULL_CLASSES` — ~22 hull archetypes across the five roles (cargo/
  tourism/diplomacy/private/military), each with SF1e size category (Tiny
  through Colossal) and maneuverability class plus crew/cargo/speed/combat-
  rating ranges. A hull's role plus its size category together cover "private
  and capital, as well as war spaceships" — a Huge+ hull in *any* role reads
  as capital-scale (a grand cruise liner is as much a capital ship as a
  dreadnought) rather than needing a separate "is it capital" flag.
- `SHIP_MANUFACTURERS` — a dozen fictional shipwrights (not SF1e's real
  Pact-Worlds manufacturer list — same "plausible, setting-appropriate, not
  a copy" approach as star types/station classes), each with a specialty
  role bias and an economy/standard/premium quality tier that nudges a
  model's stats up or down from its hull's baseline.
- `generateShipModels(project)` — a fixed-size, galaxy-wide reference
  catalog (16-40 entries, scaled gently by sector count), *not* placed
  per-system, mirroring how `STAR_TYPES`/`STATION_CLASSES` are catalogs a
  generator picks from rather than per-location rolls.
- `generateCompanies(project, shipModels)` — seeds companies per sector
  (~1 per 15 systems, min 1 max 4), kind biased by the sector's own focus
  (mining/industry/logistics → cargo-heavy, residential/cultural → tourism,
  administrative → diplomacy, frontier/research → private, military →
  military contractor — mirrors `systemGen.js`'s existing `FOCUS_TRADE`
  table), home system weighted toward the sector's more important systems,
  and a ~60% chance of becoming a subsidiary of that system's controlling
  faction (if any) rather than independent. Only `origin: "generated"`
  companies are replaced on a re-run; hand-authored ones (new "+ New
  Company" form, **Companies** tab) survive, same convention as
  authored factions/actors.
- Haulers being "private, affiliated, or employed" (the GM's own framing)
  maps onto the existing actor `affiliation` field gaining a third typed-ref
  kind alongside `faction:`/`party:` — `company:<slug>` — selectable from
  the same dropdown every actor-editing form already shares
  (`affiliationOptions` in `SectorList.jsx`); an unaffiliated actor reads as
  fully private/independent.

**UI**: a new top-level **Companies** tab (`App.jsx`/`Toolbar.jsx`/
`SectorList.jsx`) — a company card (name, kind/scale, parent faction, home
system/sector, fleet list, notable-ships list) alongside a persistent
selection card like every other entity type, plus a "Fleets" section on the
Generate tab with "Generate ship models" and "Generate companies" buttons
(the latter disabled/no-ops with a clear message until models exist).

**Export/AI surface**: `persistence.js` gained `shipModelToEntry`/
`companyToEntry` (SDF `ship_models/<slug>/entry.json` and
`companies/<slug>/entry.json`, wired into both the File-System-Access and
combined-download export paths) and `aiIndex.js` gained matching compact-
index rows, so both are visible to the same SDF export and AI-index
pipeline every other entity type already uses. Not yet wired: the event/
effect engine (§9) has no ship/company-targeting ops yet (a company can't
be the target of `adjust_influence` the way an actor/org can), and
background-actor generation (`actorGen.js`) doesn't yet auto-seed hauler
crew — both are natural follow-ups, not built because nothing in this pass
needed them.

Verified: a standalone sweep across sector-count/systems-per-sector
combinations (13×29, 3×5, 1×1, 20×50) found deterministic, bounded model
catalogs (16-40 entries), zero dangling fleet/notable-ship model
references, zero duplicate slugs, and zero invalid stat values across
thousands of generated fleet entries. Live in the app: drew a sector,
generated systems, generated ship models (16) and companies (4 — "Hollis
Hauling Guild," "Elowen Militia Fleet," "Corvain Logistics," "Obsidia
Freight Co.," all mining/cargo-flavored matching the sector's focus),
inspected a company's card (8-hull fleet, a named notable ship), and
created an actor affiliated to one via the extended affiliation dropdown —
confirmed it persisted as `"affiliation": "company:hollis-hauling-guild"`.
No console errors across the whole flow.

### Known simplifications so far

- Sector vertices can't be dragged/edited after creation — delete and
  redraw if a boundary needs to change. (Still open — the one item from
  this list not yet addressed; everything else below it has a fix.)
- Galaxy bounds (width/height) are only set when starting a new project,
  not editable live against existing painted data (avoids distorting
  already-painted grids).
- "Generate systems" replaces every *unlocked* system each time (confirms
  first if any unlocked ones exist) and prunes any hyperlane/faction
  anchor that pointed at one of them, since their id/slug are gone. Locked
  systems, and anything referencing them, survive untouched. Freshly
  regenerated (unlocked) systems still lose whatever `control`/`security.
  faction`/`war_chance` they had — click Generate factions again to
  re-resolve those for the new arrivals.
- "Generate hyperlanes" still replaces the whole graph each time (with a
  confirmation) — but the new **Hyperlane tool** now lets you manually
  toggle a single edge on or off afterward without a full regen (see
  "Placing/generating hyperlanes" below).
- Hyperlane risk is still derived from Dominion security alone (lower
  security along the route → higher risk) as a stand-in — the design
  doc's real formula also factors in faction relations, and while
  `relationships` is now editable (Factions tab), it isn't fed into
  hyperlane risk or war-chance yet. Per-edge length/risk/capacity live
  only in the project's in-memory `hyperlanes` list for
  rendering/inspection — SDF export still follows §7's plan of a plain
  symmetric slug list on each system, not a separate edge category.
- "Generate factions" re-seeds every auto-generated ("(auto)") faction
  from scratch each time and recomputes control/security/war-chance for
  every system, but keeps GM-authored factions and their stats as-is —
  editing a faction's aggression/strength doesn't move borders until you
  click Generate factions again.
- Deleting a faction strips it from any system's `control` immediately
  (no stale references), but doesn't re-resolve who picks up the freed
  territory — click Generate factions again for that.
- The territory overlay and border-fragmentation pass both resample the
  control contest at the same 128×128 grid resolution as the density
  fields; it isn't persisted (computed on the fly), so very large faction
  counts (dozens+) could get slow to render, though this hasn't been an
  issue at the scale tested (single digits to low tens of factions).
- Locking protects an *existing* generated system, and the new **System
  tool** now also covers §3 stage 4's other half — hand-placing a brand
  new system at an arbitrary point inside a sector, rolled from whatever's
  painted there and locked immediately.
- Deleting a sector still removes every system inside it, locked or not —
  locking only protects against a *systems regen*, not a sector deletion,
  since there'd be no sector left for it to belong to.
- Nothing stops two different factions from anchoring to the same system;
  if it happens, whichever faction comes later in the list wins that
  system outright the next time you generate. A faction can now be
  **un-anchored** from its home system via a button on its card, though
  re-anchoring it to a *different* system still means dropping a new seed.
- Background actor density coefficients (population weight, the "meaningful
  contested share" cutoff, per-system cap) are the tuned defaults from
  initial testing, not calibrated against a real galaxy at the 500-2000
  system scale (§13 flags the exact coefficients as an implementation
  detail, not a design question) — expect to retune `actorGen.js`'s
  constants once a full-scale galaxy is generated.
- Promotion (a background actor flipping to `authored` when an event
  elevates them) isn't implemented — nothing in the event form currently
  triggers it automatically; a GM can still flip an actor's `origin` by
  hand via `set_status`-adjacent editing if wanted, but there's no
  dedicated "promote" action yet.
- If a sector is deleted, any actor based in one of its systems is marked
  unplaced (`location: null`) rather than deleted outright, so the curated
  actor itself isn't lost — but it does need to be manually reassigned to
  a new system afterward.
- The AI/MCP interface itself (§9) still doesn't exist — Phase 6 work.
  What now exists is a frozen **tool contract spec** (`Docs/11-AI-integration.md`
  §6) for `query_galaxy`/`create_actor`/`create_organization`/`apply_event`/
  `project_timestep`, precisely matched against the current SDF field
  names, plus a real, tested implementation of `query_galaxy`'s index mode
  and the entire `apply_event` effect engine — Phase 6 mostly needs to
  wire an LLM up to call these, not invent new logic.
- No replay/undo engine: events apply directly to live state and are
  logged append-only, but there's no "reconstruct the galaxy by replaying
  every event from the base generation" capability yet (§9 pipeline step 5
  frames this as a natural free side-effect of the append-only log, but
  actually building the replay path is future work) — deleting a journal
  entry removes it from the log only, it does **not** revert whatever it
  changed.
- Confidence-based delta narrowing exists in the effect engine
  (`effectEngine.js`'s `envelopeCap`) but is inert for hand-authored events,
  which always pass `confidence: 1` — there's no UI to set a lower
  confidence by hand, since a GM typing an exact number isn't "uncertain"
  the way an AI-classified event might be. The curve itself (confidence 0
  shrinks the envelope to 30%) is a reasonable placeholder, not something
  derived from the design doc, which leaves the exact formula unspecified.
- A `set_system_status` cascade's neighbor re-derive uses the live
  geometric control contest (`computeControlShares`), which will overwrite
  any earlier event-driven `adjust_control`/`set_owner` override on those
  *specific* neighboring systems — same behavior as clicking "Generate
  factions" already has on hand-tuned control.
- Destroyed/quarantined systems don't yet render any differently on the
  map (no visual distinction from an active system) — only the stored
  `status` field and the hyperlane-severing cascade are implemented.
- Not every one of the 12 effect ops got an individual live end-to-end
  test in the session that built this phase — `adjust_control`,
  `adjust_security`, `adjust_relationship`, `adjust_focus`,
  `adjust_influence`, `set_affiliation`, `set_status`, and `remove_tag`
  share the exact same clamp-apply-diff code path as the ones that were
  tested (`adjust_aggression`, `set_owner`, `set_system_status`, `add_tag`,
  `relocate`), just against different fields.
- No separate backend yet (Docs/11-AI-integration.md's "Application Host"/
  "Inference Host" split, the two-model-slot Ollama config, the cloud-
  fallback env vars) — the browser calls the inference endpoint directly.
  This works for local testing but isn't the deployed shape the design doc
  describes; a real deployment still needs that backend built.
- A local Ollama server needs `OLLAMA_ORIGINS` set to allow this page's
  origin, or the browser's `fetch` will be blocked by CORS — the AI panel
  surfaces this as a clear error when it happens, but doesn't configure it
  for you. Cloud providers (OpenAI, Anthropic) generally allow direct
  browser calls out of the box; Anthropic specifically requires the
  `anthropic-dangerous-direct-browser-access` header, which is already
  sent on every request.
- Pass 1's relevance filter (kicks in once the compact index would exceed
  a ~6000-character budget, `aiClient.js`) is lexical, not semantic — it
  scores entities by literal word overlap with your request, not meaning.
  "Increase Gammon's control over Vraxis" finds `Vraxis`/`Gammon` fine;
  something like "the pirates near the mining world" with no name/tag
  actually containing those words could miss the intended entity even
  though a human (or real embeddings) would connect them. This is a
  stand-in for the real embedding-similarity retrieval §10 calls for, not
  that retrieval itself. The budget is tuned conservatively for a default,
  unconfigured local model (confirmed live against Ollama/Qwen3 8B at
  ~2000 usable prompt tokens despite a 4096 reported context) — raise
  `MAX_PASS1_INDEX_CHARS` in `aiClient.js` if you've configured a bigger
  context window and want more of the galaxy visible per request.
- Some local models/setups don't reliably honor a *forced* tool call —
  confirmed live: Qwen3 8B via Ollama answered in free text instead of
  calling `shortlist` even with `tool_choice` pinned to it. `runPass1` now
  falls back to scanning that free text for a JSON refs array before
  giving up, but this is a best-effort patch over a real model/server
  limitation, not a guarantee — a model that answers in a totally
  unparseable shape still fails Pass 1.
- Only one proposed tool call is ever shown/actionable per request — if
  the AI proposes several (e.g. a `create_organization` + a `create_actor`
  for the "new party" worked example in §9.1), only the first is surfaced;
  the rest are silently dropped with a note to re-ask afterward. The
  design doc frames that worked example as one bundled reviewable
  proposal, which this doesn't yet do.
- No confidence editing in the UI — an AI proposal's per-effect
  `confidence` value (used by the magnitude-envelope clamp, §9.2) passes
  straight through from the model's tool call with no GM override, unlike
  every other field on the proposal review, which is currently
  accept-as-is or reject-the-whole-thing (no partial editing before
  commit).
- `query_galaxy` as an actual named, independently-callable tool doesn't
  exist — Pass 1/Pass 2 call `buildGalaxyIndexEnvelope`/`queryGalaxyFull`
  directly as internal functions rather than through a real tool-call round
  trip, since there's no agent loop yet where the model decides *when* to
  query vs. propose — it's a fixed two-step pipeline, not an
  agent-directed one.
- `project_timestep` (projection mode) isn't implemented at all — see
  "Not yet built" above.

## Running it

```
cd GalaxyGen
npm install
npm run dev
```

Opens on `http://localhost:5174` (see `vite.config.js`).

## How to use it

The whole app is one map (left) plus one side panel (right), switched
between with the **tab bar along the top** — Draw, Generate, Sectors,
Factions, Actors, Organizations, Events, AI, Project. This replaced an
earlier layout with two permanent side panels (a long-scrolling toolbar on
the left, a second tab row buried inside the right sidebar) that got
cluttered fast — now only the controls for whatever you're actually doing
are on screen, and the map gets the rest of the space. Selecting a system,
faction, actor, or organization shows its inspector card at the top of the
side panel **regardless of which tab is active** — pick a system, switch
to the AI tab to ask something about the galaxy, and the system's card is
still right there. (Sectors are the one exception: since a sector has no
standalone inspector card — its list row *is* its editor — selecting one
still jumps you to the Sectors tab, same as starting to draw a new one
does.) The panel is resizable — drag the thin divider between it and the
map (cursor turns to a col-resize arrow); its width persists across
reloads (clamped 180–560px), stored in `localStorage` separately from the
project itself.

**Draw tab**

| Tool | What it does |
|---|---|
| Brush | Left-drag to paint the selected Field onto the map; Shift+drag erases. Pick the field (Population, Export, Import, Hyperlane density, Dominion security), radius, and strength above it. |
| Sector | Click to place boundary vertices (need 3+). See "Drawing a sector" below. |
| System | Click inside a drawn sector to hand-place a single new system there, rolled from whatever's painted at that exact point and locked immediately. Clicking outside every sector does nothing. |
| Faction | Click to drop a faction's control seed (a diamond marker) — click again to reposition before naming it in the Factions tab. Click near an existing system instead to anchor the faction to it (violet ring) — that system is then held outright by that faction. |
| Hyperlane | Click a system (cyan ring), then click a second one to toggle a direct hyperlane between them — click the same system twice, or empty space, to cancel. |
| Select | Click a system, faction seed, or a sector to select it (systems, then factions, take priority when they're close together) — needed to inspect a system/faction, enable "constrain to selected sector" for the brush, or before deleting/editing a sector. |
| Pan | Left-drag to move the view. (Middle-mouse-drag pans in any tool; scroll wheel always zooms.) |

**Drawing a sector** — drawing and naming are two separate steps, so you
can lay out the shape first and only decide the name/focus once it's done:
1. Switch to the Sector tool and click to drop vertices — the Sectors
   panel (right) shows a live point count (need 3+) and a **Close
   boundary** button. No name/focus fields yet at this stage.
2. A faint dashed line always previews the closing edge back to your
   first point, and that first point gets a highlighted ring once you
   have 3+ vertices.
3. Hovering near any existing vertex — your own first point, or another
   sector's corner — shows a colored ring: **green** means clicking there
   closes your current shape (same as pressing Enter, or the sidebar's
   **Close boundary** button); **amber** means clicking there snaps onto
   that neighboring sector's exact vertex, so the two sectors share a
   clean border with no gap.
4. Once closed, the sidebar switches to "Boundary closed (N vertices)" and
   *now* shows the Name/Focus form. Fill it in and click **Create
   sector** — or **Edit boundary** to reopen and keep adding points if you
   closed it too early.
5. Escape cancels the whole draft at any point (before or after closing);
   the × button in the sector list deletes an existing sector (and any
   systems already generated inside it).

**Generating systems**
1. Draw at least one sector first — placement only happens inside sector
   polygons, so an empty galaxy generates nothing.
2. In the **Generate** tab, set min/max spacing (world units) — this is the distance between systems at the sparsest
   (unpainted, population 0) vs. densest (fully painted, population 1)
   points. Painting the Population field (Brush tool) before generating is
   what actually shapes where systems cluster.
3. Click **Generate systems**. This replaces every *unlocked* system
   currently in the project (confirms first if any unlocked ones exist),
   so regenerate as many times as you like while still tuning the
   fields/spacing — anything you've locked stays exactly where it is.
4. Switch to the Select tool and click a system to see its rolled details
   (star type, population band, export/import goods — biased by its
   sector's focus) in the sidebar. The name field there is editable, and
   editing it (or the importance slider) automatically **locks** that
   system — it and anything referencing it (hyperlanes, faction anchors)
   will survive the next regen untouched. Toggle **Locked** directly to
   lock/unlock without changing anything else.
5. Alternatively, switch to the **System tool** and click a specific point
   inside a sector to hand-place exactly one system there instead — rolled
   from the fields painted at that point, locked immediately (no batch
   regen involved).

**Generating hyperlanes**
1. Generate systems first — hyperlanes connect existing systems, so there's
   nothing to link with fewer than two.
2. Painting the Hyperlane density field (Brush tool) beforehand shapes
   where the graph gets extra, denser connections; sparser areas fall back
   to the plain natural-looking mesh.
3. Click **Generate hyperlanes**. This replaces the whole graph currently
   in the project (confirms first if any exist).
4. Select a system to see the slugs of everything it connects to in the
   sidebar. On the map, brighter thicker lines are "major trade route"
   connections (high hyperlane density along that edge), faint thin ones
   are "backwater spur" connections (low density).
5. To adjust one connection without a full regen, switch to the
   **Hyperlane tool**: click a system (cyan ring marks it as picked), then
   click a second one to toggle a direct edge between them — add it if
   missing, remove it if already connected. Click the same system twice,
   click empty space, or press Escape to cancel a half-made pick.

**Placing factions and generating control**
1. Switch to the Faction tool and click on the map to drop a control seed
   — the Factions panel (right, below Sectors) shows a naming form: name,
   color, government flavor tag (free text), aggression, and strength.
   Strength governs territory *size* (how far its influence carries), not
   how solidly it holds its own capital — every faction fully controls its
   own seed point regardless of strength.
2. To make a faction's capital a specific system instead of an arbitrary
   point, click near that system — a violet ring shows it'll anchor there.
   An anchored faction holds that one system outright (`control.owner`
   forced to it, no contest) no matter how strong a rival seed happens to
   sit nearby.
3. Repeat for as many major powers as you want, then click **Generate
   factions**. This auto-seeds small local factions into any colonized
   area where none of your majors clear a meaningful share (tagged
   "(auto)" in the list) and recomputes every system's `control`,
   `security.faction`, and `war_chance` from the full set.
4. Turn on **Show faction territory** (Layers) to see the soft territory
   overlay and each faction's seed marker; contested systems (no single
   faction at ~85%+ share) get a dashed amber ring right on the map, and an
   anchored faction's home system gets a solid ring in that faction's
   color.
5. Select a system to see its control breakdown (owner, or contested-by
   with shares), faction security, and war chance in the sidebar; select a
   faction seed to tweak its aggression/strength inline or delete it.
   Re-click **Generate factions** after any tweak to see it take effect —
   nothing recomputes live as you drag a slider.
6. An anchored faction's card has an **Un-anchor from home system** button
   — its home system goes back into the normal control contest the next
   time you generate factions. The card also has editable **relationships**
   (a slider per other faction, -1 to 1) and **tolerated crimes** (a
   free-text tag list) — both exist for future event/war-chance resolution
   (§9) but aren't fed into the live calculations yet.

**Marking important systems**
- Every system rolls a realistic importance value automatically at
  generation time (mostly low, rare standouts, nearby systems dampened so
  landmarks don't cluster). Select any system to see/adjust its
  **Importance** slider (0–1) in the inspector, or click **Mark as
  landmark** to set it straight to 1.0 — either one locks the system too.
- The zoom level needed to reveal a system's name scales down with its
  importance, relative to the view's initial zoom-to-fit level: a 1.0
  landmark always shows its label; a 0.0 system needs several times the
  initial zoom before it appears; everything between graduates smoothly.
  Keeps a large galaxy from turning into a wall of overlapping text at the
  default view while still surfacing what matters first as you zoom in.

**Adding actors and organizations**
1. Generate at least one system first — actors are always anchored to an
   existing system (or created "Unplaced" and assigned to one later).
2. Click **+ New Organization** first if you want an actor to belong to a
   local party rather than a faction directly — give it a name, ideology
   tag, and a parent faction (or Dominion) whose sphere it operates within.
3. Click **+ New Actor** — name, individual/group, a role flavor tag,
   which system they're based at, and an affiliation (a faction, an
   organization, or none). Placing them at a system locks that system.
4. Select an actor or organization from its list to edit any field
   afterward, or delete it. An organization's member list isn't edited
   directly — it's always whichever actors currently have that
   organization set as their affiliation. An organization's home
   system/sector are mutually exclusive — setting one clears the other.
5. An actor's card also has editable **reputation** (a slider per faction,
   -1 to 1, mirroring faction relationships) — exists for future
   event-driven standing (§9) but isn't fed into anything live yet.

**Generating background actors**
1. Generate systems and (ideally) factions first — background actor
   density is driven by each system's population band and its control/
   contest state, so running this before factions just skips the
   faction-rep half of the count.
2. Click **Generate background actors** in the toolbar. This rerolls every
   `generated`-origin actor from scratch (confirms first if any already
   exist) — anything you've curated by hand is left exactly as it is.
3. The Actors list in the sidebar keeps curated actors visible up top and
   collapses the (often much larger) background batch behind a "Show N
   background actors" toggle; click through to inspect or delete an
   individual one like any other actor.

**Authoring events**
1. Switch to the **Events** tab. Fill in a name, summary, tags, an
   in-fiction timestamp, and how much in-fiction time it spans (the
   timestep) — this last one is purely descriptive and independent of how
   big the effects are.
2. Pick a **magnitude** (`minor`/`moderate`/`major`/`historic`) — this sets
   the ceiling every numeric effect below gets clamped to, tightest at
   `minor` and loosest at `historic`.
3. Optionally set the **scope** (every entity this event touches — useful
   later for "show every event that touched this system/faction/actor,"
   though nothing browses by scope yet).
4. Click **+ Add effect** for each mechanical change the event causes —
   pick an op from the closed vocabulary (adjust control, set owner, set
   system status, adjust security/relationship/aggression/focus/influence/
   reputation, set affiliation, relocate, set status, add/remove tag), then
   fill in whichever typed-ref/number/select fields that op needs.
5. `minor` events: click **Commit** directly — no review step, per the
   design doc's "low stakes, envelope-capped, never enough to flip
   ownership" rule. Everything `moderate`+ requires **Preview effects**
   first, showing the exact before/after diff for every effect, before
   **Confirm commit** unlocks.
6. `set_owner` has an extra gate on top of its magnitude envelope: the
   control shift has to clear a fixed minimum (0.15) before it's allowed to
   flip ownership at all — a small nudge under a `historic` event still
   won't flip a system, it has to actually earn it.
7. Every committed event appears in the **Journal** below the form
   (append-only, newest first) — click one to expand its full diff and
   narrative. Deleting one only removes it from the log; it does not
   revert whatever it already changed.

**Using the AI tab**

The AI tab is a chat window: a scrolling message history with a
send-on-Enter input pinned at the bottom (Shift+Enter for a newline).
Settings collapse into a one-line summary (`model @ base URL`) once set —
click **Show AI settings** to reopen them.

1. First time only: click **Show AI settings** and fill in **API base
   URL** (e.g. `http://localhost:11434/v1` for a local Ollama server, or a
   cloud provider's base URL), an **API key** if the endpoint needs one,
   and a **model** name. These save to this browser only, never to a
   project file.
2. Type a plain-language request — a creation command ("add a politician
   to the Libertarian Party in Vernak, called Aria Valeran") or a discrete
   happening ("the Free Traders Coalition routed the Kreel Clans at
   Kreel's Reach") — and hit Enter or **Send**. It appears as your message
   in the thread.
3. **Pass 1** sends the whole galaxy's compact index and gets back a
   shortlist of relevant entity refs; **Pass 2** sends those entities'
   full records plus recent event history and asks for exactly one tool
   call — `create_actor`, `create_organization`, or `apply_event`. Both
   render as an evolving assistant message ("Shortlisting…" → "Drafting a
   proposal…" → the finished proposal card), same bubble the whole time.
4. The proposal card shows a plain-language summary; for `apply_event` it
   also runs the exact same effect-engine preview the manual Events form
   uses, showing the real diff (and any validation error, e.g. an
   ownership flip that doesn't clear its threshold) before you can commit.
5. **Confirm & commit** applies it through the same handler a manual
   creation/event would use — no separate code path, no special
   privileges — and the card updates in place to "✓ Committed." rather
   than disappearing, so the thread stays a readable log of what you
   asked for and what happened. **Reject** marks it "✗ Rejected" instead,
   without touching state.
6. If the AI proposed more than one action in a single response, only the
   first is shown; commit it and send another message for the rest.

**Saving your work**
- Everything autosaves to the browser's local storage as you go (per
  browser/profile — it won't follow you to a different machine).
- **Save .json** / **Load .json** in the sidebar export/import the whole
  project (seed, bounds, sectors, systems, all five field grids) as a
  portable file.
- **Export SDF** writes real `sectors/<slug>/entry.json`,
  `systems/<slug>/entry.json`, `factions/<slug>/entry.json`,
  `actors/<slug>/entry.json`, `organizations/<slug>/entry.json`, and
  `events/<slug>/entry.json` files, plus a top-level `index.json`
  (Chrome/Edge: pick a `content/` folder and it writes the tree directly;
  other browsers get a single combined JSON to split by hand).
- **New** starts a fresh galaxy (asks for confirmation if you have
  unsaved sectors).
