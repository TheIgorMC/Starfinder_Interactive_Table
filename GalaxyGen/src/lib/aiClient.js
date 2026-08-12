// Docs/11-AI-integration.md §3-4, §9.3 — the two-pass broad-then-deep call
// structure, talking to any OpenAI-compatible `/chat/completions` endpoint
// (a local Ollama server, or a cloud fallback) via plain `fetch`. Runs
// entirely client-side: the browser is both the "Application Host"
// crafting prompts and the caller of the inference endpoint — there is no
// separate backend yet (Phase 6 still needs one for a real deployment,
// §5's "Model Settings Panel" toggle between local/cloud, etc.), but for
// local testing this is the whole loop already.
import { EFFECT_OPS, MAGNITUDES } from "./effectEngine.js";

async function chatCompletion({ baseUrl, apiKey, model, messages, tools, toolChoice }) {
  if (!baseUrl) throw new Error("Set an API base URL in AI settings first.");
  if (!model) throw new Error("Set a model name in AI settings first.");
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // Anthropic specifically requires this header to allow a direct browser
  // call. It is NOT harmless to send everywhere, despite what an earlier
  // version of this comment claimed: a strict CORS server (Ollama
  // included) can return 204 on the OPTIONS preflight and still reject
  // the real request client-side because this header isn't in its
  // Access-Control-Allow-Headers — the browser then blocks the POST with
  // the same generic "Failed to fetch" as an actual connectivity problem,
  // which is indistinguishable from here. So it's only sent when the base
  // URL is actually Anthropic's.
  const isAnthropic = /(^|\.)anthropic\.com$/.test(new URL(url).hostname);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(isAnthropic ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        ...(tools ? { tools, tool_choice: toolChoice ?? "auto" } : {}),
      }),
    });
  } catch (err) {
    throw new Error(
      `Couldn't reach ${url}: ${err.message}. This is usually CORS: check the endpoint's DevTools → Network → the OPTIONS request's response headers for Access-Control-Allow-Origin/-Headers, rather than assuming which fix applies. For a local Ollama server on 127.0.0.1/localhost, OLLAMA_ORIGINS usually isn't the issue (both are allowed by default) — a custom header or a non-localhost origin is more likely (Docs/11-AI-integration.md §2.1).`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function extractToolCalls(response) {
  const message = response.choices?.[0]?.message;
  if (!message) throw new Error("AI response had no message.");
  return (message.tool_calls || []).map((c) => {
    let args;
    try {
      args = JSON.parse(c.function.arguments);
    } catch {
      throw new Error(`AI returned malformed JSON arguments for ${c.function.name}: ${c.function.arguments}`);
    }
    return { name: c.function.name, arguments: args };
  });
}

// Pass 1 (§9.3) forces a single structured `shortlist` call instead of free
// text, so there's nothing to parse loosely out of a chat response.
const SHORTLIST_TOOL = {
  type: "function",
  function: {
    name: "shortlist",
    description: "Return the typed refs of every entity plausibly relevant to the request.",
    parameters: {
      type: "object",
      properties: {
        refs: {
          type: "array",
          items: { type: "string" },
          description: 'Typed refs, e.g. "system:kreels-reach", "faction:kreel-clans".',
        },
      },
      required: ["refs"],
    },
  },
};

// A galaxy at real scale (500-2000 systems, plus a large background-actor
// pool, §11/§9.3) produces a compact index far too big to hand an 8B
// model whole — dumping it all in blew a 45k-token prompt past a 4k
// context window in testing and got silently truncated before the model
// ever saw the actual request. §10 calls for "plain embedding-similarity
// retrieval (not an LLM call at all)" to pre-narrow candidates before Pass
// 1 even runs; no embedding model is wired up yet, so this is a cheap
// lexical stand-in — score every entity by how many significant words
// from the request appear in its name/ref/tags, then greedily keep
// highest-scoring entities up to a *character* budget (not just a count —
// entity line length varies a lot with tag count, so a fixed entity count
// doesn't reliably bound prompt size). ~4 chars/token is a rough English/
// JSON approximation; 6000 chars (~1500 tokens) is deliberately
// conservative so this fits even a default, unconfigured 4096-context
// local model's actual usable prompt budget (which testing showed lands
// around ~2000 tokens once the server reserves headroom) — raise
// `MAX_PASS1_INDEX_CHARS` if you've configured a larger context window
// (`OLLAMA_CONTEXT_LENGTH`, §2) and want more of the galaxy visible to
// Pass 1 for better recall. `MAX_PASS1_ENTITIES` is just a safety net
// against pathological cases (e.g. thousands of entities with empty tags).
const MAX_PASS1_INDEX_CHARS = 6000;
const MAX_PASS1_ENTITIES = 300;

function entityLine(e) {
  return `${e.ref} :: ${e.name} :: [${e.tags.join(", ")}]`;
}

function selectCandidateEntities(entities, requestText) {
  const full = entities.map(entityLine).join("\n");
  if (full.length <= MAX_PASS1_INDEX_CHARS) return entities;

  const terms = requestText.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = entities.map((e) => {
    let score = 0;
    if (terms.length > 0) {
      const haystack = `${e.name} ${e.ref} ${e.tags.join(" ")}`.toLowerCase();
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length;
      }
    }
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let chars = 0;
  for (const { e } of scored) {
    if (picked.length >= MAX_PASS1_ENTITIES) break;
    const lineLength = entityLine(e).length + 1;
    if (picked.length > 0 && chars + lineLength > MAX_PASS1_INDEX_CHARS) break;
    picked.push(e);
    chars += lineLength;
  }
  return picked;
}

// Some local tool-calling setups don't reliably honor a *forced* tool
// choice (confirmed live: Qwen3 8B via Ollama answered in free text
// instead of calling `shortlist` even with `tool_choice` pinned to it) —
// so as a fallback, scan the plain-text response for something
// JSON-shaped before giving up entirely. Cheap, and turns an otherwise
// total failure into a working shortlist whenever the model at least
// tried to answer in a parseable shape.
function tryParseRefsFromText(text) {
  if (!text) return null;
  const objMatch = text.match(/\{[^{}]*"refs"\s*:\s*\[[^\]]*\][^{}]*\}/s);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed.refs)) return parsed.refs;
    } catch {
      // fall through to the bare-array attempt below
    }
  }
  const arrMatch = text.match(/\[(?:\s*"[a-z]+:[a-z0-9-]+"\s*,?)+\s*\]/i);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // give up — caller throws
    }
  }
  return null;
}

export async function runPass1(settings, index, requestText) {
  const candidates = selectCandidateEntities(index.entities, requestText);
  const filtered = candidates.length < index.entities.length;
  const compactIndex = candidates.map(entityLine).join("\n");
  const response = await chatCompletion({
    ...settings,
    tools: [SHORTLIST_TOOL],
    toolChoice: { type: "function", function: { name: "shortlist" } },
    messages: [
      {
        role: "system",
        content: `You are the broad/coherence pass of a galaxy simulator (Docs/10-galaxy-mapgen.md §9.3). Given a${filtered ? " pre-filtered subset of the most textually relevant entities in" : ""} the galaxy and a GM's request, call shortlist with the typed refs of every entity plausibly relevant. Err toward including a few extra rather than missing one — pass 2 looks at each in full detail.`,
      },
      { role: "user", content: `Galaxy index${filtered ? ` (${candidates.length} of ${index.entities.length} entities, filtered for relevance)` : ""}:\n${compactIndex}\n\nRequest: ${requestText}` },
    ],
  });
  const [call] = extractToolCalls(response);
  if (call && call.name === "shortlist") return call.arguments.refs || [];

  const text = response.choices?.[0]?.message?.content;
  const fallbackRefs = tryParseRefsFromText(text);
  if (fallbackRefs) return fallbackRefs;

  throw new Error(
    text
      ? `Pass 1 did not return a shortlist: ${text}`
      : "Pass 1 did not return a shortlist — if this keeps happening, the model's context window may still be too small (check server logs for \"truncating input prompt\") or the model doesn't reliably support forced tool calls.",
  );
}

// Docs/11-AI-integration.md §6.3/6.4/6.5 — the three creation/event tools
// an AI proposal can call, schema-identical to those sections (the enum
// values below are imported straight from effectEngine.js, so the tool
// schema can never drift out of sync with what the engine actually
// accepts).
const CREATE_ACTOR_TOOL = {
  type: "function",
  function: {
    name: "create_actor",
    description: "Mint a curated actor (Docs/10-galaxy-mapgen.md §6).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["individual", "group"] },
        role: { type: "string", description: "Free-text flavor tag, e.g. politician, garrison-captain." },
        affiliation: { type: ["string", "null"], description: "Typed ref faction:<slug> or party:<slug>, or null." },
        location: { type: ["string", "null"], description: "Typed ref system:<slug>, or null." },
        mobile: { type: "boolean" },
        influence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["name", "kind", "role"],
    },
  },
};

const CREATE_ORGANIZATION_TOOL = {
  type: "function",
  function: {
    name: "create_organization",
    description:
      'Mint a party/organization (Docs/10-galaxy-mapgen.md §6.2). parent_faction must resolve to an existing faction ref or the literal "dominion".',
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        ideology: { type: "string" },
        parent_faction: { type: "string", description: 'faction:<slug> or the literal "dominion".' },
        home_system: { type: ["string", "null"], description: "Typed ref, mutually exclusive with home_sector." },
        home_sector: { type: ["string", "null"], description: "Typed ref, mutually exclusive with home_system." },
        local_influence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["name", "ideology", "parent_faction"],
    },
  },
};

const APPLY_EVENT_TOOL = {
  type: "function",
  function: {
    name: "apply_event",
    description:
      "Submit a discrete, point-in-time event (Docs/10-galaxy-mapgen.md §9.2 authored mode) as a set of effects from the closed vocabulary. Deltas are clamped server-side to the magnitude's envelope — propose the specific value the event's description justifies, not just the ceiling.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        timestamp: { type: "string", description: "In-fiction date, e.g. 3025-04-11." },
        timestep: {
          type: "object",
          properties: {
            amount: { type: "number" },
            unit: { type: "string", enum: ["day", "week", "month", "year"] },
          },
          required: ["amount", "unit"],
        },
        magnitude: { type: "string", enum: MAGNITUDES },
        scope: { type: "array", items: { type: "string" }, description: "Every typed ref this event touches." },
        effects: {
          type: "array",
          items: {
            type: "object",
            description:
              "Fields used depend on op. Pick the op that matches what actually changed — these are easy to conflate, so read carefully: " +
              "adjust_control = a FACTION'S TERRITORIAL CONTROL/OWNERSHIP SHARE of a system (§4) — use for \"increase/strengthen/weaken X's control/grip/hold/influence over system Y\" (target=system ref, faction=faction ref, delta=share change -1..1). " +
              "set_owner = flip a system's owner outright (only for a full/decisive change of hands, needs a large delta). " +
              "adjust_security = the system's DOMINION SECURITY LEVEL (law-and-order/crime rate) — a completely different field from control; do NOT use this for \"control/grip/hold\" requests, only for requests actually about security/crime/lawfulness (target=system ref, delta). " +
              "adjust_relationship = how two factions feel about each other (a=faction ref, b=faction ref, delta). adjust_aggression = one faction's overall aggression level (faction=faction ref, delta). " +
              "adjust_focus = a sector's trade-goods weighting (target=sector ref, focus=new focus tag). adjust_influence = an actor's or organization's influence score (target=actor or party ref, delta). " +
              "set_affiliation = who an actor answers to (target=actor ref, affiliation=faction/party ref or null). relocate = where an actor is based (target=actor ref, location=system ref or null). " +
              "set_status = an actor's status field (target=actor ref, status). adjust_reputation = one actor's standing with one faction (actor=actor ref, faction=faction ref, delta). " +
              "add_tag/remove_tag = a free-text tag on any entity (target=any ref, tag).",
            properties: {
              op: { type: "string", enum: EFFECT_OPS },
              target: { type: "string" },
              faction: { type: "string" },
              a: { type: "string" },
              b: { type: "string" },
              actor: { type: "string" },
              delta: { type: "number" },
              status: { type: "string" },
              focus: { type: "string" },
              affiliation: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
              tag: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1, description: "How well-grounded this delta is in the request (0-1)." },
            },
            required: ["op"],
          },
        },
        narrative: { type: "string" },
      },
      required: ["name", "magnitude", "effects"],
    },
  },
};

// Balanced-brace scan for the first JSON object in free text, rather than a
// regex — a naive greedy `{...}` match can over-run past the real object's
// closing brace into trailing prose that also happens to contain braces.
function extractFirstJSONObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Some local models answer `auto` tool_choice by writing an entity record
// as plain-text JSON instead of actually calling one of the provided
// functions (confirmed live: a request to add an actor got back free text
// containing `{"type":"actor","name":"Aria Valeran",...}` shaped like an
// exported SDF entry, not a create_actor call). Rather than lose the
// proposal entirely, sniff the parsed object's shape and remap it into the
// same {name, arguments} shape extractToolCalls would have produced — best
// effort, same spirit as Pass 1's tryParseRefsFromText fallback above.
function tryParseProposalFromText(text) {
  if (!text) return null;
  const jsonText = extractFirstJSONObject(text);
  if (!jsonText) return null;
  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!obj.name) return null;
  const data = obj.data || {};
  const tags = Array.isArray(obj.tags) ? obj.tags : [];

  if (obj.type === "actor" || data.kind || obj.kind) {
    const role = tags.find((t) => t !== "individual" && t !== "group") || obj.role || "unspecified";
    return [
      {
        name: "create_actor",
        arguments: {
          name: obj.name,
          kind: data.kind || obj.kind || (tags.includes("group") ? "group" : "individual"),
          role,
          affiliation: data.affiliation ?? obj.affiliation ?? null,
          location: data.location ?? obj.location ?? null,
          mobile: !!(data.mobile ?? obj.mobile),
          influence: typeof data.influence === "number" ? data.influence : typeof obj.influence === "number" ? obj.influence : 0.2,
        },
      },
    ];
  }
  if (obj.type === "organization" || obj.type === "party" || data.ideology || obj.ideology) {
    return [
      {
        name: "create_organization",
        arguments: {
          name: obj.name,
          ideology: data.ideology || obj.ideology || "unspecified",
          parent_faction: data.parent_faction || obj.parent_faction || "dominion",
          home_system: data.home_system ?? obj.home_system ?? null,
          home_sector: data.home_sector ?? obj.home_sector ?? null,
          local_influence: typeof data.local_influence === "number" ? data.local_influence : typeof obj.local_influence === "number" ? obj.local_influence : 0.2,
        },
      },
    ];
  }
  if (obj.type === "event" || Array.isArray(obj.effects)) {
    return [
      {
        name: "apply_event",
        arguments: {
          name: obj.name,
          summary: obj.summary || "",
          tags,
          magnitude: obj.magnitude || "minor",
          scope: obj.scope || [],
          effects: obj.effects || [],
          narrative: obj.narrative || "",
        },
      },
    ];
  }
  return null;
}

// Typed refs are self-identifying ("system:kreel-1"); anything else in a
// ref-shaped field is a bare name the model wrote instead — either from the
// text fallback above, or (just as easily) from a real tool call, since
// nothing stops a compliant model from writing an entity's display name
// there instead of its ref despite the prompt's instructions. `fullContext`
// already has every shortlisted entity's real name right next to its ref,
// so resolve bare names against it rather than passing them through blind
// and letting them silently fail to match anything downstream.
const REF_LIKE = /^[a-z]+:[a-z0-9-]+$/i;

function buildNameLookup(entities) {
  const lookup = new Map();
  for (const e of entities) {
    const name = e.entry?.name;
    if (typeof name === "string" && !lookup.has(name.toLowerCase())) {
      lookup.set(name.toLowerCase(), e.ref);
    }
  }
  return lookup;
}

function resolveRef(value, lookup) {
  if (typeof value !== "string" || !value) return value;
  if (REF_LIKE.test(value)) return value;
  const resolved = lookup.get(value.toLowerCase());
  return resolved ?? value;
}

const ACTOR_REF_FIELDS = ["affiliation", "location"];
const ORG_REF_FIELDS = ["home_system", "home_sector"];
const EFFECT_REF_FIELDS = ["target", "faction", "a", "b", "actor", "affiliation", "location"];

function resolveRefsInCall(call, lookup) {
  const args = call.arguments;
  if (call.name === "create_actor") {
    for (const field of ACTOR_REF_FIELDS) if (args[field]) args[field] = resolveRef(args[field], lookup);
  } else if (call.name === "create_organization") {
    if (args.parent_faction && args.parent_faction !== "dominion") {
      args.parent_faction = resolveRef(args.parent_faction, lookup);
    }
    for (const field of ORG_REF_FIELDS) if (args[field]) args[field] = resolveRef(args[field], lookup);
  } else if (call.name === "apply_event") {
    if (Array.isArray(args.scope)) args.scope = args.scope.map((ref) => resolveRef(ref, lookup));
    if (Array.isArray(args.effects)) {
      for (const effect of args.effects) {
        for (const field of EFFECT_REF_FIELDS) if (effect[field]) effect[field] = resolveRef(effect[field], lookup);
      }
    }
  }
  return call;
}

export async function runPass2(settings, fullContext, requestText) {
  // Every ref MUST be sent explicitly alongside its entry — the entry
  // itself (systemToEntry/etc., §7) carries no ref/slug field at all, and
  // a system's slug can diverge from slugify(its current name) once it's
  // been renamed (renaming keeps the original slug on purpose, so
  // hyperlane/control references never break, App.jsx). Without the ref
  // spelled out, the model's only option is to guess one from the name —
  // works by coincidence for anything never renamed, silently produces an
  // unresolvable ref (confirmed live: "System not found: vraxis" for a
  // renamed system) otherwise.
  const contextText = fullContext.entities.map((e) => `${e.ref} => ${JSON.stringify(e.entry)}`).join("\n");
  const response = await chatCompletion({
    ...settings,
    tools: [CREATE_ACTOR_TOOL, CREATE_ORGANIZATION_TOOL, APPLY_EVENT_TOOL],
    toolChoice: "auto",
    messages: [
      {
        role: "system",
        content:
          "You are the deep/detail pass of a galaxy simulator (Docs/10-galaxy-mapgen.md §9.3). You've been given full records for every entity shortlisted as relevant, plus recent event history touching them. Each line below is `ref => entry` — the ref before \"=>\" is that entity's exact, real typed ref. Every target/faction/actor/a/b/affiliation/location field you output MUST be copied verbatim from one of these refs — never invent or derive a ref from an entity's name; a system's slug can differ from its current display name once renamed. If the request names something that isn't in the list below, say so in plain text instead of guessing a ref for it. You MUST respond by calling exactly one of the provided functions (create_actor, create_organization, or apply_event) — never write an entity record, SDF-shaped object, or any other JSON directly as your message content instead of calling a function, even if it looks like a natural way to answer. For apply_event, use only the closed effect vocabulary, pick a magnitude honestly reflecting how big a deal this is, and choose specific deltas the description justifies rather than maxing out the envelope — clamping is enforced downstream regardless.",
      },
      {
        role: "user",
        content: `Entities:\n${contextText}\n\nRecent events touching them: ${fullContext.events.join(", ") || "none"}\n\nRequest: ${requestText}`,
      },
    ],
  });
  const calls = extractToolCalls(response);
  const lookup = buildNameLookup(fullContext.entities);
  if (calls.length === 0) {
    const message = response.choices?.[0]?.message?.content;
    const fallback = tryParseProposalFromText(message);
    if (fallback) return fallback.map((c) => resolveRefsInCall(c, lookup));
    throw new Error(message ? `AI did not propose a tool call: ${message}` : "AI did not propose a tool call.");
  }
  return calls.map((c) => resolveRefsInCall(c, lookup));
}
