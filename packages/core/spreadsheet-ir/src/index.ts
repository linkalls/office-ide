export type CellScalar = string | number | boolean | null;

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  foreground?: string;
  background?: string;
  horizontalAlign?: "left" | "center" | "right";
  numberFormat?: string;
}

export interface SpreadsheetCell {
  address: string;
  value: CellScalar;
  formula?: string;
  style?: CellStyle;
}

export interface SpreadsheetSheet {
  id: string;
  name: string;
  cells: Record<string, SpreadsheetCell>;
  /** KDLのcolumn widthを保持する。キーはA1 notationの列名。 */
  columnWidths: Record<string, number>;
  /** KDLのrow heightを保持する。キーは1始まりの行番号。 */
  rowHeights: Record<number, number>;
  rowCount: number;
  columnCount: number;
  frozenRows: number;
  frozenColumns: number;
}

export interface SpreadsheetWorkbook {
  id: string;
  name: string;
  activeSheetId: string;
  sheets: SpreadsheetSheet[];
  version: 1;
}

export interface SpreadsheetSelection {
  resourceId: string;
  sheetId: string;
  ranges: string[];
  activeCell: string | null;
}

export function createEmptyWorkbook(
  name = "Untitled Workbook",
  sheetName = "Sheet1",
): SpreadsheetWorkbook {
  return {
    id: "workbook-1",
    name,
    activeSheetId: "sheet-1",
    version: 1,
    sheets: [
      {
        id: "sheet-1",
        name: sheetName,
        cells: {},
        columnWidths: {},
        rowHeights: {},
        rowCount: 100,
        columnCount: 26,
        frozenRows: 0,
        frozenColumns: 0,
      },
    ],
  };
}

export function getActiveSheet(workbook: SpreadsheetWorkbook): SpreadsheetSheet {
  return (
    workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ??
    workbook.sheets[0]
  );
}

export function cloneWorkbook(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  return structuredClone(workbook);
}
