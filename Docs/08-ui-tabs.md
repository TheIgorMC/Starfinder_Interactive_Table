# Tabbed views — how they work and how to extend them

The app has three independent tab bars, all built from the same tiny pattern.
This doc explains the pattern once, then gives copy-paste steps for the two
you're most likely to touch: the **GM console** and the **character sheet**
(shared by the player's own view and the GM's Campaign → Characters viewer).

| Tab bar | File | CSS class | Used by |
|---|---|---|---|
| GM console | `frontend/src/views/GM.jsx` | `.gm-tabs` | `/gm` only |
| Character sheet | `frontend/src/components/CharacterSheet.jsx` | `.sheet-tabs` | `/player` **and** GM's Campaign → Characters panel |
| Compendium sections | `frontend/src/views/Compendium.jsx` | `.compendium-tabs` | `/compendium` (heavier variant — see note at the end) |

## The pattern

Every tab bar is three pieces in the same component:

1. A `TABS` array of `{ key, label }`.
2. One `useState` holding the active `key`.
3. Nav buttons that `map` over `TABS`, and a body that conditionally renders
   based on `tab === "..."`.

```jsx
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "skills", label: "Skills" },
  // ...
];

const [tab, setTab] = useState("overview");

<nav className="sheet-tabs">
  {TABS.map((t) => (
    <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
      {t.label}
    </button>
  ))}
</nav>

{tab === "overview" && <div>...</div>}
{tab === "skills" && <div>...</div>}
```

No router, no lazy loading, no tab-specific state persistence — switching
tabs just swaps which JSX block renders. State for a tab's contents (e.g. a
draft textarea) lives in the same component and survives tab switches since
nothing unmounts except the inactive `{tab === "..." && ...}` blocks.

The CSS for all three tab bars is the same recipe already in `styles.css`
(`.gm-tabs`, `.sheet-tabs`, `.compendium-tabs` — search for `.active` in each
block): flex row, transparent buttons, a 2px bottom border that lights up
blue (`#4f8ef7`) on the active one. **Adding a tab never requires new CSS** —
just add to the array and add a render branch.

## Adding a tab to the GM console

File: `frontend/src/views/GM.jsx`

1. Add an entry to `TABS` (line ~67):
   ```js
   const TABS = [
     { key: "battlemap", label: "Battle Map" },
     { key: "scene", label: "Scene & Mood" },
     { key: "media", label: "Media Library" },
     { key: "campaign", label: "Campaign" },
     { key: "sources", label: "Sources" },
     { key: "mynewtab", label: "My New Tab" },
   ];
   ```
2. Add a render branch inside `.gm-tab-content` (line ~220), following the
   existing ones:
   ```jsx
   {tab === "mynewtab" && <MyNewTabComponent />}
   ```
   Full-width tabs (like `battlemap`, `media`, `campaign`) render their own
   component directly. Simple form-style tabs (like `scene`, `sources`) wrap
   their component in `<div className="gm-panel">` to get the
   `max-width: 480px` constrained layout — pick whichever fits your content.
3. If the tab needs its own component, put it in `frontend/src/components/`
   and give it whatever local state/effects it needs — it doesn't need to
   know about `GM`'s state unless it's reading things like `session` or
   `characters`, which are passed down as props (see how `ScenePanel` and
   `BattleMapTab` receive them).

That's the whole recipe — no backend route is required just to add a tab;
only add one if the tab needs its own data.

## Adding a tab to the character sheet

File: `frontend/src/components/CharacterSheet.jsx`

This is the one to reach for when you want to build a feature in a small,
self-contained chunk, since **one tab = one `{tab === "key" && (...)}` block**
that doesn't affect the others. Remember this component is shared — anything
you add here shows up both on the player's own `/player` view and on the
GM's read/write viewer in Campaign → Characters, for free.

1. Add an entry to `TABS` (line ~24):
   ```js
   const TABS = [
     { key: "overview", label: "Overview" },
     { key: "skills", label: "Skills" },
     { key: "feats", label: "Feats" },
     { key: "spells", label: "Spells" },
     { key: "inventory", label: "Inventory" },
     { key: "conditions", label: "Conditions" },
     { key: "notes", label: "Notes" },
     { key: "mynewtab", label: "My New Tab" },
   ];
   ```
2. Add a render branch after the existing ones (each tab's block sits right
   after the previous, e.g. right after the `notes` block around line 400):
   ```jsx
   {tab === "mynewtab" && (
     <div>
       {/* your content */}
     </div>
   )}
   ```
3. If the tab reads/writes character data, follow the existing pattern:
   read from `char.<field>` (with a defensive default, e.g.
   `char.someField || []`, since older imported characters may not have the
   field), and write via `patch({ someField: newValue })` — `patch` is
   passed in as a prop from whichever parent is hosting the sheet
   (`Player.jsx` for the player, `Campaign.jsx`'s `patchCharacter` for the
   GM) and both already PATCH `/api/characters/:id` and refresh state, so a
   new tab never needs its own save plumbing.
4. If the new field doesn't exist on the `characters` table yet, add a
   migration (see `backend/migrations/008_character_sheet.sql` for the
   shape: `ALTER TABLE characters ADD COLUMN IF NOT EXISTS ...`), then add
   the column name to `FIELDS` (and to `JSON_FIELDS` if it's JSONB) in
   `backend/src/routes/characters.js` so `PATCH` accepts it.

Useful existing sub-patterns to copy from when building a new tab:
- **List of cards** (Feats, Equipped Weapons): `<ul className="sheet-list">`
  wrapping `<li className="sheet-card">` — see the Feats tab.
- **Table** (Skills, all-equipment): `<table className="sheet-table">` with
  a `<colgroup>` sizing the narrow columns explicitly (don't skip this —
  without it, `table-layout: auto` + `width: 100%` spreads narrow columns
  like checkboxes way too wide; see the Skills/Inventory tables for the
  `<colgroup>` shape to copy).
- **+/− counter** (SP/HP/RP, ammo): the `Pool` sub-component near the top of
  the file.
- **Checklist with per-item notes** (Conditions): map over an array of
  `[key, label]` pairs, checkbox + conditional notes `<input>`.

### A CSS gotcha worth knowing before you add a card-based tab

`.sheet-card` and `.sheet-list > li` both style list items when a card is
also a list item (e.g. Feats, Equipped Weapons: `<li className="sheet-card">`
inside `<ul className="sheet-list">`). `.sheet-list > li` is more specific
(one class + one element beats one class), so it used to silently override
`.sheet-card`'s padding down to `4px 0` regardless of what was set on
`.sheet-card` — this is why card titles looked cramped against the card
edge even after bumping the padding value. It's fixed now
(`.sheet-list > li:not(.sheet-card)`), but if you introduce a new class that
also targets `.sheet-list > li` directly, double check it doesn't reintroduce
the same trap.

## Compendium sections (heavier variant, FYI)

`Compendium.jsx` uses the identical tab-bar pattern for its top nav
(`.compendium-tabs`, a `SECTIONS` array instead of `TABS`), but each
"tab" also owns its own `columns`/`facets`/`ranges` config for a sortable,
filterable table — see the `SECTIONS` array near the top of the file. It's
the same core recipe, just with more config per entry. Not typically what
you want to copy for a GM/player feature tab — start from the character
sheet's plainer pattern above unless you're specifically adding a new
Compendium category.
