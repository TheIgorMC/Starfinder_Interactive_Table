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

### 2.1 Quick setup for testing against GalaxyGen's AI tab today

The AI tab calls whatever endpoint you give it directly from the browser
— there's no backend to configure yet, so this is the whole setup:

1. **Install Ollama** (https://ollama.com) on whichever machine will run
   inference — same machine as the browser is fine for local testing.
2. **Pull a tool-calling-capable model**, e.g.:
   ```
   ollama pull qwen3:8b
   ```
   (Any model Ollama lists as supporting tool/function calling works —
   Qwen3, Llama 3.1+, Mistral Nemo, etc. A model without tool-calling
   support will not be able to return the structured `shortlist`/
   `create_actor`/`apply_event` calls the AI tab expects.)
3. **Set `OLLAMA_ORIGINS`** so Ollama's server accepts a browser request
   from GalaxyGen's dev-server origin — Ollama rejects cross-origin
   requests by default. On the machine running Ollama:
   - Windows: set the `OLLAMA_ORIGINS` environment variable (System
     Properties → Environment Variables, or `setx OLLAMA_ORIGINS "*"` in
     an elevated shell) and restart Ollama.
   - Linux (systemd): `sudo systemctl edit ollama.service`, add under
     `[Service]`:
     ```ini
     Environment="OLLAMA_ORIGINS=*"
     ```
     then `sudo systemctl restart ollama`.
   - `*` allows any origin — fine for local testing; scope it to
     `http://localhost:5174` (GalaxyGen's dev port) if you want it
     tighter.
4. **Start Ollama** (`ollama serve`, or it may already be running as a
   service after install) — it listens on `http://localhost:11434` by
   default.
5. **In GalaxyGen's AI tab**, set:
   - API base URL: `http://localhost:11434/v1` (Ollama's OpenAI-compatible
     endpoint — note the `/v1` suffix)
   - API key: leave blank (Ollama doesn't require one locally)
   - Model: `qwen3:8b` (or whatever you pulled)
6. Type a request and click **Ask AI**. If the base URL is unreachable or
   CORS-blocked, the panel surfaces a clear error naming the URL and
   suggesting the `OLLAMA_ORIGINS` fix above.

Using a cloud provider instead (OpenAI, Anthropic, OpenRouter) works the
same way — set the base URL to their API root (e.g.
`https://api.openai.com/v1`), paste a real API key, and use one of their
model names. No `OLLAMA_ORIGINS`-equivalent step is needed for most cloud
providers; Anthropic specifically requires a direct-browser-access header,
which the AI tab already sends on every request.

## 3. The Two-Pass Call Structure

Given the token limits and reasoning capacity of an 8B model, providing the entire galaxy state (1000+ systems, factions, and actors) in a single prompt will fail. AI calls are structured into two sequential passes using the exact same Qwen3 8B model.

### Pass 1: Broad Coherence (The Filter)
*   **Goal:** Determine *who* and *where* is relevant to the user's text input.
*   **Input Context:** A highly compressed index of the galaxy. Only names, slugs, and high-level tags (e.g., `[System: kreels-reach, Tags: frontier, mining, contested]`).
*   **Prompt Instruction:** "Identify which specific system slugs, faction slugs, and actor slugs are relevant to the following event: [User Input]."
*   **Output:** A small JSON array of referenced slugs. No tool calling or complex logic yet.
*   **Confirmed live**: at real galaxy scale (~2300 entities in testing), sending the whole compact index blew a 45k-token prompt past a 4k-context local model, which silently truncated it and never even reached the actual request — Pass 1 came back empty every time. `aiClient.js`'s `runPass1` now pre-narrows candidates by a cheap lexical relevance score (how many significant words from the request appear in each entity's name/ref/tags), greedily keeping the highest-scoring entities up to a **character budget** (not a fixed entity count — line length varies too much with tag count for a flat cap to reliably bound prompt size) before ever calling the model. This is the local, no-embedding-model stand-in for the "plain embedding-similarity retrieval" §10 calls for. Below the budget, nothing is filtered.
    - The budget (`MAX_PASS1_INDEX_CHARS = 6000`, ≈1500 tokens at a ~4-char/token estimate) is deliberately conservative — testing against a real local setup (Qwen3 8B via Ollama, default unconfigured context) showed only ~2000 tokens are actually usable for the prompt even though the server reports a 4096-token context (the rest is server-reserved headroom). An earlier 200-*entity* cap (no character budget) still produced prompts too large for that setup. If you've raised `OLLAMA_CONTEXT_LENGTH` (§2) to get a bigger usable window, raising `MAX_PASS1_INDEX_CHARS` correspondingly gives Pass 1 more of the galaxy to reason over and improves shortlist recall.
    - **Confirmed live**: this exact local setup (Qwen3 8B, Ollama, forced `tool_choice` pinned to the `shortlist` function) still answered in free text instead of calling the tool. `runPass1` now falls back to scanning that free text for a JSON `{"refs": [...]}` object (or a bare typed-ref array) before giving up — turns an otherwise total failure into a working shortlist whenever the model at least attempts a parseable answer, independent of whether it honors forced tool-calling.

### Pass 2: Deep Detail (The Generator)
*   **Goal:** Reason about the specific entities and construct the structured tool call.
*   **Input Context:** The *full* JSON records (SDF data) of only the entities shortlisted in Pass 1, plus their recent event history.
*   **Prompt Instruction:** "You are the effect engine simulator. Based on the provided detailed profiles, map the user's request to the exact system tool call."
*   **Output:** A strict JSON Tool Call matching the system's predefined schemas (e.g., `apply_event`, `create_actor`).
*   **Fixed a real bug found live**: `runPass2` was serializing each shortlisted entity's SDF entry (`JSON.stringify(e.entry)`) without its `ref` — the entry itself (`systemToEntry`/etc., §7) carries no ref/slug field at all. The model therefore had no ground truth for the actual typed ref and had to derive one from the entity's display name, which only happens to work when a system's slug still equals `slugify(name)` — i.e. it was never renamed (renaming intentionally keeps the original slug, so hyperlane/control references never break). Confirmed live: a system renamed to "Vraxis" (real slug unrelated to the name) made the model invent `system:vraxis`, which the effect engine correctly rejected with "System not found: vraxis." Fixed by sending each entity as `<ref> => <entry JSON>` and instructing the model explicitly to copy refs verbatim, never derive them from a name. Re-verified live with a system named "Vraxis" whose real slug was unrelated: the fixed prompt correctly exposes the real ref, and a proposal using it resolves cleanly.
*   **Op confusion, confirmed live**: with the ref bug fixed, a real Qwen3 8B response for "increase X's control over system Y" picked `adjust_security` (Dominion security/crime level) instead of `adjust_control` (territorial ownership share, §4) — a plausible-sounding but wrong op, landing on a field that happened to already be maxed at 1.0 so the diff correctly rendered as a no-op (`1 → 1`), which was at least a visible tell something was off. The `APPLY_EVENT_TOOL` schema's `effects` array previously only pointed at this doc's §6.5 table for per-op field guidance — no help to a model that's never read it. Added an explicit inline cheat-sheet to the schema description distinguishing every op in one line each, specifically calling out that `adjust_control` (territorial share) and `adjust_security` (Dominion security level) are different fields not to be conflated. This is a prompt-quality improvement, not a guarantee — an 8B model can still pick the wrong op; if it keeps happening, try a stronger Pass 2 model (a bigger local model, or a cloud model) even while keeping a cheap one for Pass 1's broad filtering.
*   **Tool call skipped entirely, confirmed live**: unlike Pass 1's forced `tool_choice`, Pass 2 uses `auto`, so nothing stops the model from answering in free text instead of calling `create_actor`/`create_organization`/`apply_event`. Confirmed live: a request to add an actor got back a plain-text JSON object shaped like an exported SDF entry (`{"type":"actor","name":"Aria Valeran","data":{"kind":"individual",...}}`) instead of a real tool call. `runPass2` now has the same class of fallback Pass 1 already had — on no tool call, it scans the response text for a JSON object and, if its shape (`type`/`data.kind`, `ideology`, `effects` array, etc.) matches one of the three tools, remaps it into that tool's argument shape before giving up. The system prompt was also strengthened to explicitly forbid writing an entity record directly instead of calling a function. Best effort, not a guarantee — a response in a genuinely unrecognized shape still surfaces as a plain error.

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

**Status: implemented client-side, no separate backend yet.**
`query_galaxy` (both `index` and `full` mode), `create_actor`, and
`apply_event` are all real, working code paths, wired into a two-pass AI
loop (§9.3) that calls out to any OpenAI-compatible `/chat/completions`
endpoint directly from the browser (`GalaxyGen/src/lib/aiClient.js`,
`aiIndex.js`, `aiQuery.js`, `effectEngine.js`) — see the GalaxyGen tab
"AI". `create_organization` shares the exact same tool-calling and commit
path as `create_actor` but hasn't been separately exercised end-to-end.
`project_timestep` is not implemented at all. What's still missing
relative to §1-5 above: the actual split-host deployment (a real
"Application Host" backend, the Ollama VRAM/model config, the cloud-
fallback toggle) — for now the browser *is* the Application Host, which
works for local testing but isn't the deployed shape. Field names below
match the SDF export exactly — an implementation should not need to
invent or rename anything.

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
with no backend or tool-calling plumbing required yet.

`mode: "full"` is now also implemented: `GalaxyGen/src/lib/aiQuery.js`
exports `queryGalaxyFull(project, scope, includeEvents)`, resolving a
scope of typed refs to the exact same entry shape `persistence.js`'s
`Export SDF` writes (imported directly from there — zero duplicated
logic), plus recent event slugs whose `scope` overlaps the query. The
AI tab's Pass 2 calls this directly on the shortlist Pass 1 returned.
What's still missing is `query_galaxy` as an independently-callable tool
inside an agent loop — right now it's only ever invoked as a fixed step in
a two-pass pipeline the app drives itself, not something the model decides
to call (or not) on its own.

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

**Implemented today**: `AIPanel.jsx`'s Pass 2 can propose this tool; a
confirmed proposal is converted (typed refs stripped to the app's internal
bare-slug/field shapes) and handed to `App.jsx`'s existing
`handleCreateActor` — the exact function the manual "+ New Actor" form
calls, so `origin: "authored"` and every other convention above is
enforced for free, not re-implemented. Verified live with a mocked
response.

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

**Implemented today**: the tool schema is wired into Pass 2 alongside
`create_actor` and `apply_event`, dispatching to `App.jsx`'s existing
`handleCreateOrganization` on confirm — same code path, same validation.
Not separately exercised end-to-end in the session that built this (only
`create_actor` and `apply_event` proposals were live-tested), but it's
the identical dispatch pattern.

### 6.5 `apply_event`

**Status: implemented, both mechanics and the AI-facing wrapper.**
`GalaxyGen/src/lib/effectEngine.js` is a complete, tested implementation of
this tool's actual mechanics — `applyEvent(project, draft)` runs every
effect below through the magnitude envelope, the ownership-flip gate, and
the derived-field re-computation. The Events tab (§13 Phase 5) is a
hand-authored client for it; the **AI tab** (§13 Phase 6,
`GalaxyGen/src/components/AIPanel.jsx`) is the AI-driven one — Pass 2 can
propose this tool, and a confirmed proposal is handed to the exact same
`applyEvent`-backed commit path (`App.jsx`'s `handleCommitEvent`), including
the same Preview-then-Confirm review gate the manual form uses. Verified
live end-to-end with a mocked chat-completions response. Still missing:
a real inference host (this all currently runs against a local/cloud
endpoint called directly from the browser, not the split-host deployment
§1-5 describe) and the actual natural-language classification quality,
which depends entirely on whatever model is configured — nothing here
constrains or evaluates that.

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
leaves the exact shape unspecified). Hand-authored events always pass
confidence `1` (full envelope); the AI tab's `apply_event` proposals now
actually exercise this with real sub-1 values from the model's tool call
(verified live: a proposed effect carrying `confidence: 0.9` round-tripped
through commit unchanged), so this is no longer inert — just still
un-tuned against real model output at scale.

### 6.6 `project_timestep`

**Status: not implemented.** Nothing in the AI tab requests a projection —
`AIPanel.jsx` only ever asks Pass 2 for one of `create_actor`/
`create_organization`/`apply_event`. Since a projection is defined as
decomposing into several linked ordinary `apply_event`-shaped records,
implementing it is mostly a prompting/orchestration problem (ask the model
for a list of events instead of one, then commit each through the exact
same `applyEvent` path already built) rather than new engine work — but
that orchestration and its own review-gate-per-event UI don't exist yet.

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
