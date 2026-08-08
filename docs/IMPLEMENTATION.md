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
