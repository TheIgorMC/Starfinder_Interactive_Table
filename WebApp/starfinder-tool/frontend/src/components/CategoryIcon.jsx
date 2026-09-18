import React, { useState } from "react";

// Small hand-drawn line-art icon set (24x24, stroke=currentColor) used as a
// fallback wherever an entry has no real per-item icon copied from Foundry
// (see backend/src/foundry-import.js's iconPathFor() — AoN-scraped entries
// never have one, and plenty of Foundry ones don't either). Deliberately
// generic-per-category, not per-entry art: no external image source is
// reliable/licensed for that at this scale, so this just breaks up the
// visual monotony of a long list rather than trying to illustrate every
// entry individually.
const ICONS = {
  weapon: (
    <path d="M6.5 17.5 17.5 6.5M14 4l6 6M4 20l3-1 1-3M15.5 8.5l-2-2" />
  ),
  armor: (
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
  ),
  ammo: (
    <>
      <path d="M8 3h8l1 6H7l1-6Z" />
      <path d="M7 9h10l-1 12H8L7 9Z" />
    </>
  ),
  upgrade: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  feat: <path d="M12 3.5l2.4 5 5.6.6-4.2 3.8 1.2 5.5L12 15.8 6.9 18.4l1.2-5.5-4.2-3.8 5.6-.6L12 3.5Z" />,
  feature: <path d="M12 2v6M12 16v6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M16 12h6M4.9 19.1l4.2-4.2M14.9 9.1l4.2-4.2" />,
  item: (
    <>
      <path d="M4 8l8-5 8 5-8 5-8-5Z" />
      <path d="M4 8v9l8 5 8-5V8" />
      <path d="M12 13v9" />
    </>
  ),
  race: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
    </>
  ),
  class: (
    <>
      <path d="M12 3 5 6v5c0 5 3 8 7 9 4-1 7-4 7-9V6l-7-3Z" />
      <path d="M9.5 12.2l1.8 1.8 3.5-3.8" />
    </>
  ),
  spell: (
    <>
      <path d="M12 3.5l1.4 3.8 3.8 1.4-3.8 1.4-1.4 3.8-1.4-3.8-3.8-1.4 3.8-1.4L12 3.5Z" />
      <path d="M18.5 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </>
  ),
  condition: <path d="M12 2 3 21h18L12 2Zm0 6.5v6M12 17v1.2" />,
  book: (
    <>
      <path d="M4 4.5C6 3.5 9 3.5 12 5c3-1.5 6-1.5 8-.5v15c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5V4.5Z" />
      <path d="M12 5v15" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M9 9.5V19.5" />
    </>
  ),
};

// Compendium `category` (a raw aon_entries value) -> icon key. Anything not
// listed falls back to "item".
export const CATEGORY_ICON_KEY = {
  weapon: "weapon",
  armor: "armor",
  shield: "armor",
  ammunition: "ammo",
  fusion: "upgrade",
  weaponAccessory: "upgrade",
  feat: "feat",
  "class-feature": "feature",
  "racial-feature": "feature",
  "archetype-feature": "feature",
  "theme-feature": "feature",
  "universal-creature-rule": "feature",
  race: "race",
  class: "class",
  archetype: "class",
  theme: "class",
  spell: "spell",
  condition: "condition",
  effect: "condition",
  rule: "book",
  setting: "book",
  table: "table",
};

export default function CategoryIcon({ category, iconPath, size = 18, className = "" }) {
  const [broken, setBroken] = useState(false);

  if (iconPath && !broken) {
    return (
      <img
        className={`category-icon category-icon-img ${className}`}
        src={`/api/aon/icons/${iconPath}`}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
      />
    );
  }

  const key = CATEGORY_ICON_KEY[category] || "item";
  return (
    <svg
      className={`category-icon category-icon-fallback ${className}`}
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    >
      {ICONS[key] || ICONS.item}
    </svg>
  );
}
