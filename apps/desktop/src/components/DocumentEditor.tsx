import { Bold, Code2, Download, Heading1, Heading2, List, Redo2, Table2, Undo2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { useDocxTransfer } from "../state/useDocxTransfer";

type Block =
  | { kind: "heading"; level: 1 | 2; line: number; text: string }
  | { kind: "list"; line: number; text: string }
  | { kind: "paragraph"; line: number; text: string }
  | { kind: "table"; start: number; rows: Array<{ line: number; cells: string[] }> };

function parseDjot(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const value = lines[line] ?? "";
    if (!value.trim()) continue;
    if (value.startsWith("|")) {
      const start = line;
      const rows: Array<{ line: number; cells: string[] }> = [];
      while (line < lines.length && lines[line]?.startsWith("|")) {
        const cells = lines[line]!.split("|").slice(1, -1).map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push({ line, cells });
        line += 1;
      }
      blocks.push({ kind: "table", start, rows });
      line -= 1;
      continue;
    }
    const heading = value.match(/^(#{1,2})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2, line, text: heading[2] ?? "" });
      continue;
    }
    const list = value.match(/^\d+\.\s+(.*)$/);
    if (list) {
      blocks.push({ kind: "list", line, text: list[1] ?? "" });
      continue;
    }
    blocks.push({ kind: "paragraph", line, text: value });
  }
  return blocks;
}

function replaceLine(source: string, line: number, value: string): string {
  const lines = source.split("\n");
  lines[line] = value;
  return lines.join("\n");
}
function lineOffset(source: string, line: number): number { return source.split("\n").slice(0, line).reduce((length, value) => length + value.length + 1, 0); }
function replaceTableCell(source: string, line: number, cellIndex: number, value: string): string {
  const lines = source.split("\n");
  const cells = (lines[line] ?? "").split("|").slice(1, -1).map((cell) => cell.trim());
  cells[cellIndex] = value;
  lines[line] = `| ${cells.join(" | ")} |`;
  return lines.join("\n");
}
function tableCellOffset(source: string, line: number, cellIndex: number): number {
  const value = source.split("\n")[line] ?? "";
  let offset = 1;
  for (let index = 0; index < cellIndex; index += 1) offset += (value.split("|")[index + 1] ?? "").length + 1;
  return lineOffset(source, line) + offset + (value.split("|")[cellIndex + 1]?.match(/^\s*/)?.[0].length ?? 0);
}

export function DocumentEditor({ workspace, docx }: { workspace: OfficeWorkspace; docx: ReturnType<typeof useDocxTransfer> }) {
  const [view, setView] = useState<"visual" | "source">("visual");
  const blocks = useMemo(() => parseDjot(workspace.documentSource), [workspace.documentSource]);
  const applyPrefix = (prefix: string) => {
    workspace.editDocumentSource(`${prefix}${workspace.documentSource}`);
    setView("source");
  };

  return (
    <section className="document-editor" aria-label="Document editor">
      <header className="document-toolbar">
        <div className="document-view-toggle" role="tablist" aria-label="Document view">
          <button type="button" role="tab" data-active={view === "visual"} onClick={() => setView("visual")}>Visual</button>
          <button type="button" role="tab" data-active={view === "source"} onClick={() => setView("source")}><Code2 size={14} /> Source</button>
        </div>
        <span className="toolbar-divider" />
        <button type="button" aria-label="Undo document edit" title="Undo" disabled={!workspace.canUndoDocument} onClick={workspace.undoDocument}><Undo2 size={15} /></button>
        <button type="button" aria-label="Redo document edit" title="Redo" disabled={!workspace.canRedoDocument} onClick={workspace.redoDocument}><Redo2 size={15} /></button>
        <span className="toolbar-divider" />
        <button type="button" title="Add heading" onClick={() => applyPrefix("# ")}><Heading1 size={15} /></button>
        <button type="button" title="Add section heading" onClick={() => applyPrefix("## ")}><Heading2 size={15} /></button>
        <button type="button" title="Add numbered list" onClick={() => applyPrefix("1. ")}><List size={15} /></button>
        <button type="button" title="Add table" onClick={() => applyPrefix("| 項目 | 値 |\n|---|---:|\n| | |\n\n")}><Table2 size={15} /></button>
        <button type="button" title="Bold syntax" onClick={() => applyPrefix("**重要:** ")}><Bold size={15} /></button>
        <span className="toolbar-divider" />
        <button type="button" title="Import DOCX" disabled={docx.busy} onClick={() => void docx.importDocx().then((source) => source && workspace.editDocumentSource(source))}><Upload size={15} /></button>
        <button type="button" title="Export DOCX" disabled={docx.busy} onClick={() => void docx.exportDocx(workspace.documentSource)}><Download size={15} /></button>
        {docx.message ? <span className="document-transfer-status" role="status">{docx.message}</span> : null}
      </header>
      {view === "source" ? (
        <textarea
          className="document-source"
          aria-label="Djot document source"
          spellCheck={false}
          value={workspace.documentSource}
          onChange={(event) => workspace.editDocumentSource(event.target.value)}
          onSelect={(event) => workspace.setDocumentSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
        />
      ) : (
        <article className="document-page" aria-label="Visual document">
          {blocks.map((block) => {
            if (block.kind === "table") return (
              <table className="document-table" key={`table-${block.start}`}>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={row.line}>{row.cells.map((cell, cellIndex) => {
                  const Cell = rowIndex === 0 ? "th" : "td";
                  return <Cell key={cellIndex}><input
                    aria-label={`Document table cell ${block.start + 1}:${rowIndex + 1}:${cellIndex + 1}`}
                    value={cell}
                    onChange={(event) => workspace.editDocumentSource(replaceTableCell(workspace.documentSource, row.line, cellIndex, event.target.value))}
                    onSelect={(event) => {
                      const start = event.currentTarget.selectionStart ?? 0;
                      const end = event.currentTarget.selectionEnd ?? start;
                      const offset = tableCellOffset(workspace.documentSource, row.line, cellIndex);
                      workspace.setDocumentSelection({ start: offset + start, end: offset + end });
                    }}
                  /></Cell>;
                })}</tr>)}</tbody>
              </table>
            );
            const prefix = block.kind === "heading" ? "#".repeat(block.level) + " " : block.kind === "list" ? "1. " : "";
            const Tag = block.kind === "heading" ? (`h${block.level}` as const) : block.kind === "list" ? "li" : "p";
            return <Tag key={`${block.kind}-${block.line}`} className={`document-${block.kind}`}>
              <input
                aria-label={`Document ${block.kind} line ${block.line + 1}`}
                value={block.text}
                onChange={(event) => workspace.editDocumentSource(replaceLine(workspace.documentSource, block.line, `${prefix}${event.target.value}`))}
                onSelect={(event) => { const start = event.currentTarget.selectionStart ?? 0; const end = event.currentTarget.selectionEnd ?? start; const offset = lineOffset(workspace.documentSource, block.line) + prefix.length; workspace.setDocumentSelection({ start: offset + start, end: offset + end }); }}
              />
            </Tag>;
          })}
        </article>
      )}
    </section>
  );
}
