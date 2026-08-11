import { FileCode2, FileText, Search, Sheet, Sigma } from "lucide-react";
import { useMemo, useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  onClose: () => void;
  workspace: OfficeWorkspace;
}

interface SearchResult {
  detail: string;
  icon: "cell" | "document" | "source" | "sheet";
  id: string;
  label: string;
  run: () => void;
}

function matchingLines(source: string, query: string): Array<{ line: number; text: string }> {
  return source.split("\n").flatMap((text, index) =>
    text.toLocaleLowerCase().includes(query) ? [{ line: index + 1, text: text.trim() || "(blank line)" }] : [],
  );
}

export function GlobalSearch({ onClose, workspace }: Props) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo<SearchResult[]>(() => {
    if (!normalized) return [];
    const output: SearchResult[] = [];

    for (const sheet of workspace.workbook.sheets) {
      if (sheet.name.toLocaleLowerCase().includes(normalized)) {
        output.push({
          detail: "Spreadsheet",
          icon: "sheet",
          id: `sheet:${sheet.id}`,
          label: sheet.name,
          run: () => workspace.activateSheet(sheet.id),
        });
      }
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const value = String(cell.value ?? "");
        const formula = cell.formula ?? "";
        if (!value.toLocaleLowerCase().includes(normalized) && !formula.toLocaleLowerCase().includes(normalized)) continue;
        output.push({
          detail: `${sheet.name}!${address}${formula ? `  =${formula}` : ""}`,
          icon: "cell",
          id: `cell:${sheet.id}:${address}`,
          label: value || `=${formula}`,
          run: () => {
            workspace.activateSheet(sheet.id);
            workspace.setActiveCell(address);
            workspace.setSelection(address);
          },
        });
      }
    }

    for (const match of matchingLines(workspace.source, normalized)) {
      output.push({
        detail: `sales.kdl:${match.line}`,
        icon: "source",
        id: `kdl:${match.line}`,
        label: match.text,
        run: () => {
          workspace.openResource("sales");
          workspace.setActiveView("source");
        },
      });
    }

    for (const document of workspace.documents) {
      if (document.name.toLocaleLowerCase().includes(normalized)) {
        output.push({
          detail: "Document",
          icon: "document",
          id: `document:${document.id}`,
          label: document.name,
          run: () => workspace.openResource(document.id),
        });
      }
      for (const match of matchingLines(document.source, normalized)) {
        output.push({
          detail: `${document.name}.dj:${match.line}`,
          icon: "document",
          id: `document-source:${document.id}:${match.line}`,
          label: match.text,
          run: () => workspace.openResource(document.id),
        });
      }
    }
    return output.slice(0, 80);
  }, [normalized, workspace]);

  const select = (result: SearchResult) => {
    result.run();
    onClose();
  };
  const icon = (kind: SearchResult["icon"]) => kind === "cell" ? <Sigma size={15} /> : kind === "source" ? <FileCode2 size={15} /> : kind === "document" ? <FileText size={15} /> : <Sheet size={15} />;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette global-search" role="dialog" aria-label="Global search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={17} />
          <input
            autoFocus
            aria-label="Search workspace"
            placeholder="Search cells, formulas, source, documents…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && results[0]) select(results[0]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-group-label"><Search size={12} /> WORKSPACE SEARCH</div>
        <div className="palette-results global-search-results">
          {!normalized ? <p className="global-search-hint">Search across spreadsheet values, formulas, KDL, Djot, and resource names.</p> : null}
          {normalized && results.length === 0 ? <p className="global-search-hint">No matches in this workspace.</p> : null}
          {results.map((result, index) => (
            <button key={result.id} type="button" data-selected={index === 0} onClick={() => select(result)}>
              {icon(result.icon)}
              <span>{result.label}</span>
              <small>{result.detail}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
