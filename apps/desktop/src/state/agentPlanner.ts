import type { SpreadsheetOperation } from "@office-ide/operations";
import { validateFormula } from "@office-ide/formula";
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
  input: { title: string; header: string; formula: string; explanation: string; column?: string },
): AgentProposal {
  const sheet = getActiveSheet(workbook);
  const lastRow = findLastDataRow(workbook);
  const column = input.column ?? "G";
  const range = `${column}1:${column}${lastRow}`;
  const operations: SpreadsheetOperation[] = [
    { type: "set-cell-value", sheetId: sheet.id, address: `${column}1`, value: input.header },
    {
      type: "set-cell-style",
      sheetId: sheet.id,
      address: `${column}1`,
      style: {
        bold: true,
        foreground: "#eff6ff",
        background: "#1b3f68",
        horizontalAlign: "center",
      },
    },
    { type: "set-formula", sheetId: sheet.id, address: `${column}2`, formula: input.formula },
    {
      type: "fill-formula",
      sheetId: sheet.id,
      range: `${column}2:${column}${lastRow}`,
      sourceAddress: `${column}2`,
      formula: input.formula,
    },
  ];
  return {
    id: crypto.randomUUID(),
    title: input.title,
    explanation: input.explanation,
    affectedRange: range,
    focusCell: `${column}2`,
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

function createRegionalSummaryProposal(workbook: SpreadsheetWorkbook): AgentProposal | null {
  const sourceSheet = getActiveSheet(workbook);
  const lastRow = findLastDataRow(workbook);
  const totals = new Map<string, { sales: number; records: number }>();

  for (let row = 2; row <= lastRow; row += 1) {
    const region = sourceSheet.cells[`F${row}`]?.value;
    const sales = sourceSheet.cells[`C${row}`]?.value;
    if (typeof region !== "string" || typeof sales !== "number") continue;
    const current = totals.get(region) ?? { sales: 0, records: 0 };
    current.sales += sales;
    current.records += 1;
    totals.set(region, current);
  }
  if (totals.size === 0) return null;

  const rows = [...totals.entries()]
    .map(([region, value]) => ({ region, ...value }))
    .sort((left, right) => right.sales - left.sales || left.region.localeCompare(right.region, "ja"));
  const baseId = "sheet-region-summary";
  let sheetId = baseId;
  let suffix = 2;
  while (workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    sheetId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  const existingNames = new Set(workbook.sheets.map((sheet) => sheet.name));
  let sheetName = "地域別集計";
  let nameSuffix = 2;
  while (existingNames.has(sheetName)) {
    sheetName = `地域別集計${nameSuffix}`;
    nameSuffix += 1;
  }

  const headerStyle = {
    bold: true,
    foreground: "#eff6ff",
    background: "#1b3f68",
    horizontalAlign: "center" as const,
  };
  const totalStyle = {
    bold: true,
    foreground: "#dbeafe",
    background: "#173354",
  };
  const operations: SpreadsheetOperation[] = [
    { type: "add-sheet", sheetId, name: sheetName },
    { type: "set-column-width", sheetId, column: "A", width: 18 },
    { type: "set-column-width", sheetId, column: "B", width: 24 },
    { type: "set-column-width", sheetId, column: "C", width: 10 },
    { type: "set-cell-value", sheetId, address: "A1", value: "地域" },
    { type: "set-cell-value", sheetId, address: "B1", value: "売上合計（円）" },
    { type: "set-cell-value", sheetId, address: "C1", value: "件数" },
    { type: "set-cell-style", sheetId, address: "A1", style: headerStyle },
    { type: "set-cell-style", sheetId, address: "B1", style: headerStyle },
    { type: "set-cell-style", sheetId, address: "C1", style: headerStyle },
  ];

  rows.forEach((row, index) => {
    const targetRow = index + 2;
    operations.push(
      { type: "set-cell-value", sheetId, address: `A${targetRow}`, value: row.region },
      { type: "set-cell-value", sheetId, address: `B${targetRow}`, value: row.sales },
      { type: "set-cell-value", sheetId, address: `C${targetRow}`, value: row.records },
    );
  });

  const totalRow = rows.length + 2;
  const grandSales = rows.reduce((sum, row) => sum + row.sales, 0);
  const grandRecords = rows.reduce((sum, row) => sum + row.records, 0);
  operations.push(
    { type: "set-cell-value", sheetId, address: `A${totalRow}`, value: "合計" },
    { type: "set-cell-value", sheetId, address: `B${totalRow}`, value: grandSales },
    { type: "set-cell-value", sheetId, address: `C${totalRow}`, value: grandRecords },
    { type: "set-cell-style", sheetId, address: `A${totalRow}`, style: totalStyle },
    { type: "set-cell-style", sheetId, address: `B${totalRow}`, style: totalStyle },
    { type: "set-cell-style", sheetId, address: `C${totalRow}`, style: totalStyle },
  );

  const topRegions = rows.slice(0, 3)
    .map((row) => `${row.region} ¥${new Intl.NumberFormat("ja-JP").format(row.sales)}`)
    .join(" / ");

  return {
    id: crypto.randomUUID(),
    title: "Create regional sales summary sheet",
    explanation: `${sourceSheet.name}の${lastRow - 1}件を地域で集計し、${rows.length}地域の売上合計と件数を新しいsheetへ作成する。`,
    affectedRange: `${sheetName}!A1:C${totalRow}`,
    focusCell: "A1",
    selection: `A1:C${totalRow}`,
    operations,
    operationPreview: [
      `Read C2:C${lastRow} (sales) and F2:F${lastRow} (region)`,
      `Group ${lastRow - 1} records into ${rows.length} regions`,
      `Top totals: ${topRegions}`,
      `Create ${sheetName} with a styled header and grand total`,
    ],
  };
}

function parseSheetctlScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const quoted = trimmed.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
  return quoted ? (quoted[1] ?? quoted[2] ?? "") : trimmed;
}

export type SheetctlReadResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function sheetctlColumnIndex(label: string): number {
  return [...label].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function parseSheetctlAddress(address: string) {
  const match = address.toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  return { address: match[0], column: sheetctlColumnIndex(match[1]), row: Number(match[2]) };
}

/**
 * Serves the deliberately small read-only sheetctl surface. Returning null
 * means the command is mutating (or unsupported) and must be reviewed as a
 * proposal instead of receiving a workbook snapshot.
 */
export function readSheetctlCommand(
  command: string,
  workbook: SpreadsheetWorkbook,
): SheetctlReadResult | null {
  const normalized = command.trim();
  const sheet = getActiveSheet(workbook);
  if (/^sheetctl\s+context$/i.test(normalized)) {
    return {
      ok: true,
      message: JSON.stringify({
        workbook: { id: workbook.id, name: workbook.name },
        activeSheet: {
          id: sheet.id,
          name: sheet.name,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          frozenRows: sheet.frozenRows,
          frozenColumns: sheet.frozenColumns,
        },
      }),
    };
  }

  const rangeMatch = normalized.match(/^sheetctl\s+range\s+([^\s]+)$/i);
  if (!rangeMatch) return null;
  const [startText, endText = startText] = rangeMatch[1].split(":");
  const start = parseSheetctlAddress(startText);
  const end = parseSheetctlAddress(endText);
  if (!start || !end) {
    return { ok: false, message: "Range must use A1 notation, for example A1:C10" };
  }
  const firstColumn = Math.min(start.column, end.column);
  const lastColumn = Math.max(start.column, end.column);
  const firstRow = Math.min(start.row, end.row);
  const lastRow = Math.max(start.row, end.row);
  if (lastColumn > sheet.columnCount || lastRow > sheet.rowCount) {
    return { ok: false, message: "Range is outside the active sheet" };
  }
  if ((lastColumn - firstColumn + 1) * (lastRow - firstRow + 1) > 1_000) {
    return { ok: false, message: "Range is limited to 1,000 cells" };
  }
  const cells = Object.values(sheet.cells)
    .filter((cell) => {
      const position = parseSheetctlAddress(cell.address);
      return position
        && position.column >= firstColumn
        && position.column <= lastColumn
        && position.row >= firstRow
        && position.row <= lastRow;
    })
    .sort((left, right) => {
      const leftPosition = parseSheetctlAddress(left.address)!;
      const rightPosition = parseSheetctlAddress(right.address)!;
      return leftPosition.row - rightPosition.row || leftPosition.column - rightPosition.column;
    })
    .map(({ address, value, formula }) => ({ address, value, ...(formula ? { formula } : {}) }));
  return {
    ok: true,
    message: JSON.stringify({
      sheet: { id: sheet.id, name: sheet.name },
      range: `${start.address}:${end.address}`,
      cells,
    }),
  };
}

/**
 * Converts the intentionally small sheetctl command surface into a proposal.
 * This is a parser only: it never mutates the workbook. A future local IPC
 * transport must use this same boundary instead of applying cell writes itself.
 */
export function planSheetctlCommand(command: string, workbook: SpreadsheetWorkbook): AgentPlanResult {
  const formulaColumn = command.trim().match(/^sheetctl\s+formula\s+column\s+([A-Za-z]+)\s+(?:"([^"]+)"|'([^']+)')\s+=?(.+)$/i);
  if (formulaColumn) {
    const [, rawColumn, doubleQuotedHeader, singleQuotedHeader, rawFormula] = formulaColumn;
    const column = rawColumn.toUpperCase();
    const header = doubleQuotedHeader ?? singleQuotedHeader ?? "Calculated value";
    const formula = rawFormula.trim().replace(/^=/, "");
    const formulaError = validateFormula(formula);
    if (formulaError) {
      return {
        ok: false,
        message: `Formula is invalid: ${formulaError}`,
        suggestions: ["sheetctl formula column G \"Average unit price\" =ROUND(C2/D2,0)"],
      };
    }
    return {
      ok: true,
      proposal: createFormulaColumnProposal(workbook, {
        title: `Add calculated column ${column}`,
        header,
        formula,
        column,
        explanation: `Create ${column}1:${column}${findLastDataRow(workbook)} as one reviewable change set.`,
      }),
    };
  }
  const match = command.trim().match(/^sheetctl\s+(cell|formula)\s+set\s+([A-Za-z]+[1-9]\d*)\s+([\s\S]+)$/i);
  if (!match) {
    return {
      ok: false,
      message: "sheetctl commandを解釈できなかった。変更は行っていない。",
      suggestions: [
        "sheetctl cell set B2 100",
        'sheetctl cell set A2 "North region"',
        "sheetctl formula set G2 =ROUND(C2/D2,0)",
      ],
    };
  }

  const [, subject, rawAddress, rawValue] = match;
  const sheet = getActiveSheet(workbook);
  const address = rawAddress.toUpperCase();
  const position = address.match(/^([A-Z]+)([1-9]\d*)$/);
  const column = position?.[1] ?? "";
  const row = Number(position?.[2]);
  const columnIndex = [...column].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
  if (!position || row > sheet.rowCount || columnIndex > sheet.columnCount) {
    return {
      ok: false,
      message: `${address}は現在のsheet範囲外です。変更は行っていない。`,
      suggestions: ["sheetctl cell set B2 100", "sheetctl formula set G2 =ROUND(C2/D2,0)"],
    };
  }

  const formula = rawValue.trim().replace(/^=/, "");
  if (subject.toLowerCase() === "formula" && !formula) {
    return {
      ok: false,
      message: "数式が空です。変更は行っていない。",
      suggestions: ["sheetctl formula set G2 =ROUND(C2/D2,0)"],
    };
  }
  if (subject.toLowerCase() === "formula") {
    const formulaError = validateFormula(formula);
    if (formulaError) {
      return {
        ok: false,
        message: `Formula is invalid: ${formulaError}`,
        suggestions: ["sheetctl formula set G2 =ROUND(C2/D2,0)"],
      };
    }
  }

  const operation: SpreadsheetOperation = subject.toLowerCase() === "formula"
    ? { type: "set-formula", sheetId: sheet.id, address, formula }
    : { type: "set-cell-value", sheetId: sheet.id, address, value: parseSheetctlScalar(rawValue) };
  const preview = operation.type === "set-formula"
    ? `Set ${address} formula to =${operation.formula}`
    : `Set ${address} to ${JSON.stringify(operation.value)}`;
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(),
      title: `sheetctl: set ${address}`,
      explanation: `sheetctlからの変更要求を検証し、${sheet.name}!${address}への1 operationとして保留した。ApplyするまでWorkbook IRは変更されない。`,
      affectedRange: `${sheet.name}!${address}`,
      focusCell: address,
      selection: address,
      operations: [operation],
      operationPreview: [preview, "Apply this CLI request as one reviewable transaction"],
    },
  };
}

/**
 * Phase 2のCLI/LLM接続前にproposal→review→apply境界を検証するlocal planner。
 * 対応外の依頼を勝手に実行せず、提案可能な例を返す。
 */
export function planAgentRequest(prompt: string, workbook: SpreadsheetWorkbook): AgentPlanResult {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.startsWith("sheetctl")) return planSheetctlCommand(prompt, workbook);
  if (/(地域別|regional).*(集計|summary)|(?:集計|summary).*(地域別|regional)/.test(normalized)) {
    const proposal = createRegionalSummaryProposal(workbook);
    if (proposal) return { ok: true, proposal };
    return {
      ok: false,
      message: "地域と売上金額を持つ行を見つけられなかった。変更は行っていない。",
      suggestions: ["地域別の売上集計シートを作って", "売上50万円以上を強調して"],
    };
  }

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
      "地域別の売上集計シートを作って",
    ],
  };
}
