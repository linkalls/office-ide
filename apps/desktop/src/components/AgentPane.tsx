import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Send,
  Sheet,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  planAgentRequest,
  type AgentProposal,
} from "../state/agentPlanner";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import {
  getHistoryLifecycle,
  type HistoryEntry,
} from "../state/workspaceHistory";

interface Props {
  workspace: OfficeWorkspace;
}

interface AgentMessage {
  role: "user" | "assistant" | "system";
  text: string;
  transactionId?: string;
}

interface AgentMessageCardProps {
  activeAgent: string;
  entry?: HistoryEntry;
  message: AgentMessage;
  redoAvailable: boolean;
  undoAvailable: boolean;
}

function AgentMessageCard({
  activeAgent,
  entry,
  message,
  redoAvailable,
  undoAvailable,
}: AgentMessageCardProps) {
  const lifecycle = entry ? getHistoryLifecycle(entry) : null;
  const heading = message.role === "user"
    ? "You"
    : message.role === "assistant"
      ? activeAgent
      : lifecycle === "reverted"
        ? "Reverted"
        : lifecycle === "re-applied"
          ? "Re-applied"
          : "Applied";

  return (
    <div
      className="agent-message"
      data-role={message.role}
      data-state={lifecycle ?? undefined}
    >
      <strong>{heading}</strong>
      <p>{message.text}</p>
      {entry ? (
        <span className="agent-transaction-state">
          {entry.transaction.operations.length} operations
          {redoAvailable ? " · ↻ Redo available" : null}
          {undoAvailable ? " · ↶ Undo available" : null}
        </span>
      ) : null}
    </div>
  );
}

const AGENT_TABS = ["Claude", "Codex", "Cursor", "Shell"] as const;
const AGENT_SUGGESTIONS = [
  "Add an average unit price formula to column G",
  "G列に税込売上を追加して",
  "売上50万円以上を強調して",
  "地域別の売上集計シートを作って",
] as const;

export function AgentPane({ workspace }: Props) {
  const [activeAgent, setActiveAgent] = useState<(typeof AGENT_TABS)[number]>("Codex");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const historyByTransaction = useMemo(
    () => new Map(workspace.history.map((entry) => [entry.transaction.id, entry])),
    [workspace.history],
  );

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, proposal?.id]);

  const submit = () => {
    const clean = prompt.trim();
    if (!clean) return;
    const result = planAgentRequest(clean, workspace.workbook);
    setMessages((items) => [
      ...items,
      { role: "user", text: clean },
      {
        role: "assistant",
        text: result.ok
          ? `変更案を作成した。${result.proposal.affectedRange}へ${result.proposal.operations.length} operationsを適用する。`
          : `${result.message} 例: ${result.suggestions.join(" / ")}`,
      },
    ]);
    setProposal(result.ok ? result.proposal : null);
    setPrompt("");
  };

  const applyProposal = () => {
    if (!proposal) return;
    const transactionId = workspace.applyAgentProposal(proposal, `${activeAgent} local planner`);
    setMessages((items) => [...items, {
      role: "system",
      text: proposal.title,
      transactionId,
    }]);
    setProposal(null);
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
        <span><Sheet size={13} /> sales.kdl</span>
        <span>Sheet: {workspace.activeSheet.name}</span>
        <span>Selection: {workspace.selection}</span>
        <span>Active: {workspace.activeCell}</span>
      </div>
      <div className="agent-terminal" aria-live="polite" ref={terminalRef}>
        <div className="terminal-heading">
          <Bot size={15} /> {activeAgent}
          <small><ShieldCheck size={11} /> Local planner</small>
        </div>
        <p className="agent-line"><ChevronRight size={13} /> Workbook IR and KDL source attached</p>
        <p className="agent-line"><ChevronRight size={13} /> Active context: {workspace.activeSheet.name}!{workspace.selection}</p>
        <div className="agent-plan">
          <span><Sparkles size={14} /> Review-first agent workflow</span>
          <p>依頼をsemantic operationsへ変換し、適用前に範囲と変更内容を確認できる。</p>
        </div>

        {messages.length === 0 ? (
          <div className="agent-suggestions" aria-label="Agent prompt examples">
            {AGENT_SUGGESTIONS.map((suggestion) => (
              <button
                type="button"
                className="agent-suggestion"
                key={suggestion}
                onClick={() => setPrompt(suggestion)}
              >
                <Sparkles size={13} /> {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message, index) => {
          const entry = message.transactionId
            ? historyByTransaction.get(message.transactionId)
            : undefined;
          return (
            <AgentMessageCard
              activeAgent={activeAgent}
              entry={entry}
              key={message.transactionId ?? `${message.role}-${index}`}
              message={message}
              redoAvailable={workspace.nextRedoTransactionId === message.transactionId}
              undoAvailable={workspace.nextUndoTransactionId === message.transactionId}
            />
          );
        })}

        {proposal ? (
          <section className="agent-proposal" aria-label="Agent change proposal">
            <div className="proposal-heading">
              <span><Sparkles size={14} /> Proposal ready</span>
              <code>{proposal.affectedRange}</code>
            </div>
            <strong>{proposal.title}</strong>
            <p>{proposal.explanation}</p>
            <ol>
              {proposal.operationPreview.map((operation) => <li key={operation}>{operation}</li>)}
            </ol>
            <div className="proposal-actions">
              <button type="button" className="proposal-apply" onClick={applyProposal}>
                <CheckCircle2 size={14} /> Apply {proposal.operations.length} operations
              </button>
              <button type="button" className="proposal-dismiss" onClick={() => setProposal(null)}>
                <X size={14} /> Dismiss
              </button>
            </div>
          </section>
        ) : null}
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
