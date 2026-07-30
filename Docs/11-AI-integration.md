# 11 - AI Integration & Call Architecture

**Status:** Architecture Specification
**Context:** This document outlines the physical and logical integration of the LLM layer into the GalaxyGen application, targeting a split-host environment (lightweight UI host + heavy PC inference) and operating within strict resource boundaries (8GB VRAM).

---

## 1. Hardware Topology & Deployment

The AI integration relies on decoupling the application server from the inference server. This ensures the deterministic web UI remains snappy while offloading VRAM-intensive generative tasks to a dedicated GPU.

*   **Application Host (OrangePi / Mini-PC):**
    *   Runs the Vite + React frontend and the deterministic effect engine.
    *   Holds the canonical state of the galaxy (SDF file tree in memory).
    *   Acts as the **Client** to the AI model, crafting system prompts, injecting JSON schemas, and parsing tool-call responses.
*   **Inference Host (Desktop PC with NVIDIA RTX 3070 - 8GB VRAM):**
    *   Runs the local LLM server (Ollama).
    *   Exposes a local API endpoint (e.g., `http://192.168.x.x:11434/v1`) that implements the standard OpenAI chat completions format.

## 2. Local Model Configuration (Ollama)

To successfully run an intelligent instruction-tuned model (like **Qwen3 8B**) without causing VRAM overflow on an 8GB card, the Ollama service must be strictly constrained via environment variables on the Inference Host.

**Service Configuration (`systemctl edit ollama.service` or Windows Env Vars):**
```ini
# Restrict to a single loaded model to prevent VRAM fragmentation
OLLAMA_MAX_LOADED_MODELS=1

# Prevent concurrent requests from multiplying context window memory
OLLAMA_NUM_PARALLEL=1

# Cap the context window (tune between 4096 and 8192 based on system stability)
OLLAMA_CONTEXT_LENGTH=8192
```

By standardizing on a single versatile 8B model for both reasoning passes, we eliminate model-swapping latency. The model remains hot in VRAM, processing sequential requests instantly.

## 3. The Two-Pass Call Structure

Given the token limits and reasoning capacity of an 8B model, providing the entire galaxy state (1000+ systems, factions, and actors) in a single prompt will fail. AI calls are structured into two sequential passes using the exact same Qwen3 8B model.

### Pass 1: Broad Coherence (The Filter)
*   **Goal:** Determine *who* and *where* is relevant to the user's text input.
*   **Input Context:** A highly compressed index of the galaxy. Only names, slugs, and high-level tags (e.g., `[System: kreels-reach, Tags: frontier, mining, contested]`).
*   **Prompt Instruction:** "Identify which specific system slugs, faction slugs, and actor slugs are relevant to the following event: [User Input]."
*   **Output:** A small JSON array of referenced slugs. No tool calling or complex logic yet.

### Pass 2: Deep Detail (The Generator)
*   **Goal:** Reason about the specific entities and construct the structured tool call.
*   **Input Context:** The *full* JSON records (SDF data) of only the entities shortlisted in Pass 1, plus their recent event history.
*   **Prompt Instruction:** "You are the effect engine simulator. Based on the provided detailed profiles, map the user's request to the exact system tool call."
*   **Output:** A strict JSON Tool Call matching the system's predefined schemas (e.g., `apply_event`, `create_actor`).

## 4. API & Tool Calling Protocol

The OrangePi will communicate with the Inference Host using the industry-standard OpenAI Tool Calling API structure. This ensures compatibility whether the backend is local or cloud-based.

When crafting the `Pass 2` request, the OrangePi injects the MCP surface as tools:

```json
{
  "model": "qwen3:8b",
  "messages": [
    { "role": "system", "content": "You are a determinism engine for a galaxy simulator..." },
    { "role": "user", "content": "The Free Traders Coalition routed the Kreel Clans at Kreel's Reach." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "apply_event",
        "description": "Submit a discrete, point-in-time event with mechanical effects.",
        "parameters": {
          "type": "object",
          "properties": {
            "magnitude": { "type": "string", "enum": ["minor", "moderate", "major", "historic"] },
            "scope": { "type": "array", "items": { "type": "string" } },
            "effects": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "op": { "type": "string", "enum": ["adjust_control", "adjust_relationship", "set_system_status"] },
                  "target": { "type": "string" },
                  "delta": { "type": "number" },
                  "confidence": { "type": "number" }
                }
              }
            }
          }
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

The Qwen3 8B model will return a standard `tool_calls` block, which the OrangePi parses. The effect engine validates the deltas against the magnitude envelopes, applies them to the state, and records the event log.

## 5. Cloud Fallback & Routing

If the desktop PC is turned off, or if a highly complex `historic` event requires reasoning beyond the 8B model's capability, the system must seamlessly fall back to a cloud provider.

Since the application uses the OpenAI tool-calling schema, swapping backends requires zero code changes to the logic. 

**Environment Configuration on the OrangePi:**
```env
# Default Local Route
AI_API_BASE=http://192.168.x.x:11434/v1
AI_API_KEY=ollama
AI_MODEL_PASS_1=qwen3:8b
AI_MODEL_PASS_2=qwen3:8b

# Cloud Fallback Route (e.g., Anthropic / OpenRouter)
# AI_API_BASE=https://openrouter.ai/api/v1
# AI_API_KEY=sk-or-v1-...
# AI_MODEL_PASS_1=meta-llama/llama-3-8b-instruct
# AI_MODEL_PASS_2=anthropic/claude-3.5-sonnet
```

The frontend UI should include a **Model Settings Panel** to allow the GM to toggle between "Local GPU" and "Cloud Fallback" on the fly, applying these environment variables dynamically per pass.

## 6. Tool contract (§9.1 surface, firmed up against the current data model)

**Status: mostly spec — `query_galaxy`'s `index` mode is implemented
client-side (`GalaxyGen/src/lib/aiIndex.js`), the other four tools are not.**
This section freezes their request/response shapes against GalaxyGen's
actual current data model (`GalaxyGen/src/lib/persistence.js`,
`Docs/10-galaxy-mapgen.md` §7) so Phase 5's effect engine and Phase 6's MCP
server can be built directly against it without re-deriving field names
from scratch. Field names below match the SDF export exactly — an
implementation should not need to invent or rename anything.

### 6.1 Typed refs

Every scope/target/reference below is a typed slug string, never a bare
slug — this is what lets `query_galaxy`/`effects` disambiguate a faction
from an organization from an actor sharing a similar name:

| Prefix | Resolves to |
|---|---|
| `sector:<slug>` | `sectors/<slug>` |
| `system:<slug>` | `systems/<slug>` |
| `faction:<slug>` | `factions/<slug>` (never `dominion` — that's the implicit baseline, not a real entity) |
| `party:<slug>` | `organizations/<slug>` |
| `actor:<slug>` | `actors/<slug>` |

### 6.2 `query_galaxy` (read-only)

```json
// Request
{
  "scope": ["system:kreels-reach", "faction:kreel-clans"],
  "mode": "full",            // "index" (compact, §9.3 pass 1) | "full" (§9.3 pass 2)
  "include_events": 10        // optional: most recent N event slugs touching this scope
}
```
```json
// Response (mode: "full")
{
  "entities": [
    { "ref": "system:kreels-reach", "entry": { "...": "the exact systems/<slug>/entry.json shape" } },
    { "ref": "faction:kreel-clans", "entry": { "...": "the exact factions/<slug>/entry.json shape" } }
  ],
  "events": ["battle-of-kreels-reach", "kreel-clans-aggression-spike"]
}
```
`mode: "index"` returns the same `entities` shape but each `entry` is
replaced with a compact `{ ref, name, tags, summary, stats }` row (no full
`data` block) — this is the "compact index" §9.3's pass 1 reasons over,
scaled to the whole galaxy without blowing an 8B model's context. `tags`
carries cheap keyword signal (a system gets `"contested"`/`"landmark"`/
`"station-only"` auto-appended on top of its normal tags; a faction gets
`"anchored"` if it holds a home system; an actor gets `"background"` vs.
`"curated"`); `stats` carries the handful of precise numbers/booleans a
tag can't (system: `important`, `owner`, `contested`, `war_chance`;
faction: `strength`, `aggression`, `home_system`; actor: `influence`,
`status`, `affiliation`, `location`; organization: `local_influence`,
`member_count`) — text alone loses "why," numbers alone lose "at a
glance," so both travel on every row. `scope` can also be the literal
string `"all"` in index mode only, for a pass-1 call that needs the entire
galaxy's index at once; `"all"` is rejected in `full` mode (too large —
pass 2 must shortlist first).

**Implemented today**: `GalaxyGen/src/lib/aiIndex.js` exports
`buildGalaxyIndex(project, scope)` (the `entities` array above — pass an
array of typed refs to scope it, or omit for the `"all"` case) and
`buildGalaxyIndexEnvelope(project)` (wraps it with `sdf`/`type`/
`generated_at`/`seed`/`entity_count`, the shape actually written to disk).
"Export SDF" now writes this envelope to `index.json` at the tree root
automatically; a standalone **Download AI index** button (Toolbar → AI
index) grabs just this file so it can be pasted into any LLM chat today,
with no backend or tool-calling plumbing required yet. What's still
missing is the live `query_galaxy` call itself (an actual request/response
round-trip with an inference host) and `mode: "full"` — right now only the
compact `entities` array exists; there's no handler that resolves a scope
of typed refs back into full SDF entries on demand.

### 6.3 `create_actor`

```json
// Request — every field maps directly onto actors/<slug>/entry.json's `data` block
{
  "name": "Aria Valeran",
  "kind": "individual",              // "individual" | "group"
  "role": "politician",              // free-text flavor tag, same field GM-authored actors use
  "affiliation": "party:vernak-libertarian-party",  // typed ref or null
  "location": "system:vernak",       // typed ref or null (unplaced)
  "mobile": false,
  "influence": 0.2
}
```
```json
// Response
{ "proposed": { "ref": "actor:aria-valeran", "entry": { "...": "the entry that would be written" } } }
```
`origin` is always forced to `"authored"` server-side — this tool can never
mint a `"generated"` (background, §6.1) actor; background actors only come
from the bulk auto-seed pass. `status` defaults `"active"`, `reputation`
defaults `{}`. Slug collision handling matches the existing UI form
(`uniqueSlug` — append `-2`, `-3`, ... on collision, never silently
overwrite).

### 6.4 `create_organization`

```json
// Request
{
  "name": "Vernak Libertarian Party",
  "ideology": "libertarian",
  "parent_faction": "faction:free-traders-coalition",  // required; must resolve to an existing faction, or the literal "dominion"
  "home_system": "system:vernak",     // optional, mutually exclusive with home_sector (§6.2)
  "home_sector": null,
  "local_influence": 0.2
}
```
```json
// Response
{ "proposed": { "ref": "party:vernak-libertarian-party", "entry": { "...": "the entry that would be written" } } }
```
`parent_faction` resolving to nothing is a hard validation failure, not a
silent fallback to Dominion — per §9.1's worked example, creation always
hooks onto a pre-existing faction the caller found via `query_galaxy`
first, never invents one. `members` is never part of the request — it's
always derived (§6.2), so passing it is a validation error.

### 6.5 `apply_event`

**Status: implemented.** `GalaxyGen/src/lib/effectEngine.js` is a complete,
tested implementation of this tool's actual mechanics — `applyEvent(project,
draft)` runs every effect below through the magnitude envelope, the
ownership-flip gate, and the derived-field re-computation, and the Events
tab (§13 Phase 5) is a hand-authored client for it. What's still missing is
the AI-facing wrapper: nothing yet turns natural-language text into an
event draft, and there's no live request/response round-trip with an
inference host — an AI layer calling this tool just needs to produce the
same draft shape the Events form already builds and hands to
`applyEvent`.

```json
// Request — identical to the events/<slug>/entry.json data block (§7)
{
  "name": "Battle of Kreel's Reach",
  "summary": "Free Traders Coalition routs Kreel Clan raiders at Kreel's Reach.",
  "tags": ["conflict", "border"],
  "timestamp": "3025-04-11",
  "timestep": { "amount": 1, "unit": "day" },
  "mode": "authored",
  "magnitude": "major",
  "scope": ["system:kreels-reach", "faction:free-traders-coalition", "faction:kreel-clans", "actor:governor-yeselle-tarn"],
  "effects": [
    { "op": "adjust_control", "target": "system:kreels-reach", "faction": "faction:free-traders-coalition", "delta": 0.27, "confidence": 0.8 },
    { "op": "adjust_relationship", "a": "faction:free-traders-coalition", "b": "faction:kreel-clans", "delta": -0.22, "confidence": 0.8 },
    { "op": "adjust_aggression", "faction": "faction:kreel-clans", "delta": -0.08, "confidence": 0.6 },
    { "op": "adjust_reputation", "actor": "actor:governor-yeselle-tarn", "faction": "faction:free-traders-coalition", "delta": 0.1, "confidence": 0.5 }
  ],
  "narrative": "Free-form GM/agent text — flavor/history only, never read by the effect engine."
}
```
```json
// Response — a diff, not a silent write; GM reviews this before commit
// unless magnitude === "minor" (§9 pipeline step 3)
{
  "event": { "ref": "event:battle-of-kreels-reach", "entry": { "...": "the entry that would be written" } },
  "diff": [
    { "ref": "system:kreels-reach", "field": "control", "before": { "...": "..." }, "after": { "...": "..." } },
    { "ref": "faction:kreel-clans", "field": "relationships.free-traders-coalition", "before": -0.3, "after": -0.52 }
  ],
  "requires_review": true
}
```

**Closed `effects` op vocabulary** — this is the entire surface; anything
outside this table cannot be expressed as an effect:

| `op` | Applies to | Fields |
|---|---|---|
| `adjust_control` | system | `target`, `faction`, `delta` |
| `set_owner` | system | `target`, `faction`, `delta` (the control-shift being claimed — any magnitude can flip ownership, §9.2/§12, not gated to `historic`, but `delta` must clear both the magnitude envelope *and* a separate fixed minimum, 0.15 by default, or the call is rejected outright) |
| `set_system_status` | system | `target`, `status` (`active`\|`destroyed`\|`quarantined`\|`uninhabitable`) — `destroyed`/`quarantined` cascade: sever that system's hyperlane edges, force a security/`war_chance` re-derive on every former neighbor |
| `adjust_security` | system | `target`, `delta` |
| `adjust_relationship` | faction↔faction | `a`, `b`, `delta` (symmetric — same value written to both factions' `relationships`) |
| `adjust_aggression` | faction | `faction`, `delta` |
| `adjust_focus` | sector | `target`, `focus` (nudges the sector's trade-goods weighting, §5) |
| `adjust_influence` | actor \| organization | `target`, `delta` |
| `set_affiliation` | actor | `target`, `affiliation` (typed ref or null) |
| `relocate` | actor | `target`, `location` (typed ref or null) |
| `set_status` | actor | `target`, `status` |
| `adjust_reputation` | actor→faction | `actor`, `faction`, `delta` |
| `add_tag` / `remove_tag` | any entity | `target`, `tag` |

Every numeric `delta` is clamped server-side to the requested
`magnitude`'s envelope (a small GM-tunable config table — e.g. `minor` caps
`adjust_control`/`adjust_relationship` at ±0.05, `major` allows ±0.35,
`historic` allows an outright flip) — this is a hard ceiling, not a target;
the caller should still propose the specific value it judges right within
that ceiling, not just max it out. Every effect's `confidence` (0–1) is
used engine-side to pull low-confidence deltas toward a narrower
sub-range automatically before the ceiling clamp — richly-detailed,
high-confidence events get to use more of the envelope; a one-line rumor
does not, even at the same nominal magnitude. Implemented as
`envelopeCap = base * (0.3 + 0.7 * confidence)` in `effectEngine.js` — a
reasonable placeholder curve, not one derived from the design doc (which
leaves the exact shape unspecified); confidence `1` (the only value
hand-authored events ever pass) uses the full envelope, so this is
currently inert until an AI layer starts passing anything lower.

### 6.6 `project_timestep`

```json
// Request
{
  "scope": ["sector:kreels-reach-border"],
  "duration": { "amount": 1, "unit": "month" },
  "prompt": "Given current tension and trade patterns, project how this border develops."
}
```
```json
// Response — always several linked ordinary events, never one aggregate
// blob (§9.2/§12: "many events always, makes it easier to track")
{
  "events": [
    { "ref": "event:...", "entry": { "...": "same shape as apply_event's request, mode: \"projection\"", "timestamp": "3025-04-18" } },
    { "ref": "event:...", "entry": { "...": "...", "timestamp": "3025-05-02" } }
  ]
}
```
Each event in the batch is independently reviewed or auto-committed by its
own `magnitude` (same `minor`-skips-review rule as `apply_event`) — a
`project_timestep` call is not one review gate, it's N of them, one per
decomposed event, exactly as if the GM had called `apply_event` N times.
