import { describe, expect, test } from "bun:test";
import { createTransaction } from "@office-ide/operations";
import type { SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";
import {
  createHistoryEntry,
  getHistoryLifecycle,
  setHistoryEntryState,
} from "./workspaceHistory";

const workbook = (name: string): SpreadsheetWorkbook => ({
  id: `workbook-${name}`,
  name,
  activeSheetId: "sheet-1",
  version: 1,
  sheets: [{
    id: "sheet-1",
    name: "Sheet1",
    cells: {},
    columnWidths: {},
    rowHeights: {},
    rowCount: 100,
    columnCount: 26,
    frozenRows: 0,
    frozenColumns: 0,
  }],
});

describe("workspace history", () => {
  test("keeps an undone transaction as a reverted audit record", () => {
    const transaction = createTransaction("Agent change", [], { type: "agent", agent: "Codex" });
    const entry = createHistoryEntry(transaction, workbook("before"), workbook("after"));

    const reverted = setHistoryEntryState([entry], transaction.id, "reverted", 200);

    expect(reverted).toHaveLength(1);
    expect(reverted[0]?.transaction).toEqual(transaction);
    expect(reverted[0]?.state).toBe("reverted");
    expect(reverted[0]?.stateChangedAt).toBe(200);
    expect(reverted[0] && getHistoryLifecycle(reverted[0])).toBe("reverted");
  });

  test("redo reactivates the same transaction instead of duplicating it", () => {
    const transaction = createTransaction("Agent change", []);
    const entry = createHistoryEntry(transaction, workbook("before"), workbook("after"));
    const reverted = setHistoryEntryState([entry], transaction.id, "reverted", 200);
    const restored = setHistoryEntryState(reverted, transaction.id, "applied", 300);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.transaction.id).toBe(transaction.id);
    expect(restored[0]?.state).toBe("applied");
    expect(restored[0]?.stateChangedAt).toBe(300);
    expect(restored[0]?.stateRevision).toBe(2);
    expect(restored[0] && getHistoryLifecycle(restored[0])).toBe("re-applied");
  });
});
