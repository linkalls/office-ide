import { findKdlChildren, parseKdl } from "@office-ide/kdl";
import type { Diagnostic } from "@office-ide/protocol";
import {
  createEmptyWorkbook,
  type CellScalar,
  type SpreadsheetWorkbook,
} from "@office-ide/spreadsheet-ir";

export interface SheetSourceParseResult {
  workbook: SpreadsheetWorkbook | null;
  diagnostics: Diagnostic[];
}

export function parseSpreadsheetSource(source: string): SheetSourceParseResult {
  const parsed = parseKdl(source);
  const diagnostics: Diagnostic[] = parsed.diagnostics.map((diagnostic) => ({
    severity: "error",
    code: "KDL_PARSE",
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
  }));

  if (diagnostics.length > 0) return { workbook: null, diagnostics };

  const spreadsheet = parsed.nodes.find((node) => node.name === "spreadsheet");
  if (!spreadsheet) {
    return {
      workbook: null,
      diagnostics: [
        {
          severity: "error",
          code: "SHEET_ROOT",
          message: "Expected a spreadsheet root node",
        },
      ],
    };
  }

  const workbookNode = findKdlChildren(spreadsheet, "workbook")[0];
  const workbookNameNode = workbookNode
    ? findKdlChildren(workbookNode, "name")[0]
    : undefined;
  const sheetNodes = findKdlChildren(spreadsheet, "sheet");
  const workbook = createEmptyWorkbook(
    String(workbookNameNode?.arguments[0] ?? "Workbook"),
    String(sheetNodes[0]?.arguments[0] ?? "Sheet1"),
  );
  workbook.sheets = [];

  for (const [sheetIndex, sheetNode] of sheetNodes.entries()) {
    const cells: SpreadsheetWorkbook["sheets"][number]["cells"] = {};
    for (const cellNode of findKdlChildren(sheetNode, "cell")) {
      const address = String(cellNode.arguments[0] ?? "").toUpperCase();
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) {
        diagnostics.push({
          severity: "error",
          code: "CELL_ADDRESS",
          message: `Invalid cell address: ${address || "(empty)"}`,
          line: cellNode.line,
        });
        continue;
      }

      const value = (cellNode.properties.value ?? null) as CellScalar;
      const formula = cellNode.properties.formula;
      cells[address] = {
        address,
        value,
        formula: typeof formula === "string" ? formula : undefined,
      };
    }

    workbook.sheets.push({
      id: `sheet-${sheetIndex + 1}`,
      name: String(sheetNode.arguments[0] ?? `Sheet${sheetIndex + 1}`),
      cells,
      rowCount: 100,
      columnCount: 26,
      frozenRows: 0,
      frozenColumns: 0,
    });
  }

  workbook.activeSheetId = workbook.sheets[0]?.id ?? "sheet-1";
  return { workbook, diagnostics };
}

function formatScalar(value: CellScalar): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === true) return "#true";
  if (value === false) return "#false";
  if (value === null) return "#null";
  return String(value);
}

export function serializeSpreadsheetSource(workbook: SpreadsheetWorkbook): string {
  const lines: string[] = [
    'spreadsheet version="1" {',
    "    workbook {",
    `        name ${JSON.stringify(workbook.name)}`,
    "    }",
    "",
  ];

  for (const [sheetIndex, sheet] of workbook.sheets.entries()) {
    lines.push(`    sheet ${JSON.stringify(sheet.name)} {`);
    const cells = [...Object.values(sheet.cells)].sort((left, right) =>
      left.address.localeCompare(right.address, undefined, { numeric: true }),
    );
    for (const cell of cells) {
      const valuePart = cell.formula
        ? `formula=${JSON.stringify(cell.formula)}`
        : `value=${formatScalar(cell.value)}`;
      lines.push(`        cell ${JSON.stringify(cell.address)} ${valuePart}`);
    }
    lines.push("    }");
    if (sheetIndex < workbook.sheets.length - 1) lines.push("");
  }

  lines.push("}", "");
  return lines.join("\n");
}
