import {
  AlignLeft,
  Bold,
  ChevronDown,
  Download,
  FileUp,
  Italic,
  PaintBucket,
  Percent,
  Redo2,
  Search,
  Sigma,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { calculateSheet, isCalculatedError } from "@office-ide/formula";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { CodexRuntime } from "../state/useCodexRuntime";
import type { XlsxTransfer } from "../state/useXlsxTransfer";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { WorkbenchPanel } from "./WorkbenchPanel";

interface Props {
  workspace: OfficeWorkspace;
  codexRuntime: CodexRuntime;
  xlsx: XlsxTransfer;
}

interface FormulaInputProps {
  address: string;
  value: string;
  onCommit: (value: string) => void;
}

/** 数式を入力し終えるまでIRへcommitせず、途中の構文エラーを暴発させない。 */
function FormulaInput({ address, value, onCommit }: FormulaInputProps) {
  const [draft, setDraft] = useState(value);
  const cancelRef = useRef(false);

  useEffect(() => setDraft(value), [address, value]);

  return (
    <input
      aria-label="Formula bar"
      className="formula-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(value);
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function SpreadsheetEditor({ workspace, codexRuntime, xlsx }: Props) {
  const internalClipboard = useRef("");
  const cell = workspace.activeSheet.cells[workspace.activeCell];
  const calculatedValues = useMemo(() => calculateSheet(workspace.activeSheet), [workspace.activeSheet]);
  const activeFormulaError = calculatedValues[workspace.activeCell];
  const formulaValue = cell?.formula ? `=${cell.formula}` : String(cell?.value ?? "");
  const [, activeColumn = "A", activeRowText = "1"] = workspace.activeCell.match(/^([A-Z]+)(\d+)$/) ?? [];
  const activeRow = Number(activeRowText);
  const activeColumnIndex = activeColumn
    .split("")
    .reduce((index, character) => index * 26 + character.charCodeAt(0) - 64, 0);
  const columnWidth = workspace.activeSheet.columnWidths[activeColumn] ?? 14;
  const rowHeight = workspace.activeSheet.rowHeights[activeRow] ?? 25;
  const bounds = workspace.selectionBounds;
  const firstRow = bounds?.firstRow ?? activeRow;
  const rowCount = bounds ? bounds.lastRow - bounds.firstRow + 1 : 1;
  const firstColumn = bounds?.firstColumn ?? activeColumnIndex;
  const columnCount = bounds ? bounds.lastColumn - bounds.firstColumn + 1 : 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target;
      const isGridCell = target instanceof HTMLInputElement && target.getAttribute("aria-label")?.startsWith("Cell ");
      if (!modifier || !isGridCell) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        const text = workspace.copySelection();
        internalClipboard.current = text;
        void navigator.clipboard?.writeText(text).catch(() => undefined);
      }
      if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        void navigator.clipboard?.readText()
          .catch(() => internalClipboard.current)
          .then((text) => workspace.pasteCells(text || internalClipboard.current));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspace.copySelection, workspace.pasteCells]);

  return (
    <div className="spreadsheet-editor">
      <div className="formula-row">
        <button className="name-box" type="button">
          {workspace.selection}
          <ChevronDown size={13} />
        </button>
        <span className="formula-symbol">ƒx</span>
        <FormulaInput
          address={workspace.activeCell}
          value={formulaValue}
          onCommit={(value) => workspace.applyCellEdit(workspace.activeCell, value)}
        />
        {isCalculatedError(activeFormulaError) ? (
          <div className="formula-error-recovery" role="alert">
            <span>{activeFormulaError}</span>
            <button type="button" onClick={() => workspace.applyCellEdit(workspace.activeCell, "")}>エラーを消去</button>
          </div>
        ) : null}
      </div>
      <div className="format-toolbar" role="toolbar" aria-label="Spreadsheet formatting">
        <button className="toolbar-button" type="button" onClick={workspace.undo} disabled={!workspace.canUndo}>
          <Undo2 size={15} />
        </button>
        <button className="toolbar-button" type="button" onClick={workspace.redo} disabled={!workspace.canRedo}>
          <Redo2 size={15} />
        </button>
        <span className="toolbar-divider" />
        <button className="toolbar-select" type="button">Yu Gothic UI <ChevronDown size={12} /></button>
        <button className="toolbar-select compact" type="button">11 <ChevronDown size={12} /></button>
        <button className="toolbar-button" type="button" aria-label="Bold" aria-pressed={cell?.style?.bold ?? false} onClick={() => workspace.applyCellStyle({ bold: !cell?.style?.bold })}><Bold size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Italic" aria-pressed={cell?.style?.italic ?? false} onClick={() => workspace.applyCellStyle({ italic: !cell?.style?.italic })}><Italic size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Align" aria-pressed={cell?.style?.horizontalAlign === "left"} onClick={() => workspace.applyCellStyle({ horizontalAlign: cell?.style?.horizontalAlign === "left" ? "right" : "left" })}><AlignLeft size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Fill color" aria-pressed={Boolean(cell?.style?.background)} onClick={() => workspace.applyCellStyle({ background: cell?.style?.background ? "" : "#254f7d" })}><PaintBucket size={15} /></button>
        <button className="toolbar-button" type="button"><Percent size={15} /></button>
        <button
          className="toolbar-button"
          type="button"
          aria-label="Fill formula through selection"
          title="選択範囲へ数式を相対フィル"
          disabled={!workspace.canFillFormula}
          onClick={workspace.applyFormulaFill}
        >
          <Sigma size={15} />
        </button>
        <label className="dimension-control">
          <span>W</span>
          <input
            aria-label={`Column ${activeColumn} width`}
            type="number"
            min={4}
            max={80}
            value={columnWidth}
            onChange={(event) => workspace.applyColumnWidth(activeColumn, Number(event.target.value))}
          />
        </label>
        <label className="dimension-control">
          <span>H</span>
          <input
            aria-label={`Row ${activeRow} height`}
            type="number"
            min={16}
            max={120}
            value={rowHeight}
            onChange={(event) => workspace.applyRowHeight(activeRow, Number(event.target.value))}
          />
        </label>
        <span className="toolbar-divider" />
        <button
          className="toolbar-button xlsx-action"
          type="button"
          aria-label="Import XLSX workbook"
          title="Import XLSX workbook"
          disabled={xlsx.busy !== null}
          onClick={() => void xlsx.importWorkbook()}
        >
          <FileUp size={15} />
        </button>
        <button
          className="toolbar-button xlsx-action"
          type="button"
          aria-label="Export XLSX workbook"
          title="Export XLSX workbook"
          disabled={xlsx.busy !== null}
          onClick={() => void xlsx.exportWorkbook()}
        >
          <Download size={15} />
        </button>
        {xlsx.busy ? <span className="xlsx-status">{xlsx.busy === "import" ? "XLSX を読み込み中…" : "XLSX を書き出し中…"}</span> : null}
        {xlsx.error ? <span className="xlsx-status error" title={xlsx.error}>XLSX error</span> : null}
        {xlsx.report ? <span className="xlsx-status" title={xlsx.report.warnings.join("\n")}>XLSX: {xlsx.report.importedCells || xlsx.report.exportedCells} cells</span> : null}
        <div className="structure-controls" role="group" aria-label="Row and column structure">
          <button
            className="structure-button"
            type="button"
            aria-label={`Insert ${rowCount} row${rowCount === 1 ? "" : "s"} before ${firstRow}`}
            title={`Insert ${rowCount} row${rowCount === 1 ? "" : "s"}`}
            onClick={() => workspace.applySheetStructure("insert-rows", firstRow, rowCount)}
          >
            +R
          </button>
          <button
            className="structure-button"
            type="button"
            aria-label={`Delete ${rowCount} row${rowCount === 1 ? "" : "s"} at ${firstRow}`}
            title={`Delete ${rowCount} row${rowCount === 1 ? "" : "s"}`}
            onClick={() => workspace.applySheetStructure("delete-rows", firstRow, rowCount)}
          >
            −R
          </button>
          <button
            className="structure-button"
            type="button"
            aria-label={`Insert ${columnCount} column${columnCount === 1 ? "" : "s"} before ${firstColumn}`}
            title={`Insert ${columnCount} column${columnCount === 1 ? "" : "s"}`}
            onClick={() => workspace.applySheetStructure("insert-columns", firstColumn, columnCount)}
          >
            +C
          </button>
          <button
            className="structure-button"
            type="button"
            aria-label={`Delete ${columnCount} column${columnCount === 1 ? "" : "s"} at ${firstColumn}`}
            title={`Delete ${columnCount} column${columnCount === 1 ? "" : "s"}`}
            onClick={() => workspace.applySheetStructure("delete-columns", firstColumn, columnCount)}
          >
            −C
          </button>
        </div>
        <span className="toolbar-spacer" />
        <button className="toolbar-button" type="button"><Search size={15} /></button>
      </div>
      <div className="editor-work-area">
        <SpreadsheetGrid workspace={workspace} />
        <WorkbenchPanel workspace={workspace} codexRuntime={codexRuntime} />
      </div>
    </div>
  );
}
