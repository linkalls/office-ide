import { Braces, Bot, Command, FilePlus2, PanelRight, Search, TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

export function CommandPalette({ workspace }: Props) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => [
    { label: "Open KDL source", detail: "Workbench: Source", icon: <Braces size={15} />, run: () => workspace.setActiveView("source") },
    { label: "Toggle agent pane", detail: "Ctrl+J", icon: <PanelRight size={15} />, run: () => workspace.setAgentOpen(!workspace.agentOpen) },
    { label: "Start Codex terminal", detail: "Agent: Codex", icon: <Bot size={15} />, run: () => workspace.setAgentOpen(true) },
    { label: "Open integrated terminal", detail: "Workbench: Terminal", icon: <TerminalSquare size={15} />, run: () => workspace.setActiveView("terminal") },
    { label: "Create spreadsheet resource", detail: "New resource", icon: <FilePlus2 size={15} />, run: () => workspace.setActiveResource("sales") },
  ], [workspace]);
  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));

  const execute = (run: () => void) => {
    run();
    workspace.setPaletteOpen(false);
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={() => workspace.setPaletteOpen(false)}>
      <section className="command-palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={17} />
          <input
            autoFocus
            placeholder="Type a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") workspace.setPaletteOpen(false);
              if (event.key === "Enter" && filtered[0]) execute(filtered[0].run);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-group-label"><Command size={12} /> COMMANDS</div>
        <div className="palette-results">
          {filtered.map((command, index) => (
            <button key={command.label} type="button" data-selected={index === 0} onClick={() => execute(command.run)}>
              {command.icon}
              <span>{command.label}</span>
              <small>{command.detail}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
