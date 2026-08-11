import {
  AlertTriangle,
  Bot,
  Braces,
  Clock3,
  ChevronDown,
  ChevronUp,
  FileDiff,
  GitBranch,
  Grid3X3,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Transaction } from "@office-ide/operations";
import type { OfficeWorkspace, WorkbenchView } from "../state/useOfficeWorkspace";
import type { CodexRuntime } from "../state/useCodexRuntime";
import { usePersistentShell } from "../state/usePersistentShell";
import { useGitWorkspace } from "../state/useGitWorkspace";

interface Props {
  workspace: OfficeWorkspace;
  codexRuntime: CodexRuntime;
}

const TABS: Array<{ id: WorkbenchView; label: string; icon: ReactNode }> = [
  { id: "visual", label: "Grid / Visual", icon: <Grid3X3 size={13} /> },
  { id: "source", label: "Source", icon: <Braces size={13} /> },
  { id: "diff", label: "Diff", icon: <FileDiff size={13} /> },
  { id: "history", label: "History", icon: <Clock3 size={13} /> },
  { id: "problems", label: "Problems", icon: <AlertTriangle size={13} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={13} /> },
  { id: "activity", label: "Activity", icon: <Bot size={13} /> },
  { id: "git", label: "Git", icon: <GitBranch size={13} /> },
];

function actorLabel(actor: Transaction["actor"]): string {
  if (actor.type === "agent") return `Agent · ${actor.agent}`;
  if (actor.type === "cli") return `CLI · ${actor.process}`;
  if (actor.type === "importer") return "Importer";
  return "User";
}

function SourceView({ workspace }: Pick<Props, "workspace">) {
  const isDocument = workspace.documents.some((document) => document.id === workspace.activeResource);
  const source = isDocument ? workspace.documentSource : workspace.source;
  return (
    <div className="source-editor-wrap">
      <div className="line-numbers" aria-hidden="true">
        {source.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <textarea
        className="source-editor"
        aria-label={isDocument ? "Djot source editor" : "KDL source editor"}
        spellCheck={false}
        value={source}
        onChange={(event) => isDocument ? workspace.editDocumentSource(event.target.value) : workspace.editSource(event.target.value)}
      />
      {!isDocument && workspace.diagnostics.length > 0 ? (
        <div className="source-error-banner">
          Source contains errors. Visual preview shows the last valid state.
        </div>
      ) : null}
    </div>
  );
}

function DiffView({ workspace }: Pick<Props, "workspace">) {
  const latest = workspace.history.at(-1);
  return (
    <div className="semantic-view">
      <div className="semantic-title">Semantic Diff</div>
      {latest ? (
        <>
          <div className="diff-path">Sheet: {workspace.activeSheet.name}</div>
          <div className="diff-entry">
            <span className={`diff-marker ${latest.state === "applied" ? "added" : "reverted"}`}>
              {latest.state === "applied" ? "+" : "↶"}
            </span>
            <span>{latest.transaction.label} · {latest.transaction.operations.length} operations · {actorLabel(latest.transaction.actor)}</span>
            <span className="history-state" data-state={latest.state}>{latest.state.toUpperCase()}</span>
          </div>
        </>
      ) : <p className="empty-copy">変更はまだない。</p>}
    </div>
  );
}

function sessionTextDiff(before: string, after: string, filename: string): string {
  if (before === after) return "No source changes since this session's baseline.";
  const left = before.split("\n");
  const right = after.split("\n");
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let leftEnd = left.length - 1;
  let rightEnd = right.length - 1;
  while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) { leftEnd -= 1; rightEnd -= 1; }
  return [`--- session baseline (${filename})`, `+++ current source (${filename})`, `@@ -${start + 1},${Math.max(0, leftEnd - start + 1)} +${start + 1},${Math.max(0, rightEnd - start + 1)} @@`, ...left.slice(start, leftEnd + 1).map((line) => `-${line}`), ...right.slice(start, rightEnd + 1).map((line) => `+${line}`)].join("\n");
}

function DiffPanel({ workspace }: Pick<Props, "workspace">) {
  const [mode, setMode] = useState<"text" | "semantic">("semantic");
  const isDocument = workspace.documents.some((document) => document.id === workspace.activeResource);
  useEffect(() => setMode(isDocument ? "text" : "semantic"), [isDocument]);
  const before = isDocument ? workspace.documentSourceBaseline : workspace.sourceBaseline;
  const after = isDocument ? workspace.documentSource : workspace.source;
  const filename = isDocument ? `${workspace.activeDocument.name}.dj` : "sales.kdl";
  return <div className="diff-panel">
    <div className="diff-toolbar" role="tablist" aria-label="Diff mode">
      <button type="button" role="tab" data-active={mode === "text"} onClick={() => setMode("text")}>Text</button>
      <button type="button" role="tab" data-active={mode === "semantic"} disabled={isDocument} onClick={() => setMode("semantic")}>Semantic</button>
    </div>
    {mode === "text" ? <pre className="source-diff" aria-label="Text source diff">{sessionTextDiff(before, after, filename)}</pre> : <DiffView workspace={workspace} />}
  </div>;
}

function HistoryView({ workspace }: Pick<Props, "workspace">) {
  return (
    <div className="semantic-view history-list">
      {workspace.history.length === 0 ? <p className="empty-copy">履歴はまだない。</p> : null}
      {[...workspace.history].reverse().map((entry) => (
        <div className="history-entry" data-state={entry.state} key={entry.transaction.id}>
          <span className="history-dot" aria-hidden="true" />
          <div className="history-copy">
            <strong>{entry.transaction.label}</strong>
            <span>{actorLabel(entry.transaction.actor)} · {entry.transaction.operations.length} ops · {new Date(entry.transaction.timestamp).toLocaleTimeString("ja-JP")}</span>
          </div>
          <span className="history-state" data-state={entry.state}>{entry.state.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}

function ProblemsView({ workspace }: Pick<Props, "workspace">) {
  return (
    <div className="semantic-view">
      {workspace.diagnostics.length === 0 ? (
        <p className="no-problems">✓ No problems detected in sales.kdl</p>
      ) : workspace.diagnostics.map((diagnostic, index) => (
        <div className="problem-row" key={`${diagnostic.code}-${index}`}>
          <AlertTriangle size={14} />
          <span>{diagnostic.message}</span>
          <code>{diagnostic.line ?? 1}:{diagnostic.column ?? 1}</code>
        </div>
      ))}
    </div>
  );
}

function TerminalView({ workspace, shell }: Pick<Props, "workspace"> & { shell: ReturnType<typeof usePersistentShell> }) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const submit = () => {
    const command = input.trim();
    if (!command) return;
    setInput("");
    setHistory((items) => items.at(-1) === command ? items : [...items, command].slice(-100));
    setHistoryIndex(null);
    void shell.send(command);
  };
  return (
    <div className="terminal-view">
      <div className="terminal-toolbar">
        <span>{shell.desktop ? shell.running ? "PowerShell session running" : "PowerShell disconnected" : "Desktop shell available in the Tauri app"}</span>
        <span className="terminal-toolbar-actions">
          <button type="button" onClick={shell.clear} disabled={shell.lines.length === 0}>Clear</button>
          {shell.desktop ? <button type="button" onClick={() => void (shell.running ? shell.stop() : shell.start())}>{shell.running ? "Stop" : "Start"}</button> : null}
        </span>
      </div>
      <div className="terminal-output-log" ref={shell.outputRef} aria-label="Persistent shell output">
        {shell.lines.length === 0 ? <p className="terminal-output">workspace={workspace.activeSheet.name} · Run a command to start.</p> : null}
        {shell.lines.map((line, index) => <p className={line.stream === "stderr" ? "terminal-error" : "terminal-output"} key={`${index}-${line.text}`}>{line.text || " "}</p>)}
      </div>
      <div className="terminal-input-row">
        <span><span className="terminal-user">office-ide</span>$</span>
        <input
          aria-label="Persistent shell command"
          disabled={!shell.desktop}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { submit(); return; }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (history.length === 0) return;
              const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
              setHistoryIndex(next); setInput(history[next]);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (historyIndex === null) return;
              const next = historyIndex + 1;
              if (next >= history.length) { setHistoryIndex(null); setInput(""); }
              else { setHistoryIndex(next); setInput(history[next]); }
            }
          }}
          placeholder={shell.desktop ? "Type a command and press Enter" : "Run this in the desktop app"}
          value={input}
        />
      </div>
    </div>
  );
}

function ActivityView({ codexRuntime }: Pick<Props, "codexRuntime">) {
  return (
    <div className="semantic-view history-list">
      {codexRuntime.activities.length === 0 ? <p className="empty-copy">No Codex activity yet.</p> : null}
      {[...codexRuntime.activities].reverse().map((activity) => (
        <div className="history-entry" data-state={activity.status === "error" ? "reverted" : "applied"} key={activity.id}>
          <span className="history-dot" aria-hidden="true" />
          <div className="history-copy"><strong>{activity.title}</strong><span>{activity.detail ?? activity.kind}</span></div>
          <span className="history-state" data-state={activity.status === "error" ? "reverted" : "applied"}>{activity.status.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}

function GitView({ git }: { git: ReturnType<typeof useGitWorkspace> }) {
  const [message, setMessage] = useState("");
  if (!git.desktop) return <div className="semantic-view"><p className="empty-copy">Git status is available in the Tauri desktop app.</p></div>;
  if (git.error) return <div className="semantic-view"><p className="git-error-message" role="alert">{git.error}</p></div>;
  if (!git.status) return <div className="semantic-view"><p className="empty-copy">Reading Git status…</p></div>;
  if (!git.status.isRepository) return <div className="semantic-view"><p className="empty-copy">This workspace is not a Git repository.</p></div>;
  return <div className="git-view">
    <header><strong><GitBranch size={14} /> {git.status.branch ?? "detached HEAD"}</strong><button type="button" onClick={() => void git.refresh()}>Refresh</button></header>
    <div className="git-columns">
      <section aria-label="Changed files"><h3>CHANGES <span>{git.status.files.length}</span></h3>{git.status.files.length === 0 ? <p className="empty-copy">Working tree clean.</p> : git.status.files.map((file) => <div className="git-file-row" key={file.path}><button type="button" className="git-file" data-active={git.selectedPath === file.path} onClick={() => void git.selectFile(file.path)}><code>{file.indexStatus}{file.worktreeStatus}</code><span>{file.path}</span></button><button className="git-stage-button" type="button" onClick={() => void (file.indexStatus === " " ? git.stage(file.path) : git.unstage(file.path))}>{file.indexStatus === " " ? "Stage" : "Unstage"}</button></div>)}</section>
      <section aria-label="Git diff"><h3>DIFF</h3><pre>{git.diff ?? "Select a changed file to inspect its diff."}</pre></section>
    </div>
    <section className="git-history" aria-label="Recent commits"><h3>RECENT COMMITS</h3>{git.status.commits.map((commit) => <div key={commit.id}><code>{commit.id.slice(0, 7)}</code><span>{commit.subject}</span><small>{commit.author} · {commit.date}</small></div>)}</section>
    <form className="git-commit" onSubmit={(event) => { event.preventDefault(); void git.commit(message).then(() => setMessage("")); }}>
      <label htmlFor="git-commit-message">Commit message</label><input id="git-commit-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the reviewed change" /><button type="submit" disabled={!message.trim() || git.status.files.every((file) => file.indexStatus === " ")}>Commit staged</button>
    </form>
  </div>;
}

export function WorkbenchPanel({ workspace, codexRuntime }: Props) {
  const shell = usePersistentShell(workspace.activeView === "terminal");
  const git = useGitWorkspace(workspace.activeView === "git");
  const [collapsed, setCollapsed] = useState(true);
  const previousView = useRef(workspace.activeView);

  useEffect(() => {
    if (workspace.activeView !== previousView.current && workspace.activeView !== "visual") {
      setCollapsed(false);
    }
    previousView.current = workspace.activeView;
  }, [workspace.activeView]);
  return (
    <section className="workbench-panel" data-collapsed={collapsed}>
      <div className="workbench-tabs" role="tablist" aria-label="Editor views">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            data-active={workspace.activeView === tab.id}
            onClick={() => { workspace.setActiveView(tab.id); setCollapsed(false); }}
          >
            {tab.icon}{tab.label}
            {tab.id === "problems" && workspace.diagnostics.length > 0 ? <span>{workspace.diagnostics.length}</span> : null}
          </button>
        ))}
        <button
          type="button"
          className="workbench-collapse"
          aria-label={collapsed ? "Expand workbench" : "Collapse workbench"}
          title={collapsed ? "Expand workbench" : "Collapse workbench"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <div className="workbench-content">
        {workspace.activeView === "source" ? <SourceView workspace={workspace} /> : null}
        {workspace.activeView === "diff" ? <DiffPanel workspace={workspace} /> : null}
        {workspace.activeView === "history" ? <HistoryView workspace={workspace} /> : null}
        {workspace.activeView === "problems" ? <ProblemsView workspace={workspace} /> : null}
        {workspace.activeView === "terminal" ? <TerminalView workspace={workspace} shell={shell} /> : null}
        {workspace.activeView === "activity" ? <ActivityView codexRuntime={codexRuntime} /> : null}
        {workspace.activeView === "git" ? <GitView git={git} /> : null}
        {workspace.activeView === "visual" ? <div className="semantic-view"><p className="empty-copy">Grid view is active above.</p></div> : null}
      </div>
    </section>
  );
}
