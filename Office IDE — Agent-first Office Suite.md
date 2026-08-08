# Office IDE — Agent-first Office Suite
## 実装仕様書 / Product & Technical Specification

**Codename:** Office IDE  
**Status:** Initial implementation specification  
**Primary platform:** Desktop  
**Framework:** Tauri 2  
**Frontend:** React + TypeScript  
**Package manager / JS runtime:** Bun  
**Backend/Core:** Rust  
**Primary goal:** Spreadsheet・Document・Source Code・Git・Terminal・AI Coding Agentを一つのデスクトップ環境へ統合する。

---

# 0. この仕様書を実装するAgentへの指示

このプロジェクトは「ExcelやWordに似たUIを作る」こと自体を目的としない。

本質は、

> **Office documentを、GUIでも、人間が読めるsource codeでも、AI Agentでも操作できるIDEにすること**

である。

以下の設計原則を勝手に変更しないこと。

1. Spreadsheetのnative sourceはKDLを採用する。
2. Document本文はDjot系の軽量マークアップをnative sourceとする。
3. `.xlsx` / `.docx` はnative formatではなくimport/export compatibility formatとする。
4. Spreadsheet/Documentの実行中状態には明示的なIRを持つ。
5. GUI、Source Editor、CLI、AgentはすべてIRを操作する。
6. Claude Code / Codex CLI / Cursor CLIなどのローカルAgentは、基本的にMCPではなくSkills + CLIを使用する。
7. MCPはChatGPTなど外部クライアント向けの任意機能とする。
8. Agentによる変更はsemantic transactionとして履歴管理し、Undo/Diff/Review可能にする。
9. xlsx/docxを完全再現できない機能を黙って破棄しない。
10. 不明なOffice OOXML要素は可能な限りopaque dataとして保持する。
11. 最初からExcel/Wordの100%互換を目指さない。
12. UIはOfficeクローンではなく「Spreadsheet / Document IDE」として設計する。

---

# 1. Product Vision

従来のOffice文書はバイナリ中心であり、

- Git diffしにくい
- AI Agentが直接操作しにくい
- CLIによる自動化が難しい
- 人間が内部構造を確認しにくい
- GUI以外の編集手段が弱い

という問題がある。

本製品では、

```text
Spreadsheet GUI
Document GUI
Source Code
Git
Terminal
AI Agents
CLI
External MCP
```

を同じworkspaceへ統合する。

理想的にはVS Codeでコードを扱う感覚でOffice documentを扱えるようにする。

---

# 2. Product Concept

アプリ全体を以下のように捉える。

```text
                  ┌──────────────────────────┐
                  │       Office IDE         │
                  └────────────┬─────────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
          Spreadsheet Editor         Document Editor
                  │                         │
          Spreadsheet IR             Document IR
                  │                         │
            sheet source              doc source
               KDL                    Djot + KDL
                  │                         │
             XLSX bridge               DOCX bridge
                  │                         │
             .xlsx files               .docx files
```

加えて、

```text
                         IR
                         │
        ┌────────────────┼────────────────┐
        │                │                │
       GUI             CLI             Source
                         │
                    Agent Skills
                         │
             ┌───────────┼───────────┐
             │           │           │
          Claude       Codex       Cursor
```

とする。

---

# 3. 基本設計原則

## 3.1 Source of Truth

native projectではKDL/Djot sourceを永続的なSource of Truthとする。

ただし実行中は、

```text
Source
  ↓ parse
IR
  ↓
Editor
```

として扱う。

GUI変更時には、

```text
GUI operation
→ semantic transaction
→ IR mutation
→ source AST patch
→ save
```

を行う。

文字列置換でKDL/Djotを書き換えてはいけない。

---

# 4. 使用技術

## Desktop

Tauri 2。

TauriはFrontendからRust commandを呼び出すcommand primitiveと、Rust→Frontend通知用event/channelを提供している。ストリーミング用途にはeventよりchannelが推奨されているため、terminal outputなど大量の連続データはchannelまたは専用IPC経路を使用する。

## Frontend

- React
- TypeScript
- Bun
- Vite
- CSS variables
- 必要ならRadix / shadcn系component
- CodeMirror 6：Source editor
- xterm.js：Terminal view

## Spreadsheet Engine

第一候補：

```text
Univer Sheets
```

Univer Sheets OSS coreには、

- Spreadsheet rendering
- Cell selection
- Cell styling
- Formula calculation
- Number formatting
- Gridlines
- Frozen panes

などが含まれる。またformula engineはExcel系関数との互換性を重視している。

Univer自体はApache 2.0のOSS coreを提供している。

## Document Engine

第一候補：

```text
Univer Docs
```

理由：

- Spreadsheetと同一ecosystem
- 共通Facade API思想
- Document rendering
- Paragraph layout
- Alignment
- Indentation
- Hanging indent
- Table editing
- 日本語などを含むtypesetting

をcoreとして持つ。

将来的にUniver Docsが必要な自由度を提供しない場合のみProseMirror系editorへの切り替えを検討する。

---

# 5. Repository Structure

monorepoにする。

```text
office-ide/
├── apps/
│   └── desktop/
│       ├── src/
│       ├── src-tauri/
│       └── package.json
│
├── packages/
│   ├── core/
│   │   ├── spreadsheet-ir/
│   │   ├── document-ir/
│   │   ├── operations/
│   │   └── protocol/
│   │
│   ├── kdl/
│   ├── djot/
│   ├── sheet-source/
│   ├── doc-source/
│   ├── sheetctl/
│   ├── docctl/
│   ├── officectl/
│   ├── agent-skills/
│   └── ui/
│
├── crates/
│   ├── office-core/
│   ├── ipc/
│   ├── terminal/
│   ├── xlsx/
│   ├── docx/
│   └── ooxml/
│
├── skills/
│   ├── spreadsheet/
│   │   └── SKILL.md
│   └── document/
│       └── SKILL.md
│
├── examples/
├── fixtures/
├── tests/
├── bun.lock
├── Cargo.toml
└── README.md
```

---

# 6. Native Workspace

workspaceは普通のdirectoryとして保存する。

例：

```text
sales-report.office/
├── project.kdl
├── sheets/
│   ├── sales.kdl
│   └── summary.kdl
├── docs/
│   └── report/
│       ├── document.dj
│       └── layout.kdl
├── assets/
│   ├── logo.png
│   └── chart-01.svg
└── compat/
    ├── xlsx/
    └── docx/
```

directoryである理由：

- Git friendly
- Agent friendly
- Asset管理が容易
- 巨大documentを一ファイルにしなくてよい
- merge conflictを局所化できる

---

# 7. project.kdl

KDL 2.0を使用する。

KDL 2.0.0は最新stable specificationであり、node + arguments + properties + childrenという構造を持つ。

例：

```kdl
office-project version="1"

metadata {
    title "2026 Sales Report"
}

resource "sales" type="spreadsheet" path="./sheets/sales.kdl"
resource "summary" type="spreadsheet" path="./sheets/summary.kdl"
resource "report" type="document" path="./docs/report/document.dj"

settings {
    autosave #true
    locale "ja-JP"
}
```

---

# 8. Spreadsheet Source Format

SpreadsheetはKDLベース。

## 基本例

```kdl
spreadsheet version="1" {
    workbook {
        name "売上分析"
    }

    style "header" {
        font family="Arial" size=11 bold=#true
        fill "#E9EEF6"
        align horizontal="center"
    }

    sheet "売上" {
        freeze row=1

        column "A" width=20
        column "B" width=12
        column "C" width=12
        column "D" width=15

        cell "A1" value="商品" style="header"
        cell "B1" value="数量" style="header"
        cell "C1" value="単価" style="header"
        cell "D1" value="売上" style="header"

        row 2 {
            cell "A" value="Apple"
            cell "B" value=10
            cell "C" value=120
            cell "D" formula="B2*C2"
        }

        row 3 {
            cell "A" value="Orange"
            cell "B" value=20
            cell "C" value=80
            cell "D" formula="B3*C3"
        }

        cell "D4" formula="SUM(D2:D3)"
    }
}
```

---

# 9. Spreadsheet Source Features

最低限以下のnodeを定義する。

```text
spreadsheet
workbook
sheet
row
column
cell
range
formula
merge
style
font
fill
border
align
freeze
validation
conditional-format
table
filter
sort
chart
image
named-range
```

---

# 10. Range Syntax

A1 notationを標準とする。

```kdl
range "A1:D10"
```

sheet付き：

```kdl
range "売上!A1:D10"
```

column：

```kdl
range "B:B"
```

row：

```kdl
range "2:10"
```

---

# 11. Style Syntax

```kdl
style "header" {
    font {
        family "Noto Sans JP"
        size 11
        bold #true
        color "#222222"
    }

    fill "#EEEEEE"

    border {
        bottom style="thin" color="#AAAAAA"
    }

    align horizontal="center" vertical="middle"

    number-format "#,##0"
}
```

stylesは継承可能。

```kdl
style "total" extends="header" {
    font bold=#true
    number-format "#,##0"
}
```

---

# 12. Formula

formula文字列はExcel互換notationを基本とする。

```kdl
cell "D2" formula="B2*C2"
```

range formula：

```kdl
formula "D2:D100" {
    expression "B2*C2"
    fill-relative #true
}
```

`fill-relative #true`の場合、

```text
D2 = B2*C2
D3 = B3*C3
D4 = B4*C4
```

へ展開する。

---

# 13. Spreadsheet IR

KDL ASTを直接UI modelとして使わない。

明示的なIRを持つ。

概念モデル：

```ts
export interface SpreadsheetWorkbook {
    id: string;
    name: string;
    sheets: SpreadsheetSheet[];
    styles: Record<string, CellStyle>;
    namedRanges: NamedRange[];
    metadata: Record<string, unknown>;
}

export interface SpreadsheetSheet {
    id: string;
    name: string;
    cells: Map<string, SpreadsheetCell>;
    rows: Map<number, RowProperties>;
    columns: Map<number, ColumnProperties>;
    merges: CellRange[];
    tables: SpreadsheetTable[];
    charts: SpreadsheetChart[];
    validations: DataValidation[];
    conditionalFormats: ConditionalFormat[];
}

export interface SpreadsheetCell {
    address: string;
    value?: string | number | boolean | null;
    formula?: string;
    styleId?: string;
    numberFormat?: string;
}
```

実コードではRust/TypeScript双方で共有可能なserialization schemaを定義する。

---

# 14. Document Source Format

文章本文にはDjotを採用候補とする。

DjotはCommonMark系の軽量syntaxを持ちながら、

- tables
- footnotes
- definition lists
- highlight
- insert/delete
- superscript
- subscript
- math
- attributes
- generic containers

などをサポートしている。

ただしDjot自体はまだsyntaxのminor change可能性を明記しているため、本製品では**対応Djot subsetとversionを固定**する。

---

# 15. Document Example

`document.dj`

```text
# 2026年度 売上分析

2026年度の売上は前年比 **12.4%増** となった。

## 概要

主要な要因は以下の三点である。

1. 国内需要の増加
2. 新商品の投入
3. 海外市場の成長

## 地域別売上

| 地域 | 2025 | 2026 |
|------|-----:|-----:|
| 東京 | 1200 | 1450 |
| 大阪 |  800 |  910 |

売上増加は特に東京地域で顕著である。

[^source]: 2026年度売上データ。
```

---

# 16. Document Layout

本文とlayout/styleを分離する。

`layout.kdl`

```kdl
document-layout version="1" {
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

    style "heading-2" {
        font family="Noto Sans JP" size=15 bold=#true
        spacing before=14 after=8
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
```

---

# 17. Document IR

文書もDjot ASTを直接UI stateとして使用しない。

概念：

```ts
export interface DocumentModel {
    id: string;
    blocks: DocumentBlock[];
    styles: Record<string, DocumentStyle>;
    sections: DocumentSection[];
    comments: DocumentComment[];
    footnotes: Footnote[];
    metadata: Record<string, unknown>;
}

export type DocumentBlock =
    | ParagraphBlock
    | HeadingBlock
    | TableBlock
    | ImageBlock
    | QuoteBlock
    | ListBlock
    | PageBreakBlock;
```

全blockにstable IDを付与する。

例：

```text
para_01J...
heading_01J...
table_01J...
```

Agentはtext offsetだけでなくblock IDを利用可能とする。

---

# 18. Main Application UI

基本layout：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ File  Edit  View  Insert  Data  Agent                         ◯ ◯ ◯ │
├──────────────┬──────────────────────────────────┬────────────────────┤
│ Explorer     │                                  │ Agent Pane         │
│              │                                  │                    │
│ 📊 sales     │           Main Editor            │ Claude             │
│ 📊 summary   │                                  │ Codex              │
│ 📄 report    │                                  │ Cursor             │
│              │                                  │ Shell              │
│              │                                  │                    │
├──────────────┴──────────────────────────────────┴────────────────────┤
│ Grid / Visual │ Source │ Diff │ History │ Problems │ Terminal       │
└──────────────────────────────────────────────────────────────────────┘
```

---

# 19. Explorer

左sidebarにはworkspace resourceを表示。

```text
WORKSPACE

▾ Spreadsheets
  ├─ sales
  └─ summary

▾ Documents
  └─ report

▾ Assets
  ├─ logo.png
  └─ graph.svg
```

右クリック：

```text
Rename
Duplicate
Export
Open Source
Reveal in Explorer/Finder
Delete
```

---

# 20. Spreadsheet View

Spreadsheet編集時は以下を表示。

上：

```text
Name Box
Formula Bar
Formatting toolbar
```

中央：

```text
Univer Sheet
```

下：

```text
Sheet tabs
```

Spreadsheet selectionはapplication contextへ常に同期する。

```ts
interface SpreadsheetUIContext {
    resourceId: string;
    sheetId: string;
    selection: string[];
    activeCell: string | null;
}
```

---

# 21. Document View

Word風editing view。

MVPでは、

```text
Visual editor
+
print preview
```

を優先する。

最初からpixel-perfect Word paginationを作らない。

後から、

```text
A4 page view
header/footer
section
page break
footnotes
```

を追加する。

---

# 22. Source View

下部または中央editor modeとしてSourceを開く。

Spreadsheet：

```text
sales.kdl
```

Document：

```text
document.dj
layout.kdl
```

CodeMirrorを使用。

必要機能：

- syntax highlighting
- bracket matching
- diagnostics
- format
- Go to definition
- autocomplete
- schema completion
- error underline
- line/column
- AST-aware formatting

---

# 23. Live Source Editing

Source変更時：

```text
edit
↓
incremental parse
↓
validate
↓
IR transaction
↓
GUI update
```

syntax errorが存在する場合、最後のvalid IRをGUI側で維持する。

例：

```text
Source contains errors.
Visual preview shows last valid state.
```

と表示する。

syntax errorのあるsourceを勝手に破棄しない。

---

# 24. Visual → Source Editing

GUI操作：

```text
B列幅を変更
```

↓

```text
SetColumnWidth operation
```

↓

IR更新

↓

KDL AST patch

↓

元コメント・可能な限りformatを保持してserialize。

ASTを書き直す際に毎回ファイル全体のformatを破壊しないこと。

---

# 25. Semantic Operations

全変更をoperationとして定義する。

Spreadsheet例：

```text
SetCellValue
SetFormula
SetCellStyle
SetColumnWidth
SetRowHeight
InsertRows
DeleteRows
InsertColumns
DeleteColumns
MoveRange
MergeCells
UnmergeCells
CreateChart
DeleteChart
SetDataValidation
SortRange
```

Document例：

```text
InsertText
DeleteText
ReplaceText
InsertBlock
DeleteBlock
MoveBlock
ApplyMark
SetParagraphStyle
InsertTable
InsertImage
AddComment
ResolveComment
```

---

# 26. Transaction

複数operationを一つのtransactionとしてgroupできる。

```ts
interface Transaction {
    id: string;
    actor: Actor;
    timestamp: number;
    label: string;
    operations: Operation[];
}
```

Actor：

```ts
type Actor =
    | { type: "user" }
    | { type: "agent"; agent: string }
    | { type: "cli"; process: string }
    | { type: "importer" };
```

---

# 27. Undo / Redo

全semantic transactionについてinverse operationを生成する。

Agent変更もUndo可能。

```text
Claude changed 42 cells
[Undo]
```

が必須。

---

# 28. Diff

二種類提供。

## Source Diff

普通のGit-style textual diff。

```diff
-cell "C2" value=120
+cell "C2" value=130
```

## Semantic Diff

```text
Sheet: 売上

C2
120 → 130

D2:D100
Formula added: Bn * Cn

Chart
+ monthly-sales
```

Document：

```text
Paragraph 18
- この施策は重要である。
+ この施策は長期的な競争力を左右す重要な要素である。
```

---

# 29. History

History pane：

```text
16:32  User
Changed C2

16:34  Claude
Modified 24 cells
Added 1 chart

16:36  Codex
Fixed 3 formulas
```

任意transactionへrevert可能。

---

# 30. Agent Pane

右paneでembedded CLIを起動する。

tabs：

```text
Claude
Codex
Cursor
Shell
+
```

---

# 31. Terminal Implementation

Frontend：

```text
xterm.js
```

xterm.jsはブラウザUIへterminalを埋め込むcomponentで、bash/vim等のterminal appに対応し、CJK/emoji/IMEも考慮されている。

Rust：

```text
portable-pty
```

portable-ptyはcross-platform PTY interfaceを提供する。

構成：

```text
xterm.js
   ⇅
Tauri channel
   ⇅
TerminalManager
   ⇅
portable-pty
   ⇅
claude / codex / agent / shell
```

通常のstdout captureではなくPTYを使用する。

---

# 32. Agent Detection

起動時に以下をprobe。

```text
claude
codex
agent
cursor-agent
```

見つかったものをAgent launcherへ表示。

例：

```text
Claude Code       Installed
Codex CLI         Installed
Cursor CLI        Installed
```

存在しない場合はdisabled表示。

---

# 33. Agent Context Bar

各terminal pane上部に現在のcontextを表示。

Spreadsheet：

```text
📊 sales
Sheet: 売上
Selection: A2:F42
Active: C17
```

Document：

```text
📄 report
Selection: paragraphs 12–14
```

---

# 34. Local Agent Architecture

重要：

ローカルAgentはMCPを必須としない。

主経路：

```text
Agent
 ↓
Skill
 ↓
sheetctl / docctl
 ↓
local IPC
 ↓
Office IDE
 ↓
IR
```

Skillsは`SKILL.md`で再利用可能workflowを定義する方式であり、OpenAIも2026年現在この方式をSkillsとして採用している。

CursorもSkillsをAgent/CLIでサポートし、always-on rulesよりdynamic context discoveryに向いているとしている。

---

# 35. sheetctl

CLI executable：

```text
sheetctl
```

## 基本

```bash
sheetctl context
```

出力：

```json
{
  "resource": "sales",
  "sheet": "売上",
  "selection": ["A2:F42"],
  "activeCell": "C17"
}
```

---

# 36. sheetctl Commands

```bash
sheetctl workbook info
sheetctl sheet list
sheetctl sheet active
sheetctl context

sheetctl cell get A1
sheetctl cell set A1 "Hello"
sheetctl cell clear A1

sheetctl range get A1:D20
sheetctl range clear A1:D20

sheetctl formula set D2 '=B2*C2'
sheetctl formula fill D2:D100 '=B2*C2'

sheetctl style apply A1:D1 header
sheetctl style set A1:D1 --bold true

sheetctl row insert 5
sheetctl row delete 5

sheetctl column insert C
sheetctl column delete C
sheetctl column width B 120

sheetctl merge A1:D1
sheetctl unmerge A1:D1

sheetctl chart create --type bar --source A1:B12
sheetctl chart list
sheetctl chart delete <id>

sheetctl diff
sheetctl history
sheetctl undo

sheetctl export ./report.xlsx
```

---

# 37. Structured Output

CLIのstdoutはhuman mode / JSON modeを持つ。

```bash
sheetctl --json range get A1:D20
```

Agent Skillsでは原則 `--json` を使用する。

error：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_RANGE",
    "message": "Invalid range: A0:D20"
  }
}
```

---

# 38. docctl

```text
docctl
```

Commands：

```bash
docctl context
docctl selection read
docctl selection replace --stdin

docctl block get <id>
docctl block delete <id>
docctl block move <id> --after <id>

docctl heading set 2
docctl style apply quote

docctl comment add "根拠を確認"
docctl comment list
docctl comment resolve <id>

docctl table insert --rows 3 --columns 4
docctl image insert ./chart.png

docctl diff
docctl history
docctl undo

docctl export ./report.docx
```

---

# 39. officectl

workspace全体操作：

```bash
officectl context
officectl resource list
officectl resource open sales
officectl save
officectl status
officectl diff
```

---

# 40. IPC

CLIがnative source fileを直接編集する設計にしない。

```text
sheetctl
  ↓
local IPC
  ↓
running Office IDE
```

IPC：

Windows：

```text
Named Pipe
```

Linux/macOS：

```text
Unix Domain Socket
```

TCP serverをdefaultにしない。

---

# 41. Session Security

アプリ起動ごとにrandom session tokenを生成。

Agent processをspawnするとき、

```text
OFFICE_IDE_SOCKET
OFFICE_IDE_SESSION_TOKEN
OFFICE_IDE_WORKSPACE
```

をenvironmentへ渡す。

CLIはtokenなしではmutation不可。

他processから勝手にWorkbookを変更されないようにする。

---

# 42. Skills Directory

canonical Skill：

```text
skills/
├── spreadsheet/
│   ├── SKILL.md
│   └── references/
│       ├── formulas.md
│       ├── formatting.md
│       └── charts.md
│
└── document/
    ├── SKILL.md
    └── references/
        ├── editing.md
        └── citations.md
```

---

# 43. Spreadsheet Skill Rules

SKILL.mdには最低限以下を書く。

```text
# Spreadsheet

Use sheetctl to interact with the active spreadsheet.

Do not edit spreadsheet KDL directly unless the user explicitly asks to edit the source.

Before operating on "this", "these cells", "the selected area", or similar references, run:

sheetctl --json context

Read only the ranges necessary for the requested task.

Prefer semantic operations over rewriting large ranges.

After large modifications, inspect:

sheetctl --json diff

Never delete sheets, large ranges, or user data unless required by the user's request.

Preserve formulas, styles, number formats, comments, and data validation unless the task requires changing them.
```

---

# 44. Document Skill Rules

```text
# Document

Use docctl to interact with documents.

For requests referring to the current selection, first run:

docctl --json context

Read only the required blocks or selected text.

Prefer semantic document operations.

Do not rewrite the entire document when only a paragraph needs modification.

Preserve headings, comments, footnotes, references, tables, and styles unless the task requires changing them.

Use docctl diff after significant edits.
```

---

# 45. Agent Review Mode

Settings：

```text
Agent changes:

● Apply immediately
○ Ask before destructive changes
○ Review every change
```

default：

```text
Ask before destructive changes
```

destructive：

- delete sheet
- delete table
- delete > 100 cells
- replace entire document
- remove asset
- destructive import overwrite

---

# 46. Agent Change Banner

Agent操作後：

```text
Codex changed this workbook

24 cells modified
3 formulas added
1 chart created

[Review] [Undo]
```

---

# 47. MCP

MCPはoptional。

default：

```text
disabled
```

用途：

- ChatGPT Web
- remote agent
- external developer tools
- integration testing

local Claude/Codex/Cursorのprimary pathにしない。

---

# 48. MCP Tool Surface

大量の細かいToolを公開しない。

MVP：

```text
get_context
read
apply_operations
export
```

程度。

`apply_operations`はsemantic operation batchを受ける。

例：

```json
{
  "operations": [
    {
      "type": "set_cell_value",
      "sheet": "sales",
      "cell": "B2",
      "value": 1200
    },
    {
      "type": "set_formula",
      "sheet": "sales",
      "cell": "D2",
      "formula": "=B2*C2"
    }
  ]
}
```

---

# 49. XLSX Import

`.xlsx`を開いた場合：

```text
XLSX
 ↓
OOXML reader
 ↓
Spreadsheet Import Model
 ↓
Spreadsheet IR
 ↓
KDL
```

MicrosoftのSpreadsheetMLではworkbook、worksheetsが個別partsとして存在し、table、chart、pivot table等も別要素として構成される。

---

# 50. XLSX MVP Compatibility

必須：

- worksheets
- cell values
- strings
- numbers
- booleans
- dates
- formulas
- row height
- column width
- merged cells
- font
- fills
- borders
- alignment
- number formats
- freeze panes
- hidden rows/columns
- hyperlinks
- autofilter

次フェーズ：

- tables
- validation
- conditional formatting
- charts
- named ranges
- images

後回し：

- pivot
- slicer
- Power Query
- macros
- external data connection
- embedded objects

---

# 51. XLSX Unsupported Feature Report

import後、黙って削除しない。

例：

```text
Imported sales.xlsx

Supported:
✓ 6 sheets
✓ 18,403 cells
✓ 216 formulas
✓ 42 styles

Partially supported:
⚠ 2 charts

Unsupported:
⚠ 1 pivot table
⚠ 1 external connection
```

---

# 52. OOXML Opaque Preservation

理解できないOOXML package partを可能なら保存。

```text
compat/xlsx/
├── original-parts/
├── relationships/
└── manifest.json
```

目的：

```text
unknown != delete
```

既知の部分だけIRへ変換する。

---

# 53. XLSX Export

```text
KDL
 ↓
IR
 ↓
OOXML writer
 ↓
.xlsx
```

native sourceを変更せずexportする。

Exportダイアログ：

```text
Excel Workbook (.xlsx)

Compatibility:
✓ Standard formulas
✓ Cell formatting
⚠ Pivot tables are preserved from original but cannot be edited
```

---

# 54. Univer XLSX Limitation

Univer公式にもXLSX import/exportは存在するが、現在はUniver Pro / server-side serviceを必要とする。公式は独自open-source parserでUniver data modelへ変換する手段も案内している。

本製品ではlocal-firstを維持するため、Univer Pro import/exportを必須依存にしない。

---

# 55. DOCX Import

WordprocessingMLは本文だけでなく、

- main document
- comments
- settings
- endnotes
- footnotes
- headers
- footers
- styles

など複数partで構成される。

したがって、

```text
DOCX
→ Markdown
→ DOCX
```

という単純変換は禁止。

---

# 56. DOCX Pipeline

```text
DOCX
 ↓ unzip OOXML
Document Importer
 ├─ known semantics → Document IR
 └─ unknown parts   → opaque compatibility storage
 ↓
Djot + layout.kdl
```

---

# 57. DOCX MVP Compatibility

必須：

- paragraph
- heading
- bold
- italic
- underline
- strike
- font family
- font size
- text color
- paragraph alignment
- indentation
- ordered list
- unordered list
- hyperlinks
- tables
- images
- page break
- headers
- footers

次：

- footnotes
- endnotes
- comments
- section breaks
- page numbering
- custom styles

後：

- tracked changes
- fields
- text boxes
- SmartArt
- embedded Office objects

---

# 58. DOCX Parser

Rust側で`docx-rust`等を調査対象とする。

`docx-rust`は現在DOCX parseとgenerationの双方を提供している。

ただし特定libraryのmodelをDocument IRそのものにしてはいけない。

必ずadapterを置く。

```text
docx-rust
 ↓ adapter
Document IR
```

とする。

---

# 59. Univer DOCX Limitation

Univer DocsにもDOCX import/export機能はあるが、公式advanced機能はUniver Pro/serverを必要とする。

したがって本製品のlocal-first DOCX compatibility layerは独立実装する。

---

# 60. Git Integration

workspaceがGit repositoryなら自動検出。

Sidebar：

```text
SOURCE CONTROL

M  sheets/sales.kdl
M  docs/report/document.dj
A  assets/chart.svg
```

最低限：

- diff
- stage
- unstage
- commit

高度なGit UIは後回し。

---

# 61. Git + Semantic Diff

Source DiffとSemantic Diffを切替可能。

```text
Text | Semantic
```

Agentに、

```text
昨日から何が変わった？
```

と聞けるよう、`officectl diff --json`を提供する。

---

# 62. Autosave

default：

```text
enabled
```

ただし入力ごとにdisk writeしない。

debounce：

```text
500–1000 ms
```

transaction boundaryでflush可能。

---

# 63. Crash Recovery

編集transaction journalを保持。

```text
.officeide/
└── recovery/
```

abnormal exit後、

```text
Unsaved changes from the previous session were found.

[Restore] [Discard]
```

---

# 64. Performance Goals

Spreadsheet：

- 10,000 populated cells：interactive
- 100,000 populated cells：usable
- 1,000,000 cells：可能ならvirtualized access
- UI操作で長時間main thread blockを避ける

Univer自身も大量formula計算ではWeb Worker利用を推奨しているため、formula calculation worker化を検討する。

---

# 65. Large Data Strategy

巨大datasetはKDLへ全cellをベタ書きしないoptionを将来提供する。

例：

```kdl
sheet "raw-data" {
    data-source {
        type "parquet"
        path "./data/raw.parquet"
        at "A1"
    }
}
```

対応候補：

```text
CSV
Arrow
Parquet
```

これはV1必須ではない。

---

# 66. Search

Workspace global search：

```text
Ctrl+Shift+F
```

検索対象：

- document text
- cell text
- formulas
- KDL
- Djot
- comments
- filenames

resultsからVisual editorへjump可能。

---

# 67. Command Palette

```text
Ctrl+Shift+P
```

例：

```text
Export as XLSX
Export as DOCX
Open Source
Open Diff
Toggle Agent Pane
Start Codex
Start Claude
Start Cursor
Format Source
Recalculate Workbook
```

---

# 68. Keyboard Shortcuts

最低限：

```text
Ctrl+S        Save
Ctrl+Z        Undo
Ctrl+Shift+Z  Redo
Ctrl+P        Quick Open
Ctrl+Shift+P  Command Palette
Ctrl+J        Toggle Agent Pane
Ctrl+`        Toggle Terminal
Ctrl+Shift+F  Global Search
```

---

# 69. Theme

Light / Dark / System。

Spreadsheet/Document content自体のdocument colorsとアプリthemeは分離。

---

# 70. Security

Tauri shell permissionは必要最低限に限定する。

Tauri shell pluginにはspawn / execute / stdinなど個別permissionが存在するため、無制限shell permissionをfrontendへ公開しない。

PTY process管理はRust backendのみ。

WebViewから任意process spawn APIを直接呼ばせない。

---

# 71. Agent Process Security

Agentはuser権限で起動。

アプリは、

- API keyを取得しない
- Agent credentialsを保存しない
- Agent configを勝手に変更しない

認証は各CLI自身へ委譲。

---

# 72. Source Safety

Agentが直接native sourceを編集した場合もfilesystem watcherで検出。

```text
source changed externally
 ↓
parse
 ↓
validate
 ↓
transaction
 ↓
UI update
```

conflict時：

```text
The source was modified externally while unsaved visual changes exist.

[Compare] [Use External] [Keep Local]
```

---

# 73. Error Model

全core errorにcodeを持たせる。

```ts
interface OfficeError {
    code: string;
    message: string;
    details?: unknown;
}
```

例：

```text
KDL_PARSE_ERROR
INVALID_CELL_RANGE
FORMULA_ERROR
DOCUMENT_PARSE_ERROR
XLSX_IMPORT_UNSUPPORTED
DOCX_IMPORT_UNSUPPORTED
IPC_AUTH_FAILED
AGENT_NOT_FOUND
```

---

# 74. Problems Panel

Compiler/IDE風に表示。

```text
PROBLEMS

sales.kdl
  Line 42  Invalid cell address "A0"
  Line 81  Unknown style "heder"

report.dj
  Line 12  Missing footnote reference
```

clickで該当Sourceへ移動。

---

# 75. Spreadsheet Source Validation

最低限：

- duplicate sheet name
- invalid A1 address
- invalid range
- unknown style
- invalid formula syntax
- circular style inheritance
- merge overlap
- invalid chart source
- unsupported number format warning

---

# 76. Document Validation

最低限：

- invalid Djot
- duplicate block ID
- missing asset
- missing footnote
- invalid style
- invalid section reference

---

# 77. Tests

## Unit

```text
KDL parser
KDL formatter
KDL → Spreadsheet IR
Spreadsheet IR → KDL
Djot → Document IR
Document IR → Djot
operation inverse
transaction
range parser
formula fill
```

## Integration

```text
GUI operation → IR → source
source edit → IR → GUI
sheetctl → IPC → IR
docctl → IPC → IR
Agent transaction → history → undo
```

## Import Fixtures

fixtures：

```text
simple.xlsx
styles.xlsx
formulas.xlsx
merged.xlsx
charts.xlsx
unsupported-pivot.xlsx

simple.docx
styles.docx
tables.docx
headers.docx
footnotes.docx
comments.docx
```

---

# 78. Round-trip Tests

重要。

```text
KDL
→ IR
→ KDL
```

semantic equality。

```text
Djot
→ IR
→ Djot
```

semantic equality。

Office：

```text
xlsx
→ IR
→ xlsx
```

についてはbyte equalityではなくsemantic fidelityを検査。

同様に：

```text
docx
→ IR
→ docx
```

---

# 79. Visual Regression Tests

Spreadsheet/Documentの主要fixtureについてscreenshot regressionを用意する。

---

# 80. Accessibility

最低限：

- keyboard navigation
- visible focus
- screen reader labels
- sufficient contrast
- terminal accessibility mode
- zoom

xterm.js自体もscreen reader modeを持つ。

---

# 81. Offline First

基本機能は完全offline動作。

必要：

```text
Spreadsheet edit
Document edit
KDL/Djot
Terminal
CLI
Git
XLSX/DOCX import/export
```

cloud serviceを必須にしない。

Agentのみ各CLIの仕様に依存。

---

# 82. Telemetry

MVPではdefault telemetryなし。

後から導入する場合もopt-in。

document contentsやAgent promptを収集してはいけない。

---

# 83. MVP Definition

**MVPは以下が一つのアプリとして動けば完成とする。**

## Spreadsheet

- Tauri desktop起動
- workspace作成
- KDL spreadsheet作成
- Univerで表示
- cell editing
- formulas
- styling
- row/column
- source view
- source → visual live update
- visual → source update
- save/load

## Document

- Djot document
- Univer Docs表示・編集
- headings
- paragraphs
- lists
- basic table
- basic styles
- source view
- visual/source同期

## Agent

- xterm.js terminal
- PTY
- Claude/Codex/Cursor/Shell launcher
- context bar
- sheetctl
- docctl
- Skills

## IDE

- Explorer
- tabs
- Source
- Diff
- History
- Undo/Redo

---

# 84. MVPで必須ではないもの

以下のためにMVP完成を遅らせない。

```text
100% Excel compatibility
100% Word compatibility
PowerPoint
collaboration
cloud sync
mobile
Pivot editing
Power Query
VBA
SmartArt
complex pagination
track changes
MCP
plugins marketplace
```

---

# 85. Implementation Phases

## Phase 0 — Foundation

- Tauri
- React
- Bun
- workspace
- Explorer
- tabs
- command palette
- Rust IPC architecture

受け入れ条件：

```text
bun install
bun run tauri dev
```

でdesktop appが起動。

---

## Phase 1 — Spreadsheet Core

- Univer Sheets
- Spreadsheet IR
- KDL parser
- KDL serializer
- Grid/source sync
- formulas
- styles
- basic history

受け入れ条件：

KDLを編集すると即座にGridが変わり、Gridを編集するとKDLへ反映される。

---

## Phase 2 — Agent Infrastructure

- PTY
- xterm.js
- Agent tabs
- sheetctl
- local IPC
- Spreadsheet Skill
- transaction history
- semantic diff

受け入れ条件：

Codex/Claude/Cursorから、

```bash
sheetctl cell set B2 100
```

を実行するとGridのB2が即座に100へ変化する。

---

## Phase 3 — XLSX

- importer
- exporter
- compatibility report
- opaque storage foundation

受け入れ条件：

一般的なxlsxを開き、編集し、再度xlsxとして保存できる。

---

## Phase 4 — Document Core

- Univer Docs
- Document IR
- Djot
- layout KDL
- Visual/source sync
- docctl
- Document Skill

受け入れ条件：

DjotとVisual documentを双方向編集できる。

---

## Phase 5 — DOCX

- importer
- exporter
- compatibility report
- opaque OOXML

受け入れ条件：

一般的なWord documentを読み込み、文章・basic formattingを編集し、docxとして保存できる。

---

## Phase 6 — Git / External MCP

- Git panel
- semantic git diff
- optional MCP server

---

# 86. Definition of Done

機能完成を「画面がある」だけで判断しない。

各featureについて最低限、

```text
Implementation
Unit tests
Integration test
Error state
Keyboard operation
Persistence
Undo
```

を確認する。

---

# 87. UX Principle

Office ribbonをそのままコピーしない。

基本思想：

```text
VS Code
+
Spreadsheet
+
Word Processor
```

とする。

情報密度は高くしてよいが、常時必要でないpaneは折り畳める。

Agent paneは、

```text
Ctrl+J
```

で即座に開閉。

---

# 88. Core User Stories

## Spreadsheet

ユーザー：

> この表の右に前年比を追加して

Agent：

```text
context取得
→ selected range読取
→ formula追加
→ semantic transaction
→ UI即時更新
```

---

## Document

ユーザー：

> この段落冗長だから短くして

Agent：

```text
context取得
→ selection read
→ replace
→ diff
```

---

## Import

ユーザーが、

```text
sales.xlsx
```

をdrag/drop。

アプリ：

```text
Importing Excel workbook...
```

完了：

```text
Imported as sales

✓ 5 sheets
✓ 3,241 cells
⚠ 1 unsupported pivot table
```

---

## Git

Agentが変更後：

```text
Source Control

M sheets/sales.kdl
```

semantic diff：

```text
42 cells modified
1 formula column added
```

---

# 89. Product Identity

これは、

```text
Excel clone
```

でも、

```text
Word clone
```

でもない。

正式なproduct categoryは、

> **Agent-first Office IDE**

または

> **Programmable Office Workspace**

とする。

中心思想：

> Office document should be editable as data, source code, GUI, and agent operations without choosing only one representation.

---

# 90. 将来拡張

## Slides

将来的に：

```text
Slides IR
+
source
+
visual editor
+
pptx import/export
```

を同一workspaceへ追加可能なarchitectureにしておく。

coreを、

```text
Spreadsheet専用app
```

としてhard-codeしてはいけない。

---

# 91. Plugin Architecture

resource editorを抽象化。

```ts
export interface ResourceEditor {
    type: string;
    open(resourceId: string): Promise<void>;
    getContext(): Promise<EditorContext>;
    applyOperations(operations: Operation[]): Promise<void>;
    serialize(): Promise<string>;
    validate(): Promise<Diagnostic[]>;
}
```

実装：

```text
SpreadsheetEditor
DocumentEditor
FutureSlidesEditor
```

---

# 92. 最重要Acceptance Test

最終的に次の一連の操作が成功すること。

### Scenario A

1. `sales.xlsx`をdrag/drop。
2. Spreadsheetとして表示。
3. KDL Sourceを開く。
4. Agent paneでCodexを起動。
5. A1:D20を選択。
6. 「右に前年比列を追加して」と入力。
7. CodexがSkillを利用。
8. `sheetctl context`を実行。
9. 必要範囲だけ読む。
10. semantic operationでformulaを追加。
11. Spreadsheetが即時更新。
12. KDLも更新。
13. Diffから変更を確認。
14. Undo可能。
15. `sales-edited.xlsx`としてexport。

### Scenario B

1. `report.docx`をdrag/drop。
2. Document editorで表示。
3. 一段落を選択。
4. Claude Codeを起動。
5. 「ここをもっと簡潔に」と入力。
6. Claudeが`docctl context`を実行。
7. 選択部分だけ取得。
8. 文章をreplace。
9. Visual editor即時更新。
10. Djot source更新。
11. Diff確認。
12. Undo可能。
13. DOCXとしてexport。

この2シナリオが、本製品のNorth Star Testである。

---

# 93. Research-backed Constraints

- KDL 2.0.0はstable specificationとして利用できる。
- Djotは高機能だがまだminor syntax changeの可能性があるためsubset/version固定が必要。
- Univer Sheets/Docsには本製品に必要なeditor coreの多くが存在する。
- Univer公式Office import/exportはPro/server側の機能であるため、local-first要件では自前bridgeが必要。
- OOXMLは複数package partで成立するため、単純なHTML/Markdown変換だけをOffice compatibility layerとして使用してはいけない。
- ローカルAgentにはSkill + CLIを基本とし、必要なworkflowだけ発見・利用させる。OpenAI/CursorともSKILL.mdベースのSkillsを採用している。
- Terminal CLIは通常pipeではなくPTYで起動する。portable-ptyはcross-platform interfaceを提供し、xterm.jsはWebView側terminal UIとして利用可能。

---

# 94. 最終指示

まずPhase 0〜2を、将来Phase 3〜6を追加できるarchitectureで実装すること。

prototypeだからといって、

```text
KDLを単なるJSONへ置換する
Agentがsourceをgrep/sedで直接変更する
MCPを全操作の中心にする
xlsxをnative formatにする
Spreadsheet専用architectureにhard-codeする
```

といった設計短縮を行わない。

特に最初に完成させるべき縦方向sliceは、

```text
KDL file
   ↕
Spreadsheet IR
   ↕
Univer Grid
   ↕
semantic operations
   ↕
sheetctl
   ↕
embedded Agent CLI
```

である。

この一本が完全に動いた後に機能を横へ広げる。

**最初から100個の機能が半分動くアプリより、一つのSpreadsheetをGUI・Source・CLI・Agentの4方向から完全に操作できるアプリを先に完成させること。**