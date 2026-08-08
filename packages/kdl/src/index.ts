export type KdlPrimitive = string | number | boolean | null;

export interface KdlNode {
  name: string;
  arguments: KdlPrimitive[];
  properties: Record<string, KdlPrimitive>;
  children: KdlNode[];
  line: number;
}

export interface KdlDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface KdlParseResult {
  nodes: KdlNode[];
  diagnostics: KdlDiagnostic[];
}

const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|#[a-z]+|-?\d+(?:\.\d+)?|[A-Za-z_][\w-]*|\{|\}|=/g;

function parsePrimitive(token: string): KdlPrimitive {
  if (token.startsWith('"')) {
    return JSON.parse(token) as string;
  }
  if (token === "#true") return true;
  if (token === "#false") return false;
  if (token === "#null") return null;
  if (/^-?\d/.test(token)) return Number(token);
  return token;
}

/**
 * MVP向けの小さなKDL 2 subset parser。
 * ASTを明示的に返すため、後で完全parserへ置換しても上位層の契約は変わらない。
 */
export function parseKdl(source: string): KdlParseResult {
  const diagnostics: KdlDiagnostic[] = [];
  const root: KdlNode = {
    name: "$root",
    arguments: [],
    properties: {},
    children: [],
    line: 0,
  };
  const stack = [root];

  for (const [lineIndex, rawLine] of source.split("\n").entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    if (line === "}") {
      if (stack.length === 1) {
        diagnostics.push({ line: lineNumber, column: 1, message: "Unexpected closing brace" });
      } else {
        stack.pop();
      }
      continue;
    }

    const tokens = line.match(TOKEN_PATTERN) ?? [];
    if (tokens.length === 0) continue;

    const nodeName = tokens.shift();
    if (!nodeName || nodeName === "{" || nodeName === "}") {
      diagnostics.push({ line: lineNumber, column: 1, message: "Expected node name" });
      continue;
    }

    const node: KdlNode = {
      name: nodeName,
      arguments: [],
      properties: {},
      children: [],
      line: lineNumber,
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "{") continue;
      const maybeEquals = tokens[index + 1];
      const propertyValue = tokens[index + 2];
      if (maybeEquals === "=" && propertyValue && propertyValue !== "{") {
        node.properties[token] = parsePrimitive(propertyValue);
        index += 2;
      } else {
        node.arguments.push(parsePrimitive(token));
      }
    }

    stack.at(-1)?.children.push(node);
    if (line.endsWith("{")) stack.push(node);
  }

  if (stack.length > 1) {
    diagnostics.push({
      line: source.split("\n").length,
      column: 1,
      message: `${stack.length - 1} unclosed block(s)`,
    });
  }

  return { nodes: root.children, diagnostics };
}

export function findKdlChildren(node: KdlNode, name: string): KdlNode[] {
  return node.children.filter((child) => child.name === name);
}
