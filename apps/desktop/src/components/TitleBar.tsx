import {
  Bot,
  ChevronDown,
  FolderOpen,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Save,
  Sun,
  Table2,
  Undo2,
} from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { useNativeWorkspace } from "../state/useNativeWorkspace";
import type { useAppTheme } from "../state/useAppTheme";

interface Props {
  workspace: OfficeWorkspace;
  nativeWorkspace: ReturnType<typeof useNativeWorkspace>;
  appTheme: ReturnType<typeof useAppTheme>;
}

const MENUS = ["ファイル", "ホーム", "挿入", "ページ レイアウト", "数式", "データ", "校閲", "表示", "自動化", "開発", "ヘルプ"];

export function TitleBar({ workspace, nativeWorkspace, appTheme }: Props) {
  return (
    <header className="title-bar">
      <div className="brand" aria-label="Office IDE">
        <span className="brand-mark"><Table2 size={16} /></span>
        <span className="workbook-name">{workspace.workspaceTitle}</span>
        <span className="workbook-separator">・</span>
        <span className="workbook-saved">保存済み</span>
        <ChevronDown className="workbook-caret" size={14} />
        <span className={`autosave-status autosave-status-${workspace.autosaveState}`} role="status" aria-live="polite">
          {workspace.autosaveState === "saving" ? "Saving…" : workspace.autosaveState === "error" ? "Save error" : "Saved"}
        </span>
      </div>
      <nav className="menu-bar" aria-label="Application menu">
        {MENUS.map((menu) => (
          <button key={menu} className="menu-button" type="button" disabled title="Menu commands are not available yet">
            {menu}
          </button>
        ))}
      </nav>
      <div className="title-actions">
        <button
          type="button"
          aria-label="Undo"
          className="icon-button"
          disabled={!workspace.canUndo}
          onClick={workspace.undo}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          className="icon-button"
          disabled={!workspace.canRedo}
          onClick={workspace.redo}
        >
          <Redo2 size={16} />
        </button>
        <span className="title-divider" />
        <button
          type="button"
          aria-label="Toggle explorer"
          className="icon-button"
          onClick={() => workspace.setExplorerOpen(!workspace.explorerOpen)}
        >
          {workspace.explorerOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button
          type="button"
          aria-label="Toggle agent pane"
          className="icon-button"
          onClick={() => workspace.setAgentOpen(!workspace.agentOpen)}
        >
          {workspace.agentOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        <button type="button" className="agent-trigger" onClick={() => workspace.setAgentOpen(true)}>
          <Bot size={15} />
          AI エージェント
        </button>
        <div className="theme-control" role="group" aria-label="Theme">
          <button type="button" aria-label="Use light theme" aria-pressed={appTheme.theme === "light"} title="Light theme" onClick={() => appTheme.setTheme("light")}><Sun size={14} /></button>
          <button type="button" aria-label="Use dark theme" aria-pressed={appTheme.theme === "dark"} title="Dark theme" onClick={() => appTheme.setTheme("dark")}><Moon size={14} /></button>
          <button type="button" aria-label="Use system theme" aria-pressed={appTheme.theme === "system"} title="System theme" onClick={() => appTheme.setTheme("system")}><Monitor size={14} /></button>
        </div>
        <button type="button" className="workspace-action-button" aria-label="Save workspace" title="Save workspace" onClick={() => void nativeWorkspace.save()}><Save size={14} /></button>
        <button type="button" className="workspace-action-button" aria-label="Open workspace" title="Open workspace" onClick={() => void nativeWorkspace.open()}><FolderOpen size={14} /></button>
        {nativeWorkspace.message ? <span className="workspace-action-status" role="status">{nativeWorkspace.message}</span> : null}
      </div>
    </header>
  );
}
