import { FileText, Search, Sheet } from "lucide-react";
import { useMemo, useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface Props {
  workspace: OfficeWorkspace;
  onClose: () => void;
}

export function QuickOpen({ workspace, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose, "input");
  const resources = useMemo(() => {
    const sheets = workspace.workbook.sheets.map((sheet) => ({
      id: sheet.id,
      label: sheet.name,
      detail: "Spreadsheet",
      icon: <Sheet size={15} />,
      open: () => workspace.activateSheet(sheet.id),
    }));
    const documents = workspace.documents.map((document) => ({
      id: document.id,
      label: document.name,
      detail: "Document · Djot",
      icon: <FileText size={15} />,
      open: () => workspace.openResource(document.id),
    }));
    return [...sheets, ...documents];
  }, [workspace]);
  const normalized = query.trim().toLowerCase();
  const filtered = resources.filter((resource) => !normalized || resource.label.toLowerCase().includes(normalized));
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  const open = (resource: (typeof resources)[number]) => {
    resource.open();
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Quick open" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={17} />
          <input
            autoFocus
            aria-label="Quick open resource"
            placeholder="Open a spreadsheet or document…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && filtered[safeSelectedIndex]) open(filtered[safeSelectedIndex]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-group-label"><Search size={12} /> QUICK OPEN</div>
        <div className="palette-results">
          {filtered.map((resource, index) => (
            <button key={resource.id} type="button" data-selected={index === safeSelectedIndex} onClick={() => open(resource)}>
              {resource.icon}<span>{resource.label}</span><small>{resource.detail}</small>
            </button>
          ))}
          {filtered.length === 0 ? <p className="global-search-hint">No matching resource.</p> : null}
        </div>
      </section>
    </div>
  );
}
