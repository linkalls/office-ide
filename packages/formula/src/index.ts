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
    while (["=", "<>", "<", ">", "<=", ">="].includes(this.current().text)) {
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
    while (this.current().text === "+" || this.current().text === "-") {
      const operator = this.take().text as "+" | "-";
      left = { type: "binary", operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): FormulaNode {
    let left = this.parseUnary();
    while (this.current().text === "*" || this.current().text === "/") {
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
    if (this.current().text === "+" || this.current().text === "-") {
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

  private evaluateCall(node: CallNode): FormulaValue {
    if (node.name === "IF") {
      if (node.arguments.length < 2 || node.arguments.length > 3) return "#VALUE!";
      const condition = isTruthy(asScalar(this.evaluate(node.arguments[0])));
      if (isFormulaError(condition)) return condition;
      const branch = condition ? node.arguments[1] : node.arguments[2];
      return branch ? asScalar(this.evaluate(branch)) : false;
    }

    const values = flatten(node.arguments.map((argument) => this.evaluate(argument)));
    const firstError = values.find(isFormulaError);
    if (firstError) return firstError;
    const numbers = values
      .filter((value): value is number => typeof value === "number");

    if (node.name === "SUM") return numbers.reduce((sum, value) => sum + value, 0);
    if (node.name === "COUNT") return numbers.length;
    if (node.name === "AVERAGE") {
      return numbers.length === 0
        ? "#DIV/0!"
        : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }
    if (node.name === "MIN") return numbers.length === 0 ? 0 : Math.min(...numbers);
    if (node.name === "MAX") return numbers.length === 0 ? 0 : Math.max(...numbers);
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
