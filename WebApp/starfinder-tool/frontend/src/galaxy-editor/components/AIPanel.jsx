import { useEffect, useRef, useState } from "react";

// Docs/10-galaxy-mapgen.md §9.1/§9.3, Docs/11-AI-integration.md §6 — the
// GM-facing side of the two-pass AI loop, as a scrolling chat window: each
// request becomes a user bubble, the broad/deep pass progress and the
// eventual proposal become an assistant bubble (a diff card for
// apply_event, a plain-language summary for the creation tools) reviewed
// inline before anything commits. Every commit reuses the exact same
// handlers the manual forms already use — an AI proposal gets no special
// privileges over a hand-typed one.
export default function AIPanel({ settings, onSettingsChange, onRunPass1, onRunPass2, onPreviewProposal, onConfirmProposal, resolveRefName }) {
  const [messages, setMessages] = useState([]);
  const [requestText, setRequestText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(!settings.baseUrl || !settings.model);
  const listRef = useRef(null);
  const nextId = useRef(1);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function addMessage(msg) {
    const id = nextId.current++;
    setMessages((list) => [...list, { id, ...msg }]);
    return id;
  }

  function updateMessage(id, patch) {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function handleSend() {
    const text = requestText.trim();
    if (!text || busy) return;
    setRequestText("");
    addMessage({ role: "user", kind: "text", content: text });
    const replyId = addMessage({ role: "assistant", kind: "status", content: "Shortlisting relevant entities…" });
    setBusy(true);
    try {
      const refs = await onRunPass1(text);
      updateMessage(replyId, { content: "Drafting a proposal…", shortlist: refs });
      const calls = await onRunPass2(text, refs);
      const [proposal, ...rest] = calls;
      let preview = null;
      if (proposal.name === "apply_event") {
        try {
          preview = { diffs: onPreviewProposal(proposal) };
        } catch (err) {
          preview = { error: err.message };
        }
      }
      updateMessage(replyId, {
        kind: "proposal",
        content: null,
        proposal,
        preview,
        extraCount: rest.length,
        resolved: null,
      });
    } catch (err) {
      updateMessage(replyId, { kind: "error", content: err.message });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleConfirm(msg) {
    try {
      onConfirmProposal(msg.proposal);
      updateMessage(msg.id, { resolved: "confirmed" });
    } catch (err) {
      addMessage({ role: "assistant", kind: "error", content: err.message });
    }
  }

  function handleReject(msg) {
    updateMessage(msg.id, { resolved: "rejected" });
  }

  return (
    <div className="gg-chat">
      <div className="gg-chat-header">
        <button className="gg-link" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? "Hide" : "Show"} AI settings
        </button>
        {!showSettings && (
          <span className="small muted">
            {settings.model || "no model set"} @ {settings.baseUrl || "no endpoint set"}
          </span>
        )}
      </div>

      {showSettings && (
        <div className="gg-new-form" style={{ marginTop: 0, marginBottom: 8 }}>
          <label className="small muted">API base URL</label>
          <input
            value={settings.baseUrl}
            onChange={(e) => onSettingsChange({ ...settings, baseUrl: e.target.value })}
            placeholder="e.g. http://localhost:11434/v1"
          />
          <label className="small muted">API key (optional — leave blank for a local Ollama server)</label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => onSettingsChange({ ...settings, apiKey: e.target.value })}
          />
          <label className="small muted">Model</label>
          <input
            value={settings.model}
            onChange={(e) => onSettingsChange({ ...settings, model: e.target.value })}
            placeholder="e.g. qwen3:8b, gpt-4o-mini, claude-sonnet-5"
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Settings are saved to this browser only — never part of a project file or SDF export.
          </p>
        </div>
      )}

      <div className="gg-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="muted small">
            Type a creation command or a discrete event below — e.g. "add a
            governor to Vernak called Aria Valeran" or "the Free Traders
            Coalition routed the Kreel Clans at Kreel's Reach."
          </p>
        )}
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            msg={m}
            onConfirm={() => handleConfirm(m)}
            onReject={() => handleReject(m)}
            resolveRefName={resolveRefName}
          />
        ))}
      </div>

      <div className="gg-chat-input-row">
        <textarea
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ask the AI… (Enter to send, Shift+Enter for a new line)"
        />
        <button disabled={!requestText.trim() || busy} onClick={handleSend}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// A typed ref (§6) is a stable identifier, not display text — once a
// system/faction/actor/etc. has been renamed, its ref stops resembling its
// current name at all (renaming intentionally keeps the original slug,
// App.jsx). Showing "Vraxis (system:kreel-1)" instead of a bare
// "system:kreel-1" is what actually makes an AI proposal legible against a
// galaxy with manually-renamed entities, without having to churn every
// stored reference (including past events' history) on every rename.
function RefLabel({ refId, resolveRefName }) {
  const name = resolveRefName?.(refId);
  return <>{name ? `${name} (${refId})` : refId}</>;
}

function ChatMessage({ msg, onConfirm, onReject, resolveRefName }) {
  if (msg.kind === "text") {
    return (
      <div className={`gg-chat-msg ${msg.role}`}>
        <p>{msg.content}</p>
      </div>
    );
  }
  if (msg.kind === "status") {
    return (
      <div className="gg-chat-msg assistant status">
        <p className="small muted">{msg.content}</p>
      </div>
    );
  }
  if (msg.kind === "error") {
    return (
      <div className="gg-chat-msg assistant error">
        <p className="small">{msg.content}</p>
      </div>
    );
  }
  if (msg.kind === "proposal") {
    return (
      <div className="gg-chat-msg assistant">
        {msg.shortlist?.length > 0 && (
          <p className="small muted">
            Considered:{" "}
            {msg.shortlist.map((ref, i) => (
              <span key={ref}>
                {i > 0 && ", "}
                <RefLabel refId={ref} resolveRefName={resolveRefName} />
              </span>
            ))}
          </p>
        )}
        <p className="small muted">
          <strong>{msg.proposal.name}</strong>
          {msg.extraCount > 0 && ` — ${msg.extraCount + 1} actions proposed; showing the first. Send another message after committing for the rest.`}
        </p>
        <ProposalSummary proposal={msg.proposal} resolveRefName={resolveRefName} />
        {msg.preview?.error && <p className="small" style={{ color: "#e6a3a3" }}>{msg.preview.error}</p>}
        {msg.preview?.diffs?.map((d, i) => (
          <p key={i} className="small muted">
            {d.op} · <RefLabel refId={d.ref} resolveRefName={resolveRefName} /> · {d.field}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
          </p>
        ))}
        {!msg.resolved && (
          <div className="gg-tool-row" style={{ marginTop: 8 }}>
            <button disabled={!!msg.preview?.error} onClick={onConfirm}>Confirm &amp; commit</button>
            <button className="gg-danger" onClick={onReject}>Reject</button>
          </div>
        )}
        {msg.resolved === "confirmed" && <p className="small muted" style={{ marginTop: 6 }}>✓ Committed.</p>}
        {msg.resolved === "rejected" && <p className="small muted" style={{ marginTop: 6 }}>✗ Rejected.</p>}
      </div>
    );
  }
  return null;
}

function ProposalSummary({ proposal, resolveRefName }) {
  const args = proposal.arguments;
  if (proposal.name === "create_actor") {
    return (
      <p className="small muted">
        {args.name} — {args.kind}, {args.role}
        {args.affiliation ? <> , affiliated with <RefLabel refId={args.affiliation} resolveRefName={resolveRefName} /></> : ""}
        {args.location ? <> , at <RefLabel refId={args.location} resolveRefName={resolveRefName} /></> : ", unplaced"}
      </p>
    );
  }
  if (proposal.name === "create_organization") {
    return (
      <p className="small muted">
        {args.name} — {args.ideology}, under{" "}
        {args.parent_faction === "dominion" ? "dominion" : <RefLabel refId={args.parent_faction} resolveRefName={resolveRefName} />}
      </p>
    );
  }
  if (proposal.name === "apply_event") {
    return (
      <p className="small muted">
        {args.name} · {args.magnitude} · {args.effects?.length || 0} effect(s)
        {args.summary ? ` — ${args.summary}` : ""}
      </p>
    );
  }
  return null;
}
