import type {
  CellScalar,
  SpreadsheetSheet,
} from "@office-ide/spreadsheet-ir";

export type FormulaError =
  | "#REF!"
  | "#DIV/0!"
  | "#VALUE!"
  | "#NAME?"
  | "#CYCLE!"
  | "#ERROR!";

export type FormulaValue = CellScalar | FormulaError;

interface NumberNode {
  type: "number";
  value: number;
}

interface StringNode {
  type: "string";
  value: string;
}

interface BooleanNode {
  type: "boolean";
  value: boolean;
}

interface ErrorNode {
  type: "error";
  value: FormulaError;
}

interface CellNode {
  type: "cell";
  address: string;
}

interface RangeNode {
  type: "range";
  start: string;
  end: string;
}

interface UnaryNode {
  type: "unary";
  operator: "+" | "-";
  operand: FormulaNode;
}

interface BinaryNode {
  type: "binary";
  operator: "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";
  left: FormulaNode;
  right: FormulaNode;
}

interface CallNode {
  type: "call";
  name: string;
  arguments: FormulaNode[];
}

type FormulaNode =
  | NumberNode
  | StringNode
  | BooleanNode
  | ErrorNode
  | CellNode
  | RangeNode
  | UnaryNode
  | BinaryNode
  | CallNode;

type TokenType =
  | "number"
  | "string"
  | "identifier"
  | "cell"
  | "error"
  | "operator"
  | "left-paren"
  | "right-paren"
  | "comma"
  | "colon"
  | "eof";

interface Token {
  type: TokenType;
  text: string;
  position: number;
}

interface CellPosition {
  column: number;
  row: number;
}

type EvaluatedValue = FormulaValue | FormulaValue[];

const ERROR_LITERALS = new Set<FormulaError>([
  "#REF!",
  "#DIV/0!",
  "#VALUE!",
  "#NAME?",
  "#CYCLE!",
  "#ERROR!",
]);

function isFormulaError(value: unknown): value is FormulaError {
  return typeof value === "string" && ERROR_LITERALS.has(value as FormulaError);
}

function normalizeAddress(address: string): string {
  return address.replaceAll("$", "").toUpperCase();
}

function columnLabelToIndex(label: string): number {
  let result = 0;
  for (const character of label.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function columnIndexToLabel(index: number): string {
  let current = index;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function parseAddress(address: string): CellPosition | null {
  const match = normalizeAddress(address).match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  return { column: columnLabelToIndex(match[1]), row: Number(match[2]) };
}

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < formula.length) {
    const character = formula[position];
    if (/\s/.test(character)) {
      position += 1;
      continue;
    }

    if (character === '"') {
      const start = position;
      position += 1;
      let value = "";
      let closed = false;
      while (position < formula.length) {
        if (formula[position] === '"') {
          if (formula[position + 1] === '"') {
            value += '"';
            position += 2;
            continue;
          }
          position += 1;
          closed = true;
          break;
        }
        value += formula[position];
        position += 1;
      }
      if (!closed) throw new SyntaxError(`Unterminated string at ${start + 1}`);
      tokens.push({ type: "string", text: value, position: start });
      continue;
    }

    const rest = formula.slice(position);
    const error = rest.match(/^#(?:REF!|DIV\/0!|VALUE!|NAME\?|CYCLE!|ERROR!)/i)?.[0];
    if (error) {
      tokens.push({ type: "error", text: error.toUpperCase(), position });
      position += error.length;
      continue;
    }

    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
    if (number) {
      tokens.push({ type: "number", text: number, position });
      position += number.length;
      continue;
    }

    const cell = rest.match(/^\$?[A-Za-z]+\$?[1-9]\d*/)?.[0];
    if (cell) {
      tokens.push({ type: "cell", text: cell.toUpperCase(), position });
      position += cell.length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/)?.[0];
    if (identifier) {
      tokens.push({ type: "identifier", text: identifier.toUpperCase(), position });
      position += identifier.length;
      continue;
    }

    const twoCharacterOperator = formula.slice(position, position + 2);
    if (["<=", ">=", "<>"].includes(twoCharacterOperator)) {
      tokens.push({ type: "operator", text: twoCharacterOperator, position });
      position += 2;
      continue;
    }

    const simpleTokens: Record<string, TokenType> = {
      "+": "operator",
      "-": "operator",
      "*": "operator",
      "/": "operator",
      "^": "operator",
      "&": "operator",
      "=": "operator",
      "<": "operator",
      ">": "operator",
      "(": "left-paren",
      ")": "right-paren",
      ",": "comma",
      ":": "colon",
    };
    const tokenType = simpleTokens[character];
    if (!tokenType) throw new SyntaxError(`Unexpected character '${character}' at ${position + 1}`);
    tokens.push({ type: tokenType, text: character, position });
    position += 1;
  }

  tokens.push({ type: "eof", text: "", position });
  return tokens;
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const expression = this.parseComparison();
    this.expect("eof");
    return expression;
  }

  private current(): Token {
    return this.tokens[this.index];
  }

  private take(): Token {
    const token = this.current();
    this.index += 1;
    return token;
  }

  private match(type: TokenType, text?: string): boolean {
    const token = this.current();
    if (token.type !== type || (text !== undefined && token.text !== text)) return false;
    this.index += 1;
    return true;
  }

  private expect(type: TokenType, text?: string): Token {
    const token = this.current();
    if (!this.match(type, text)) {
      throw new SyntaxError(`Expected ${text ?? type} at ${token.position + 1}`);
    }
    return token;
  }

  private parseComparison(): FormulaNode {
    let left = this.parseConcatenation();
    while (
      this.current().type === "operator"
      && ["=", "<>", "<", ">", "<=", ">="].includes(this.current().text)
    ) {
      const operator = this.take().text as BinaryNode["operator"];
      left = { type: "binary", operator, left, right: this.parseConcatenation() };
    }
    return left;
  }

  private parseConcatenation(): FormulaNode {
    let left = this.parseAdditive();
    while (this.match("operator", "&")) {
      left = { type: "binary", operator: "&", left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): FormulaNode {
    let left = this.parseMultiplicative();
    while (
      this.current().type === "operator"
      && (this.current().text === "+" || this.current().text === "-")
    ) {
      const operator = this.take().text as "+" | "-";
      left = { type: "binary", operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): FormulaNode {
    let left = this.parseUnary();
    while (
      this.current().type === "operator"
      && (this.current().text === "*" || this.current().text === "/")
    ) {
      const operator = this.take().text as "*" | "/";
      left = { type: "binary", operator, left, right: this.parseUnary() };
    }
    return left;
  }

  private parsePower(): FormulaNode {
    const left = this.parsePrimary();
    if (!this.match("operator", "^")) return left;
    return { type: "binary", operator: "^", left, right: this.parseUnary() };
  }

  private parseUnary(): FormulaNode {
    if (
      this.current().type === "operator"
      && (this.current().text === "+" || this.current().text === "-")
    ) {
      const operator = this.take().text as "+" | "-";
      return { type: "unary", operator, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePrimary(): FormulaNode {
    const token = this.current();
    if (this.match("number")) return { type: "number", value: Number(token.text) };
    if (this.match("string")) return { type: "string", value: token.text };
    if (this.match("error")) return { type: "error", value: token.text as FormulaError };

    if (this.match("cell")) {
      const start = token.text;
      if (!this.match("colon")) return { type: "cell", address: start };
      return { type: "range", start, end: this.expect("cell").text };
    }

    if (this.match("identifier")) {
      if (token.text === "TRUE" || token.text === "FALSE") {
        return { type: "boolean", value: token.text === "TRUE" };
      }
      if (!this.match("left-paren")) return { type: "error", value: "#NAME?" };
      const args: FormulaNode[] = [];
      if (!this.match("right-paren")) {
        do {
          args.push(this.parseComparison());
        } while (this.match("comma"));
        this.expect("right-paren");
      }
      return { type: "call", name: token.text, arguments: args };
    }

    if (this.match("left-paren")) {
      const expression = this.parseComparison();
      this.expect("right-paren");
      return expression;
    }

    throw new SyntaxError(`Expected expression at ${token.position + 1}`);
  }
}

function parseFormula(formula: string): FormulaNode {
  const source = formula.startsWith("=") ? formula.slice(1) : formula;
  if (!source.trim()) throw new SyntaxError("Formula is empty");
  return new FormulaParser(tokenize(source)).parse();
}

function asScalar(value: EvaluatedValue): FormulaValue {
  return Array.isArray(value) ? "#VALUE!" : value;
}

function asNumber(value: FormulaValue): number | FormulaError {
  if (isFormulaError(value)) return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "#VALUE!";
}

function isTruthy(value: FormulaValue): boolean | FormulaError {
  if (isFormulaError(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function flatten(values: EvaluatedValue[]): FormulaValue[] {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]);
}

function asText(value: FormulaValue): string | FormulaError {
  if (isFormulaError(value)) return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function roundWithMode(value: number, digits: number, mode: "nearest" | "up" | "down"): number {
  const factor = 10 ** Math.trunc(digits);
  const scaled = value * factor;
  if (mode === "nearest") return Math.round(scaled + Number.EPSILON) / factor;
  if (mode === "up") return (scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
  return (scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
}

class SheetCalculator {
  private readonly cache = new Map<string, FormulaValue>();
  private readonly visiting = new Set<string>();

  constructor(private readonly sheet: SpreadsheetSheet) {}

  calculateAll(): Record<string, FormulaValue> {
    const result: Record<string, FormulaValue> = {};
    for (const address of Object.keys(this.sheet.cells)) {
      result[address] = this.calculateCell(address);
    }
    return result;
  }

  calculateCell(address: string): FormulaValue {
    const normalized = normalizeAddress(address);
    const cached = this.cache.get(normalized);
    if (cached !== undefined) return cached;
    if (this.visiting.has(normalized)) return "#CYCLE!";

    const cell = this.sheet.cells[normalized];
    if (!cell) return null;
    if (!cell.formula) return cell.value;

    this.visiting.add(normalized);
    let value: FormulaValue;
    try {
      value = asScalar(this.evaluate(parseFormula(cell.formula)));
    } catch {
      value = "#ERROR!";
    }
    this.visiting.delete(normalized);
    this.cache.set(normalized, value);
    return value;
  }

  private evaluate(node: FormulaNode): EvaluatedValue {
    if (node.type === "number" || node.type === "string" || node.type === "boolean" || node.type === "error") {
      return node.value;
    }
    if (node.type === "cell") return this.calculateCell(node.address);
    if (node.type === "range") return this.evaluateRange(node.start, node.end);
    if (node.type === "unary") {
      const number = asNumber(asScalar(this.evaluate(node.operand)));
      if (isFormulaError(number)) return number;
      return node.operator === "-" ? -number : number;
    }
    if (node.type === "binary") return this.evaluateBinary(node);
    return this.evaluateCall(node);
  }

  private evaluateRange(startAddress: string, endAddress: string): FormulaValue[] {
    const start = parseAddress(startAddress);
    const end = parseAddress(endAddress);
    if (!start || !end) return ["#REF!"];
    const values: FormulaValue[] = [];
    const firstColumn = Math.min(start.column, end.column);
    const lastColumn = Math.max(start.column, end.column);
    const firstRow = Math.min(start.row, end.row);
    const lastRow = Math.max(start.row, end.row);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        values.push(this.calculateCell(`${columnIndexToLabel(column)}${row}`));
      }
    }
    return values;
  }

  private evaluateBinary(node: BinaryNode): FormulaValue {
    const left = asScalar(this.evaluate(node.left));
    if (isFormulaError(left)) return left;
    const right = asScalar(this.evaluate(node.right));
    if (isFormulaError(right)) return right;

    if (node.operator === "&") return `${left ?? ""}${right ?? ""}`;
    if (["=", "<>", "<", ">", "<=", ">="].includes(node.operator)) {
      if (node.operator === "=") return left === right;
      if (node.operator === "<>") return left !== right;
      const leftNumber = asNumber(left);
      const rightNumber = asNumber(right);
      if (isFormulaError(leftNumber)) return leftNumber;
      if (isFormulaError(rightNumber)) return rightNumber;
      if (node.operator === "<") return leftNumber < rightNumber;
      if (node.operator === ">") return leftNumber > rightNumber;
      if (node.operator === "<=") return leftNumber <= rightNumber;
      return leftNumber >= rightNumber;
    }

    const leftNumber = asNumber(left);
    const rightNumber = asNumber(right);
    if (isFormulaError(leftNumber)) return leftNumber;
    if (isFormulaError(rightNumber)) return rightNumber;
    if (node.operator === "+") return leftNumber + rightNumber;
    if (node.operator === "-") return leftNumber - rightNumber;
    if (node.operator === "*") return leftNumber * rightNumber;
    if (node.operator === "/") return rightNumber === 0 ? "#DIV/0!" : leftNumber / rightNumber;
    return leftNumber ** rightNumber;
  }

  private asGrid(node: FormulaNode): FormulaValue[][] {
    if (node.type === "range") return this.evaluateRangeGrid(node.start, node.end);
    if (node.type === "cell") return [[this.calculateCell(node.address)]];
    const evaluated = this.evaluate(node);
    if (Array.isArray(evaluated)) return [evaluated];
    return [[evaluated]];
  }

  private evaluateRangeGrid(startAddress: string, endAddress: string): FormulaValue[][] {
    const start = parseAddress(startAddress);
    const end = parseAddress(endAddress);
    if (!start || !end) return [["#REF!"]];
    const grid: FormulaValue[][] = [];
    const firstColumn = Math.min(start.column, end.column);
    const lastColumn = Math.max(start.column, end.column);
    const firstRow = Math.min(start.row, end.row);
    const lastRow = Math.max(start.row, end.row);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowValues: FormulaValue[] = [];
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        rowValues.push(this.calculateCell(`${columnIndexToLabel(column)}${row}`));
      }
      grid.push(rowValues);
    }
    return grid;
  }

  private evaluateCall(node: CallNode): FormulaValue {
    const name = node.name.toUpperCase();

    // Lazy / Special conditional evaluation
    if (name === "IF") {
      if (node.arguments.length < 2 || node.arguments.length > 3) return "#VALUE!";
      const condition = isTruthy(asScalar(this.evaluate(node.arguments[0])));
      if (isFormulaError(condition)) return condition;
      const branch = condition ? node.arguments[1] : node.arguments[2];
      return branch ? asScalar(this.evaluate(branch)) : false;
    }

    if (name === "IFERROR") {
      if (node.arguments.length !== 2) return "#VALUE!";
      try {
        const value = asScalar(this.evaluate(node.arguments[0]));
        if (isFormulaError(value)) return asScalar(this.evaluate(node.arguments[1]));
        return value;
      } catch {
        return asScalar(this.evaluate(node.arguments[1]));
      }
    }

    if (name === "IFNA") {
      if (node.arguments.length !== 2) return "#VALUE!";
      const value = asScalar(this.evaluate(node.arguments[0]));
      if (value === "#REF!" || value === "#VALUE!") return asScalar(this.evaluate(node.arguments[1]));
      return value;
    }

    if (name === "IFS") {
      if (node.arguments.length < 2 || node.arguments.length % 2 !== 0) return "#VALUE!";
      for (let i = 0; i < node.arguments.length; i += 2) {
        const condition = isTruthy(asScalar(this.evaluate(node.arguments[i])));
        if (isFormulaError(condition)) return condition;
        if (condition) return asScalar(this.evaluate(node.arguments[i + 1]));
      }
      return "#VALUE!";
    }

    if (name === "SWITCH") {
      if (node.arguments.length < 3) return "#VALUE!";
      const target = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(target)) return target;
      for (let i = 1; i < node.arguments.length - 1; i += 2) {
        const val = asScalar(this.evaluate(node.arguments[i]));
        if (val === target) return asScalar(this.evaluate(node.arguments[i + 1]));
      }
      // Odd number of remaining args has default
      if ((node.arguments.length - 1) % 2 === 1) {
        return asScalar(this.evaluate(node.arguments.at(-1)!));
      }
      return "#VALUE!";
    }

    if (name === "AND" || name === "OR") {
      const values = flatten(node.arguments.map((argument) => this.evaluate(argument)));
      const booleans: boolean[] = [];
      for (const value of values) {
        const truthy = isTruthy(value);
        if (isFormulaError(truthy)) return truthy;
        booleans.push(truthy);
      }
      return name === "AND" ? booleans.every(Boolean) : booleans.some(Boolean);
    }

    if (name === "NOT") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const truthy = isTruthy(asScalar(this.evaluate(node.arguments[0])));
      return isFormulaError(truthy) ? truthy : !truthy;
    }

    // Information functions
    if (name === "ISBLANK") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const val = asScalar(this.evaluate(node.arguments[0]));
      return val === null || val === "";
    }

    if (name === "ISNUMBER") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const val = asScalar(this.evaluate(node.arguments[0]));
      return typeof val === "number";
    }

    if (name === "ISTEXT") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const val = asScalar(this.evaluate(node.arguments[0]));
      return typeof val === "string" && !isFormulaError(val);
    }

    if (name === "ISERROR") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const val = asScalar(this.evaluate(node.arguments[0]));
      return isFormulaError(val);
    }

    // Lookup & Reference functions
    if (name === "ROW") {
      if (node.arguments.length === 0) return 1;
      const firstArg = node.arguments[0];
      if (firstArg.type === "cell") {
        const pos = parseAddress(firstArg.address);
        return pos ? pos.row : "#REF!";
      }
      if (firstArg.type === "range") {
        const pos = parseAddress(firstArg.start);
        return pos ? pos.row : "#REF!";
      }
      return 1;
    }

    if (name === "COLUMN") {
      if (node.arguments.length === 0) return 1;
      const firstArg = node.arguments[0];
      if (firstArg.type === "cell") {
        const pos = parseAddress(firstArg.address);
        return pos ? pos.column : "#REF!";
      }
      if (firstArg.type === "range") {
        const pos = parseAddress(firstArg.start);
        return pos ? pos.column : "#REF!";
      }
      return 1;
    }

    if (name === "CHOOSE") {
      if (node.arguments.length < 2) return "#VALUE!";
      const indexNum = asNumber(asScalar(this.evaluate(node.arguments[0])));
      if (isFormulaError(indexNum)) return indexNum;
      const idx = Math.trunc(indexNum);
      if (idx < 1 || idx >= node.arguments.length) return "#VALUE!";
      return asScalar(this.evaluate(node.arguments[idx]));
    }

    if (name === "INDEX") {
      if (node.arguments.length < 2 || node.arguments.length > 3) return "#VALUE!";
      const grid = this.asGrid(node.arguments[0]);
      const rowNum = asNumber(asScalar(this.evaluate(node.arguments[1])));
      if (isFormulaError(rowNum)) return rowNum;
      const colNum = node.arguments[2] ? asNumber(asScalar(this.evaluate(node.arguments[2]))) : 1;
      if (isFormulaError(colNum)) return colNum;
      const r = Math.trunc(rowNum) - 1;
      const c = Math.trunc(colNum) - 1;
      if (r < 0 || r >= grid.length || c < 0 || c >= (grid[r]?.length ?? 0)) return "#REF!";
      return grid[r][c];
    }

    if (name === "MATCH") {
      if (node.arguments.length < 2 || node.arguments.length > 3) return "#VALUE!";
      const target = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(target)) return target;
      const grid = this.asGrid(node.arguments[1]);
      const items = flatten(grid);
      const index = items.findIndex((item) => {
        if (typeof target === "number" && typeof item === "number") return target === item;
        return String(item ?? "").toLowerCase() === String(target ?? "").toLowerCase();
      });
      return index >= 0 ? index + 1 : "#REF!";
    }

    if (name === "VLOOKUP") {
      if (node.arguments.length < 3 || node.arguments.length > 4) return "#VALUE!";
      const target = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(target)) return target;
      const grid = this.asGrid(node.arguments[1]);
      const colIndex = asNumber(asScalar(this.evaluate(node.arguments[2])));
      if (isFormulaError(colIndex)) return colIndex;
      const cIdx = Math.trunc(colIndex) - 1;
      if (cIdx < 0) return "#REF!";

      for (const row of grid) {
        const first = row[0];
        const match = typeof target === "number" && typeof first === "number"
          ? target === first
          : String(first ?? "").toLowerCase() === String(target ?? "").toLowerCase();
        if (match) {
          return cIdx < row.length ? row[cIdx] : "#REF!";
        }
      }
      return "#REF!";
    }

    if (name === "HLOOKUP") {
      if (node.arguments.length < 3 || node.arguments.length > 4) return "#VALUE!";
      const target = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(target)) return target;
      const grid = this.asGrid(node.arguments[1]);
      const rowIndex = asNumber(asScalar(this.evaluate(node.arguments[2])));
      if (isFormulaError(rowIndex)) return rowIndex;
      const rIdx = Math.trunc(rowIndex) - 1;
      if (rIdx < 0 || rIdx >= grid.length) return "#REF!";

      const firstRow = grid[0] ?? [];
      for (let col = 0; col < firstRow.length; col += 1) {
        const val = firstRow[col];
        const match = typeof target === "number" && typeof val === "number"
          ? target === val
          : String(val ?? "").toLowerCase() === String(target ?? "").toLowerCase();
        if (match) {
          return grid[rIdx][col] ?? "#REF!";
        }
      }
      return "#REF!";
    }

    // Criteria Math functions (SUMIF, COUNTIF, AVERAGEIF)
    if (name === "SUMIF" || name === "COUNTIF" || name === "AVERAGEIF") {
      if (node.arguments.length < 2) return "#VALUE!";
      const checkGrid = this.asGrid(node.arguments[0]);
      const checkItems = flatten(checkGrid);
      const criteria = asScalar(this.evaluate(node.arguments[1]));
      if (isFormulaError(criteria)) return criteria;

      const sumItems = node.arguments[2]
        ? flatten(this.asGrid(node.arguments[2]))
        : checkItems;

      let sum = 0;
      let count = 0;
      for (let i = 0; i < checkItems.length; i += 1) {
        const cell = checkItems[i];
        const critStr = String(criteria ?? "").trim();
        let matches = false;
        const opMatch = critStr.match(/^([<>=!]+)\s*(.*)$/);
        if (opMatch) {
          const op = opMatch[1];
          const targetNum = Number(opMatch[2]);
          const cellNum = typeof cell === "number" ? cell : Number(cell);
          if (!Number.isNaN(targetNum) && !Number.isNaN(cellNum)) {
            if (op === ">") matches = cellNum > targetNum;
            else if (op === ">=") matches = cellNum >= targetNum;
            else if (op === "<") matches = cellNum < targetNum;
            else if (op === "<=") matches = cellNum <= targetNum;
            else if (op === "=" || op === "==") matches = cellNum === targetNum;
            else if (op === "<>" || op === "!=") matches = cellNum !== targetNum;
          } else {
            const cellStr = String(cell ?? "").toLowerCase();
            const targetStr = opMatch[2].toLowerCase();
            if (op === "=" || op === "==") matches = cellStr === targetStr;
            else if (op === "<>" || op === "!=") matches = cellStr !== targetStr;
          }
        } else {
          matches = typeof criteria === "number"
            ? Number(cell) === criteria
            : String(cell ?? "").toLowerCase() === critStr.toLowerCase();
        }

        if (matches) {
          count += 1;
          const valNum = Number(sumItems[i]);
          if (!Number.isNaN(valNum)) sum += valNum;
        }
      }

      if (name === "COUNTIF") return count;
      if (name === "SUMIF") return sum;
      return count === 0 ? "#DIV/0!" : sum / count;
    }

    // Date / Time functions
    if (name === "DATE") {
      if (node.arguments.length !== 3) return "#VALUE!";
      const y = asNumber(asScalar(this.evaluate(node.arguments[0])));
      const m = asNumber(asScalar(this.evaluate(node.arguments[1])));
      const d = asNumber(asScalar(this.evaluate(node.arguments[2])));
      if (isFormulaError(y) || isFormulaError(m) || isFormulaError(d)) return "#VALUE!";
      const year = Math.trunc(y);
      const month = Math.trunc(m);
      const day = Math.trunc(d);
      const date = new Date(year, month - 1, day);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    if (name === "TODAY") {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    if (name === "NOW") {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    }

    if (name === "YEAR" || name === "MONTH" || name === "DAY") {
      if (node.arguments.length !== 1) return "#VALUE!";
      const raw = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(raw)) return raw;
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) return "#VALUE!";
      if (name === "YEAR") return date.getFullYear();
      if (name === "MONTH") return date.getMonth() + 1;
      return date.getDate();
    }

    if (name === "WEEKDAY") {
      if (node.arguments.length < 1 || node.arguments.length > 2) return "#VALUE!";
      const raw = asScalar(this.evaluate(node.arguments[0]));
      if (isFormulaError(raw)) return raw;
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) return "#VALUE!";
      const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
      const returnType = node.arguments[1] ? asNumber(asScalar(this.evaluate(node.arguments[1]))) : 1;
      if (returnType === 2) return dayOfWeek === 0 ? 7 : dayOfWeek; // 1 = Mon, 7 = Sun
      return dayOfWeek + 1; // 1 = Sun, 7 = Sat
    }

    const values = flatten(node.arguments.map((argument) => this.evaluate(argument)));
    const firstError = values.find(isFormulaError);
    if (firstError) return firstError;
    const numbers = values.filter((value): value is number => typeof value === "number");

    if (name === "SUM") return numbers.reduce((sum, value) => sum + value, 0);
    if (name === "PRODUCT") return numbers.length === 0 ? 0 : numbers.reduce((prod, value) => prod * value, 1);
    if (name === "COUNT") return numbers.length;
    if (name === "COUNTA") return values.filter((value) => value !== null && value !== "").length;
    if (name === "AVERAGE") {
      return numbers.length === 0
        ? "#DIV/0!"
        : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }
    if (name === "MIN") return numbers.length === 0 ? 0 : Math.min(...numbers);
    if (name === "MAX") return numbers.length === 0 ? 0 : Math.max(...numbers);
    if (name === "ABS") {
      const number = asNumber(values[0] ?? null);
      return values.length !== 1 || isFormulaError(number) ? "#VALUE!" : Math.abs(number);
    }
    if (name === "POWER") {
      if (values.length !== 2) return "#VALUE!";
      const base = asNumber(values[0]);
      const exp = asNumber(values[1]);
      if (isFormulaError(base) || isFormulaError(exp)) return "#VALUE!";
      return base ** exp;
    }
    if (name === "SQRT") {
      if (values.length !== 1) return "#VALUE!";
      const num = asNumber(values[0]);
      if (isFormulaError(num) || num < 0) return "#VALUE!";
      return Math.sqrt(num);
    }
    if (name === "MOD") {
      if (values.length !== 2) return "#VALUE!";
      const num = asNumber(values[0]);
      const divisor = asNumber(values[1]);
      if (isFormulaError(num) || isFormulaError(divisor)) return "#VALUE!";
      if (divisor === 0) return "#DIV/0!";
      return num % divisor;
    }
    if (name === "INT") {
      if (values.length !== 1) return "#VALUE!";
      const num = asNumber(values[0]);
      if (isFormulaError(num)) return num;
      return Math.floor(num);
    }
    if (name === "TRUNC") {
      if (values.length < 1 || values.length > 2) return "#VALUE!";
      const num = asNumber(values[0]);
      const digits = values[1] ? asNumber(values[1]) : 0;
      if (isFormulaError(num) || isFormulaError(digits)) return "#VALUE!";
      return roundWithMode(num, digits, "down");
    }
    if (["ROUND", "ROUNDUP", "ROUNDDOWN"].includes(name)) {
      if (values.length < 1 || values.length > 2) return "#VALUE!";
      const number = asNumber(values[0] ?? null);
      const digits = asNumber(values[1] ?? 0);
      if (isFormulaError(number)) return number;
      if (isFormulaError(digits)) return digits;
      const mode = name === "ROUND" ? "nearest" : name === "ROUNDUP" ? "up" : "down";
      return roundWithMode(number, digits, mode);
    }

    // Text functions
    if (name === "CONCAT" || name === "CONCATENATE") {
      const text: string[] = [];
      for (const value of values) {
        const part = asText(value);
        if (isFormulaError(part)) return part;
        text.push(part);
      }
      return text.join("");
    }
    if (name === "TRIM") {
      if (values.length !== 1) return "#VALUE!";
      const text = asText(values[0]);
      return isFormulaError(text) ? text : text.trim().replace(/\s+/g, " ");
    }
    if (name === "EXACT") {
      if (values.length !== 2) return "#VALUE!";
      const t1 = asText(values[0]);
      const t2 = asText(values[1]);
      if (isFormulaError(t1) || isFormulaError(t2)) return "#VALUE!";
      return t1 === t2;
    }
    if (name === "REPT") {
      if (values.length !== 2) return "#VALUE!";
      const text = asText(values[0]);
      const count = asNumber(values[1]);
      if (isFormulaError(text) || isFormulaError(count)) return "#VALUE!";
      return text.repeat(Math.max(0, Math.trunc(count)));
    }
    if (name === "FIND" || name === "SEARCH") {
      if (values.length < 2 || values.length > 3) return "#VALUE!";
      const findText = asText(values[0]);
      const withinText = asText(values[1]);
      const start = values[2] ? asNumber(values[2]) : 1;
      if (isFormulaError(findText) || isFormulaError(withinText) || isFormulaError(start)) return "#VALUE!";
      const startIdx = Math.max(0, Math.trunc(start) - 1);
      const pos = name === "FIND"
        ? withinText.indexOf(findText, startIdx)
        : withinText.toLowerCase().indexOf(findText.toLowerCase(), startIdx);
      return pos >= 0 ? pos + 1 : "#VALUE!";
    }
    if (name === "SUBSTITUTE") {
      if (values.length < 3 || values.length > 4) return "#VALUE!";
      const text = asText(values[0]);
      const oldText = asText(values[1]);
      const newText = asText(values[2]);
      if (isFormulaError(text) || isFormulaError(oldText) || isFormulaError(newText)) return "#VALUE!";
      if (values[3] !== undefined) {
        const instanceValue = asNumber(values[3]);
        if (isFormulaError(instanceValue)) return instanceValue;
        const instance = Math.trunc(instanceValue);
        let count = 0;
        return text.replace(new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (match) => {
          count += 1;
          return count === instance ? newText : match;
        });
      }
      return text.replaceAll(oldText, newText);
    }
    if (name === "TEXT") {
      if (values.length !== 2) return "#VALUE!";
      const val = values[0];
      const fmt = asText(values[1]);
      if (isFormulaError(fmt)) return fmt;
      const num = asNumber(val);
      if (!isFormulaError(num)) {
        if (fmt.includes("%")) return `${(num * 100).toFixed(0)}%`;
        if (fmt.includes("#,##0.00")) return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (fmt.includes("#,##0")) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (fmt.includes("0.00")) return num.toFixed(2);
        return String(num);
      }
      return String(val ?? "");
    }
    if (["LEN", "LOWER", "UPPER", "LEFT", "RIGHT", "MID"].includes(name)) {
      const text = asText(values[0] ?? null);
      if (isFormulaError(text)) return text;
      if (name === "LEN") return values.length === 1 ? text.length : "#VALUE!";
      if (name === "LOWER") return values.length === 1 ? text.toLowerCase() : "#VALUE!";
      if (name === "UPPER") return values.length === 1 ? text.toUpperCase() : "#VALUE!";
      const count = asNumber(values[1] ?? 1);
      if (isFormulaError(count)) return count;
      if (name === "LEFT") return values.length <= 2 ? text.slice(0, Math.max(0, Math.trunc(count))) : "#VALUE!";
      if (name === "RIGHT") return values.length <= 2 ? text.slice(-Math.max(0, Math.trunc(count))) : "#VALUE!";
      if (values.length !== 3) return "#VALUE!";
      const length = asNumber(values[2]);
      if (isFormulaError(length)) return length;
      return text.slice(Math.max(0, Math.trunc(count) - 1), Math.max(0, Math.trunc(count) - 1) + Math.max(0, Math.trunc(length)));
    }
    return "#NAME?";
  }
}

export function calculateSheet(sheet: SpreadsheetSheet): Record<string, FormulaValue> {
  return new SheetCalculator(sheet).calculateAll();
}

export function calculateCell(sheet: SpreadsheetSheet, address: string): FormulaValue {
  return new SheetCalculator(sheet).calculateCell(address);
}

export function validateFormula(formula: string): string | null {
  try {
    parseFormula(formula);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid formula";
  }
}

export function isCalculatedError(value: FormulaValue): value is FormulaError {
  return isFormulaError(value);
}
