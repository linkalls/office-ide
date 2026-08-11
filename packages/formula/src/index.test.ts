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

  test("supports criteria functions SUMIF, COUNTIF, and AVERAGEIF", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: "Apple" };
    sheet.cells.A2 = { address: "A2", value: "Orange" };
    sheet.cells.A3 = { address: "A3", value: "Apple" };
    sheet.cells.B1 = { address: "B1", value: 100 };
    sheet.cells.B2 = { address: "B2", value: 200 };
    sheet.cells.B3 = { address: "B3", value: 300 };

    sheet.cells.C1 = { address: "C1", value: null, formula: 'SUMIF(A1:A3,"Apple",B1:B3)' };
    sheet.cells.C2 = { address: "C2", value: null, formula: 'COUNTIF(A1:A3,"Apple")' };
    sheet.cells.C3 = { address: "C3", value: null, formula: 'AVERAGEIF(B1:B3,">100")' };
    sheet.cells.C4 = { address: "C4", value: null, formula: 'COUNTIF(B1:B3,">=200")' };

    const calculated = calculateSheet(sheet);
    expect(calculated.C1).toBe(400);
    expect(calculated.C2).toBe(2);
    expect(calculated.C3).toBe(250);
    expect(calculated.C4).toBe(2);
  });

  test("supports lookup and reference functions VLOOKUP, HLOOKUP, INDEX, MATCH, CHOOSE, ROW, COLUMN", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: "P101" };
    sheet.cells.B1 = { address: "B1", value: "Keyboard" };
    sheet.cells.C1 = { address: "C1", value: 50 };

    sheet.cells.A2 = { address: "A2", value: "P102" };
    sheet.cells.B2 = { address: "B2", value: "Mouse" };
    sheet.cells.C2 = { address: "C2", value: 25 };

    sheet.cells.D1 = { address: "D1", value: null, formula: 'VLOOKUP("P102",A1:C2,2)' };
    sheet.cells.D2 = { address: "D2", value: null, formula: 'VLOOKUP("P101",A1:C2,3)' };
    sheet.cells.D3 = { address: "D3", value: null, formula: 'INDEX(A1:C2,2,2)' };
    sheet.cells.D4 = { address: "D4", value: null, formula: 'MATCH("Mouse",B1:B2)' };
    sheet.cells.D5 = { address: "D5", value: null, formula: 'CHOOSE(2,"First","Second","Third")' };
    sheet.cells.D6 = { address: "D6", value: null, formula: 'ROW(B5)' };
    sheet.cells.D7 = { address: "D7", value: null, formula: 'COLUMN(C1)' };

    const calculated = calculateSheet(sheet);
    expect(calculated.D1).toBe("Mouse");
    expect(calculated.D2).toBe(50);
    expect(calculated.D3).toBe("Mouse");
    expect(calculated.D4).toBe(2);
    expect(calculated.D5).toBe("Second");
    expect(calculated.D6).toBe(5);
    expect(calculated.D7).toBe(3);
  });

  test("supports error handling and logical functions IFERROR, IFS, SWITCH, ISBLANK, ISNUMBER, ISTEXT", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: 'IFERROR(1/0,"Recovered")' };
    sheet.cells.A2 = { address: "A2", value: null, formula: 'IFERROR(2+3,"Recovered")' };
    sheet.cells.A3 = { address: "A3", value: null, formula: 'IFS(1=2,"A",2=2,"B",TRUE,"C")' };
    sheet.cells.A4 = { address: "A4", value: null, formula: 'SWITCH(2,1,"One",2,"Two","Other")' };
    sheet.cells.A5 = { address: "A5", value: null, formula: 'ISNUMBER(123)&"-"&ISTEXT("abc")&"-"&ISBLANK(B10)' };

    const calculated = calculateSheet(sheet);
    expect(calculated.A1).toBe("Recovered");
    expect(calculated.A2).toBe(5);
    expect(calculated.A3).toBe("B");
    expect(calculated.A4).toBe("Two");
    expect(calculated.A5).toBe("true-true-true");
  });

  test("supports math functions POWER, SQRT, MOD, INT, TRUNC, PRODUCT", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "POWER(2,4)+SQRT(16)" };
    sheet.cells.A2 = { address: "A2", value: null, formula: "MOD(10,3)" };
    sheet.cells.A3 = { address: "A3", value: null, formula: "INT(4.9)&\"-\"&TRUNC(4.876,2)" };
    sheet.cells.A4 = { address: "A4", value: null, formula: "PRODUCT(2,3,4)" };

    const calculated = calculateSheet(sheet);
    expect(calculated.A1).toBe(20);
    expect(calculated.A2).toBe(1);
    expect(calculated.A3).toBe("4-4.87");
    expect(calculated.A4).toBe(24);
  });

  test("supports extended text functions TRIM, EXACT, REPT, FIND, SEARCH, SUBSTITUTE, TEXT", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: 'TRIM("  hello   world  ")' };
    sheet.cells.A2 = { address: "A2", value: null, formula: 'EXACT("abc","abc")&"-"&EXACT("abc","ABC")' };
    sheet.cells.A3 = { address: "A3", value: null, formula: 'REPT("*",3)' };
    sheet.cells.A4 = { address: "A4", value: null, formula: 'SUBSTITUTE("2025-01-01","2025","2026")' };
    sheet.cells.A5 = { address: "A5", value: null, formula: 'TEXT(1234.5,"#,##0.00")' };
    sheet.cells.A6 = { address: "A6", value: null, formula: 'FIND("b","abc")&"-"&SEARCH("b","ABC")' };

    const calculated = calculateSheet(sheet);
    expect(calculated.A1).toBe("hello world");
    expect(calculated.A2).toBe("true-false");
    expect(calculated.A3).toBe("***");
    expect(calculated.A4).toBe("2026-01-01");
    expect(calculated.A5).toBe("1,234.50");
    expect(calculated.A6).toBe("2-2");
  });

  test("supports date functions DATE, YEAR, MONTH, DAY, TODAY", () => {
    const sheet = createSheet();
    sheet.cells.A1 = { address: "A1", value: null, formula: "DATE(2026,8,10)" };
    sheet.cells.A2 = { address: "A2", value: null, formula: 'YEAR("2026-08-10")' };
    sheet.cells.A3 = { address: "A3", value: null, formula: 'MONTH("2026-08-10")' };
    sheet.cells.A4 = { address: "A4", value: null, formula: 'DAY("2026-08-10")' };
    sheet.cells.A5 = { address: "A5", value: null, formula: "TODAY()" };

    const calculated = calculateSheet(sheet);
    expect(calculated.A1).toBe("2026-08-10");
    expect(calculated.A2).toBe(2026);
    expect(calculated.A3).toBe(8);
    expect(calculated.A4).toBe(10);
    expect(typeof calculated.A5).toBe("string");
  });
});

