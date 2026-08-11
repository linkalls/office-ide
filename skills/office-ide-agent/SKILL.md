---
name: office-ide-agent
description: Work safely with an Office IDE spreadsheet through its review-first semantic-operation boundary. Use when inspecting workbook context, reading ranges, or proposing spreadsheet edits in an Office IDE session.
---

# Office IDE Agent

Use `sheetctl` for workbook interaction. It is available only inside the Office IDE Codex session.

## Read workbook state

- Run `sheetctl context` for the active workbook, sheet, dimensions, and frozen panes.
- Run `sheetctl range A1:F10` for bounded, row-major cell data. Keep reads to at most 1,000 cells.

## Propose workbook edits

- Use `sheetctl cell set A1 value` or `sheetctl formula set A1 '=SUM(B1:B10)'` for a requested change.
- For a calculated column, make one grouped request such as `sheetctl formula column G "Average unit price" =ROUND(C2/D2,0)`. This becomes one review card for the entire column, not separate requests for G1, G2, and each filled cell.
- Treat every mutation as a proposal: it is not applied until the user approves it in Office IDE.
- State the affected sheet/range and expected result before requesting a mutation.

## Constraints

- Do not write the KDL source directly to bypass review.
- Do not claim a spreadsheet mutation completed before its proposal has been approved.
- Report unsupported requirements instead of inventing a `sheetctl` command.

## Document resources

- `sheetctl` is deliberately spreadsheet-only. Do not use it for a Djot document such as `report.dj`.
- Use `docctl context` or `docctl selection read` before document work. Use `docctl selection replace <text>` or `docctl append <text>` to create a review card; it is not applied until the user approves it in Office IDE.
- Document edits must stay review-first so the Visual and Source views update atomically. Do not claim to have edited a document unless that card was approved.
