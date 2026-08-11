import { describe, expect, test } from "bun:test";
import { parseSpreadsheetSource, serializeSpreadsheetSource } from "./index";

const SOURCE = `spreadsheet version="1" {
    workbook {
        name "Test"
    }
    sheet "売上" {
<<<<<<< ours
        column "B" width=20
        row 2 height=32

=======
>>>>>>> theirs
        cell "A1" value="商品" {
            font bold=#true color="#ffffff"
            fill "#254f7d"
            align horizontal="center"
        }
        cell "B2" value=100
        cell "C2" formula="B2*2"
    }
}
`;

describe("spreadsheet source", () => {
  test("parses KDL into explicit spreadsheet IR", () => {
    const result = parseSpreadsheetSource(SOURCE);
    expect(result.diagnostics).toEqual([]);
    expect(result.workbook?.name).toBe("Test");
    expect(result.workbook?.sheets[0]?.cells.B2?.value).toBe(100);
    expect(result.workbook?.sheets[0]?.cells.C2?.formula).toBe("B2*2");
<<<<<<< ours
    expect(result.workbook?.sheets[0]?.columnWidths.B).toBe(20);
    expect(result.workbook?.sheets[0]?.rowHeights[2]).toBe(32);
=======
>>>>>>> theirs
    expect(result.workbook?.sheets[0]?.cells.A1?.style).toEqual({
      bold: true,
      italic: undefined,
      foreground: "#ffffff",
      background: "#254f7d",
      horizontalAlign: "center",
      numberFormat: undefined,
    });
  });

  test("round trips supported cells", () => {
    const first = parseSpreadsheetSource(SOURCE).workbook;
    expect(first).not.toBeNull();
    const second = parseSpreadsheetSource(serializeSpreadsheetSource(first!)).workbook;
    expect(second?.sheets[0]?.cells).toEqual(first?.sheets[0]?.cells);
    expect(second?.sheets[0]?.columnWidths).toEqual(first?.sheets[0]?.columnWidths);
    expect(second?.sheets[0]?.rowHeights).toEqual(first?.sheets[0]?.rowHeights);
  });

  test("preserves stable sheet ids across KDL serialization", () => {
    const first = parseSpreadsheetSource(SOURCE).workbook!;
    first.sheets[0]!.id = "sheet-sales-stable";
    const serialized = serializeSpreadsheetSource(first);
    const second = parseSpreadsheetSource(serialized).workbook;
    expect(serialized).toContain('sheet "売上" id="sheet-sales-stable"');
    expect(second?.sheets[0]?.id).toBe("sheet-sales-stable");
  });

  test("keeps the last valid IR possible by reporting syntax errors", () => {
    const result = parseSpreadsheetSource(`${SOURCE}\n}`);
    expect(result.workbook).toBeNull();
    expect(result.diagnostics[0]?.code).toBe("KDL_PARSE");
  });

  test("reports invalid row and column dimensions", () => {
    const result = parseSpreadsheetSource(SOURCE.replace("width=20", "width=0"));
    expect(result.diagnostics[0]?.code).toBe("COLUMN_WIDTH");
  });

  test("reports invalid formula syntax without discarding the workbook", () => {
    const result = parseSpreadsheetSource(SOURCE.replace('formula="B2*2"', 'formula="SUM(B2"'));
    expect(result.workbook).not.toBeNull();
    expect(result.diagnostics[0]?.code).toBe("FORMULA_ERROR");
    expect(result.diagnostics[0]?.message).toContain("売上!C2");
  });
});
