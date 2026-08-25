// Minimal OpenAI-compatible /chat/completions client for the narrow
// LLM-assisted step in normalize-entries.js — same conventions as
// GalaxyGen/src/lib/aiClient.js (Docs/11-AI-integration.md), ported to
// Node's built-in fetch since this runs as a CLI script, not a browser.
// Deliberately single-shot, no tool-calling: each call is a small, bounded
// question ("does this replaces-sentence clause apply to race X, and which
// of these known trait ids does it match?"), not an open-ended agent loop,
// so a plain "answer in JSON" instruction plus a tolerant parser is enough.

// 120s default, not 30s: the first call after the server starts (or after
// switching models) has to load the model into VRAM/RAM before it can
// answer at all — confirmed live, a qwen3:8b request aborted at 30s with
// no other error, and succeeded once given more room.
//
// think:false + max_tokens are both load-bearing, not defensive padding —
// confirmed live against a real Qwen3 8B/Ollama setup: without them, one
// call ran away decoding 7,800+ tokens of hidden reasoning before hitting
// the 120s abort (server log: "task 920 ... n_decoded = 7821" climbing,
// then "500 | 2m0s"), for a question that only ever needs a one-line JSON
// answer. `think: false` is Ollama's own extension for hybrid-reasoning
// models (Qwen3, DeepSeek-R1-distills, ...) — harmless on providers that
// don't recognize it, since unknown JSON fields are ignored, not rejected.
// `max_tokens` is standard OpenAI-compatible and is the actual hard
// backstop if a model ignores think:false (or doesn't support it) and
// starts rambling anyway.
// One /chat/completions round trip — returns the raw content string (or
// throws). response_format: json_object is the standard OpenAI JSON-mode
// flag; Ollama's OpenAI-compat route honors it (unrecognized fields are
// ignored elsewhere by other providers, so this is safe to send always).
// It measurably helps but doesn't eliminate free-text replies on its own —
// confirmed live, Qwen3 8B still occasionally answers in prose despite it,
// which is what the retry in askOllamaJson() below is for.
async function chatOnce({ url, model, messages, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        think: false,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    throw new Error(`Couldn't reach ${url}: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  const message = body.choices?.[0]?.message;
  // Confirmed live: ~1/3 of real calls came back with an empty `content`
  // and finish_reason "length" — Qwen3's hidden reasoning tokens (which
  // think:false is supposed to suppress) still ate the whole max_tokens
  // budget before any visible answer was written, on some calls but not
  // others. `reasoning`/`reasoning_content` is where Ollama surfaces that
  // hidden text when it does leak through — worth a fallback parse attempt
  // before giving up, since the model may still have "said" the answer
  // there even though the visible `content` field is empty.
  const content = message?.content || message?.reasoning_content || message?.reasoning;
  if (!content) {
    const finishReason = body.choices?.[0]?.finish_reason;
    throw new Error(`Ollama response had no message content (finish_reason: ${finishReason ?? "unknown"}) — likely hit max_tokens before producing visible output.`);
  }
  return content;
}

export async function askOllamaJson({ baseUrl, model, system, user, timeoutMs = 120000, maxTokens = 800 }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const systemMsg = { role: "system", content: `${system}\nRespond with a single JSON object only — no prose, no markdown fences, no explanation.` };
  const userMsg = { role: "user", content: user };

  const first = await chatOnce({ url, model, messages: [systemMsg, userMsg], maxTokens, timeoutMs });
  try {
    return parseJsonLoose(first);
  } catch (firstErr) {
    // One retry, not an open-ended loop: replay the conversation with the
    // model's own bad answer attached, explicitly told it was rejected and
    // why, then ask again — a real second pass with corrective feedback,
    // not just resending the same prompt and hoping for a different roll.
    const retryMessages = [
      systemMsg,
      userMsg,
      { role: "assistant", content: first.slice(0, 1000) },
      { role: "user", content: "That wasn't a valid JSON object (or wasn't parseable). Respond again with ONLY the JSON object — no explanation, no markdown fences, nothing before or after it." },
    ];
    let second;
    try {
      second = await chatOnce({ url, model, messages: retryMessages, maxTokens, timeoutMs });
    } catch (retryErr) {
      throw new Error(`First reply wasn't parseable JSON (${firstErr.message}), and the retry call failed too: ${retryErr.message}`);
    }
    return parseJsonLoose(second);
  }
}

// Models that ignore "respond with JSON only" sometimes wrap it in prose or
// a markdown fence — same fallback GalaxyGen's aiClient.js uses for its
// pass 1/2 tool-call fallbacks: scan for the first {...} block.
function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(`Couldn't parse a JSON object out of the model's response: ${text.slice(0, 200)}`);
  }
}

// Returns { ok, url, reason } instead of a bare boolean — a silent `false`
// was useless for debugging a real failure (Ollama confirmed running via
// its own "address already in use" error on a second `ollama serve`, yet
// this still reported unreachable). Tries a couple of candidate
// URL/endpoint combinations before giving up: Node's fetch (undici) can
// resolve "localhost" to the IPv6 ::1 first and stall/fail if the server
// only bound the IPv4 loopback, and older Ollama builds don't implement
// the OpenAI-compat `/v1/models` endpoint at all (only its native
// `/api/tags`) — either alone can make a real, running server look dead.
export async function pingOllama(baseUrl, timeoutMs = 2500) {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const alt = root.replace("//localhost", "//127.0.0.1");
  const candidates = [...new Set([`${root}/v1/models`, `${root}/api/tags`, `${alt}/v1/models`, `${alt}/api/tags`])];

  let lastReason = "no candidates tried";
  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return { ok: true, url };
      lastReason = `${url} -> HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timeout);
      lastReason = `${url} -> ${err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err.message}`;
    }
  }
  return { ok: false, reason: lastReason };
}
