import {
  AlertTriangle,
  Braces,
  Clock3,
  FileDiff,
  Grid3X3,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import type { OfficeWorkspace, WorkbenchView } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

const TABS: Array<{ id: WorkbenchView; label: string; icon: ReactNode }> = [
  { id: "visual", label: "Grid / Visual", icon: <Grid3X3 size={13} /> },
  { id: "source", label: "Source", icon: <Braces size={13} /> },
  { id: "diff", label: "Diff", icon: <FileDiff size={13} /> },
  { id: "history", label: "History", icon: <Clock3 size={13} /> },
  { id: "problems", label: "Problems", icon: <AlertTriangle size={13} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={13} /> },
];

function SourceView({ workspace }: Props) {
  return (
    <div className="source-editor-wrap">
      <div className="line-numbers" aria-hidden="true">
        {workspace.source.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <textarea
        className="source-editor"
        aria-label="KDL source editor"
        spellCheck={false}
        value={workspace.source}
        onChange={(event) => workspace.editSource(event.target.value)}
      />
      {workspace.diagnostics.length > 0 ? (
        <div className="source-error-banner">
          Source contains errors. Visual preview shows the last valid state.
        </div>
      ) : null}
    </div>
  );
}

function DiffView({ workspace }: Props) {
  const latest = workspace.history.at(-1);
  return (
    <div className="semantic-view">
      <div className="semantic-title">Semantic Diff</div>
      {latest ? (
        <>
          <div className="diff-path">Sheet: {workspace.activeSheet.name}</div>
          <div className="diff-entry">
            <span className="diff-marker added">+</span>
            <span>{latest.transaction.label}</span>
            <time>{new Date(latest.transaction.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        </>
      ) : <p className="empty-copy">変更はまだない。</p>}
    </div>
  );
}

function HistoryView({ workspace }: Props) {
  return (
    <div className="semantic-view history-list">
      {workspace.history.length === 0 ? <p className="empty-copy">履歴はまだない。</p> : null}
      {[...workspace.history].reverse().map((entry) => (
        <div className="history-entry" key={entry.transaction.id}>
          <span className="history-dot" />
          <div><strong>{entry.transaction.label}</strong><span>User · {new Date(entry.transaction.timestamp).toLocaleTimeString("ja-JP")}</span></div>
        </div>
      ))}
    </div>
  );
}

function ProblemsView({ workspace }: Props) {
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

function TerminalView() {
  return (
    <div className="terminal-view">
      <p><span className="terminal-user">poteto@office-ide</span>:<span className="terminal-path">~/sales-report.office</span>$ sheetctl context</p>
      <p className="terminal-output">resource=sales sheet=売上 selection=A2:F15 active=C17</p>
      <p><span className="terminal-user">poteto@office-ide</span>:<span className="terminal-path">~/sales-report.office</span>$ <span className="terminal-cursor" /></p>
    </div>
  );
}

export function WorkbenchPanel({ workspace }: Props) {
  return (
    <section className="workbench-panel">
      <div className="workbench-tabs" role="tablist" aria-label="Editor views">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            data-active={workspace.activeView === tab.id}
            onClick={() => workspace.setActiveView(tab.id)}
          >
            {tab.icon}{tab.label}
            {tab.id === "problems" && workspace.diagnostics.length > 0 ? <span>{workspace.diagnostics.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="workbench-content">
        {workspace.activeView === "source" ? <SourceView workspace={workspace} /> : null}
        {workspace.activeView === "diff" ? <DiffView workspace={workspace} /> : null}
        {workspace.activeView === "history" ? <HistoryView workspace={workspace} /> : null}
        {workspace.activeView === "problems" ? <ProblemsView workspace={workspace} /> : null}
        {workspace.activeView === "terminal" ? <TerminalView /> : null}
        {workspace.activeView === "visual" ? <div className="semantic-view"><p className="empty-copy">Grid view is active above.</p></div> : null}
      </div>
    </section>
  );
}
