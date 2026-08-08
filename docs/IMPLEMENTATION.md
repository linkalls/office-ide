# Phase 0 implementation notes

## Implemented vertical slice

```text
KDL source
  ↕
Spreadsheet IR
  ↕
semantic operation
  ↕
editable grid
  ↕
history / undo
```

The grid is currently a small in-house adapter used to verify contracts and UI behavior. `SpreadsheetEditor` is deliberately isolated so Univer Sheets can replace this adapter without changing the KDL, IR, transaction, workspace, or editor-shell contracts.

## Design system

- Background: true near-black graphite (`#080d14`)
- Surfaces: cool navy steps (`#0b111b` through `#172333`)
- Accent: electric cobalt (`#2f81f7`)
- Container model: IDE rails, resizable-pane-ready regions, tab strips, grid, source workbench, status bar
- Typography: Noto Sans JP Variable for Japanese-safe UI; system monospace with Noto fallback for KDL and terminal content
- Icons: Lucide, 13–17px, restrained outline treatment

## Fidelity ledger

| Comparison point | Concept | Implementation | Result |
| --- | --- | --- | --- |
| Overall skeleton | Explorer / grid+source / agent | Same three-region IDE layout | Matched |
| Palette | Graphite, navy, cobalt | Tokenized equivalent palette | Matched |
| Editor density | Compact spreadsheet chrome | 36px formula row, 38px toolbar, 25px cells | Matched |
| Workbench | Grid, Source, Diff, History, Problems, Terminal | Same tab family with working state | Matched |
| Agent context | Resource, sheet, selection, active cell | Same context fields and agent tabs | Matched |
| Typography | Japanese UI plus monospace source | Bundled Noto Sans JP plus monospace fallback | Matched |
| Responsive behavior | Desktop-first dense IDE | 980px compact layout with overlay agent pane and zero body overflow | Extended consistently |

## Intentional MVP deviations

- The spreadsheet renderer is not Univer Sheets yet. It is a contract-validating adapter for Phase 0.
- Source editing uses a styled native textarea instead of CodeMirror 6.
- The embedded terminal is a functional UI surface; PTY transport lands in Phase 2.
- Rust/Tauri source is present, but Rust compilation requires a machine with the Rust toolchain installed.

## Phase 1 formatting slice

Cell formatting follows the same semantic path as value edits:

```text
toolbar → set-cell-style operation → Spreadsheet IR → KDL → grid
```

The supported first slice is bold, italic, foreground/background color, horizontal alignment, and number-format data. Formatting is represented as child nodes on a cell, so source edits and visual edits round-trip without hiding style state in the UI. Named styles, inheritance, borders, and the full number-format renderer are still pending.

## Phase 1 row and column dimensions

The selected row height and column width use the same semantic path:

```text
toolbar input → set-row-height / set-column-width → Spreadsheet IR → KDL → grid
```

KDL uses `column "B" width=24` and `row 2 height=40`. Invalid non-positive dimensions produce diagnostics. Both visual edits and source edits round-trip, and snapshot history makes the changes undoable and redoable. Drag handles remain pending.

## Phase 1 structural editing slice

The toolbar can insert or delete the active row and column through semantic operations:

```text
+R / −R / +C / −C
  → insert/delete operation
  → shift cell addresses, dimensions, and A1 formula references
  → Spreadsheet IR → KDL → grid
```

The transformer supports base-26 columns such as `Z` and `AA`, preserves `$` markers in absolute references, emits `#REF!` for direct references to deleted cells, and rejects invalid positions. Snapshot history keeps all four operations undoable. Multi-row/column commands, range-selection UX, and Excel-complete formula rewrite semantics remain pending.

## Phase 1 formula engine slice

Formula evaluation is isolated in `@office-ide/formula` and consumes Spreadsheet IR directly:

```text
KDL formula → Spreadsheet IR → parser/evaluator → calculated Grid value
                                      ↓
                           Source / Problems diagnostics
```

The first slice supports arithmetic and exponentiation, parentheses and unary operators, comparisons, string concatenation, booleans, cell/range references, and `SUM`, `COUNT`, `AVERAGE`, `MIN`, `MAX`, and lazy `IF`. Recursive references are cached; circular references and common spreadsheet errors render as `#CYCLE!`, `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, or `#ERROR!`. Malformed formulas remain in the IR/source, appear as an error in the Grid and Problems view, and Undo restores both the previous formula and diagnostics state.

The function set also includes `ABS`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `AND`, `OR`, `NOT`, `COUNTA`, `CONCAT`, `CONCATENATE`, `LEN`, `LOWER`, `UPPER`, `LEFT`, `RIGHT`, and `MID`. This is intentionally an Excel-like subset, not an Excel-complete engine. Date/time functions, arrays, named ranges, cross-sheet references, locale-specific syntax, and the larger function catalog remain pending.

## Phase 1 range and formula-fill slice

Grid inputs now keep a local draft while typing and commit on Enter or blur, preventing partial formulas from being replaced by transient calculation errors. Shift-click extends the active selection and drives two semantic workflows:

```text
formula cell → Shift-click range → Σ → fill-formula transaction
selected range → +R / −R / +C / −C → count-aware structure transaction
```

`fill-formula` translates row and column references from the active source cell across the range, preserves `$` absolute markers and quoted A1-like text, retains each destination style, serializes every generated formula to KDL, and is reverted by one Undo. Row and column controls use the selected span as their operation count, so multiple rows or columns move in a single transaction.
