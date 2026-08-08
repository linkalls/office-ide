import {
  Bot,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Undo2,
} from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

const MENUS = ["File", "Edit", "View", "Insert", "Data", "Agent"];

export function TitleBar({ workspace }: Props) {
  return (
    <header className="title-bar">
      <div className="brand" aria-label="Office IDE">
        <span className="brand-mark">OI</span>
        <span>Office IDE</span>
      </div>
      <nav className="menu-bar" aria-label="Application menu">
        {MENUS.map((menu) => (
          <button key={menu} className="menu-button" type="button">
            {menu}
          </button>
        ))}
      </nav>
      <button
        className="workspace-switcher"
        type="button"
        onClick={() => workspace.setPaletteOpen(true)}
        title="Open command palette"
      >
        sales-report.office
        <ChevronDown size={13} />
      </button>
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
          Agent
        </button>
      </div>
    </header>
  );
}
