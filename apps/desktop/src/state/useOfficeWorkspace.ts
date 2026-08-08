import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySpreadsheetOperations,
  createTransaction,
  type SpreadsheetOperation,
  type Transaction,
} from "@office-ide/operations";
import type { Diagnostic, EditorContext } from "@office-ide/protocol";
import {
  parseSpreadsheetSource,
  serializeSpreadsheetSource,
} from "@office-ide/sheet-source";
import {
  getActiveSheet,
  type CellScalar,
  type CellStyle,
  type SpreadsheetWorkbook,
} from "@office-ide/spreadsheet-ir";
import { SAMPLE_SHEET_SOURCE } from "../data/sampleSource";

export type WorkbenchView = EditorContext["activeView"];
type StructureOperationType = Extract<SpreadsheetOperation, { at: number }>["type"];

interface SelectionBounds {
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
}

interface HistoryEntry {
  transaction: Transaction;
  before: SpreadsheetWorkbook;
  after: SpreadsheetWorkbook;
}

const initialParse = parseSpreadsheetSource(SAMPLE_SHEET_SOURCE);
if (!initialParse.workbook) throw new Error("Bundled spreadsheet source is invalid");
const initialWorkbook = initialParse.workbook;

function getWorkbookDiagnostics(workbook: SpreadsheetWorkbook): Diagnostic[] {
  return parseSpreadsheetSource(serializeSpreadsheetSource(workbook)).diagnostics;
}

function columnLabelToIndex(label: string): number {
  return [...label].reduce(
    (index, character) => index * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function columnIndexToLabel(index: number): string {
  let current = index;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

function parseAddress(address: string): { column: number; row: number } | null {
  const match = address.match(/^([A-Z]+)([1-9]\d*)$/);
  return match ? { column: columnLabelToIndex(match[1]), row: Number(match[2]) } : null;
}

export function getSelectionBounds(selection: string): SelectionBounds | null {
  const [startAddress, endAddress = startAddress] = selection.split(":");
  const start = parseAddress(startAddress);
  const end = parseAddress(endAddress);
  if (!start || !end) return null;
  return {
    firstColumn: Math.min(start.column, end.column),
    lastColumn: Math.max(start.column, end.column),
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
  };
}

export function useOfficeWorkspace() {
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbook>(initialWorkbook);
  const [source, setSource] = useState(SAMPLE_SHEET_SOURCE);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [activeCell, setActiveCell] = useState("C17");
  const [selection, setSelection] = useState("A2:F15");
  const [activeView, setActiveView] = useState<WorkbenchView>("source");
  const [agentOpen, setAgentOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeResource, setActiveResource] = useState("sales");
  const sourceUpdateOrigin = useRef<"visual" | "source">("visual");

  const activeSheet = useMemo(() => getActiveSheet(workbook), [workbook]);
  const selectionBounds = useMemo(() => getSelectionBounds(selection), [selection]);
  const canFillFormula = useMemo(() => {
    const position = parseAddress(activeCell);
    return Boolean(
      activeSheet.cells[activeCell]?.formula
      && position
      && selectionBounds
      && position.column >= selectionBounds.firstColumn
      && position.column <= selectionBounds.lastColumn
      && position.row >= selectionBounds.firstRow
      && position.row <= selectionBounds.lastRow
      && (selectionBounds.firstColumn !== selectionBounds.lastColumn
        || selectionBounds.firstRow !== selectionBounds.lastRow),
    );
  }, [activeCell, activeSheet.cells, selectionBounds]);

  const selectCell = useCallback((address: string, extend = false) => {
    if (!extend) {
      setActiveCell(address);
      setSelection(address);
      return;
    }
    const anchor = parseAddress(activeCell);
    const target = parseAddress(address);
    if (!anchor || !target) return;
    setSelection(
      `${columnIndexToLabel(Math.min(anchor.column, target.column))}${Math.min(anchor.row, target.row)}`
      + `:${columnIndexToLabel(Math.max(anchor.column, target.column))}${Math.max(anchor.row, target.row)}`,
    );
  }, [activeCell]);

  const applyCellEdit = useCallback(
    (address: string, nextValue: string) => {
      const parsed: CellScalar = /^-?\d+(\.\d+)?$/.test(nextValue)
        ? Number(nextValue)
        : nextValue;
      const before = workbook;
      const operation = nextValue.startsWith("=")
        ? {
            type: "set-formula" as const,
            sheetId: activeSheet.id,
            address,
            formula: nextValue.slice(1),
          }
        : {
            type: "set-cell-value" as const,
            sheetId: activeSheet.id,
            address,
            value: parsed,
          };
      const after = applySpreadsheetOperations(before, [operation]);
      const transaction = createTransaction(`Changed ${address}`, [operation]);
      sourceUpdateOrigin.current = "visual";
      setWorkbook(after);
      setSource(serializeSpreadsheetSource(after));
      setHistory((entries) => [...entries, { transaction, before, after }]);
      setRedoStack([]);
      setDiagnostics(getWorkbookDiagnostics(after));
      setActiveCell(address);
      setSelection(address);
    },
    [activeSheet.id, workbook],
  );

  const editSource = useCallback((nextSource: string) => {
    sourceUpdateOrigin.current = "source";
    setSource(nextSource);
  }, []);

  const applyCellStyle = useCallback(
    (style: CellStyle) => {
      const before = workbook;
      const operation = {
        type: "set-cell-style" as const,
        sheetId: activeSheet.id,
        address: activeCell,
        style,
      };
      const after = applySpreadsheetOperations(before, [operation]);
      const transaction = createTransaction(`Formatted ${activeCell}`, [operation]);
      sourceUpdateOrigin.current = "visual";
      setWorkbook(after);
      setSource(serializeSpreadsheetSource(after));
      setHistory((entries) => [...entries, { transaction, before, after }]);
      setRedoStack([]);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeCell, activeSheet.id, workbook],
  );

  const applyColumnWidth = useCallback(
    (column: string, width: number) => {
      const clampedWidth = Math.min(80, Math.max(4, width));
      const before = workbook;
      const operation = {
        type: "set-column-width" as const,
        sheetId: activeSheet.id,
        column,
        width: clampedWidth,
      };
      const after = applySpreadsheetOperations(before, [operation]);
      const transaction = createTransaction(`Resized column ${column}`, [operation]);
      sourceUpdateOrigin.current = "visual";
      setWorkbook(after);
      setSource(serializeSpreadsheetSource(after));
      setHistory((entries) => [...entries, { transaction, before, after }]);
      setRedoStack([]);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, workbook],
  );

  const applyRowHeight = useCallback(
    (row: number, height: number) => {
      const clampedHeight = Math.min(120, Math.max(16, height));
      const before = workbook;
      const operation = {
        type: "set-row-height" as const,
        sheetId: activeSheet.id,
        row,
        height: clampedHeight,
      };
      const after = applySpreadsheetOperations(before, [operation]);
      const transaction = createTransaction(`Resized row ${row}`, [operation]);
      sourceUpdateOrigin.current = "visual";
      setWorkbook(after);
      setSource(serializeSpreadsheetSource(after));
      setHistory((entries) => [...entries, { transaction, before, after }]);
      setRedoStack([]);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, workbook],
  );

  const applySheetStructure = useCallback(
    (type: StructureOperationType, at: number, count = 1) => {
      const before = workbook;
      const operation = {
        type,
        sheetId: activeSheet.id,
        at,
        count,
      } as Extract<SpreadsheetOperation, { at: number }>;
      const after = applySpreadsheetOperations(before, [operation]);
      const labels: Record<StructureOperationType, string> = {
        "insert-rows": `Inserted ${count} row${count === 1 ? "" : "s"} at ${at}`,
        "delete-rows": `Deleted ${count} row${count === 1 ? "" : "s"} at ${at}`,
        "insert-columns": `Inserted ${count} column${count === 1 ? "" : "s"} at ${at}`,
        "delete-columns": `Deleted ${count} column${count === 1 ? "" : "s"} at ${at}`,
      };
      const transaction = createTransaction(labels[type], [operation]);
      sourceUpdateOrigin.current = "visual";
      setWorkbook(after);
      setSource(serializeSpreadsheetSource(after));
      setHistory((entries) => [...entries, { transaction, before, after }]);
      setRedoStack([]);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, workbook],
  );

  const applyFormulaFill = useCallback(() => {
    const sourceCell = activeSheet.cells[activeCell];
    if (!sourceCell?.formula || !selectionBounds || !canFillFormula) return;
    const before = workbook;
    const operation = {
      type: "fill-formula" as const,
      sheetId: activeSheet.id,
      range: selection,
      sourceAddress: activeCell,
      formula: sourceCell.formula,
    };
    const after = applySpreadsheetOperations(before, [operation]);
    const transaction = createTransaction(`Filled formula through ${selection}`, [operation]);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    setHistory((entries) => [...entries, { transaction, before, after }]);
    setRedoStack([]);
    setDiagnostics(getWorkbookDiagnostics(after));
  }, [activeCell, activeSheet.cells, activeSheet.id, canFillFormula, selection, selectionBounds, workbook]);

  useEffect(() => {
    if (sourceUpdateOrigin.current !== "source") return;
    const timer = window.setTimeout(() => {
      const result = parseSpreadsheetSource(source);
      setDiagnostics(result.diagnostics);
      if (!result.workbook) return;

      setWorkbook((before) => {
        const transaction = createTransaction("Updated KDL source", [], { type: "user" });
        setHistory((entries) => [
          ...entries,
          { transaction, before, after: result.workbook! },
        ]);
        setRedoStack([]);
        return result.workbook!;
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [source]);

  const undo = useCallback(() => {
    setHistory((entries) => {
      const latest = entries.at(-1);
      if (!latest) return entries;
      sourceUpdateOrigin.current = "visual";
      setWorkbook(latest.before);
      const nextSource = serializeSpreadsheetSource(latest.before);
      setSource(nextSource);
      setDiagnostics(parseSpreadsheetSource(nextSource).diagnostics);
      setRedoStack((redoEntries) => [...redoEntries, latest]);
      return entries.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((entries) => {
      const latest = entries.at(-1);
      if (!latest) return entries;
      sourceUpdateOrigin.current = "visual";
      setWorkbook(latest.after);
      const nextSource = serializeSpreadsheetSource(latest.after);
      setSource(nextSource);
      setDiagnostics(parseSpreadsheetSource(nextSource).diagnostics);
      setHistory((historyEntries) => [...historyEntries, latest]);
      return entries.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (modifier && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setAgentOpen((open) => !open);
      }
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return {
    workbook,
    activeSheet,
    source,
    diagnostics,
    history,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
    activeCell,
    selection,
    selectionBounds,
    canFillFormula,
    activeView,
    agentOpen,
    explorerOpen,
    paletteOpen,
    activeResource,
    applyCellEdit,
    applyCellStyle,
    applyColumnWidth,
    applyRowHeight,
    applySheetStructure,
    applyFormulaFill,
    editSource,
    undo,
    redo,
    setActiveCell,
    setSelection,
    selectCell,
    setActiveView,
    setAgentOpen,
    setExplorerOpen,
    setPaletteOpen,
    setActiveResource,
  };
}

export type OfficeWorkspace = ReturnType<typeof useOfficeWorkspace>;
