import { describe, expect, test } from "bun:test";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
import { calculateCell, calculateSheet, validateFormula } from "./index";

function createSheet() {
  return createEmptyWorkbook().sheets[0]!;
}

describe("formula engine", () => {
  test("evaluates precedence, parentheses, powers, and unary operators", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "2+3*4" };
    sheet.cells.A2 = { address: "A2", value: null, formula: "-(2+3)^2" };
    expect(calculateCell(sheet, "A1")).toBe(14);
    expect(calculateCell(sheet, "A2")).toBe(-25);
  });

  test("resolves recursive cell references", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: 10 };
    sheet.cells.A2 = { address: "A2", value: null, formula: "A1*2" };
    sheet.cells.A3 = { address: "A3", value: null, formula: "A2+5" };
    expect(calculateCell(sheet, "A3")).toBe(25);
  });

  test("evaluates range aggregation functions", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: 10 };
    sheet.cells.A2 = { address: "A2", value: 20 };
    sheet.cells.A3 = { address: "A3", value: "ignored" };
    sheet.cells.B1 = { address: "B1", value: null, formula: "SUM(A1:A3)" };
    sheet.cells.B2 = { address: "B2", value: null, formula: "AVERAGE(A1:A3)" };
    sheet.cells.B3 = { address: "B3", value: null, formula: "MIN(A1:A2)+MAX(A1:A2)+COUNT(A1:A3)" };
    const calculated = calculateSheet(sheet);
    expect(calculated.B1).toBe(30);
    expect(calculated.B2).toBe(15);
    expect(calculated.B3).toBe(32);
  });

  test("supports comparisons, IF, booleans, strings, and concatenation", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: 12 };
    sheet.cells.B1 = { address: "B1", value: null, formula: 'IF(A1>=10,"OK","NG")' };
    sheet.cells.B2 = { address: "B2", value: null, formula: '"売上"&":"&A1' };
    sheet.cells.B3 = { address: "B3", value: null, formula: "IF(TRUE,1,1/0)" };
    expect(calculateCell(sheet, "B1")).toBe("OK");
    expect(calculateCell(sheet, "B2")).toBe("売上:12");
    expect(calculateCell(sheet, "B3")).toBe(1);
  });

  test("returns spreadsheet errors", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "1/0" };
    sheet.cells.A2 = { address: "A2", value: null, formula: "UNKNOWN(1)" };
    sheet.cells.A3 = { address: "A3", value: null, formula: "#REF!+1" };
    expect(calculateCell(sheet, "A1")).toBe("#DIV/0!");
    expect(calculateCell(sheet, "A2")).toBe("#NAME?");
    expect(calculateCell(sheet, "A3")).toBe("#REF!");
  });

  test("detects circular references", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "B1+1" };
    sheet.cells.B1 = { address: "B1", value: null, formula: "A1+1" };
    expect(calculateCell(sheet, "A1")).toBe("#CYCLE!");
  });

  test("validates syntax without evaluating the workbook", () => {
    expect(validateFormula("SUM(A1:A3)+2")).toBeNull();
    expect(validateFormula("SUM(A1:A3")).toContain("Expected right-paren");
    expect(validateFormula("")).toBe("Formula is empty");
  });

  test("supports common math and logical functions", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "ROUND(12.345,2)" };
    sheet.cells.A2 = { address: "A2", value: null, formula: "ROUNDUP(-12.341,2)" };
    sheet.cells.A3 = { address: "A3", value: null, formula: "ROUNDDOWN(12.349,2)" };
    sheet.cells.A4 = { address: "A4", value: null, formula: "ABS(-3)+COUNTA(1,\"x\",\"\")" };
    sheet.cells.A5 = { address: "A5", value: null, formula: "AND(TRUE,NOT(FALSE),OR(FALSE,1))" };
    expect(calculateCell(sheet, "A1")).toBe(12.35);
    expect(calculateCell(sheet, "A2")).toBe(-12.35);
    expect(calculateCell(sheet, "A3")).toBe(12.34);
    expect(calculateCell(sheet, "A4")).toBe(5);
    expect(calculateCell(sheet, "A5")).toBe(true);
  });

  test("supports common text functions", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: 'CONCAT(UPPER("office"),"-",LOWER("IDE"))' };
    sheet.cells.A2 = { address: "A2", value: null, formula: 'LEFT("abcdef",2)&RIGHT("abcdef",2)' };
    sheet.cells.A3 = { address: "A3", value: null, formula: 'MID("abcdef",2,3)&LEN("日本語")' };
    expect(calculateCell(sheet, "A1")).toBe("OFFICE-ide");
    expect(calculateCell(sheet, "A2")).toBe("abef");
    expect(calculateCell(sheet, "A3")).toBe("bcd3");
  });
});
