# Visual design system — "Holo Deck"

The frontend's look (fonts, colors, cards, nav, buttons) was replaced
wholesale, sourced from a Claude Design mockup exploration
(`SIT Mockups.dc.html`, project `da25e4eb-c6bb-4aad-bd10-4111c61851cc`) that
iterated through GM Console, player character sheet, and mobile combat-view
directions. That exploration tried three GM-console color directions and
explicitly carried one forward through every later screen — this doc
describes the system that resulted, now implemented in
`frontend/src/styles.css`.

## Where it lives

Almost the entire system is one file: `frontend/src/styles.css`. Every
component (`GM.jsx`, `CharacterSheet.jsx`, `Compendium.jsx`, `Campaign.jsx`,
`MediaLibrary.jsx`, `CharacterCreationWizard.jsx`, `Tablet.jsx`,
`Display.jsx`, `Login.jsx`, `main.jsx`'s `Home`) is styled entirely by
class name — **there is no component-level CSS-in-JS or per-component
stylesheet**. If you're changing how something looks, start in
`styles.css`; you almost never need to touch a `.jsx` file to restyle it.

`frontend/index.html` loads the three Google Fonts the system depends on
(Chakra Petch, IBM Plex Mono, Barlow) — don't remove those `<link>` tags.

## The tokens

`:root` in `styles.css` defines the whole palette as CSS custom properties
— `--accent`/`--accent-grad` (blue→violet, the primary signal color),
`--violet` (secondary/hostile), `--danger` (red, conditions/errors),
`--success`, `--amber` (used sparingly, only for the compendium's "class"
category tag), plus `--text-*` (primary/secondary/muted/dim/faint),
`--panel*`/`--border*` (glass card fills and hairlines), and `--radius-*`.
**Reuse these tokens instead of hardcoding hex values** — that's what keeps
new UI visually consistent without needing to eyeball-match colors.

Three font roles, applied via `--font-display` / `--font-mono` /
`--font-body`:
- **Chakra Petch** — big numbers (HP, ability scores), names, card titles.
- **IBM Plex Mono** — uppercase labels, IDs, mono data. Always paired with
  wide letter-spacing (`0.08em`–`0.16em`) when used as a label.
- **Barlow** — body text, button/pill labels, nav tab text.

## The recurring motifs

- **Pill nav tabs**: `.gm-tabs`, `.sheet-tabs`, `.compendium-tabs`,
  `.wizard-steps`, `.tab-row` all share one rule block — a scrollable pill
  row, active tab filled with `--accent-grad`. This is why
  [08-ui-tabs.md](08-ui-tabs.md) says adding a tab never needs new CSS: any
  new tab bar that reuses one of those five class names gets the styling
  for free.
- **Glass cards**: the default look for `.sheet-card`, `.media-item`,
  `.campaign-editor`, `.char-card`, etc. is a flat translucent fill
  (`--panel`) + a 1px hairline border (`--border`) — deliberately quiet.
- **Highlighted card**: reserved for a genuinely "selected/primary" state
  (an active wizard pick, the active compendium row) — diagonal gradient
  fill (`--accent-fill` → violet) + accent-tinted border + glow shadow.
  Don't apply this to every card; it's meant to stand out because most
  cards don't use it.
- **Chips from checkboxes**: `.checkbox-inline` (used for the Conditions
  tab and compendium filter checkboxes) is a real `<input type="checkbox">`
  visually turned into a pill chip via `:has(input:checked)` — the JSX
  stayed a plain checkbox+label, only the CSS changed. Copy this pattern
  if you need another checkbox-driven toggle chip; don't restructure the
  markup into a custom button.
- **Touch targets**: `.pool` steppers, `.row button`, and `.wizard-nav`
  buttons are all ≥44px tall — this was a deliberate carry-over from the
  mockup's mobile combat-view note ("every stepper, fire and cast control
  is at least 44px") since `/player` is used on a phone mid-fight. Keep new
  player-facing controls at or above that size.

## Extending it

- New card-style UI → reuse `.sheet-card` (flat) or the highlighted-card
  recipe (see above) rather than inventing a new background/shadow combo.
- New status/category tag → follow `.pill.cat-*` (accent/violet/success/
  amber families already exist; don't add a fifth hue without a reason).
- New nav bar → give it one of the five pill-tab class names above instead
  of writing new tab CSS.
- Battle map SVG colors (grid lines, background) are set as inline
  `style`/`stroke` props directly in `BattleMap.jsx`, not in `styles.css`
  (SVG attribute styling doesn't route through the stylesheet the same
  way) — if you retint the map, edit them there, matching `--accent` at low
  opacity (`rgba(110,168,255,.16)`) rather than introducing a new tint.
