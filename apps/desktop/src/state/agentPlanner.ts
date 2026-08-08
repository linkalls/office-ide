import type { SpreadsheetOperation } from "@office-ide/operations";
import { getActiveSheet, type SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";

export interface AgentProposal {
  id: string;
  title: string;
  explanation: string;
  affectedRange: string;
  focusCell: string;
  selection: string;
  operations: SpreadsheetOperation[];
  operationPreview: string[];
}

export type AgentPlanResult =
  | { ok: true; proposal: AgentProposal }
  | { ok: false; message: string; suggestions: string[] };

function findLastDataRow(workbook: SpreadsheetWorkbook): number {
  const sheet = getActiveSheet(workbook);
  let lastRow = 2;
  for (const cell of Object.values(sheet.cells)) {
    const match = cell.address.match(/^[CD]([1-9]\d*)$/);
    if (!match || typeof cell.value !== "number") continue;
    lastRow = Math.max(lastRow, Number(match[1]));
  }
  return lastRow;
}

function createFormulaColumnProposal(
  workbook: SpreadsheetWorkbook,
  input: { title: string; header: string; formula: string; explanation: string },
): AgentProposal {
  const sheet = getActiveSheet(workbook);
  const lastRow = findLastDataRow(workbook);
  const range = `G1:G${lastRow}`;
  const operations: SpreadsheetOperation[] = [
    { type: "set-cell-value", sheetId: sheet.id, address: "G1", value: input.header },
    {
      type: "set-cell-style",
      sheetId: sheet.id,
      address: "G1",
      style: {
        bold: true,
        foreground: "#eff6ff",
        background: "#1b3f68",
        horizontalAlign: "center",
      },
    },
    { type: "set-formula", sheetId: sheet.id, address: "G2", formula: input.formula },
    {
      type: "fill-formula",
      sheetId: sheet.id,
      range: `G2:G${lastRow}`,
      sourceAddress: "G2",
      formula: input.formula,
    },
  ];
  return {
    id: crypto.randomUUID(),
    title: input.title,
    explanation: input.explanation,
    affectedRange: range,
    focusCell: "G2",
    selection: range,
    operations,
    operationPreview: [
      `Set G1 to “${input.header}” and apply header style`,
      `Set G2 formula to =${input.formula}`,
      `Fill relative references through G2:G${lastRow}`,
      "Apply all changes as one reviewable transaction",
    ],
  };
}

/**
 * Phase 2のCLI/LLM接続前にproposal→review→apply境界を検証するlocal planner。
 * 対応外の依頼を勝手に実行せず、提案可能な例を返す。
 */
export function planAgentRequest(prompt: string, workbook: SpreadsheetWorkbook): AgentPlanResult {
  const normalized = prompt.trim().toLowerCase();
  if (/平均単価|average unit price|avg unit price/.test(normalized)) {
    return {
      ok: true,
      proposal: createFormulaColumnProposal(workbook, {
        title: "Add average unit price formula column",
        header: "平均単価（円）",
        formula: "ROUND(C2/D2,0)",
        explanation: "売上金額を数量で割り、各行の平均単価をG列へ追加する。0桁へ丸める。",
      }),
    };
  }

  if (/税込|消費税|tax.?included|including tax/.test(normalized)) {
    return {
      ok: true,
      proposal: createFormulaColumnProposal(workbook, {
        title: "Add tax-included sales formula column",
        header: "税込売上（円）",
        formula: "ROUND(C2*1.1,0)",
        explanation: "売上金額へ10%を加えた税込売上をG列へ追加し、円単位へ丸める。",
      }),
    };
  }

  return {
    ok: false,
    message: "Local plannerではこの依頼を安全なsemantic operationへ変換できなかった。変更は行っていない。",
    suggestions: [
      "Add an average unit price formula to column G",
      "G列に税込売上を追加して",
    ],
  };
}
