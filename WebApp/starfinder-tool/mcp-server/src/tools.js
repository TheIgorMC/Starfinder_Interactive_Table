import { z } from "zod";
import { backendGet, backendJson, backendUploadTgn } from "./backend-client.js";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const errorResult = (err) => ({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });

async function safe(fn) {
  try {
    return json(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
};

// Registers every tool this MCP server exposes. Each one is a thin wrapper
// around the backend's own REST API (see backend-client.js) — no business
// logic lives here, so behavior always matches what the web UI does
// (validation, WS broadcasts, etc.).
export function registerTools(server) {
  // --- Compendium (read-only rules reference) -----------------------
  server.registerTool(
    "compendium_search",
    {
      title: "Search the rules compendium",
      description: "Search Starfinder rules entries (feats, spells, races, classes, equipment, ...) imported from Archives of Nethys / Foundry.",
      inputSchema: {
        category: z.string().optional().describe("e.g. feat, spell, race, class, weapon, armor"),
        source: z.string().optional().describe("sourcebook name"),
        q: z.string().optional().describe("free-text search over the name"),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    ({ category, source, q, limit }) => safe(() => backendGet(`/api/aon${qs({ category, source, q, limit })}`))
  );

  server.registerTool(
    "compendium_get",
    { title: "Get one compendium entry", description: "Fetch a single compendium entry by id, including its full data/mechanics.", inputSchema: { id: z.number().int() } },
    ({ id }) => safe(() => backendGet(`/api/aon/${id}`))
  );

  // --- Data review (hand-validation workflow) -------------------------
  server.registerTool(
    "review_list",
    {
      title: "List entries pending hand-review",
      description: "List compendium entries by review status (unreviewed/approved/flagged), for the AI-import hand-validation workflow.",
      inputSchema: {
        category: z.string().optional(),
        status: z.enum(["unreviewed", "approved", "flagged"]).optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    ({ category, status, q, limit }) => safe(() => backendGet(`/api/review${qs({ category, status, q, limit })}`))
  );

  server.registerTool(
    "review_get",
    { title: "Get a review entry", description: "Full row (data + mechanics + review status/notes) for one entry, by id.", inputSchema: { id: z.number().int() } },
    ({ id }) => safe(() => backendGet(`/api/review/${id}`))
  );

  server.registerTool(
    "review_update",
    {
      title: "Correct and/or mark a compendium entry reviewed",
      description: "Patch an entry's data/mechanics JSON and/or set its review verdict (approved/flagged) with notes. Fields omitted are left unchanged.",
      inputSchema: {
        id: z.number().int(),
        data: z.record(z.string(), z.any()).optional(),
        mechanics: z.record(z.string(), z.any()).optional(),
        review_status: z.enum(["unreviewed", "approved", "flagged"]).optional(),
        review_notes: z.string().optional(),
      },
    },
    ({ id, ...body }) => safe(() => backendJson("PATCH", `/api/review/${id}`, body))
  );

  // --- Campaign wiki (entries + relationships) ------------------------
  server.registerTool(
    "campaign_list",
    {
      title: "List campaign wiki entries",
      description: "List campaign entries (event/location/npc/faction/quest/object), optionally filtered by type.",
      inputSchema: { type: z.enum(["event", "location", "npc", "faction", "quest", "object"]).optional() },
    },
    ({ type }) => safe(() => backendGet(`/api/campaign${qs({ type })}`))
  );

  server.registerTool(
    "campaign_get",
    { title: "Get a campaign entry", description: "Full campaign entry by id, including its links to/from other entries.", inputSchema: { id: z.number().int() } },
    ({ id }) => safe(() => backendGet(`/api/campaign/${id}`))
  );

  server.registerTool(
    "campaign_upsert",
    {
      title: "Create or edit a campaign entry",
      description: "Create a new campaign entry (omit id) or edit an existing one (pass id) — name/summary/body/event_date/visible_to_players.",
      inputSchema: {
        id: z.number().int().optional().describe("omit to create a new entry"),
        type: z.enum(["event", "location", "npc", "faction", "quest", "object"]).optional(),
        name: z.string().optional(),
        summary: z.string().optional(),
        body: z.string().optional().describe("markdown"),
        event_date: z.string().optional().describe("freeform in-game date, only meaningful for type=event"),
        visible_to_players: z.boolean().optional(),
      },
    },
    ({ id, ...body }) => safe(() => (id ? backendJson("PATCH", `/api/campaign/${id}`, body) : backendJson("POST", "/api/campaign", body)))
  );

  server.registerTool(
    "campaign_link",
    {
      title: "Link two campaign entries",
      description: "Add a directional relationship between two campaign entries (e.g. 'member of', 'located in').",
      inputSchema: { from_id: z.number().int(), to_id: z.number().int(), relation: z.string().optional() },
    },
    ({ from_id, to_id, relation }) => safe(() => backendJson("POST", `/api/campaign/${from_id}/links`, { to_id, relation }))
  );

  server.registerTool(
    "campaign_import_tgn",
    {
      title: "Import a Tangent (.tgn) campaign export",
      description: "Parse a Tangent .tgn export's full text content and import it into the campaign wiki (locations/factions/NPCs/quests/objects + relationships + chapters). Insert-only — already-imported entries are left untouched.",
      inputSchema: { content: z.string().describe("the full text content of the .tgn file (it's YAML)") },
    },
    ({ content }) => safe(() => backendUploadTgn("/api/campaign/import-tgn", content))
  );

  // --- Characters (PCs and NPCs, incl. inventory) ---------------------
  server.registerTool(
    "characters_list",
    { title: "List all characters", description: "List every character (PCs and GM-created NPCs), with core stats.", inputSchema: {} },
    () => safe(() => backendGet("/api/characters"))
  );

  server.registerTool(
    "characters_get",
    { title: "Get a character", description: "Full character sheet by id, including inventory/equipment, feats, spells, skills.", inputSchema: { id: z.number().int() } },
    ({ id }) => safe(() => backendGet(`/api/characters/${id}`))
  );

  server.registerTool(
    "characters_update",
    {
      title: "Edit a character",
      description: "Patch any character sheet fields — stats, HP/SP/RP, equipment (full array replace), credits, conditions, notes, etc. Fields omitted are left unchanged.",
      inputSchema: { id: z.number().int(), fields: z.record(z.string(), z.any()).describe("any subset of the character sheet columns") },
    },
    ({ id, fields }) => safe(() => backendJson("PATCH", `/api/characters/${id}`, fields))
  );

  // --- Mood tablet / projector (live table presentation) --------------
  server.registerTool(
    "scene_push_tablet",
    {
      title: "Push a mode to the GM's mood tablet",
      description: "Sets what the mood tablet (/tablet) shows: idle (chapterEntryId, a campaign_entries id), media (mediaUrl/caption/loop), npc_narrative (characterIds/revealNames) or npc_boss (characterIds, HP shown as % only).",
      inputSchema: {
        mode: z.enum(["idle", "media", "npc_narrative", "npc_boss"]),
        chapterEntryId: z.number().int().optional(),
        mediaUrl: z.string().optional(),
        caption: z.string().optional(),
        loop: z.boolean().optional(),
        characterIds: z.array(z.number().int()).optional(),
        revealNames: z.boolean().optional(),
      },
    },
    ({ mode, ...body }) => safe(() => backendJson("POST", "/api/scene/channel/tablet", { mode, ...body }))
  );

  server.registerTool(
    "scene_push_projector",
    {
      title: "Push to the projector",
      description: "Sets the projector (/display): 'battlemap' mode follows a battle session, 'scenic' shows an image with a caption.",
      inputSchema: {
        mode: z.enum(["battlemap", "scenic"]),
        sessionId: z.number().int().optional(),
        mediaUrl: z.string().optional(),
        caption: z.string().optional(),
      },
    },
    ({ mode, ...body }) => safe(() => backendJson("POST", "/api/scene/channel/projector", { mode, ...body }))
  );

  server.registerTool(
    "scene_set_mood",
    {
      title: "Set ambient mood/lights",
      description: "Sets mood color/brightness/effect/name — mirrored to the mood tablet background and any registered ESP32 light nodes.",
      inputSchema: {
        color: z.string().optional().describe("hex color, e.g. #802020"),
        brightness: z.number().int().min(0).max(255).optional(),
        effect: z.enum(["static", "pulse", "flicker", "storm"]).optional(),
        name: z.string().optional(),
      },
    },
    (body) => safe(() => backendJson("POST", "/api/scene/mood", body))
  );
}
