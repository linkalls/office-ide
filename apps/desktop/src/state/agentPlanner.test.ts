import { describe, expect, test } from "bun:test";
import { applySpreadsheetOperations } from "@office-ide/operations";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
import { planAgentRequest } from "./agentPlanner";

function createSalesWorkbook() {
  const workbook = createEmptyWorkbook("Sales", "売上");
  const sheet = workbook.sheets[0]!;
  sheet.cells.C2 = { address: "C2", value: 1000 };
  sheet.cells.D2 = { address: "D2", value: 4 };
  sheet.cells.C3 = { address: "C3", value: 900 };
  sheet.cells.D3 = { address: "D3", value: 3 };
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

  test("refuses unsupported requests without producing operations", () => {
    const result = planAgentRequest("Make it beautiful somehow", createSalesWorkbook());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("変更は行っていない");
    expect(result.suggestions).toHaveLength(2);
  });
});
