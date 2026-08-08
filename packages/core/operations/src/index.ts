import type {
  CellScalar,
  SpreadsheetWorkbook,
} from "@office-ide/spreadsheet-ir";
import {
  cloneWorkbook,
  getActiveSheet,
} from "@office-ide/spreadsheet-ir";

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
    const sheet =
      workbook.sheets.find((candidate) => candidate.id === operation.sheetId) ??
      getActiveSheet(workbook);

    if (operation.type === "rename-sheet") {
      sheet.name = operation.name;
      continue;
    }

    const previous = sheet.cells[operation.address];
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
    id: crypto.randomUUID(),
    actor,
    timestamp: Date.now(),
    label,
    operations,
  };
}
