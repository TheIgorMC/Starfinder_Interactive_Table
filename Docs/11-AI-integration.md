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
