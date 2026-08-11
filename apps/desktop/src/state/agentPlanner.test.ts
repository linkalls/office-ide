import { describe, expect, test } from "bun:test";
import { applySpreadsheetOperations } from "@office-ide/operations";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
import {
  planAgentRequest,
  planSheetctlCommand,
  readSheetctlCommand,
} from "./agentPlanner";

function createSalesWorkbook() {
  const workbook = createEmptyWorkbook("Sales", "売上");
  const sheet = workbook.sheets[0]!;
  sheet.cells.C2 = { address: "C2", value: 1000 };
  sheet.cells.D2 = { address: "D2", value: 4 };
  sheet.cells.C3 = { address: "C3", value: 900 };
  sheet.cells.D3 = { address: "D3", value: 3 };
  sheet.cells.F2 = { address: "F2", value: "東京" };
  sheet.cells.F3 = { address: "F3", value: "大阪" };
  return workbook;
}

describe("local agent planner", () => {
  test("plans an average unit price column as one operation proposal", () => {
    const workbook = createSalesWorkbook();
    const result = planAgentRequest("Add an average unit price formula to column G", workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.selection).toBe("G1:G3");
    expect(result.proposal.operations).toHaveLength(4);

    const changed = applySpreadsheetOperations(workbook, result.proposal.operations);
    expect(changed.sheets[0]?.cells.G1?.value).toBe("平均単価（円）");
    expect(changed.sheets[0]?.cells.G2?.formula).toBe("ROUND(C2/D2,0)");
    expect(changed.sheets[0]?.cells.G3?.formula).toBe("ROUND(C3/D3,0)");
  });

  test("plans a tax-included column from Japanese", () => {
    const result = planAgentRequest("G列に税込売上を追加して", createSalesWorkbook());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.operations[2]).toMatchObject({
      type: "set-formula",
      formula: "ROUND(C2*1.1,0)",
    });
  });

  test("inspects workbook values and highlights only rows above a Japanese threshold", () => {
    const workbook = createSalesWorkbook();
    const result = planAgentRequest("売上0.095万円以上を強調して", workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.focusCell).toBe("C2");
    expect(result.proposal.operations).toHaveLength(6);

    const changed = applySpreadsheetOperations(workbook, result.proposal.operations);
    expect(changed.sheets[0]?.cells.A2?.style?.background).toBe("#6b4508");
    expect(changed.sheets[0]?.cells.C2?.style?.bold).toBe(true);
    expect(changed.sheets[0]?.cells.C3?.style).toBeUndefined();
  });

  test("refuses highlight requests with no matching rows", () => {
    const result = planAgentRequest("Highlight sales above 500000", createSalesWorkbook());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("見つからなかった");
  });

  test("groups workbook rows into a new regional summary sheet", () => {
    const workbook = createSalesWorkbook();
    const result = planAgentRequest("地域別の売上集計シートを作って", workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.affectedRange).toBe("地域別集計!A1:C4");
    expect(result.proposal.operations).toHaveLength(22);

    const changed = applySpreadsheetOperations(workbook, result.proposal.operations);
    expect(changed.sheets).toHaveLength(2);
    expect(changed.sheets[1]?.name).toBe("地域別集計");
    expect(changed.sheets[1]?.cells.A2?.value).toBe("東京");
    expect(changed.sheets[1]?.cells.B2?.value).toBe(1000);
    expect(changed.sheets[1]?.cells.A4?.value).toBe("合計");
    expect(changed.sheets[1]?.cells.B4?.value).toBe(1900);
  });

  test("creates a collision-free summary sheet name and id", () => {
    const workbook = createSalesWorkbook();
    workbook.sheets.push({
      ...structuredClone(workbook.sheets[0]!),
      id: "sheet-region-summary",
      name: "地域別集計",
      cells: {},
    });
    const result = planAgentRequest("Create a regional sales summary", workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.affectedRange).toBe("地域別集計2!A1:C4");
    expect(result.proposal.operations[0]).toMatchObject({
      type: "add-sheet",
      sheetId: "sheet-region-summary-2",
      name: "地域別集計2",
    });
  });

  test("refuses unsupported requests without producing operations", () => {
    const result = planAgentRequest("Make it beautiful somehow", createSalesWorkbook());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("変更は行っていない");
    expect(result.suggestions).toHaveLength(4);
  });

  test("holds sheetctl cell writes as a proposal instead of mutating the workbook", () => {
    const workbook = createSalesWorkbook();
    const result = planSheetctlCommand('sheetctl cell set B2 "North region"', workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(workbook.sheets[0]?.cells.B2).toBeUndefined();
    expect(result.proposal.operations).toEqual([{
      type: "set-cell-value",
      sheetId: workbook.sheets[0]?.id,
      address: "B2",
      value: "North region",
    }]);
    expect(applySpreadsheetOperations(workbook, result.proposal.operations).sheets[0]?.cells.B2?.value)
      .toBe("North region");
  });

  test("accepts a formula only through the sheetctl proposal boundary", () => {
    const result = planAgentRequest("sheetctl formula set G2 =ROUND(C2/D2,0)", createSalesWorkbook());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.operations[0]).toMatchObject({
      type: "set-formula",
      address: "G2",
      formula: "ROUND(C2/D2,0)",
    });
  });

  test("groups a calculated column into one reviewable proposal", () => {
    const result = planSheetctlCommand(
      'sheetctl formula column G "Average unit price" =ROUND(C2/D2,0)',
      createSalesWorkbook(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.affectedRange).toBe("G1:G3");
    expect(result.proposal.operations).toHaveLength(4);
    expect(result.proposal.operationPreview).toHaveLength(4);
  });

  test("rejects invalid sheetctl formulas before creating a proposal", () => {
    const result = planSheetctlCommand("sheetctl formula set G2 =SUM(", createSalesWorkbook());
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("Formula is invalid:"),
      suggestions: ["sheetctl formula set G2 =ROUND(C2/D2,0)"],
    });
  });

  test("serves active-sheet context without creating a proposal", () => {
    const workbook = createSalesWorkbook();
    const sheet = workbook.sheets[0]!;
    const result = readSheetctlCommand("sheetctl context", workbook);
    expect(result).toEqual({
      ok: true,
      message: JSON.stringify({
        workbook: { id: "workbook-1", name: "Sales" },
        activeSheet: {
          id: "sheet-1",
          name: sheet.name,
          rowCount: 100,
          columnCount: 26,
          frozenRows: 0,
          frozenColumns: 0,
        },
      }),
    });
  });

  test("returns a bounded read-only range in row-major order", () => {
    const workbook = createSalesWorkbook();
    const sheet = workbook.sheets[0]!;
    const result = readSheetctlCommand("sheetctl range C2:F3", workbook);
    expect(result).toEqual({
      ok: true,
      message: JSON.stringify({
        sheet: { id: "sheet-1", name: sheet.name },
        range: "C2:F3",
        cells: [
          { address: "C2", value: 1000 },
          { address: "D2", value: 4 },
          { address: "F2", value: sheet.cells.F2?.value },
          { address: "C3", value: 900 },
          { address: "D3", value: 3 },
          { address: "F3", value: sheet.cells.F3?.value },
        ],
      }),
    });
  });

  test("rejects oversized or invalid sheetctl ranges before they can mutate", () => {
    expect(readSheetctlCommand("sheetctl range A1:ZZ100", createSalesWorkbook())).toEqual({
      ok: false,
      message: "Range is outside the active sheet",
    });
    expect(readSheetctlCommand("sheetctl range A1:K100", createSalesWorkbook())).toEqual({
      ok: false,
      message: "Range is limited to 1,000 cells",
    });
  });
});
