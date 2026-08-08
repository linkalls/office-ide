import { describe, expect, test } from "bun:test";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
import { applySpreadsheetOperations } from "./index";

describe("spreadsheet operations", () => {
  test("applies formatting without replacing cell content", () => {
    const workbook = createEmptyWorkbook();
    workbook.sheets[0]!.cells.A1 = { address: "A1", value: "Heading" };

    const formatted = applySpreadsheetOperations(workbook, [{
      type: "set-cell-style",
      sheetId: "sheet-1",
      address: "A1",
      style: { bold: true, background: "#254f7d" },
    }]);

    expect(formatted.sheets[0]?.cells.A1).toEqual({
      address: "A1",
      value: "Heading",
      formula: undefined,
      style: { bold: true, background: "#254f7d" },
    });
    expect(workbook.sheets[0]?.cells.A1?.style).toBeUndefined();
  });

  test("preserves formatting when changing a value", () => {
    const workbook = createEmptyWorkbook();
    workbook.sheets[0]!.cells.B2 = {
      address: "B2",
      value: 1,
      style: { italic: true },
    };

    const changed = applySpreadsheetOperations(workbook, [{
      type: "set-cell-value",
      sheetId: "sheet-1",
      address: "B2",
      value: 2,
    }]);

    expect(changed.sheets[0]?.cells.B2?.value).toBe(2);
    expect(changed.sheets[0]?.cells.B2?.style).toEqual({ italic: true });
  });

  test("applies row and column dimensions immutably", () => {
    const workbook = createEmptyWorkbook();
    const resized = applySpreadsheetOperations(workbook, [
      { type: "set-column-width", sheetId: "sheet-1", column: "b", width: 20 },
      { type: "set-row-height", sheetId: "sheet-1", row: 2, height: 32 },
    ]);

    expect(resized.sheets[0]?.columnWidths.B).toBe(20);
    expect(resized.sheets[0]?.rowHeights[2]).toBe(32);
    expect(workbook.sheets[0]?.columnWidths).toEqual({});
    expect(workbook.sheets[0]?.rowHeights).toEqual({});
  });
});
