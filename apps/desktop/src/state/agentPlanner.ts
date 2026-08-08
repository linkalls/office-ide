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

function parseSalesThreshold(prompt: string): number | null {
  const normalized = prompt.replaceAll(",", "").replaceAll("，", "");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(万円|万|k|千円|円)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "万円" || unit === "万") return amount * 10_000;
  if (unit === "k" || unit === "千円") return amount * 1_000;
  return amount;
}

function createHighSalesHighlightProposal(
  workbook: SpreadsheetWorkbook,
  threshold: number,
): AgentProposal | null {
  const sheet = getActiveSheet(workbook);
  const lastRow = findLastDataRow(workbook);
  const matchingRows: number[] = [];

  for (let row = 2; row <= lastRow; row += 1) {
    const sales = sheet.cells[`C${row}`]?.value;
    if (typeof sales === "number" && sales >= threshold) matchingRows.push(row);
  }
  if (matchingRows.length === 0) return null;

  const columns = ["A", "B", "C", "D", "E", "F"];
  const operations: SpreadsheetOperation[] = matchingRows.flatMap((row) =>
    columns.map((column) => ({
      type: "set-cell-style" as const,
      sheetId: sheet.id,
      address: `${column}${row}`,
      style: {
        bold: true,
        foreground: "#fff4cc",
        background: "#6b4508",
      },
    })));
  const formattedThreshold = new Intl.NumberFormat("ja-JP").format(threshold);
  const rowLabels = matchingRows.map((row) => `row ${row}`).join(", ");

  return {
    id: crypto.randomUUID(),
    title: `Highlight sales at or above ¥${formattedThreshold}`,
    explanation: `売上金額（C列）を走査し、${formattedThreshold}円以上の${matchingRows.length}行だけを強調する。`,
    affectedRange: `${matchingRows.length} rows · A2:F${lastRow}`,
    focusCell: `C${matchingRows[0]}`,
    selection: `A${matchingRows[0]}:F${matchingRows.at(-1)}`,
    operations,
    operationPreview: [
      `Inspect C2:C${lastRow} using a threshold of ¥${formattedThreshold}`,
      `Matched ${rowLabels}`,
      `Apply bold text and amber emphasis to A:F on each matching row`,
      "Apply all highlights as one reviewable transaction",
    ],
  };
}

/**
 * Phase 2のCLI/LLM接続前にproposal→review→apply境界を検証するlocal planner。
 * 対応外の依頼を勝手に実行せず、提案可能な例を返す。
 */
export function planAgentRequest(prompt: string, workbook: SpreadsheetWorkbook): AgentPlanResult {
  const normalized = prompt.trim().toLowerCase();
  if (/(強調|ハイライト|highlight|emphasize)/.test(normalized) && /(売上|sales)/.test(normalized)) {
    const threshold = parseSalesThreshold(prompt);
    if (threshold === null) {
      return {
        ok: false,
        message: "強調する売上金額のしきい値を読み取れなかった。変更は行っていない。",
        suggestions: ["売上50万円以上を強調して", "Highlight sales above 500000"],
      };
    }
    const proposal = createHighSalesHighlightProposal(workbook, threshold);
    if (!proposal) {
      return {
        ok: false,
        message: `${new Intl.NumberFormat("ja-JP").format(threshold)}円以上の売上は見つからなかった。変更は行っていない。`,
        suggestions: ["売上10万円以上を強調して", "Add an average unit price formula to column G"],
      };
    }
    return { ok: true, proposal };
  }

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
      "売上50万円以上を強調して",
    ],
  };
}
