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

  test("inserts rows and shifts cells, formulas, and row heights", () => {
    const workbook = createEmptyWorkbook();
    const sheet = workbook.sheets[0]!;
    sheet.cells.A2 = { address: "A2", value: 10 };
    sheet.cells.B2 = { address: "B2", value: null, formula: "A2*$A$2" };
    sheet.rowHeights[2] = 32;

    const changed = applySpreadsheetOperations(workbook, [
      { type: "insert-rows", sheetId: "sheet-1", at: 2, count: 1 },
    ]);

    expect(changed.sheets[0]?.cells.A3?.value).toBe(10);
    expect(changed.sheets[0]?.cells.B3?.formula).toBe("A3*$A$3");
    expect(changed.sheets[0]?.rowHeights[3]).toBe(32);
    expect(changed.sheets[0]?.rowCount).toBe(100);
    expect(workbook.sheets[0]?.cells.A2?.value).toBe(10);
  });

  test("deletes rows and marks direct references to deleted cells", () => {
    const workbook = createEmptyWorkbook();
    const sheet = workbook.sheets[0]!;
    sheet.cells.A2 = { address: "A2", value: 10 };
    sheet.cells.A3 = { address: "A3", value: 20 };
    sheet.cells.B1 = { address: "B1", value: null, formula: "A2+A3" };

    const changed = applySpreadsheetOperations(workbook, [
      { type: "delete-rows", sheetId: "sheet-1", at: 2, count: 1 },
    ]);

    expect(changed.sheets[0]?.cells.A2?.value).toBe(20);
    expect(changed.sheets[0]?.cells.B1?.formula).toBe("#REF!+A2");
    expect(changed.sheets[0]?.rowCount).toBe(100);
  });

  test("inserts and deletes columns with base-26 A1 addresses", () => {
    const workbook = createEmptyWorkbook();
    const sheet = workbook.sheets[0]!;
    sheet.columnCount = 30;
    sheet.cells.Z1 = { address: "Z1", value: 26 };
    sheet.cells.AA1 = { address: "AA1", value: null, formula: "Z1+AA1" };
    sheet.columnWidths.Z = 18;

    const inserted = applySpreadsheetOperations(workbook, [
      { type: "insert-columns", sheetId: "sheet-1", at: 26, count: 1 },
    ]);
    expect(inserted.sheets[0]?.cells.AA1?.value).toBe(26);
    expect(inserted.sheets[0]?.cells.AB1?.formula).toBe("AA1+AB1");
    expect(inserted.sheets[0]?.columnWidths.AA).toBe(18);

    const restored = applySpreadsheetOperations(inserted, [
      { type: "delete-columns", sheetId: "sheet-1", at: 26, count: 1 },
    ]);
    expect(restored.sheets[0]?.cells.Z1?.value).toBe(26);
    expect(restored.sheets[0]?.cells.AA1?.formula).toBe("Z1+AA1");
  });

  test("rejects invalid structural positions", () => {
    const workbook = createEmptyWorkbook();
    expect(() => applySpreadsheetOperations(workbook, [
      { type: "insert-rows", sheetId: "sheet-1", at: 0, count: 1 },
    ])).toThrow(RangeError);
    expect(() => applySpreadsheetOperations(workbook, [
      { type: "delete-columns", sheetId: "sheet-1", at: 27, count: 1 },
    ])).toThrow(RangeError);
  });
});
