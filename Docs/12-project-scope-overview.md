# Starfinder Interactive Table (SIT) — Project Scope Overview

This document describes **what the application is for and how a user moves
through it** — screens, tabs, buttons, and the decisions a GM or player makes
at each step. It deliberately stays light on implementation detail; see the
other docs in this folder for architecture, data formats, and code-level
extension guides.

Scope note: this covers `WebApp/starfinder-tool`, the deployed multi-device
app used live at the table. Two other folders in this repo — `GalaxyGen`
(a standalone offline sandbox-galaxy generator) and `MapCreator` (an
unstarted offline map tool) — are separate, workstation-only tools that feed
*content* into SIT but don't run on the same server or share its UI. They're
noted briefly at the end for context.

## 1. What problem this solves

A physical Starfinder tabletop session traditionally needs a printed battle
map with miniatures, paper character sheets, a rulebook everyone passes
around, a laptop for reference lookups, and separate mood-setting props
(music, lighting). SIT replaces all of that with one self-hosted web app
running on a small home server, viewed simultaneously by everyone's own
device plus two shared physical screens (a projector and a GM's mood
tablet), staying in sync live over the local network. Nothing about the game
gets automated away — SIT tracks state and does arithmetic, but the GM
still narrates, adjudicates, and decides; the guiding principle across the
whole app is **"nothing gets cut for simplicity, but nothing gets
auto-applied without a human deciding it should be."**

## 2. Who uses it, and from where

Everyone at the table opens the same web address on their own device; which
"role" they land in depends on the URL/route they use and, for two of the
five, whether they've logged in.

| Route | Who sits here | Device in practice | Login? |
|---|---|---|---|
| `/gm` | The GM | Their laptop, on the table | Yes — one shared GM account |
| `/player` | Each player | Their own phone or tablet | Yes — one account per player, one character each |
| `/compendium` | Anyone at the table | Any device | Yes — GM or player account |
| `/tablet` | Nobody directly — a shared prop | A tablet propped up facing the players | No — shared physical screen |
| `/display` | Nobody directly — a shared prop | A projector/TV everyone can see | No — shared physical screen |

The two unauthenticated routes exist because they're not "someone's" screen
— they only ever show what the GM explicitly chooses to push to them, never
anything private (no full character sheets, no GM notes).

### Account rules
- Exactly one GM account exists per campaign; it can see and edit everything.
- Each player account is capped at exactly one character, permanently linked
  the first time they log in and create it (or the GM assigns one to them
  via import — see §5). This is enforced by the server, not just the UI.
- There is no self-registration screen — the GM creates accounts from the
  server's command line before the first session and hands out
  username/password. Re-running that script for an existing name resets
  their password (useful if someone forgets it).

## 3. The GM Console (`/gm`)

The GM's home base for the whole session — a full-width control panel with
a persistent header (sync status, mini-tracker connect button, sign out) and
five tabs underneath.

### 3.1 Battle Map tab
The main combat/exploration view.
- **Sessions** ("encounters") — the GM starts a new one per scene; each has
  its own grid, map image, and tokens. Switching encounters swaps the whole
  board.
- **Map image** — pick a previously-uploaded map from the Media Library and
  set it as the current encounter's background.
- **Tokens** — add a token with a label, an optional portrait/art image
  (pulled from the Media Library), and an optional *Tracker ID* string.
  Tokens without an image render as a colored circle with the first three
  letters of their label.
- **Moving tokens** — click a token to select it, then click a grid cell to
  move it there. Movement is instant everywhere: the projector and any
  other open view update live over the network, no refresh needed.
- **The mini tracker** — a physical sensor board sits under the real table
  and reports miniature positions. The GM's browser (Chrome/Edge only)
  connects to it directly over USB ("Connect tracker" in the header, no
  drivers or extra software), and any token whose Tracker ID matches an
  incoming position updates automatically as the physical miniature is
  moved by hand — the point being a GM can *either* click-to-move digitally
  *or* just move the real miniature and have the display follow it.
- Not yet built, though the full rules scope calls for it eventually: fog of
  war / GM-only vs. player-visible layers, an initiative tracker, condition
  icons on tokens, and range/AoE measurement templates. Today's map is
  grid + tokens + click-to-move only.

### 3.2 Scene & Mood tab
Drives the two shared physical screens.
- **Projector** — toggle between showing the live battle map, or a
  "scenic" mode (a full-screen image plus a caption) for non-combat scenes
  (a location's establishing shot, a cutscene image).
- **Tablet (GM's mood board)** — either shows the same scenic media, or a
  set of "featured character" cards the GM checks on/off from the party
  roster (useful for spotlighting whoever's in the current scene).
- **Mood / lights** — four preset buttons (Neutral / Combat / Derelict /
  Storm), each a color + brightness + light effect, plus manual color
  picker and brightness slider for a custom mix. This state is picked up by
  any registered ESP32 mood-light node on the network (ambient RGB
  lighting around the table) — the GM doesn't address individual lights,
  just sets "the mood," and connected nodes render it.

### 3.3 Media Library tab
Central upload/browse/delete point for all images used elsewhere in the
app, sorted into four galleries: Maps, Mood screens, Token art, Portraits.
Anything uploaded here becomes selectable from a dropdown wherever that
image type is used (map picker, token picker, campaign entry images,
character portraits). Files are served without login, since the two shared
screens that display them have none either.

### 3.4 Campaign tab
An in-house wiki that replaces needing a separate notes app. Five entry
types, switchable via a sub-tab bar: **Events, Locations, Characters
(NPCs), Factions, Objects.** Every entry has a name, short summary, longer
free-form body, and an optional image from the Media Library (plenty of
lore entries are text-only). Entries can be freeform-linked to each other
("member of," "located in," "owned by," ...) and those relationships show
from both ends automatically. Every entry defaults to **GM-only**; a single
checkbox ("visible to players") is what exposes a specific entry.

The **Characters** sub-tab is where NPCs and real player characters live
side by side — from the GM's chair, both are "characters" to keep an eye
on. Opening a PC here gives the GM the exact same read/write character
sheet the player sees on their own device (see §4), so the GM can check or
correct a player's sheet directly.

This tab also hosts **importing a character from Hephaistos** (a popular
external SF1e character builder): upload or paste an exported JSON and
every field maps onto SIT's character schema — abilities, HP/SP/RP,
defenses, saves, skills, feats, spells, full inventory with equip/stash
state, credits, conditions — optionally assigned straight to a player's
account in the same step (skip for NPCs).

### 3.5 Sources tab
Two small settings panels:
- **Owned sourcebooks** — which published rulebooks this table actually
  uses. This becomes the default filter everywhere the Compendium or the
  character creation wizard show a pickable list (races, classes, feats,
  gear, ...), so players aren't offered content the GM hasn't allowed.
  Leaving nothing checked means "show everything" rather than "show
  nothing."
- **New PC starting wealth** — for when a new player joins a campaign
  already in progress. The GM sets a flat starting-credits number (manual
  mode) or asks the tool to suggest one based on the current party's
  average wealth (auto mode, GM still approves the number before saving).
  The character creation wizard's equipment step then uses this instead of
  the rulebook's flat 1st-level default.

## 4. The Character Sheet — shared by player and GM

This is one component used in two places: a player's own `/player` view,
and the GM's read/write viewer inside Campaign → Characters. Whatever a
tab adds here appears in both automatically. Seven tabs:

1. **Overview** — the six ability scores and modifiers, HP/SP/RP pools
   (with +/− steppers for quick tracking mid-fight), EAC/KAC, saves, BAB,
   initiative, speed, race/theme/class/level, alignment, credits.
2. **Skills** — the full skill list, each row showing rank, governing
   ability, whether it's a class skill, and the computed total.
3. **Feats** — cards listing every feat taken, with its benefit text
   visible inline (no need to alt-tab to a rulebook).
4. **Spells** — organized per class, tracking known spells and per-day
   slots with cast/rest toggles so a player can mark a slot used and reset
   them all after a rest.
5. **Inventory** — full gear list with equip/stash toggles and a live
   running bulk total; equipped weapons show their linked ammunition with
   fire/reload actions, and ammo can also be tracked standalone.
6. **Conditions** — a checklist of every standard status condition
   (blinded, prone, shaken, dying, ...), each with an optional note field,
   so the GM or player can mark what's currently affecting the character.
7. **Notes** — a free-form text field for backstory or session notes.

Whatever the player checks, types, or toggles here saves immediately and is
what the GM sees moments later on their own screen — there's no separate
"submit" step.

### Character creation
A first-time player lands on a **9-step guided wizard** instead of a bare
form: Concept → Race → Theme → Class → Ability Scores → Class Features →
Skills & Feats → Equipment → Finishing Details. Each step only shows
options from the GM's allowed sourcebooks (§3.5). Ability scores are chosen
via either **point buy** (a 10-point pool to spend after race/theme
adjustments) or **quick array** (pick one of three preset spreads) — the
classic "roll 4d6" method is deliberately not offered. Every derived
number — HP, SP, RP, EAC/KAC, skill ranks — is computed automatically as
the player moves through the steps; nothing asks them to do the math.
Equipment's starting credits use the GM's wealth-limit setting (§3.5) if
one is set, otherwise the rulebook default. The wizard is mobile-first
(single column, bottom-pinned Back/Next bar) since most players fill it out
on a phone at the table. Nothing is written to the character until the
final "Create" step, so abandoning partway through leaves nothing behind.

Leveling up an existing character past 1st level is not built yet — today
a level-up is a manual edit to the sheet's fields.

## 5. The Compendium (`/compendium`)

A searchable rules reference, open to any logged-in user (GM or player),
built from content scraped/imported from Archives of Nethys and a Foundry
VTT data export. Organized into eleven sections along a tab bar: **Spells,
Weapons, Armor & Shields, Ammunition, Feats, Class/Racial/Theme Features,
Gear & Items, Races/Classes/Archetypes, Conditions & Effects, Rules,
Setting & Lore, Random Tables.**

Each section is a sortable table — click a column header to sort, click a
row to expand it into the entry's full rules text plus a "structured
mechanics" summary (range/area/duration/saving throw/requirements pulled
out as labeled data, not just prose — e.g. a spell's exact target count and
any spacing constraint). Each section also has its own relevant filters
(weapon type and melee/ranged for Weapons, armor weight for Armor, spell
school/level for Spells, rulebook chapter for Rules, and so on), and every
section defaults to only showing entries from the GM's owned sourcebooks
(§3.5).

This is a **lookup tool, not an editor** — nothing here writes back to a
character. There's currently no button to attach a Compendium entry (say,
a feat) directly onto a character sheet; a player who takes a feat notes it
manually on their Feats tab. Nothing in the app auto-applies a rule's
numeric effect either — e.g. taking a feat that grants a skill bonus
doesn't move any number on the sheet by itself. This is a deliberate,
documented scope boundary (see `03-features-scope.md` and `04-data-
pipeline-aon.md`), not a missing feature — reliably parsing arbitrary rules
prose into live modifiers is treated as a hard, open problem, and the app
instead focuses on making the *text* easy to find and read at the table.

## 6. The shared displays

### `/display` — projector
Full-screen, no menus, no buttons — purely what the GM has pushed to it
from the Scene & Mood tab (§3.2): either the live battle map (auto-follows
whichever encounter is currently active, tokens moving in real time) or a
scenic image with caption. Meant to sit on a TV or projector everyone at
the table can see, functioning like the "digital battle mat" in the middle
of the table.

### `/tablet` — GM's mood board
A second shared screen, propped facing the players (not the GM's own
working device — that's `/gm`). Shows whatever the GM last pushed: idle,
a scenic media push, or a set of featured-character cards. It's a mood/
flavor prop, not a control surface — nobody interacts with it directly.

## 7. Peripherals the app talks to

- **Miniature tracker (Hall-sensor PCB)** — see §3.1. Connects only to the
  GM's browser over USB (Web Serial), no software install; positions are
  relayed to the server and broadcast to every connected screen.
- **ESP32 mood lights** — small networked LED controllers that poll the
  server every 1–2 seconds for the current mood state set in §3.2 (color,
  brightness, effect) and render it locally. Any number can register; the
  GM console lists which ones are currently online.

## 8. Cross-cutting behaviors

- **Live sync** — every client (GM, players, projector, tablet) holds a
  WebSocket connection; a change anywhere (a token moves, a character
  sheet is edited, the mood changes) appears on every relevant open screen
  within moments, no manual refresh.
- **Everything server-side** — no client installs anything beyond a
  browser tab; all game state lives on the home server, not on any one
  device, so someone's phone dying mid-session doesn't lose anything.
- **GM decides, app doesn't auto-enforce** — a running theme across
  sourcebook restrictions, starting wealth, and rules effects: the app
  surfaces information and does arithmetic, but every judgment call stays
  with the GM. This shows up repeatedly: owned-sources filtering is a
  default, not a hard block; wealth-limit is advisory, not enforced;
  Compendium mechanics are shown, never auto-applied.
- **Nothing gets simplified away** — the guiding rule for what counts as
  "done": every stat, field, and subsystem in the SF1e rules must be
  representable somewhere in the app, even if the UI around it is still
  basic. "Intuitive" means better navigation/search/defaults, not fewer
  fields.

## 9. Deliberately out of scope (for now)

Called out explicitly in the project's own planning docs so they're not
mistaken for oversights:
- Starship combat (a separate map/ruleset from ground combat)
- Automated rule enforcement (auto-applying a feat's numeric bonus, etc.)
- Fog of war, fully-built initiative tracker, and AoE/range measurement
  tools on the battle map (map exists; these specific tools don't yet)
- Voice/video integration (the app assumes everyone is physically present)
- Leveling up a character past 1st level via the wizard

## 10. Adjacent offline tools (not part of the live app)

Two other folders in this repo produce *content* SIT can serve, but are
separate standalone tools with their own UIs, run on a GM's own workstation
ahead of time rather than at the table:

- **GalaxyGen** — a procedural galaxy/sector/star-system generator (star
  systems, hyperlanes, factions, notable NPCs, and a simulated event log
  a GM can narrate against or query with an AI assistant). Exports its
  output as read-only content SIT can display; SIT never writes back to it.
- **MapCreator** — a placeholder for a future offline battle-map creation
  tool; not started.

Neither runs on the home server or shares login/state with `/gm`,
`/player`, etc. — they're worldbuilding aids a GM uses between sessions,
not something players ever open directly.
