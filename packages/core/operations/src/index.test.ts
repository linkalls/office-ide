import { describe, expect, test } from "bun:test";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
<<<<<<< ours
import {
  applySpreadsheetOperations,
  createTransaction,
  translateFormulaReferences,
} from "./index";

describe("spreadsheet operations", () => {
  test("creates unique transaction ids even if the runtime UUID source repeats", () => {
    const first = createTransaction("First", []);
    const second = createTransaction("Second", []);
    expect(first.id).not.toBe(second.id);
  });

=======
import { applySpreadsheetOperations } from "./index";

describe("spreadsheet operations", () => {
>>>>>>> theirs
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
<<<<<<< ours

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

  test("fills a range with relative formulas and preserves absolute references", () => {
    const workbook = createEmptyWorkbook();
    workbook.sheets[0]!.cells.D2 = {
      address: "D2",
      value: null,
      formula: "B2*C2+$A$1",
      style: { bold: true },
    };

    const changed = applySpreadsheetOperations(workbook, [{
      type: "fill-formula",
      sheetId: "sheet-1",
      range: "D2:D5",
      sourceAddress: "D2",
      formula: "B2*C2+$A$1",
    }]);

    expect(changed.sheets[0]?.cells.D2?.formula).toBe("B2*C2+$A$1");
    expect(changed.sheets[0]?.cells.D3?.formula).toBe("B3*C3+$A$1");
    expect(changed.sheets[0]?.cells.D5?.formula).toBe("B5*C5+$A$1");
    expect(changed.sheets[0]?.cells.D2?.style).toEqual({ bold: true });
    expect(workbook.sheets[0]?.cells.D3).toBeUndefined();
  });

  test("translates mixed references in two dimensions", () => {
    expect(translateFormulaReferences("A1+$B1+C$1+$D$1", 2, 3))
      .toBe("C4+$B4+E$1+$D$1");
    expect(translateFormulaReferences("A1", -1, 0)).toBe("#REF!");
    expect(translateFormulaReferences('"A1"&A1', 1, 1)).toBe('"A1"&B2');
  });

  test("applies multi-row and multi-column structural operations", () => {
    const workbook = createEmptyWorkbook();
    workbook.sheets[0]!.cells.C4 = { address: "C4", value: "moved" };

    const changed = applySpreadsheetOperations(workbook, [
      { type: "insert-rows", sheetId: "sheet-1", at: 2, count: 2 },
      { type: "insert-columns", sheetId: "sheet-1", at: 2, count: 3 },
    ]);

    expect(changed.sheets[0]?.cells.F6?.value).toBe("moved");
  });

  test("creates, activates, renames, and deletes sheets immutably", () => {
    const workbook = createEmptyWorkbook("Book", "売上");
    const created = applySpreadsheetOperations(workbook, [{
      type: "add-sheet",
      sheetId: "sheet-summary",
      name: "集計",
    }]);
    expect(created.sheets.map((sheet) => sheet.name)).toEqual(["売上", "集計"]);
    expect(created.activeSheetId).toBe("sheet-summary");

    const renamed = applySpreadsheetOperations(created, [{
      type: "rename-sheet",
      sheetId: "sheet-summary",
      name: "月次集計",
    }]);
    expect(renamed.sheets[1]?.name).toBe("月次集計");

    const activated = applySpreadsheetOperations(renamed, [{
      type: "activate-sheet",
      sheetId: "sheet-1",
    }]);
    expect(activated.activeSheetId).toBe("sheet-1");

    const deleted = applySpreadsheetOperations(activated, [{
      type: "delete-sheet",
      sheetId: "sheet-summary",
    }]);
    expect(deleted.sheets).toHaveLength(1);
    expect(workbook.sheets).toHaveLength(1);
  });

  test("protects workbook sheet invariants", () => {
    const workbook = createEmptyWorkbook();
    expect(() => applySpreadsheetOperations(workbook, [{
      type: "delete-sheet",
      sheetId: "sheet-1",
    }])).toThrow("at least one sheet");
    expect(() => applySpreadsheetOperations(workbook, [{
      type: "rename-sheet",
      sheetId: "sheet-1",
      name: "   ",
    }])).toThrow("cannot be empty");
  });
});

describe("document operations", () => {
  test("inserts, updates, replaces text, and deletes blocks immutably", async () => {
    const { createEmptyDocument } = await import("../../document-ir/src/index");
    const { applyDocumentOperations, createDocumentTransaction } = await import("./index");

    const doc = createEmptyDocument("doc-1", "Test Doc");
    expect(doc.blocks.length).toBe(2);

    const inserted = applyDocumentOperations(doc, [
      {
        type: "insert-block",
        block: {
          id: "para-2",
          type: "paragraph",
          text: "Second paragraph",
        },
      },
    ]);
    expect(inserted.blocks.length).toBe(3);
    expect(inserted.blocks[2]?.id).toBe("para-2");

    const updated = applyDocumentOperations(inserted, [
      {
        type: "replace-text",
        blockId: "para-2",
        text: "Updated text",
      },
    ]);
    const block = updated.blocks.find((b) => b.id === "para-2");
    expect(block && "text" in block ? block.text : "").toBe("Updated text");

    const deleted = applyDocumentOperations(updated, [
      {
        type: "delete-block",
        blockId: "para-2",
      },
    ]);
    expect(deleted.blocks.length).toBe(2);

    const tx = createDocumentTransaction("Edited document", [
      { type: "replace-text", blockId: doc.blocks[0].id, text: "New Title" },
    ]);
    expect(tx.id).toBeDefined();
    expect(tx.operations.length).toBe(1);
  });
});

=======
});
>>>>>>> theirs
