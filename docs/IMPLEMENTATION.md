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

<<<<<<< ours
Cell formatting follows the same semantic path as value edits:
=======
Cell formatting now follows the same semantic path as value edits:
>>>>>>> theirs

```text
toolbar → set-cell-style operation → Spreadsheet IR → KDL → grid
```

The supported first slice is bold, italic, foreground/background color, horizontal alignment, and number-format data. Formatting is represented as child nodes on a cell, so source edits and visual edits round-trip without hiding style state in the UI. Named styles, inheritance, borders, and the full number-format renderer are still pending.
<<<<<<< ours

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

## Phase 1 multi-sheet and recovery slice

Sheet tabs and Explorer rows are now derived from the same Workbook IR. `add-sheet`, `activate-sheet`, `rename-sheet`, and `delete-sheet` operations enforce a non-empty workbook and stable IDs. Create, rename, and delete actions are semantic transactions; deleting a sheet is recoverable with one Undo. KDL emits each ID as `sheet "name" id="sheet-id"`, so source round-trips no longer replace sheet identity.

The browser prototype also has a versioned recovery layer:

```text
valid Workbook IR → canonical KDL snapshot → localStorage
page reload → version check → KDL parse + diagnostics → restored Workbook IR
```

Corrupt, unsupported-version, or invalid-KDL snapshots are ignored instead of entering runtime state. The active sheet ID is restored separately. This is a browser safety net for the current prototype, not the specification's final persistence layer; filesystem-backed workspace open/create/save/load through Tauri remains pending.

The original README demo is generated from the Playwright interaction flow at 1280×720 and encoded as a 14-second H.264 MP4. The recorded path covers sheet creation, inline rename, value/formula entry, autosave, full-page reload recovery, sheet switching, delete, and Undo.

## Phase 2 review-first Agent slice

The Agent pane now exercises the real proposal boundary before a CLI or LLM is attached:

```text
natural-language request
  → deterministic local planner
  → proposal with range + operation preview
  → explicit user Apply
  → one Agent-attributed transaction
  → Workbook IR + KDL + Grid + History
  → Undo / Redo
```

The planner currently recognizes average-unit-price, tax-included-sales, high-sales-highlight, and regional-summary requests in English or Japanese. It derives the last populated row from the active Workbook IR, writes formula columns, scans C-column values against thresholds expressed as yen, ten-thousands of yen, or `k`, and groups C-column sales by the F-column region. Regional summary proposals create a collision-free sheet with stable ID, three styled columns, descending totals, record counts, and a grand-total row. The full sample turns 14 source records into five regions with 31 semantic operations. Highlight proposals style only matching A:F rows; the sample `売上50万円以上を強調して` request finds four records and emits 24 operations. Unsupported or zero-match prompts produce suggestions and no operations. This is deliberately labeled `Local planner`: it proves review, data inspection, attribution, operation, and rollback semantics without pretending that a model or CLI process is connected.

The 22-second Agent README demo records every prompt character rather than injecting a finished string. It captures a 1600×900 viewport at 1.5× device scale (2400×1350 source), then uses Lanczos scaling and H.264 CRF 17 to produce a 1920×1080, 20fps artifact. A cinematic camera moves from a quiet hero into the Agent pane, proposal, generated summary, History, Undo, and Redo states. A large pointer travels only to meaningful targets with a visible trail, amber target frame, click ripple, and short Japanese captions. The recorder asserts target arrival, proposal totals, 31-operation application, five-region summary values, Agent attribution, Undo removal with a retained `REVERTED` audit record, Redo returning that record to `APPLIED`, reload recovery, and then decodes the complete MP4 with ffmpeg before accepting the artifact. The same browser run checks zero warning/error output and zero body overflow at desktop and compact viewports. Run it with `bun run demo:record`; design references and constraints are documented in `docs/DEMO-DESIGN.md`.

History is an append-only audit surface, not the Undo stack. Each original transaction stays in History with an `APPLIED` or `REVERTED` state. Undo moves the workbook to the stored `before` snapshot and marks the same transaction `REVERTED`; Redo restores `after` and marks that transaction `APPLIED` without creating a duplicate. The separate internal Undo/Redo stacks track which snapshots can currently be traversed. A new edit clears only the Redo stack—previous reverted audit records remain visible. Agent cards retain the originating transaction ID and derive `Applied`, `Reverted`, or `Re-applied` from that same History entry, including transaction-specific Undo/Redo availability. No independent card status is maintained.

## Keyboard editing slice

Grid cells keep drafts while typing and now commit plus navigate with Enter, Shift+Enter, Tab, and Shift+Tab. Tab wraps to the neighboring row at the visible grid edge. Thousands separators are normalized only for literal values; formulas retain commas so multi-argument functions are not corrupted. Undo/Redo state transitions avoid nested React state-updater side effects, keeping History keys and redo entries unique under development Strict Mode.

## Locked Phase 2 Codex runtime contract

The contract below is now represented by a first connection slice. It is not complete until it compiles and passes a signed-in desktop smoke against the installed Codex version:

```text
React Chat / Activity
  ↕ typed Tauri boundary
Rust process + JSON-RPC owner
  ↕ stdio JSONL
codex app-server
```

Codex uses the official app-server rich-client integration. Office IDE will not scrape the Codex TUI, overlay controls on it, inject a finished fake transcript, or silently route a failed Codex connection to the deterministic local planner. The Rust host owns the process and credentials boundary; the frontend receives normalized events. The installed CLI generates the version-matched wire schema.

The two approval domains remain separate. A Codex command/sandbox/network approval is rendered only from a real server-initiated app-server request. A Spreadsheet or Document mutation is held as an Office semantic Proposal with Apply/Dismiss. Routine work permitted by the configured Codex sandbox receives no extra Office approval.

Codex activity IDs (`threadId`, `turnId`, item ID) correlate execution; Office `transactionId` controls mutation state. Agent cards derive `Applied`, `Reverted`, and `Re-applied` from append-only History instead of storing their own boolean. Undo therefore preserves both the audit entry and card, marks the transaction `REVERTED`, and exposes Redo when available.

Detailed process states, host commands, failure behavior, approval ownership, and acceptance criteria are specified in `docs/AGENT-RUNTIME.md`. Until those acceptance criteria pass against a real signed-in Codex installation, Phase 2 remains partial.

## Phase 2 Codex app-server connection slice

The first real connection slice now exists behind the Tauri boundary:

```text
AgentPane
  ↕ useCodexRuntime + activity reducer
typed Tauri commands / codex://event
  ↕
Rust CodexHost
  ↕ JSONL stdio
codex app-server
```

`CodexHost` owns one child process, stdin/stdout/stderr, monotonic request IDs, pending responses, request timeouts, initialize/initialized ordering, and shutdown. It emits explicit `starting`, `ready`, `error`, and `exited` phases. Invalid JSON and stderr become diagnostics instead of being interpreted as successful Agent output.

The frontend reducer correlates thread, turn, and item IDs; merges streamed agent-message deltas into one card; treats `item/completed` as authoritative; and exposes server-initiated approvals only when the protocol actually requests them. Command/file approvals support Accept, Accept for session, Decline, and Cancel. Browser preview keeps the deterministic planner and labels it `Local planner`; only Tauri desktop attempts the real runtime.

`bun run codex:schema` generates TypeScript and JSON Schema artifacts from the installed Codex CLI. With `codex-cli 0.147.0`, the generator now verifies the four command/file approval literals and updates a compact checked-in `@office-ide/codex-protocol` adapter while ignoring the broad reproducible dump.

The follow-up runtime slice was verified on Ubuntu 24.04 against an existing ChatGPT login. The redacted Bun smoke completed `initialize`, `initialized`, `account/read`, ephemeral `thread/start`, read-only `turn/start`, streamed response collection, and `turn/completed`. The Rust host now rejects a missing login before reporting ready, exposes credential-free process status for WebView reload, supports `thread/resume` and `turn/interrupt`, and emits deterministic disconnected state. The frontend can reattach, reconnect, disconnect, and stop an active turn. Replayed approval requests are deduplicated by JSON-RPC ID; a successful response removes its control exactly once without assuming a non-standard resolved notification.
=======
>>>>>>> theirs
