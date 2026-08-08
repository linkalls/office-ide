import { AlertTriangle, Check, GitBranch, Radio, Sparkles } from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

export function StatusBar({ workspace }: Props) {
  const autosaveLabel = workspace.autosaveState === "saving"
    ? "saving…"
    : workspace.autosaveState === "error"
      ? "autosave failed"
      : "autosaved";
  return (
    <footer className="status-bar">
      <span className="status-primary"><Sparkles size={13} /> Agent-ready</span>
      <span><GitBranch size={13} /> main</span>
      <span
        className={workspace.autosaveState === "error" ? "status-error" : ""}
        title={workspace.lastSavedAt
          ? `Last saved ${new Date(workspace.lastSavedAt).toLocaleTimeString("ja-JP")}`
          : "Waiting for first save"}
      >
        <Radio size={12} /> {autosaveLabel}
      </span>
      <span className={workspace.diagnostics.length > 0 ? "status-error" : ""}>
        {workspace.diagnostics.length > 0 ? <AlertTriangle size={13} /> : <Check size={13} />}
        {workspace.diagnostics.length} problems
      </span>
      <span className="status-spacer" />
      <span>{workspace.activeCell} · {workspace.selection}</span>
      <span>KDL</span>
      <span>UTF-8</span>
      <span>LF</span>
      <span><Check size={13} /> {workspace.diagnostics.length === 0 ? "Synced" : "Last valid preview"}</span>
    </footer>
  );
}
