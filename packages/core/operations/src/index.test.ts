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
});
