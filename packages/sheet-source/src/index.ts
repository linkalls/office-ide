import { findKdlChildren, parseKdl } from "@office-ide/kdl";
import { validateFormula } from "@office-ide/formula";
import type { Diagnostic } from "@office-ide/protocol";
import {
  createEmptyWorkbook,
  type CellStyle,
  type CellScalar,
  type SpreadsheetWorkbook,
} from "@office-ide/spreadsheet-ir";

export interface SheetSourceParseResult {
  workbook: SpreadsheetWorkbook | null;
  diagnostics: Diagnostic[];
}

function parseCellStyle(cellNode: ReturnType<typeof findKdlChildren>[number]): CellStyle | undefined {
  const font = findKdlChildren(cellNode, "font")[0];
  const fill = findKdlChildren(cellNode, "fill")[0];
  const align = findKdlChildren(cellNode, "align")[0];
  const numberFormat = findKdlChildren(cellNode, "number-format")[0];
  const style: CellStyle = {
    bold: typeof font?.properties.bold === "boolean" ? font.properties.bold : undefined,
    italic: typeof font?.properties.italic === "boolean" ? font.properties.italic : undefined,
    foreground: typeof font?.properties.color === "string" ? font.properties.color : undefined,
    background: typeof fill?.arguments[0] === "string" ? fill.arguments[0] : undefined,
    horizontalAlign:
      align?.properties.horizontal === "left" ||
      align?.properties.horizontal === "center" ||
      align?.properties.horizontal === "right"
        ? align.properties.horizontal
        : undefined,
    numberFormat: typeof numberFormat?.arguments[0] === "string" ? numberFormat.arguments[0] : undefined,
  };
  return Object.values(style).some((value) => value !== undefined) ? style : undefined;
}

function readPositiveDimension(
  value: unknown,
  code: string,
  label: string,
  line: number,
  diagnostics: Diagnostic[],
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  diagnostics.push({
    severity: "error",
    code,
    message: `${label} must be a positive number`,
    line,
  });
  return undefined;
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
    const columnWidths: Record<string, number> = {};
    const rowHeights: Record<number, number> = {};

    for (const columnNode of findKdlChildren(sheetNode, "column")) {
      const column = String(columnNode.arguments[0] ?? "").toUpperCase();
      if (!/^[A-Z]+$/.test(column)) {
        diagnostics.push({
          severity: "error",
          code: "COLUMN_ADDRESS",
          message: `Invalid column address: ${column || "(empty)"}`,
          line: columnNode.line,
        });
        continue;
      }
      const width = readPositiveDimension(
        columnNode.properties.width,
        "COLUMN_WIDTH",
        `Width for column ${column}`,
        columnNode.line,
        diagnostics,
      );
      if (width !== undefined) columnWidths[column] = width;
    }

    for (const rowNode of findKdlChildren(sheetNode, "row")) {
      const row = rowNode.arguments[0];
      if (typeof row !== "number" || !Number.isInteger(row) || row < 1) {
        diagnostics.push({
          severity: "error",
          code: "ROW_ADDRESS",
          message: `Invalid row address: ${String(row ?? "(empty)")}`,
          line: rowNode.line,
        });
        continue;
      }
      const height = readPositiveDimension(
        rowNode.properties.height,
        "ROW_HEIGHT",
        `Height for row ${row}`,
        rowNode.line,
        diagnostics,
      );
      if (height !== undefined) rowHeights[row] = height;
    }

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
        style: parseCellStyle(cellNode),
      };
    }

    workbook.sheets.push({
      id: typeof sheetNode.properties.id === "string"
        ? sheetNode.properties.id
        : `sheet-${sheetIndex + 1}`,
      name: String(sheetNode.arguments[0] ?? `Sheet${sheetIndex + 1}`),
      cells,
      columnWidths,
      rowHeights,
      rowCount: 100,
      columnCount: 26,
      frozenRows: 0,
      frozenColumns: 0,
    });
  }

  workbook.activeSheetId = workbook.sheets[0]?.id ?? "sheet-1";

  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.formula) continue;
      const formulaError = validateFormula(cell.formula);
      if (!formulaError) continue;
      diagnostics.push({
        severity: "error",
        code: "FORMULA_ERROR",
        message: `${sheet.name}!${cell.address}: ${formulaError}`,
      });
    }
  }

  return { workbook, diagnostics };
}

function formatScalar(value: CellScalar): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === true) return "#true";
  if (value === false) return "#false";
  if (value === null) return "#null";
  return String(value);
}

function serializeCellStyle(style: CellStyle, indent: string): string[] {
  const lines: string[] = [];
  const fontProperties = [
    style.bold === undefined ? "" : `bold=${formatScalar(style.bold)}`,
    style.italic === undefined ? "" : `italic=${formatScalar(style.italic)}`,
    style.foreground ? `color=${JSON.stringify(style.foreground)}` : "",
  ].filter(Boolean);
  if (fontProperties.length > 0) lines.push(`${indent}font ${fontProperties.join(" ")}`);
  if (style.background) lines.push(`${indent}fill ${JSON.stringify(style.background)}`);
  if (style.horizontalAlign) lines.push(`${indent}align horizontal=${JSON.stringify(style.horizontalAlign)}`);
  if (style.numberFormat) lines.push(`${indent}number-format ${JSON.stringify(style.numberFormat)}`);
  return lines;
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
    lines.push(`    sheet ${JSON.stringify(sheet.name)} id=${JSON.stringify(sheet.id)} {`);
    for (const [column, width] of Object.entries(sheet.columnWidths).sort()) {
      lines.push(`        column ${JSON.stringify(column)} width=${width}`);
    }
    for (const [row, height] of Object.entries(sheet.rowHeights).sort(
      ([left], [right]) => Number(left) - Number(right),
    )) {
      lines.push(`        row ${row} height=${height}`);
    }
    if (Object.keys(sheet.columnWidths).length > 0 || Object.keys(sheet.rowHeights).length > 0) {
      lines.push("");
    }
    const cells = [...Object.values(sheet.cells)].sort((left, right) =>
      left.address.localeCompare(right.address, undefined, { numeric: true }),
    );
    for (const cell of cells) {
      const valuePart = cell.formula
        ? `formula=${JSON.stringify(cell.formula)}`
        : `value=${formatScalar(cell.value)}`;
      const styleLines = cell.style ? serializeCellStyle(cell.style, "            ") : [];
      if (styleLines.length === 0) {
        lines.push(`        cell ${JSON.stringify(cell.address)} ${valuePart}`);
      } else {
        lines.push(`        cell ${JSON.stringify(cell.address)} ${valuePart} {`);
        lines.push(...styleLines, "        }");
      }
    }
    lines.push("    }");
    if (sheetIndex < workbook.sheets.length - 1) lines.push("");
  }

  lines.push("}", "");
  return lines.join("\n");
}
