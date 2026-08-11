export type BlockId = string;

export interface BaseBlock {
  id: BlockId;
  type: string;
}

export interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  text: string;
  align?: "left" | "center" | "right" | "justify";
  styleId?: string;
}

export interface HeadingBlock extends BaseBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  styleId?: string;
}

export interface TableBlock extends BaseBlock {
  type: "table";
  headers: string[];
  rows: string[][];
  alignments?: Array<"left" | "center" | "right">;
}

export interface ImageBlock extends BaseBlock {
  type: "image";
  src: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface QuoteBlock extends BaseBlock {
  type: "quote";
  text: string;
  attribution?: string;
}

export interface ListBlock extends BaseBlock {
  type: "list";
  ordered: boolean;
  items: string[];
}

export interface PageBreakBlock extends BaseBlock {
  type: "page-break";
}

export interface GenericContainerBlock extends BaseBlock {
  type: "container";
  name: string;
  content: string;
  attributes?: Record<string, string>;
}

export type DocumentBlock =
  | ParagraphBlock
  | HeadingBlock
  | TableBlock
  | ImageBlock
  | QuoteBlock
  | ListBlock
  | PageBreakBlock
  | GenericContainerBlock;

export interface DocumentSection {
  id: string;
  title: string;
  blockIds: BlockId[];
}

export interface DocumentStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  lineHeight?: number;
  spacingBefore?: number;
  spacingAfter?: number;
}

export interface DocumentComment {
  id: string;
  blockId?: string;
  text: string;
  author: string;
  createdAt: number;
  resolved: boolean;
}

export interface Footnote {
  id: string;
  label: string;
  text: string;
}

export interface DocumentPageMargins {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

export interface DocumentHeaderFooter {
  text?: string;
  align?: "left" | "center" | "right";
  showPageNumber?: boolean;
}

export interface DocumentLayout {
  version: 1;
  pageSize: "A4" | "A3" | "A5" | "Letter" | "Legal";
  margins: DocumentPageMargins;
  header?: DocumentHeaderFooter;
  footer?: DocumentHeaderFooter;
  styles: Record<string, DocumentStyle>;
}

export interface DocumentModel {
  id: string;
  title: string;
  blocks: DocumentBlock[];
  layout: DocumentLayout;
  styles: Record<string, DocumentStyle>;
  sections: DocumentSection[];
  comments: DocumentComment[];
  footnotes: Footnote[];
  metadata: Record<string, unknown>;
}

export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  version: 1,
  pageSize: "A4",
  margins: {
    top: "25mm",
    bottom: "25mm",
    left: "25mm",
    right: "25mm",
  },
  header: {
    align: "right",
    text: "",
  },
  footer: {
    align: "center",
    showPageNumber: true,
  },
  styles: {
    body: {
      fontFamily: "Noto Serif JP",
      fontSize: 11,
      lineHeight: 1.6,
    },
    "heading-1": {
      fontFamily: "Noto Sans JP",
      fontSize: 20,
      bold: true,
      spacingBefore: 18,
      spacingAfter: 10,
    },
    "heading-2": {
      fontFamily: "Noto Sans JP",
      fontSize: 15,
      bold: true,
      spacingBefore: 14,
      spacingAfter: 8,
    },
  },
};

let blockSequence = 0;

export function generateBlockId(prefix = "block"): string {
  blockSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${blockSequence.toString(36)}`;
}

export function createEmptyDocument(id = "report", title = "Untitled Document"): DocumentModel {
  return {
    id,
    title,
    blocks: [
      {
        id: generateBlockId("heading"),
        type: "heading",
        level: 1,
        text: title,
      },
      {
        id: generateBlockId("para"),
        type: "paragraph",
        text: "",
      },
    ],
    layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT),
    styles: structuredClone(DEFAULT_DOCUMENT_LAYOUT.styles),
    sections: [],
    comments: [],
    footnotes: [],
    metadata: {},
  };
}

/**
 * Parses Djot-like Markdown source text into a structured DocumentModel with stable block IDs.
 */
export function parseDjotSource(source: string, id = "doc", layout?: DocumentLayout): DocumentModel {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: DocumentBlock[] = [];
  const footnotes: Footnote[] = [];
  let index = 0;
  let title = "Document";

  while (index < lines.length) {
    const line = lines[index];

    // Blank line
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Footnote definition: [^source]: footnote text
    const footnoteMatch = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
    if (footnoteMatch) {
      footnotes.push({
        id: `fn_${footnoteMatch[1]}`,
        label: footnoteMatch[1],
        text: footnoteMatch[2],
      });
      index += 1;
      continue;
    }

    // Heading: # Heading 1, ## Heading 2, etc.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = headingMatch[2].trim();
      if (level === 1 && blocks.length === 0) {
        title = text;
      }
      blocks.push({
        id: generateBlockId("heading"),
        type: "heading",
        level,
        text,
        styleId: `heading-${level}`,
      });
      index += 1;
      continue;
    }

    // Page break: --- or *** or ===
    if (/^(?:-{3,}|\*{3,}|={3,})$/.test(line.trim())) {
      blocks.push({
        id: generateBlockId("pb"),
        type: "page-break",
      });
      index += 1;
      continue;
    }

    // Blockquote: > text
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({
        id: generateBlockId("quote"),
        type: "quote",
        text: quoteLines.join("\n").trim(),
      });
      continue;
    }

    // Table: | col1 | col2 |
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const headerLine = line;
      const headers = headerLine
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      index += 1;

      let alignments: Array<"left" | "center" | "right"> | undefined;
      if (index < lines.length && lines[index].includes("---")) {
        const alignLine = lines[index];
        alignments = alignLine
          .split("|")
          .slice(1, -1)
          .map((cell) => {
            const trimmed = cell.trim();
            const startColon = trimmed.startsWith(":");
            const endColon = trimmed.endsWith(":");
            if (startColon && endColon) return "center";
            if (endColon) return "right";
            return "left";
          });
        index += 1;
      }

      const rows: string[][] = [];
      while (
        index < lines.length &&
        lines[index].trim().startsWith("|") &&
        lines[index].trim().endsWith("|")
      ) {
        const rowCells = lines[index]
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        rows.push(rowCells);
        index += 1;
      }

      blocks.push({
        id: generateBlockId("table"),
        type: "table",
        headers,
        rows,
        alignments,
      });
      continue;
    }

    // Ordered list: 1. item
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, "").trim());
        index += 1;
      }
      blocks.push({
        id: generateBlockId("list"),
        type: "list",
        ordered: true,
        items,
      });
      continue;
    }

    // Unordered list: - item or * item
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push({
        id: generateBlockId("list"),
        type: "list",
        ordered: false,
        items,
      });
      continue;
    }

    // Image: ![alt](src "caption")
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/);
    if (imgMatch) {
      blocks.push({
        id: generateBlockId("image"),
        type: "image",
        alt: imgMatch[1],
        src: imgMatch[2],
        caption: imgMatch[3],
      });
      index += 1;
      continue;
    }

    // Regular Paragraph
    const paraLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("#") &&
      !lines[index].startsWith(">") &&
      !lines[index].trim().startsWith("|") &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !lines[index].startsWith("![") &&
      !line.match(/^\[\^([^\]]+)\]:/)
    ) {
      paraLines.push(lines[index]);
      index += 1;
    }

    if (paraLines.length > 0) {
      blocks.push({
        id: generateBlockId("para"),
        type: "paragraph",
        text: paraLines.join("\n"),
        styleId: "body",
      });
    }
  }

  const effectiveLayout = layout ? structuredClone(layout) : structuredClone(DEFAULT_DOCUMENT_LAYOUT);

  return {
    id,
    title,
    blocks,
    layout: effectiveLayout,
    styles: effectiveLayout.styles,
    sections: [],
    comments: [],
    footnotes,
    metadata: {},
  };
}

/**
 * Serializes a DocumentModel back into Djot source text.
 */
export function serializeDjotSource(model: DocumentModel): string {
  const parts: string[] = [];

  for (const block of model.blocks) {
    switch (block.type) {
      case "heading": {
        const hashes = "#".repeat(block.level);
        parts.push(`${hashes} ${block.text}\n`);
        break;
      }
      case "paragraph": {
        parts.push(`${block.text}\n`);
        break;
      }
      case "quote": {
        const quoteText = block.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        parts.push(`${quoteText}\n`);
        break;
      }
      case "list": {
        if (block.ordered) {
          parts.push(block.items.map((item, index) => `${index + 1}. ${item}`).join("\n") + "\n");
        } else {
          parts.push(block.items.map((item) => `- ${item}`).join("\n") + "\n");
        }
        break;
      }
      case "table": {
        const headerRow = `| ${block.headers.join(" | ")} |`;
        const separatorRow = `| ${block.headers
          .map((_, i) => {
            const align = block.alignments?.[i] ?? "left";
            if (align === "right") return "---:";
            if (align === "center") return ":---:";
            return "---";
          })
          .join(" | ")} |`;
        const bodyRows = block.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
        parts.push(`${headerRow}\n${separatorRow}${bodyRows ? `\n${bodyRows}` : ""}\n`);
        break;
      }
      case "image": {
        const captionPart = block.caption ? ` "${block.caption}"` : "";
        parts.push(`![${block.alt ?? ""}](${block.src}${captionPart})\n`);
        break;
      }
      case "page-break": {
        parts.push("---\n");
        break;
      }
      case "container": {
        parts.push(`::: ${block.name}\n${block.content}\n:::\n`);
        break;
      }
    }
  }

  // Append footnotes if any
  if (model.footnotes.length > 0) {
    const footnoteText = model.footnotes
      .map((fn) => `[^${fn.label}]: ${fn.text}`)
      .join("\n");
    parts.push(`\n${footnoteText}\n`);
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Parses layout.kdl into a DocumentLayout structure.
 */
export function parseDocumentLayoutKdl(kdlSource: string): DocumentLayout {
  const layout = structuredClone(DEFAULT_DOCUMENT_LAYOUT);

  // Extract page size
  const pageSizeMatch = kdlSource.match(/size\s+"([^"]+)"/);
  if (pageSizeMatch && ["A4", "A3", "A5", "Letter", "Legal"].includes(pageSizeMatch[1])) {
    layout.pageSize = pageSizeMatch[1] as DocumentLayout["pageSize"];
  }

  // Extract margins
  const topMatch = kdlSource.match(/top\s+"([^"]+)"/);
  if (topMatch) layout.margins.top = topMatch[1];
  const bottomMatch = kdlSource.match(/bottom\s+"([^"]+)"/);
  if (bottomMatch) layout.margins.bottom = bottomMatch[1];
  const leftMatch = kdlSource.match(/left\s+"([^"]+)"/);
  if (leftMatch) layout.margins.left = leftMatch[1];
  const rightMatch = kdlSource.match(/right\s+"([^"]+)"/);
  if (rightMatch) layout.margins.right = rightMatch[1];

  // Extract header
  const headerMatch = kdlSource.match(/header\s*\{[^}]*text\s+"([^"]+)"/s);
  if (headerMatch) {
    layout.header = {
      text: headerMatch[1],
      align: "right",
    };
  }

  // Extract styles
  const styleRegex = /style\s+"([^"]+)"\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = styleRegex.exec(kdlSource)) !== null) {
    const styleName = match[1];
    const styleBody = match[2];
    const style: DocumentStyle = {};

    const familyMatch = styleBody.match(/family="([^"]+)"/);
    if (familyMatch) style.fontFamily = familyMatch[1];

    const sizeMatch = styleBody.match(/size=(\d+)/);
    if (sizeMatch) style.fontSize = Number(sizeMatch[1]);

    const boldMatch = styleBody.match(/bold=#(true|false)/);
    if (boldMatch) style.bold = boldMatch[1] === "true";

    const lineHeightMatch = styleBody.match(/line-height\s+([\d.]+)/);
    if (lineHeightMatch) style.lineHeight = Number(lineHeightMatch[1]);

    const beforeMatch = styleBody.match(/before=(\d+)/);
    if (beforeMatch) style.spacingBefore = Number(beforeMatch[1]);

    const afterMatch = styleBody.match(/after=(\d+)/);
    if (afterMatch) style.spacingAfter = Number(afterMatch[1]);

    layout.styles[styleName] = style;
  }

  return layout;
}

/**
 * Serializes DocumentLayout into layout.kdl format.
 */
export function serializeDocumentLayoutKdl(layout: DocumentLayout): string {
  const stylesKdl = Object.entries(layout.styles)
    .map(([name, style]) => {
      const props: string[] = [];
      if (style.fontFamily) props.push(`family="${style.fontFamily}"`);
      if (style.fontSize) props.push(`size=${style.fontSize}`);
      if (style.bold !== undefined) props.push(`bold=#${style.bold}`);
      const fontLine = props.length > 0 ? `        font ${props.join(" ")}` : "";
      const lhLine = style.lineHeight ? `        line-height ${style.lineHeight}` : "";
      const spacingProps: string[] = [];
      if (style.spacingBefore !== undefined) spacingProps.push(`before=${style.spacingBefore}`);
      if (style.spacingAfter !== undefined) spacingProps.push(`after=${style.spacingAfter}`);
      const spacingLine = spacingProps.length > 0 ? `        spacing ${spacingProps.join(" ")}` : "";

      const bodyLines = [fontLine, lhLine, spacingLine].filter(Boolean).join("\n");
      return `    style "${name}" {\n${bodyLines}\n    }`;
    })
    .join("\n\n");

  return `document-layout version="1" {
    page {
        size "${layout.pageSize}"

        margin {
            top "${layout.margins.top}"
            bottom "${layout.margins.bottom}"
            left "${layout.margins.left}"
            right "${layout.margins.right}"
        }
    }

${stylesKdl}

    header {
        paragraph align="${layout.header?.align ?? "right"}" {
            text "${layout.header?.text ?? ""}"
        }
    }

    footer {
        paragraph align="${layout.footer?.align ?? "center"}" {
            page-number
        }
    }
}
`;
}
