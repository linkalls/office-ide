import { describe, expect, test } from "bun:test";
import {
  createEmptyDocument,
  DEFAULT_DOCUMENT_LAYOUT,
  parseDjotSource,
  parseDocumentLayoutKdl,
  serializeDjotSource,
  serializeDocumentLayoutKdl,
} from "./index";

describe("Document IR", () => {
  const sampleDjot = `# 2026年度 売上分析

2026年度の売上は前年比 **12.4%増** となった。

## 概要

主要な要因は以下の三点である。

1. 国内需要の増加
2. 新商品の投入
3. 海外市場の成長

## 地域別売上

| 地域 | 2025 | 2026 |
| :--- | ---: | ---: |
| 東京 | 1200 | 1450 |
| 大阪 | 800 | 910 |

売上増加は特に東京地域で顕著である。

> この分析は速報値に基づいています。

[^source]: 2026年度売上データ。
`;

  test("parses Djot text into structured blocks with stable IDs", () => {
    const doc = parseDjotSource(sampleDjot, "report");
    expect(doc.id).toBe("report");
    expect(doc.title).toBe("2026年度 売上分析");
    expect(doc.blocks.length).toBeGreaterThan(5);

    const heading1 = doc.blocks[0];
    expect(heading1.type).toBe("heading");
    if (heading1.type === "heading") {
      expect(heading1.level).toBe(1);
      expect(heading1.text).toBe("2026年度 売上分析");
    }

    const tableBlock = doc.blocks.find((b) => b.type === "table");
    expect(tableBlock).toBeDefined();
    if (tableBlock?.type === "table") {
      expect(tableBlock.headers).toEqual(["地域", "2025", "2026"]);
      expect(tableBlock.rows.length).toBe(2);
      expect(tableBlock.rows[0]).toEqual(["東京", "1200", "1450"]);
    }

    const listBlock = doc.blocks.find((b) => b.type === "list");
    expect(listBlock).toBeDefined();
    if (listBlock?.type === "list") {
      expect(listBlock.ordered).toBe(true);
      expect(listBlock.items.length).toBe(3);
    }

    const quoteBlock = doc.blocks.find((b) => b.type === "quote");
    expect(quoteBlock).toBeDefined();
    if (quoteBlock?.type === "quote") {
      expect(quoteBlock.text).toBe("この分析は速報値に基づいています。");
    }

    expect(doc.footnotes.length).toBe(1);
    expect(doc.footnotes[0].label).toBe("source");
    expect(doc.footnotes[0].text).toBe("2026年度売上データ。");
  });

  test("round-trips Djot source preserving content and structure", () => {
    const doc = parseDjotSource(sampleDjot, "report");
    const serialized = serializeDjotSource(doc);
    expect(serialized).toContain("# 2026年度 売上分析");
    expect(serialized).toContain("## 概要");
    expect(serialized).toContain("1. 国内需要の増加");
    expect(serialized).toContain("| 地域 | 2025 | 2026 |");
    expect(serialized).toContain("[^source]: 2026年度売上データ。");
  });

  test("creates an empty document with valid default structure", () => {
    const doc = createEmptyDocument("doc-1", "New Document");
    expect(doc.id).toBe("doc-1");
    expect(doc.title).toBe("New Document");
    expect(doc.blocks.length).toBe(2);
    expect(doc.layout.pageSize).toBe("A4");
  });

  test("parses and serializes layout.kdl", () => {
    const sampleLayoutKdl = `document-layout version="1" {
    page {
        size "A4"

        margin {
            top "25mm"
            bottom "25mm"
            left "25mm"
            right "25mm"
        }
    }

    style "body" {
        font family="Noto Serif JP" size=11
        line-height 1.6
    }

    style "heading-1" {
        font family="Noto Sans JP" size=20 bold=#true
        spacing before=18 after=10
    }

    header {
        paragraph align="right" {
            text "2026年度 売上分析"
        }
    }

    footer {
        paragraph align="center" {
            page-number
        }
    }
}
`;

    const layout = parseDocumentLayoutKdl(sampleLayoutKdl);
    expect(layout.pageSize).toBe("A4");
    expect(layout.margins.top).toBe("25mm");
    expect(layout.styles["body"]?.fontFamily).toBe("Noto Serif JP");
    expect(layout.styles["heading-1"]?.bold).toBe(true);
    expect(layout.header?.text).toBe("2026年度 売上分析");

    const serialized = serializeDocumentLayoutKdl(layout);
    expect(serialized).toContain('size "A4"');
    expect(serialized).toContain('family="Noto Serif JP"');
    expect(serialized).toContain('text "2026年度 売上分析"');
  });
});
