import {
  Bot,
  CircleAlert,
  CheckCircle2,
  ChevronRight,
  FileText,
  LoaderCircle,
  Power,
  Plus,
  RotateCcw,
  Send,
  Sheet,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  planAgentRequest,
  type AgentProposal,
} from "../state/agentPlanner";
import { planDocumentRequest, type DocumentProposal } from "../state/documentPlanner";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import {
  getHistoryLifecycle,
  type HistoryEntry,
} from "../state/workspaceHistory";
import type { CodexModelOption, CodexRuntime } from "../state/useCodexRuntime";
import type { PendingSheetctlProposal } from "../state/useSheetctlBridge";
import type { PendingDocctlProposal } from "../state/useDocctlBridge";

interface Props {
  workspace: OfficeWorkspace;
  codexRuntime: CodexRuntime;
  onClose: () => void;
  onResize: (width: number) => void;
  sheetctl: {
    pending: PendingSheetctlProposal | null;
    respond: (id: string, approved: boolean, message?: string) => Promise<void>;
  };
  docctl: {
    pending: PendingDocctlProposal | null;
    respond: (id: string, approved: boolean, message?: string) => Promise<void>;
  };
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
const DOCUMENT_SUGGESTIONS = [
  "「2026年度 売上分析」を「2026年度 売上レビュー」に置換",
  "「次回の確認事項」を追加",
] as const;

export function AgentPane({ workspace, sheetctl, docctl, codexRuntime, onClose, onResize }: Props) {
  const [activeAgent, setActiveAgent] = useState<(typeof AGENT_TABS)[number]>("Codex");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [proposalReviewOpen, setProposalReviewOpen] = useState(false);
  const [documentProposal, setDocumentProposal] = useState<DocumentProposal | null>(null);
  const [recentThreads, setRecentThreads] = useState<Array<{
    id: string;
    name: string | null;
    preview: string;
  }>>([]);
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("");
  const [shellBusy, setShellBusy] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const isDocumentResource = workspace.documents.some((document) => document.id === workspace.activeResource);
  // The native host exposes both sheetctl and docctl to app-server. Keep the
  // local planner only as the browser-preview fallback.
  const usesCodexRuntime = activeAgent === "Codex" && codexRuntime.isDesktop;
  const runtimeBusy = shellBusy || usesCodexRuntime && (
    codexRuntime.phase === "starting" || codexRuntime.phase === "running"
  );
  const historyByTransaction = useMemo(
    () => new Map(workspace.history.map((entry) => [entry.transaction.id, entry])),
    [workspace.history],
  );
  const displayedProposal = sheetctl.pending?.proposal ?? proposal;
  const displayedDocumentProposal = docctl.pending?.proposal ?? documentProposal;
  const promptSuggestions = isDocumentResource ? DOCUMENT_SUGGESTIONS : AGENT_SUGGESTIONS;
  const activeModel = codexModels.find((item) => item.model === selectedModel) ?? null;
  const availableEfforts = activeModel?.efforts ?? [];

  useEffect(() => {
    if (!usesCodexRuntime || codexRuntime.phase !== "ready") return;
    void codexRuntime.listModels().then((models) => {
      setCodexModels(models);
      const first = models[0];
      if (first && !selectedModel) {
        setSelectedModel(first.model);
        setSelectedEffort(first.defaultEffort ?? first.efforts[0] ?? "");
      }
    }).catch(() => undefined);
  }, [codexRuntime.listModels, codexRuntime.phase, selectedModel, usesCodexRuntime]);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
  }, [codexRuntime.activities.length, documentProposal?.id, messages.length, proposal?.id]);

  const submit = async () => {
    const clean = prompt.trim();
    if (!clean || runtimeBusy) return;
    setPrompt("");

    if (usesCodexRuntime) {
      setMessages((items) => [...items, { role: "user", text: clean }]);
      try {
        await codexRuntime.sendPrompt(clean, ".", {
          model: selectedModel || undefined,
          effort: selectedEffort || undefined,
        });
      } catch (error) {
        setMessages((items) => [...items, {
          role: "assistant",
          text: error instanceof Error ? error.message : String(error),
        }]);
      }
      return;
    }

    // Browser preview has no native app-server or docctl capability, so retain
    // a local, review-first document planner there.
    if (isDocumentResource) {
      const result = planDocumentRequest(clean, workspace.documentSource);
      setMessages((items) => [...items,
        { role: "user", text: clean },
        { role: "assistant", text: result.ok ? result.proposal.summary : result.message },
      ]);
      setDocumentProposal(result.ok ? result.proposal : null);
      setProposal(null);
      return;
    }

    if (activeAgent === "Shell" && isTauri()) {
      setMessages((items) => [...items, { role: "user", text: clean }]);
      setShellBusy(true);
      try {
        const result = await invoke<{ exitCode: number | null; output: string }>("shell_run", { command: clean, cwd: "." });
        setMessages((items) => [...items, {
          role: "assistant",
          text: `${result.output || "(no output)"}\n\nExit code: ${result.exitCode ?? "terminated"}`,
        }]);
      } catch (error) {
        setMessages((items) => [...items, {
          role: "assistant",
          text: error instanceof Error ? error.message : String(error),
        }]);
      } finally {
        setShellBusy(false);
      }
      return;
    }

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
    setProposalReviewOpen(false);
  };

  const applyProposal = () => {
    const selectedProposal = sheetctl.pending?.proposal ?? proposal;
    if (!selectedProposal) return;
    const transactionId = sheetctl.pending
      ? workspace.applyCliProposal(selectedProposal, "sheetctl")
      : activeAgent === "Shell"
        ? workspace.applyCliProposal(selectedProposal, "sheetctl")
        : workspace.applyAgentProposal(selectedProposal, `${activeAgent} local planner`);
    setMessages((items) => [...items, {
      role: "system",
      text: selectedProposal.title,
      transactionId,
    }]);
    if (sheetctl.pending) void sheetctl.respond(sheetctl.pending.id, true);
    setProposal(null);
    setProposalReviewOpen(false);
  };

  const dismissProposal = () => {
    if (sheetctl.pending) void sheetctl.respond(sheetctl.pending.id, false);
    setProposal(null);
    setProposalReviewOpen(false);
    setDocumentProposal(null);
  };

  const applyDocumentProposal = () => {
    if (!displayedDocumentProposal) return;
    workspace.editDocumentSource(displayedDocumentProposal.nextSource);
    if (docctl.pending) void docctl.respond(docctl.pending.id, true, displayedDocumentProposal.title);
    setMessages((items) => [...items, { role: "system", text: displayedDocumentProposal.title }]);
    setDocumentProposal(null);
  };

  const startNewChat = async () => {
    if (usesCodexRuntime) await codexRuntime.newThread();
    setMessages([]);
    setProposal(null);
    setProposalReviewOpen(false);
    if (docctl.pending) void docctl.respond(docctl.pending.id, false);
    setDocumentProposal(null);
    setRecentThreads([]);
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const update = (move: PointerEvent) => onResize(Math.min(680, Math.max(300, window.innerWidth - move.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const selectAgent = (agent: (typeof AGENT_TABS)[number]) => {
    setActiveAgent(agent);
    // Codex has a native app-server chat surface. The other providers are
    // intentionally exposed through the full-width persistent terminal so
    // users can run the locally installed CLI rather than a fake chat.
    if (agent !== "Codex") {
      workspace.setActiveView("terminal");
      onClose();
    }
  };

  return (
    <aside className="agent-pane">
      <div className="agent-resizer" role="separator" aria-label="Resize agent pane" aria-orientation="vertical" onPointerDown={beginResize} />
      <div className="agent-tabs" role="tablist" aria-label="Agent terminals">
        <span className="agent-pane-title"><Bot size={15} /> AI エージェント</span>
        {AGENT_TABS.map((agent) => (
          <button
            type="button"
            role="tab"
            key={agent}
            data-active={activeAgent === agent}
            onClick={() => selectAgent(agent)}
          >
            {agent}
          </button>
        ))}
        <button type="button" className="agent-close" aria-label="Close agent pane" title="Close agent pane" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="agent-context">
        <span>{isDocumentResource ? <FileText size={13} /> : <Sheet size={13} />} {isDocumentResource ? `${workspace.activeDocument.name}.dj` : "sales.kdl"}</span>
        {isDocumentResource ? <span>Document: {workspace.activeDocument.name}</span> : <span>Sheet: {workspace.activeSheet.name}</span>}
        {isDocumentResource ? <span>Djot source attached</span> : <span>Selection: {workspace.selection}</span>}
        {isDocumentResource ? <span>Visual + Source</span> : <span>Active: {workspace.activeCell}</span>}
      </div>
      <div className="agent-terminal" aria-live="polite" ref={terminalRef}>
        <div className="terminal-heading">
          <Bot size={15} /> {activeAgent}
          <small data-phase={usesCodexRuntime ? codexRuntime.phase : "local"}>
            {runtimeBusy ? <LoaderCircle className="spin" size={11} /> : <ShieldCheck size={11} />}
            {usesCodexRuntime ? codexRuntime.phase : "Local planner"}
          </small>
          {usesCodexRuntime ? (
            <span className="runtime-actions">
              {codexRuntime.phase !== "running" ? (
                <button type="button" title="Start a new Codex chat" onClick={() => void startNewChat()}>
                  <Plus size={11} /> New chat
                </button>
              ) : null}
              {codexRuntime.phase === "running" ? (
                <button
                  type="button"
                  title="Interrupt the active Codex turn"
                  onClick={() => void codexRuntime.cancelTurn()}
                >
                  <Square size={11} /> Stop turn
                </button>
              ) : null}
              {codexRuntime.phase === "error"
              || codexRuntime.phase === "exited"
              || codexRuntime.phase === "disconnected" ? (
                <button
                  type="button"
                  title="Restart Codex app-server"
                  onClick={() => void codexRuntime.reconnect()}
                >
                  <RotateCcw size={11} /> Reconnect
                </button>
              ) : null}
              {codexRuntime.phase === "ready" ? (
                <button
                  type="button"
                  title="Load recent Codex threads for this workspace"
                  onClick={() => void codexRuntime.listThreads(".").then(setRecentThreads)}
                >
                  Recent threads
                </button>
              ) : null}
              {codexRuntime.phase === "ready" ? (
                <button
                  type="button"
                  title="Stop Codex app-server"
                  onClick={() => void codexRuntime.disconnect()}
                >
                  <Power size={11} /> Disconnect
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        <p className="agent-line">
          <ChevronRight size={13} />
          {usesCodexRuntime ? codexRuntime.statusMessage : "Workbook IR and KDL source attached"}
        </p>
        <p className="agent-line"><ChevronRight size={13} /> Active context: {isDocumentResource ? `${workspace.activeDocument.name}.dj` : `${workspace.activeSheet.name}!${workspace.selection}`}</p>
        <div className="agent-plan">
          <span><Sparkles size={14} /> {usesCodexRuntime ? "Codex app-server" : "Review-first agent workflow"}</span>
          <p>
            {usesCodexRuntime
              ? "実Codexのthread / turn / item eventを表示する。Office変更は別のProposal境界で止める。"
              : activeAgent === "Shell"
                ? "sheetctl commandを検証し、Apply前のsemantic proposalとして保留する。"
                : "依頼をsemantic operationsへ変換し、適用前に範囲と変更内容を確認できる。"}
          </p>
        </div>

        {usesCodexRuntime ? codexRuntime.activities.map((activity) => (
          <div
            className="agent-activity"
            data-kind={activity.kind}
            data-status={activity.status}
            key={activity.id}
          >
            <strong>{activity.title}</strong>
            {activity.detail ? <p>{activity.detail}</p> : null}
            <span>{activity.status}</span>
          </div>
        )) : null}

        {usesCodexRuntime ? codexRuntime.pendingRequests.map((request) => {
          const isDecisionApproval = request.method === "item/commandExecution/requestApproval"
            || request.method === "item/fileChange/requestApproval";
          return (
            <section className="codex-approval" key={request.id}>
              <strong><CircleAlert size={14} /> Codex request</strong>
              <code>{request.method}</code>
              <p>
                {isDecisionApproval
                  ? "これはCodex app-server自身が要求した承認。OfficeのApplyとは別物だ。"
                  : "このserver requestはまだ専用フォーム未実装。誤った形式では応答しない。"}
              </p>
              {isDecisionApproval ? (
                <div className="proposal-actions">
                  <button
                    type="button"
                    className="proposal-apply"
                    onClick={() => void codexRuntime.answerRequest(request.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="proposal-session"
                    onClick={() => void codexRuntime.answerRequest(request.id, "acceptForSession")}
                  >
                    For session
                  </button>
                  <button
                    type="button"
                    className="proposal-dismiss"
                    onClick={() => void codexRuntime.answerRequest(request.id, "decline")}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className="proposal-dismiss"
                    onClick={() => void codexRuntime.answerRequest(request.id, "cancel")}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </section>
          );
        }) : null}

        {usesCodexRuntime && recentThreads.length > 0 ? (
          <section className="agent-proposal" aria-label="Recent Codex threads">
            <div className="proposal-heading"><span>Recent Codex threads</span></div>
            {recentThreads.map((thread) => (
              <button
                className="agent-suggestion"
                key={thread.id}
                type="button"
                onClick={() => void codexRuntime.resumeThread(thread.id).then(() => setRecentThreads([]))}
              >
                <Sparkles size={13} /> {thread.name ?? thread.preview}
              </button>
            ))}
          </section>
        ) : null}

        {messages.length === 0 ? (
          <div className="agent-suggestions" aria-label="Agent prompt examples">
            {promptSuggestions.map((suggestion) => (
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

        {displayedProposal ? (
          <section className="agent-proposal" aria-label="Agent change proposal">
            <div className="proposal-heading">
              <span><CheckCircle2 size={15} /> {sheetctl.pending ? "sheetctl request" : "Change set ready"}</span>
              <ChevronRight size={15} className="proposal-chevron" />
            </div>
            <strong>{displayedProposal.title}</strong>
            <p>{displayedProposal.explanation}</p>
            <div className="proposal-scope">
              <span>対象範囲</span>
              <strong><Sheet size={14} /> {displayedProposal.affectedRange}</strong>
            </div>
            <div className="proposal-summary">
              <span>1 change set</span>
              <span>{displayedProposal.operations.length} operations</span>
            </div>
            <div className="proposal-diff-summary">
              <span>変更内容</span>
              <strong>{displayedProposal.operations.length} 件の操作</strong>
              <p>適用前に変更範囲と操作内容を確認できます。適用後も履歴から確認・取り消しができます。</p>
            </div>
            {proposalReviewOpen ? (
              <ul className="proposal-operation-list" aria-label="Proposal operation details">
                {displayedProposal.operationPreview.map((operation) => <li key={operation}><Plus size={13} /> {operation}</li>)}
              </ul>
            ) : null}
            <div className="proposal-actions">
              <button type="button" className="proposal-apply" onClick={applyProposal}>
                <CheckCircle2 size={14} /> 適用
              </button>
              <button type="button" className="proposal-dismiss" onClick={() => setProposalReviewOpen((open) => !open)}>
                <ChevronRight size={14} /> {proposalReviewOpen ? "閉じる" : "レビュー"}
              </button>
            </div>
          </section>
        ) : null}
        {displayedDocumentProposal ? (
          <section className="agent-proposal" aria-label="Document change proposal">
            <div className="proposal-heading"><span><Sparkles size={14} /> {docctl.pending ? "docctl request" : "Document change"}</span><code>{workspace.activeDocument.name}.dj</code></div>
            <strong>{displayedDocumentProposal.title}</strong>
            <p>{displayedDocumentProposal.summary}</p>
            <div className="proposal-diff-summary">
              <span>Scope</span><strong>Djot source</strong>
              <p>Review the document change before Visual and Source update together.</p>
            </div>
            <div className="proposal-actions">
              <button type="button" className="proposal-apply" onClick={applyDocumentProposal}><CheckCircle2 size={14} /> Apply change</button>
              <button type="button" className="proposal-dismiss" onClick={dismissProposal}><X size={14} /> Dismiss</button>
            </div>
          </section>
        ) : null}
      </div>
      <div className="agent-composer">
        {usesCodexRuntime ? (
          <div className="codex-settings" aria-label="Codex model settings">
            <label>
              Model
              <select
                aria-label="Codex model"
                value={selectedModel}
                disabled={runtimeBusy || codexModels.length === 0}
                onChange={(event) => {
                  const model = codexModels.find((item) => item.model === event.target.value);
                  setSelectedModel(event.target.value);
                  setSelectedEffort(model?.defaultEffort ?? model?.efforts[0] ?? "");
                }}
              >
                {codexModels.length === 0 ? <option value="">Loading models…</option> : null}
                {codexModels.map((model) => <option key={model.model} value={model.model}>{model.displayName}</option>)}
              </select>
            </label>
            <label>
              Thinking
              <select
                aria-label="Codex thinking mode"
                value={selectedEffort}
                disabled={runtimeBusy || availableEfforts.length === 0}
                onChange={(event) => setSelectedEffort(event.target.value)}
              >
                {availableEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        <div className="composer-label"><TerminalSquare size={13} /> Context attached automatically</div>
        <textarea
          value={prompt}
          placeholder={activeAgent === "Shell" ? "sheetctl cell set B2 100" : isDocumentResource ? `Ask about ${workspace.activeDocument.name}.dj…` : `Ask ${activeAgent}…`}
          aria-label={`Ask ${activeAgent}`}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          aria-label="Send prompt"
          disabled={runtimeBusy}
          onClick={() => void submit()}
        >
          {runtimeBusy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
        </button>
      </div>
    </aside>
  );
}
