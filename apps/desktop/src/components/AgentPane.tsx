import { Bot, ChevronRight, Send, Sheet, Sparkles, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

const AGENT_TABS = ["Claude", "Codex", "Cursor", "Shell"] as const;

export function AgentPane({ workspace }: Props) {
  const [activeAgent, setActiveAgent] = useState<(typeof AGENT_TABS)[number]>("Codex");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const submit = () => {
    const clean = prompt.trim();
    if (!clean) return;
    setMessages((items) => [...items, clean]);
    setPrompt("");
  };

  return (
    <aside className="agent-pane">
      <div className="agent-tabs" role="tablist" aria-label="Agent terminals">
        {AGENT_TABS.map((agent) => (
          <button
            type="button"
            role="tab"
            key={agent}
            data-active={activeAgent === agent}
            onClick={() => setActiveAgent(agent)}
          >
            {agent}
          </button>
        ))}
      </div>
      <div className="agent-context">
        <span><Sheet size={13} /> sales</span>
        <span>Sheet: {workspace.activeSheet.name}</span>
        <span>Selection: {workspace.selection}</span>
        <span>Active: {workspace.activeCell}</span>
      </div>
      <div className="agent-terminal" aria-live="polite">
        <div className="terminal-heading"><Bot size={15} /> {activeAgent}</div>
        <p><span className="terminal-user">codex@office-ide</span>:<span className="terminal-path">~/workspace/sales</span>$ codex</p>
        <p className="agent-line"><ChevronRight size={13} /> Reading workspace context…</p>
        <p className="agent-line"><ChevronRight size={13} /> Active resource is <strong>sales</strong></p>
        <p className="agent-line"><ChevronRight size={13} /> Selection {workspace.selection} on sheet “{workspace.activeSheet.name}”</p>
        <div className="agent-plan">
          <span><Sparkles size={14} /> Ready</span>
          <p>KDL source and semantic operations are available. Changes will be grouped into an undoable transaction.</p>
        </div>
        {messages.map((message, index) => (
          <div className="agent-message" key={`${message}-${index}`}>
            <p className="agent-line"><ChevronRight size={13} /> {message}</p>
            <p className="agent-line muted"><ChevronRight size={13} /> sheetctl context → {workspace.selection}</p>
            <p className="agent-line muted"><ChevronRight size={13} /> Local PTY connection lands in Phase 2.</p>
          </div>
        ))}
        <p><span className="terminal-user">codex@office-ide</span>:<span className="terminal-path">~/workspace/sales</span>$ <span className="terminal-cursor" /></p>
      </div>
      <div className="agent-composer">
        <div className="composer-label"><TerminalSquare size={13} /> Context attached automatically</div>
        <textarea
          value={prompt}
          placeholder={`Ask ${activeAgent}…`}
          aria-label={`Ask ${activeAgent}`}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" aria-label="Send prompt" onClick={submit}><Send size={16} /></button>
      </div>
    </aside>
  );
}
