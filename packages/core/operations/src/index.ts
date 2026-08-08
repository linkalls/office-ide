import type {
  CellScalar,
  CellStyle,
  SpreadsheetWorkbook,
} from "@office-ide/spreadsheet-ir";
import {
  cloneWorkbook,
  getActiveSheet,
} from "@office-ide/spreadsheet-ir";

interface CellPosition {
  column: number;
  row: number;
}

type StructureAxis = "row" | "column";
type StructureMode = "insert" | "delete";

const CELL_REFERENCE_PATTERN = /(\$?)([A-Z]+)(\$?)([1-9]\d*)/gi;
const FORMULA_STRING_PATTERN = /("(?:[^"]|"")*")/g;
let transactionSequence = 0;

function rewriteFormulaReferences(
  formula: string,
  rewrite: (
    match: string,
    columnMarker: string,
    columnLabel: string,
    rowMarker: string,
    rowText: string,
  ) => string,
): string {
  return formula
    .split(FORMULA_STRING_PATTERN)
    .map((segment, index) => index % 2 === 1
      ? segment
      : segment.replace(CELL_REFERENCE_PATTERN, rewrite))
    .join("");
}

function columnLabelToIndex(label: string): number {
  let result = 0;
  for (const character of label.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function columnIndexToLabel(index: number): string {
  let current = index;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function parseCellAddress(address: string): CellPosition | null {
  const match = address.toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  return {
    column: columnLabelToIndex(match[1]),
    row: Number(match[2]),
  };
}

function formatCellAddress(position: CellPosition): string {
  return `${columnIndexToLabel(position.column)}${position.row}`;
}

function parseCellRange(range: string): { start: CellPosition; end: CellPosition } | null {
  const [startAddress, endAddress = startAddress] = range.split(":");
  const start = parseCellAddress(startAddress);
  const end = parseCellAddress(endAddress);
  return start && end ? { start, end } : null;
}

function validateStructureRange(at: number, count: number): void {
  if (!Number.isInteger(at) || at < 1 || !Number.isInteger(count) || count < 1) {
    throw new RangeError("Row and column operations require positive integer positions and counts");
  }
}

function transformCoordinate(
  value: number,
  at: number,
  count: number,
  mode: StructureMode,
): number | null {
  if (mode === "insert") return value >= at ? value + count : value;
  if (value >= at && value < at + count) return null;
  return value >= at + count ? value - count : value;
}

function transformFormulaReferences(
  formula: string,
  axis: StructureAxis,
  at: number,
  count: number,
  mode: StructureMode,
): string {
  return rewriteFormulaReferences(
    formula,
    (_match, columnMarker: string, columnLabel: string, rowMarker: string, rowText: string) => {
      const position = {
        column: columnLabelToIndex(columnLabel),
        row: Number(rowText),
      };
      const current = axis === "row" ? position.row : position.column;
      const transformed = transformCoordinate(current, at, count, mode);
      if (transformed === null) return "#REF!";
      if (axis === "row") position.row = transformed;
      else position.column = transformed;
      return `${columnMarker}${columnIndexToLabel(position.column)}${rowMarker}${position.row}`;
    },
  );
}

/**
 * Excelのcopy/fillと同じように相対参照だけを移動する。
 * `$A$1`は固定、`A$1`は列だけ、`$A1`は行だけを移動する。
 */
export function translateFormulaReferences(
  formula: string,
  columnOffset: number,
  rowOffset: number,
): string {
  return rewriteFormulaReferences(
    formula,
    (_match, columnMarker: string, columnLabel: string, rowMarker: string, rowText: string) => {
      const column = columnLabelToIndex(columnLabel) + (columnMarker ? 0 : columnOffset);
      const row = Number(rowText) + (rowMarker ? 0 : rowOffset);
      if (column < 1 || row < 1) return "#REF!";
      return `${columnMarker}${columnIndexToLabel(column)}${rowMarker}${row}`;
    },
  );
}

function transformNumericDimensions(
  dimensions: Record<number, number>,
  at: number,
  count: number,
  mode: StructureMode,
  limit: number,
): Record<number, number> {
  const transformed: Record<number, number> = {};
  for (const [key, value] of Object.entries(dimensions)) {
    const next = transformCoordinate(Number(key), at, count, mode);
    if (next !== null && next <= limit) transformed[next] = value;
  }
  return transformed;
}

function transformColumnDimensions(
  dimensions: Record<string, number>,
  at: number,
  count: number,
  mode: StructureMode,
  limit: number,
): Record<string, number> {
  const transformed: Record<string, number> = {};
  for (const [key, value] of Object.entries(dimensions)) {
    const next = transformCoordinate(columnLabelToIndex(key), at, count, mode);
    if (next !== null && next <= limit) transformed[columnIndexToLabel(next)] = value;
  }
  return transformed;
}

export type Actor =
  | { type: "user" }
  | { type: "agent"; agent: string }
  | { type: "cli"; process: string }
  | { type: "importer" };

export type SpreadsheetOperation =
  | {
      type: "set-cell-value";
      sheetId: string;
      address: string;
      value: CellScalar;
    }
  | {
      type: "set-formula";
      sheetId: string;
      address: string;
      formula: string;
    }
  | {
      type: "rename-sheet";
      sheetId: string;
      name: string;
    }
  | {
      type: "add-sheet";
      sheetId: string;
      name: string;
    }
  | {
      type: "delete-sheet";
      sheetId: string;
    }
  | {
      type: "activate-sheet";
      sheetId: string;
    }
  | {
      type: "set-cell-style";
      sheetId: string;
      address: string;
      style: CellStyle;
    }
  | {
      type: "set-column-width";
      sheetId: string;
      column: string;
      width: number;
    }
  | {
      type: "set-row-height";
      sheetId: string;
      row: number;
      height: number;
    }
  | {
      type: "insert-rows" | "delete-rows";
      sheetId: string;
      at: number;
      count: number;
    }
  | {
      type: "insert-columns" | "delete-columns";
      sheetId: string;
      at: number;
      count: number;
    }
  | {
      type: "fill-formula";
      sheetId: string;
      range: string;
      sourceAddress: string;
      formula: string;
    };

export interface Transaction {
  id: string;
  actor: Actor;
  timestamp: number;
  label: string;
  operations: SpreadsheetOperation[];
}

export function applySpreadsheetOperations(
  source: SpreadsheetWorkbook,
  operations: SpreadsheetOperation[],
): SpreadsheetWorkbook {
  const workbook = cloneWorkbook(source);

  for (const operation of operations) {
    if (operation.type === "add-sheet") {
      const name = operation.name.trim();
      if (!name) throw new RangeError("Sheet name cannot be empty");
      if (workbook.sheets.some((sheet) => sheet.id === operation.sheetId)) {
        throw new RangeError(`Sheet id already exists: ${operation.sheetId}`);
      }
      workbook.sheets.push({
        id: operation.sheetId,
        name,
        cells: {},
        columnWidths: {},
        rowHeights: {},
        rowCount: 100,
        columnCount: 26,
        frozenRows: 0,
        frozenColumns: 0,
      });
      workbook.activeSheetId = operation.sheetId;
      continue;
    }

    if (operation.type === "delete-sheet") {
      if (workbook.sheets.length === 1) throw new RangeError("A workbook must keep at least one sheet");
      const index = workbook.sheets.findIndex((sheet) => sheet.id === operation.sheetId);
      if (index < 0) throw new RangeError(`Unknown sheet: ${operation.sheetId}`);
      workbook.sheets.splice(index, 1);
      if (workbook.activeSheetId === operation.sheetId) {
        workbook.activeSheetId = workbook.sheets[Math.min(index, workbook.sheets.length - 1)].id;
      }
      continue;
    }

    if (operation.type === "activate-sheet") {
      if (!workbook.sheets.some((sheet) => sheet.id === operation.sheetId)) {
        throw new RangeError(`Unknown sheet: ${operation.sheetId}`);
      }
      workbook.activeSheetId = operation.sheetId;
      continue;
    }

    const sheet =
      workbook.sheets.find((candidate) => candidate.id === operation.sheetId) ??
      getActiveSheet(workbook);

    if (operation.type === "rename-sheet") {
      const name = operation.name.trim();
      if (!name) throw new RangeError("Sheet name cannot be empty");
      sheet.name = name;
      continue;
    }

    if (operation.type === "set-column-width") {
      sheet.columnWidths[operation.column.toUpperCase()] = operation.width;
      continue;
    }

    if (operation.type === "set-row-height") {
      sheet.rowHeights[operation.row] = operation.height;
      continue;
    }

    if (operation.type === "fill-formula") {
      const range = parseCellRange(operation.range);
      const sourcePosition = parseCellAddress(operation.sourceAddress);
      if (!range || !sourcePosition) throw new RangeError("Formula fill requires a valid A1 range");
      const firstColumn = Math.min(range.start.column, range.end.column);
      const lastColumn = Math.max(range.start.column, range.end.column);
      const firstRow = Math.min(range.start.row, range.end.row);
      const lastRow = Math.max(range.start.row, range.end.row);
      if (lastColumn > sheet.columnCount || lastRow > sheet.rowCount) {
        throw new RangeError("Formula fill range is outside the sheet");
      }
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const address = formatCellAddress({ column, row });
          const previous = sheet.cells[address];
          sheet.cells[address] = {
            address,
            value: null,
            formula: translateFormulaReferences(
              operation.formula,
              column - sourcePosition.column,
              row - sourcePosition.row,
            ),
            style: previous?.style,
          };
        }
      }
      continue;
    }

    if ("at" in operation) {
      validateStructureRange(operation.at, operation.count);
      const axis: StructureAxis = operation.type.endsWith("rows") ? "row" : "column";
      const mode: StructureMode = operation.type.startsWith("insert") ? "insert" : "delete";
      const limit = axis === "row" ? sheet.rowCount : sheet.columnCount;
      if (operation.at > limit) throw new RangeError(`Cannot ${mode} outside the sheet`);
      const count = mode === "delete"
        ? Math.min(operation.count, limit - operation.at + 1)
        : operation.count;
      const transformedCells: typeof sheet.cells = {};

      for (const cell of Object.values(sheet.cells)) {
        const position = parseCellAddress(cell.address);
        if (!position) continue;
        const current = axis === "row" ? position.row : position.column;
        const transformed = transformCoordinate(current, operation.at, count, mode);
        if (transformed === null || transformed > limit) continue;
        if (axis === "row") position.row = transformed;
        else position.column = transformed;
        const address = formatCellAddress(position);
        transformedCells[address] = {
          ...cell,
          address,
          formula: cell.formula
            ? transformFormulaReferences(cell.formula, axis, operation.at, count, mode)
            : undefined,
        };
      }

      sheet.cells = transformedCells;
      if (axis === "row") {
        sheet.rowHeights = transformNumericDimensions(
          sheet.rowHeights,
          operation.at,
          count,
          mode,
          limit,
        );
      } else {
        sheet.columnWidths = transformColumnDimensions(
          sheet.columnWidths,
          operation.at,
          count,
          mode,
          limit,
        );
      }
      continue;
    }

    const previous = sheet.cells[operation.address];
    if (operation.type === "set-cell-style") {
      sheet.cells[operation.address] = {
        address: operation.address,
        value: previous?.value ?? null,
        formula: previous?.formula,
        style: { ...previous?.style, ...operation.style },
      };
      continue;
    }

    if (operation.type === "set-cell-value") {
      sheet.cells[operation.address] = {
        address: operation.address,
        value: operation.value,
        style: previous?.style,
      };
      continue;
    }

    sheet.cells[operation.address] = {
      address: operation.address,
      value: null,
      formula: operation.formula,
      style: previous?.style,
    };
  }

  return workbook;
}

export function createTransaction(
  label: string,
  operations: SpreadsheetOperation[],
  actor: Actor = { type: "user" },
): Transaction {
  return {
    id: `${crypto.randomUUID()}-${++transactionSequence}`,
    actor,
    timestamp: Date.now(),
    label,
    operations,
  };
}
