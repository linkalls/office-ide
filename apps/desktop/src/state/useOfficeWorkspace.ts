import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySpreadsheetOperations,
  createTransaction,
  type Actor,
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
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  type StoredDocument,
} from "./workspacePersistence";
import type { AgentProposal } from "./agentPlanner";
import {
  createHistoryEntry,
  setHistoryEntryState,
  type HistoryEntry,
} from "./workspaceHistory";

export type WorkbenchView = EditorContext["activeView"];
type StructureOperationType = Extract<SpreadsheetOperation, { at: number }>["type"];

interface SelectionBounds {
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
}

const initialParse = parseSpreadsheetSource(SAMPLE_SHEET_SOURCE);
if (!initialParse.workbook) throw new Error("Bundled spreadsheet source is invalid");
const initialWorkbook = initialParse.workbook;

export const SAMPLE_DOCUMENT_SOURCE = `# 2026年度 売上分析

2026年度の売上は前年を上回り、重点地域で堅調に推移しました。

## 概要

1. 既存顧客の継続率を改善
2. 新商品カテゴリを拡大
3. 地域別の施策を最適化

## 地域別売上

| 地域 | 2025 | 2026 |
|---|---:|---:|
| 東京 | 1200 | 1450 |
| 大阪 | 800 | 910 |
`;

const INITIAL_DOCUMENTS: StoredDocument[] = [{
  id: "report",
  name: "report",
  source: SAMPLE_DOCUMENT_SOURCE,
}];

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
  const [restoredWorkspace] = useState(() =>
    typeof window === "undefined" ? null : loadWorkspaceSnapshot(window.localStorage));
  const initialDocuments = restoredWorkspace?.documents?.length
    ? restoredWorkspace.documents
    : [{ ...INITIAL_DOCUMENTS[0], source: restoredWorkspace?.documentSource ?? SAMPLE_DOCUMENT_SOURCE }];
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbook>(
    restoredWorkspace?.workbook ?? initialWorkbook,
  );
  const [source, setSource] = useState(restoredWorkspace?.source ?? SAMPLE_SHEET_SOURCE);
  const sourceBaselineRef = useRef(restoredWorkspace?.source ?? SAMPLE_SHEET_SOURCE);
  const [documents, setDocuments] = useState<StoredDocument[]>(initialDocuments);
  const documentSourceBaselineRef = useRef<Record<string, string>>(
    Object.fromEntries(initialDocuments.map((document) => [document.id, document.source])),
  );
  const [documentSelection, setDocumentSelection] = useState({ start: 0, end: 0 });
  const [documentUndoStack, setDocumentUndoStack] = useState<string[]>([]);
  const [documentRedoStack, setDocumentRedoStack] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [activeCell, setActiveCell] = useState("C17");
  const [selection, setSelection] = useState("A2:F15");
  const [secondarySelections, setSecondarySelections] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<WorkbenchView>("visual");
  const [agentOpen, setAgentOpen] = useState(true);
  // Keep the spreadsheet itself as the initial focal point. The Explorer is
  // still available from the title bar whenever the user needs it.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeResource, setActiveResource] = useState("sales");
  const [workspaceTitle, setWorkspaceTitle] = useState("sales-report");
  const [openResources, setOpenResources] = useState<string[]>(["sales", "report"]);
  const [autosaveState, setAutosaveState] = useState<"saving" | "saved" | "error">(
    restoredWorkspace ? "saved" : "saving",
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(restoredWorkspace?.savedAt ?? null);
  const sourceUpdateOrigin = useRef<"visual" | "source">("visual");
  const activeDocument = documents.find((document) => document.id === activeResource) ?? documents[0]!;
  const documentSource = activeDocument.source;
  const documentSourceRef = useRef(documentSource);

  useEffect(() => {
    documentSourceRef.current = documentSource;
  }, [documentSource]);

  const recordTransaction = useCallback((
    transaction: Transaction,
    before: SpreadsheetWorkbook,
    after: SpreadsheetWorkbook,
  ) => {
    const entry = createHistoryEntry(transaction, before, after);
    setHistory((entries) => [...entries, entry]);
    setUndoStack((entries) => [...entries, entry]);
    setRedoStack([]);
  }, []);

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
      setSecondarySelections([]);
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

  const toggleSecondarySelection = useCallback((address: string) => {
    if (address === activeCell) return;
    setSecondarySelections((items) => items.includes(address)
      ? items.filter((item) => item !== address)
      : [...items, address]);
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
      recordTransaction(transaction, before, after);
      setDiagnostics(getWorkbookDiagnostics(after));
      setActiveCell(address);
      setSelection(address);
    },
    [activeSheet.id, recordTransaction, workbook],
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
      recordTransaction(transaction, before, after);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeCell, activeSheet.id, recordTransaction, workbook],
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
      recordTransaction(transaction, before, after);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, recordTransaction, workbook],
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
      recordTransaction(transaction, before, after);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, recordTransaction, workbook],
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
      recordTransaction(transaction, before, after);
      setDiagnostics(getWorkbookDiagnostics(after));
    },
    [activeSheet.id, recordTransaction, workbook],
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
    recordTransaction(transaction, before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
  }, [activeCell, activeSheet.cells, activeSheet.id, canFillFormula, recordTransaction, selection, selectionBounds, workbook]);

  const fillSelection = useCallback((direction: "down" | "right") => {
    const bounds = selectionBounds;
    if (!bounds) return;
    const hasDestination = direction === "down"
      ? bounds.lastRow > bounds.firstRow
      : bounds.lastColumn > bounds.firstColumn;
    if (!hasDestination) return;

    const before = workbook;
    const sourceIndexes = Array.from({
      length: direction === "down"
        ? bounds.lastColumn - bounds.firstColumn + 1
        : bounds.lastRow - bounds.firstRow + 1,
    }, (_, index) => index);
    const operations: SpreadsheetOperation[] = sourceIndexes.flatMap((index): SpreadsheetOperation[] => {
      const sourceColumn = direction === "down" ? bounds.firstColumn + index : bounds.firstColumn;
      const sourceRow = direction === "down" ? bounds.firstRow : bounds.firstRow + index;
      const sourceAddress = `${columnIndexToLabel(sourceColumn)}${sourceRow}`;
      const sourceCell = activeSheet.cells[sourceAddress];
      if (!sourceCell) return [];
      const destinationCount = direction === "down"
        ? bounds.lastRow - bounds.firstRow
        : bounds.lastColumn - bounds.firstColumn;
      if (sourceCell.formula) {
        const endColumn = direction === "down" ? sourceColumn : bounds.lastColumn;
        const endRow = direction === "down" ? bounds.lastRow : sourceRow;
        return [{
          type: "fill-formula" as const,
          sheetId: activeSheet.id,
          range: `${sourceAddress}:${columnIndexToLabel(endColumn)}${endRow}`,
          sourceAddress,
          formula: sourceCell.formula,
        }];
      }
      return Array.from({ length: destinationCount }, (_, offset) => ({
        type: "set-cell-value" as const,
        sheetId: activeSheet.id,
        address: direction === "down"
          ? `${columnIndexToLabel(sourceColumn)}${sourceRow + offset + 1}`
          : `${columnIndexToLabel(sourceColumn + offset + 1)}${sourceRow}`,
        value: sourceCell.value ?? "",
      }));
    });
    if (operations.length === 0) return;
    const after = applySpreadsheetOperations(before, operations);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(createTransaction(
      `Filled ${direction === "down" ? "down" : "right"} through ${selection}`,
      operations,
    ), before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
  }, [activeSheet.cells, activeSheet.id, recordTransaction, selection, selectionBounds, workbook]);

  const clearSelection = useCallback(() => {
    const bounds = selectionBounds;
    if (!bounds) return;
    const addresses = new Set(secondarySelections);
    for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
      for (let column = bounds.firstColumn; column <= bounds.lastColumn; column += 1) {
        addresses.add(`${columnIndexToLabel(column)}${row}`);
      }
    }
    const operations: SpreadsheetOperation[] = [...addresses]
      .filter((address) => {
        const cell = activeSheet.cells[address];
        return Boolean(cell?.formula || cell?.value !== null && cell?.value !== undefined && cell?.value !== "");
      })
      .map((address) => ({
        type: "set-cell-value" as const,
        sheetId: activeSheet.id,
        address,
        value: "",
      }));
    if (operations.length === 0) return;
    const before = workbook;
    const after = applySpreadsheetOperations(before, operations);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(createTransaction(`Cleared ${operations.length} cells`, operations), before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
  }, [activeSheet.cells, activeSheet.id, recordTransaction, secondarySelections, selectionBounds, workbook]);

  const copySelection = useCallback(() => {
    const bounds = selectionBounds;
    if (!bounds) return "";
    return Array.from({ length: bounds.lastRow - bounds.firstRow + 1 }, (_, rowOffset) => (
      Array.from({ length: bounds.lastColumn - bounds.firstColumn + 1 }, (_, columnOffset) => {
        const address = `${columnIndexToLabel(bounds.firstColumn + columnOffset)}${bounds.firstRow + rowOffset}`;
        const cell = activeSheet.cells[address];
        return cell?.formula ? `=${cell.formula}` : String(cell?.value ?? "");
      }).join("\t")
    )).join("\n");
  }, [activeSheet.cells, selectionBounds]);

  const pasteCells = useCallback((text: string) => {
    const start = parseAddress(activeCell);
    if (!start) return;
    const rows = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    const operations: SpreadsheetOperation[] = [];
    let lastColumn = start.column;
    let lastRow = start.row;
    rows.forEach((line, rowOffset) => line.split("\t").forEach((rawValue, columnOffset) => {
      const column = start.column + columnOffset;
      const row = start.row + rowOffset;
      if (column > activeSheet.columnCount || row > activeSheet.rowCount) return;
      const address = `${columnIndexToLabel(column)}${row}`;
      lastColumn = Math.max(lastColumn, column);
      lastRow = Math.max(lastRow, row);
      const value = rawValue.trim();
      operations.push(value.startsWith("=")
        ? { type: "set-formula", sheetId: activeSheet.id, address, formula: value.slice(1) }
        : { type: "set-cell-value", sheetId: activeSheet.id, address, value: /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value });
    }));
    if (operations.length === 0) return;
    const before = workbook;
    const after = applySpreadsheetOperations(before, operations);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(createTransaction(`Pasted ${operations.length} cells`, operations), before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
    setSelection(`${activeCell}:${columnIndexToLabel(lastColumn)}${lastRow}`);
  }, [activeCell, activeSheet.columnCount, activeSheet.id, activeSheet.rowCount, recordTransaction, workbook]);

  const applyProposal = useCallback((proposal: AgentProposal, actor: Actor) => {
    const before = workbook;
    const after = applySpreadsheetOperations(before, proposal.operations);
    const transaction = createTransaction(
      proposal.title,
      proposal.operations,
      actor,
    );
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(transaction, before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
    setActiveCell(proposal.focusCell);
    setSelection(proposal.selection);
    return transaction.id;
  }, [recordTransaction, workbook]);

  const applyAgentProposal = useCallback((proposal: AgentProposal, agent = "Codex") => (
    applyProposal(proposal, { type: "agent", agent })
  ), [applyProposal]);

  const applyCliProposal = useCallback((proposal: AgentProposal, process = "sheetctl") => (
    applyProposal(proposal, { type: "cli", process })
  ), [applyProposal]);

  const addSheet = useCallback(() => {
    const nextNumber = workbook.sheets.reduce((maximum, sheet) => {
      const match = sheet.id.match(/^sheet-(\d+)$/);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    const sheetId = `sheet-${nextNumber}`;
    const name = `Sheet${nextNumber}`;
    const operation = { type: "add-sheet" as const, sheetId, name };
    const before = workbook;
    const after = applySpreadsheetOperations(before, [operation]);
    const transaction = createTransaction(`Created sheet ${name}`, [operation]);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(transaction, before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
    setActiveCell("A1");
    setSelection("A1");
    setActiveResource("sales");
  }, [recordTransaction, workbook]);

  const activateSheet = useCallback((sheetId: string) => {
    const after = applySpreadsheetOperations(workbook, [{ type: "activate-sheet", sheetId }]);
    setWorkbook(after);
    setActiveCell("A1");
    setSelection("A1");
    setActiveResource("sales");
    setOpenResources((resources) => resources.includes("sales") ? resources : [...resources, "sales"]);
  }, [workbook]);

  const openResource = useCallback((resource: string) => {
    setOpenResources((resources) => resources.includes(resource) ? resources : [...resources, resource]);
    setActiveResource(resource);
    if (documents.some((document) => document.id === resource)) {
      setDocumentUndoStack([]);
      setDocumentRedoStack([]);
    }
  }, [documents]);

  const addDocument = useCallback((name = "untitled") => {
    const existing = new Set(documents.map((document) => document.name));
    let candidate = name.trim() || "untitled";
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${name || "untitled"} ${suffix++}`;
    const document = { id: `document-${Date.now()}`, name: candidate, source: `# ${candidate}\n\n` };
    documentSourceBaselineRef.current[document.id] = document.source;
    setDocuments((items) => [...items, document]);
    setOpenResources((resources) => [...resources, document.id]);
    setActiveResource(document.id);
    setDocumentUndoStack([]);
    setDocumentRedoStack([]);
  }, [documents]);

  const importDocument = useCallback((name: string, source: string) => {
    const existing = new Set(documents.map((document) => document.name));
    const base = name.trim() || "imported document";
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${base} ${suffix++}`;
    const document = { id: `document-${Date.now()}`, name: candidate, source };
    documentSourceBaselineRef.current[document.id] = document.source;
    setDocuments((items) => [...items, document]);
    setOpenResources((resources) => [...resources, document.id]);
    setActiveResource(document.id);
    setDocumentUndoStack([]);
    setDocumentRedoStack([]);
  }, [documents]);

  const editDocumentSource = useCallback((nextSource: string) => {
    const current = documentSourceRef.current;
    if (current === nextSource) return;
    documentSourceRef.current = nextSource;
    setDocumentUndoStack((entries) => [...entries, current]);
    setDocumentRedoStack([]);
    setDocuments((items) => items.map((document) => document.id === activeDocument.id
      ? { ...document, source: nextSource }
      : document));
  }, [activeDocument.id]);

  const undoDocument = useCallback(() => {
    const previous = documentUndoStack.at(-1);
    if (previous === undefined) return;
    setDocumentUndoStack((entries) => entries.slice(0, -1));
    setDocumentRedoStack((entries) => [...entries, documentSource]);
    documentSourceRef.current = previous;
    setDocuments((items) => items.map((document) => document.id === activeDocument.id
      ? { ...document, source: previous }
      : document));
  }, [activeDocument.id, documentSource, documentUndoStack]);

  const redoDocument = useCallback(() => {
    const next = documentRedoStack.at(-1);
    if (next === undefined) return;
    setDocumentRedoStack((entries) => entries.slice(0, -1));
    setDocumentUndoStack((entries) => [...entries, documentSource]);
    documentSourceRef.current = next;
    setDocuments((items) => items.map((document) => document.id === activeDocument.id
      ? { ...document, source: next }
      : document));
  }, [activeDocument.id, documentRedoStack, documentSource]);

  const closeResource = useCallback((resource: string) => {
    const remaining = openResources.filter((entry) => entry !== resource);
    setOpenResources(remaining);
    if (activeResource === resource) setActiveResource(remaining[0] ?? "none");
  }, [activeResource, openResources]);

  const renameSheet = useCallback((sheetId: string, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const operation = { type: "rename-sheet" as const, sheetId, name: cleanName };
    const before = workbook;
    const after = applySpreadsheetOperations(before, [operation]);
    const transaction = createTransaction(`Renamed sheet to ${cleanName}`, [operation]);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(transaction, before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
  }, [recordTransaction, workbook]);

  const deleteSheet = useCallback((sheetId: string) => {
    if (workbook.sheets.length === 1) return;
    const deletedName = workbook.sheets.find((sheet) => sheet.id === sheetId)?.name ?? sheetId;
    const operation = { type: "delete-sheet" as const, sheetId };
    const before = workbook;
    const after = applySpreadsheetOperations(before, [operation]);
    const transaction = createTransaction(`Deleted sheet ${deletedName}`, [operation]);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(after);
    setSource(serializeSpreadsheetSource(after));
    recordTransaction(transaction, before, after);
    setDiagnostics(getWorkbookDiagnostics(after));
    setActiveCell("A1");
    setSelection("A1");
  }, [recordTransaction, workbook]);

  const resetWorkspace = useCallback(() => {
    if (typeof window !== "undefined") clearWorkspaceSnapshot(window.localStorage);
    sourceUpdateOrigin.current = "visual";
    setWorkbook(initialWorkbook);
    setSource(SAMPLE_SHEET_SOURCE);
    sourceBaselineRef.current = SAMPLE_SHEET_SOURCE;
    documentSourceRef.current = SAMPLE_DOCUMENT_SOURCE;
    setDocuments(INITIAL_DOCUMENTS);
    documentSourceBaselineRef.current = Object.fromEntries(INITIAL_DOCUMENTS.map((document) => [document.id, document.source]));
    setDocumentUndoStack([]);
    setDocumentRedoStack([]);
    setDiagnostics([]);
    setHistory([]);
    setUndoStack([]);
    setRedoStack([]);
    setActiveCell("C17");
    setSelection("A2:F15");
    setAutosaveState("saving");
    setLastSavedAt(null);
    setActiveResource("sales");
    setOpenResources(["sales", "report"]);
  }, []);

  const importWorkbook = useCallback((nextWorkbook: SpreadsheetWorkbook, report?: { path: string }) => {
    if (nextWorkbook.sheets.length === 0) return;
    const before = workbook;
    const nextSource = serializeSpreadsheetSource(nextWorkbook);
    const transaction = createTransaction(
      `Imported XLSX${report ? `: ${report.path.split(/[/\\]/).at(-1)}` : ""}`,
      [],
      { type: "importer" },
    );
    sourceUpdateOrigin.current = "visual";
    setWorkbook(nextWorkbook);
    setSource(nextSource);
    sourceBaselineRef.current = nextSource;
    recordTransaction(transaction, before, nextWorkbook);
    setDiagnostics(getWorkbookDiagnostics(nextWorkbook));
    setActiveCell("A1");
    setSelection("A1");
    setActiveResource("sales");
  }, [recordTransaction, workbook]);

  const loadNativeWorkspace = useCallback((title: string, nextSource: string, nextDocuments: StoredDocument[]) => {
    const result = parseSpreadsheetSource(nextSource);
    if (!result.workbook || result.diagnostics.length) throw new Error("Workspace spreadsheet source is invalid.");
    sourceUpdateOrigin.current = "visual";
    setWorkspaceTitle(title);
    setWorkbook(result.workbook);
    setSource(nextSource);
    sourceBaselineRef.current = nextSource;
    const loadedDocuments = nextDocuments.length ? nextDocuments : INITIAL_DOCUMENTS;
    setDocuments(loadedDocuments);
    documentSourceBaselineRef.current = Object.fromEntries(loadedDocuments.map((document) => [document.id, document.source]));
    setActiveResource("sales");
    setOpenResources(["sales", ...(nextDocuments[0] ? [nextDocuments[0].id] : ["report"])]);
    setDocumentUndoStack([]);
    setDocumentRedoStack([]);
  }, []);

  useEffect(() => {
    if (sourceUpdateOrigin.current !== "source") return;
    const timer = window.setTimeout(() => {
      const result = parseSpreadsheetSource(source);
      setDiagnostics(result.diagnostics);
      if (!result.workbook) return;

      setWorkbook((before) => {
        if (result.workbook!.sheets.some((sheet) => sheet.id === before.activeSheetId)) {
          result.workbook!.activeSheetId = before.activeSheetId;
        }
        const transaction = createTransaction("Updated KDL source", [], { type: "user" });
        recordTransaction(transaction, before, result.workbook!);
        return result.workbook!;
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [recordTransaction, source]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        const savedAt = saveWorkspaceSnapshot(window.localStorage, workbook, documents);
        setLastSavedAt(savedAt);
        setAutosaveState("saved");
      } catch {
        setAutosaveState("error");
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [documents, workbook]);

  const undo = useCallback(() => {
    const latest = undoStack.at(-1);
    if (!latest) return;
    sourceUpdateOrigin.current = "visual";
    setWorkbook(latest.before);
    const nextSource = serializeSpreadsheetSource(latest.before);
    setSource(nextSource);
    setDiagnostics(parseSpreadsheetSource(nextSource).diagnostics);
    setRedoStack((entries) => [...entries, latest]);
    setUndoStack(undoStack.slice(0, -1));
    setHistory((entries) => setHistoryEntryState(
      entries,
      latest.transaction.id,
      "reverted",
    ));
  }, [undoStack]);

  const redo = useCallback(() => {
    const latest = redoStack.at(-1);
    if (!latest) return;
    sourceUpdateOrigin.current = "visual";
    setWorkbook(latest.after);
    const nextSource = serializeSpreadsheetSource(latest.after);
    setSource(nextSource);
    setDiagnostics(parseSpreadsheetSource(nextSource).diagnostics);
    setUndoStack((entries) => [...entries, latest]);
    setRedoStack(redoStack.slice(0, -1));
    setHistory((entries) => setHistoryEntryState(
      entries,
      latest.transaction.id,
      "applied",
    ));
  }, [redoStack]);

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
        if (documents.some((document) => document.id === activeResource)) {
          if (event.shiftKey) redoDocument();
          else undoDocument();
        } else if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeResource, documents, redo, redoDocument, undo, undoDocument]);

  return {
    workbook,
    activeSheet,
    source,
    sourceBaseline: sourceBaselineRef.current,
    documentSource,
    documentSourceBaseline: documentSourceBaselineRef.current[activeDocument.id] ?? documentSource,
    documentSelection,
    documents,
    activeDocument,
    canUndoDocument: documentUndoStack.length > 0,
    canRedoDocument: documentRedoStack.length > 0,
    diagnostics,
    history,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    nextUndoTransactionId: undoStack.at(-1)?.transaction.id ?? null,
    nextRedoTransactionId: redoStack.at(-1)?.transaction.id ?? null,
    activeCell,
    selection,
    secondarySelections,
    selectionBounds,
    canFillFormula,
    activeView,
    workspaceTitle,
    agentOpen,
    explorerOpen,
    paletteOpen,
    activeResource,
    openResources,
    autosaveState,
    lastSavedAt,
    applyCellEdit,
    applyCellStyle,
    applyColumnWidth,
    applyRowHeight,
    applySheetStructure,
    applyFormulaFill,
    fillSelection,
    clearSelection,
    copySelection,
    pasteCells,
    applyAgentProposal,
    applyCliProposal,
    addSheet,
    addDocument,
    importDocument,
    activateSheet,
    renameSheet,
    deleteSheet,
    resetWorkspace,
    importWorkbook,
    loadNativeWorkspace,
    editSource,
    editDocumentSource,
    undoDocument,
    redoDocument,
    undo,
    redo,
    setActiveCell,
    setSelection,
    setDocumentSelection,
    selectCell,
    toggleSecondarySelection,
    setActiveView,
    setAgentOpen,
    setExplorerOpen,
    setPaletteOpen,
    setActiveResource,
    openResource,
    closeResource,
  };
}

export type OfficeWorkspace = ReturnType<typeof useOfficeWorkspace>;
