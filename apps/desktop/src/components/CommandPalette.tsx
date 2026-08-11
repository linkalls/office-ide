import { Braces, Bot, Command, Download, FileDiff, FilePlus2, FileText, PanelRight, Search, TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { XlsxTransfer } from "../state/useXlsxTransfer";
import type { useDocxTransfer } from "../state/useDocxTransfer";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface Props {
  workspace: OfficeWorkspace;
  xlsx: XlsxTransfer;
  docx: ReturnType<typeof useDocxTransfer>;
}

export function CommandPalette({ workspace, xlsx, docx }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useDialogFocus<HTMLElement>(workspace.paletteOpen, () => workspace.setPaletteOpen(false), "input");
  const commands = useMemo(() => [
    { label: "Open KDL source", detail: "Workbench: Source", icon: <Braces size={15} />, run: () => workspace.setActiveView("source") },
    { label: "Open semantic diff", detail: "Workbench: Diff", icon: <FileDiff size={15} />, run: () => workspace.setActiveView("diff") },
    { label: "Export as XLSX", detail: "Spreadsheet", icon: <Download size={15} />, run: () => void xlsx.exportWorkbook() },
    { label: "Export as DOCX", detail: "Active document", icon: <Download size={15} />, run: () => void docx.exportDocx(workspace.documentSource) },
    { label: "Toggle agent pane", detail: "Ctrl+J", icon: <PanelRight size={15} />, run: () => workspace.setAgentOpen(!workspace.agentOpen) },
    { label: "Start Codex terminal", detail: "Agent: Codex", icon: <Bot size={15} />, run: () => workspace.setAgentOpen(true) },
    { label: "Open integrated terminal", detail: "Workbench: Terminal", icon: <TerminalSquare size={15} />, run: () => workspace.setActiveView("terminal") },
    { label: "Create spreadsheet resource", detail: "New worksheet", icon: <FilePlus2 size={15} />, run: () => workspace.addSheet() },
    { label: "Create document resource", detail: "New Djot document", icon: <FileText size={15} />, run: () => workspace.addDocument() },
  ], [docx, workspace, xlsx]);
  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const execute = (run: () => void) => {
    run();
    workspace.setPaletteOpen(false);
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={() => workspace.setPaletteOpen(false)}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={17} />
          <input
            autoFocus
            placeholder="Type a command…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") workspace.setPaletteOpen(false);
              if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && filtered[safeSelectedIndex]) execute(filtered[safeSelectedIndex].run);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-group-label"><Command size={12} /> COMMANDS</div>
        <div className="palette-results">
          {filtered.map((command, index) => (
            <button key={command.label} type="button" data-selected={index === safeSelectedIndex} onClick={() => execute(command.run)}>
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
