# Office IDE — Codex handoff

最終更新: 2026-08-08  
対象仕様: `Office IDE — Agent-first Office Suite`  
実装基準コミット: `29c0e5cf8064bf41fa092b623505caefabf69b75` (`Add Phase 0 implementation`)

## 1. 現在地

このリポジトリは**完成版MVPではない**。現在は次の段階にある。

> Phase 0の大部分を組み、Phase 1の最小vertical sliceを自作gridで検証した状態。

動作している中心経路は以下。

```text
KDL source
  ↕ parse / serialize
Spreadsheet IR
  ↕ semantic operation
editable grid
  ↕
history / undo / redo
```

セルをVisual側で編集するとsemantic operationが作られ、IRとKDL sourceが更新される。Source側を編集すると約260ms後にparseされ、validならGridへ反映される。parse error時は入力中のsourceを保持し、Gridは最後のvalid IRを表示し続ける。

ただし現状のGridはUniver Sheetsではなく、契約とUIを確認するための小さな自作adapterである。`SpreadsheetEditor`を境界として、今後Univerへ差し替える前提になっている。

## 2. 仕様書との対応

状態の意味:

- ✅ 実装済み: 現在の範囲で動作と検証ができる
- 🟡 部分実装: UIまたは最小contractのみ。仕様の受け入れ条件は未達
- ⬜ 未実装

| 仕様書 | 状態 | 現在の実装 | 残作業 |
| --- | --- | --- | --- |
| Phase 0 — Foundation | 🟡 | Bun monorepo、React/Vite shell、Tauri 2/Rustの雛形、Explorer、tabs、command palette、resource-neutralなeditor shell | 実workspace作成/読込/保存、Tauri commandの実接続、Rust toolchain上でのdesktop起動確認 |
| Phase 1 — Spreadsheet Core | 🟡 | Spreadsheet IR、KDL MVP parser/serializer、Grid/Source双方向更新、cell value/formula編集、基本transaction、Undo/Redo | Univer Sheets、数式計算、style/row/column操作、AST-preserving patch、永続化、完全なKDL 2.0 |
| Phase 2 — Agent Infrastructure | 🟡 | Agent pane、Claude/Codex/Cursor/Shell tabs、context表示、History/Diff/Problems/TerminalのUI surface | xterm.js、portable-pty、CLI launcher、sheetctl、local IPC、Skills、agent transaction、semantic diff実処理 |
| Phase 3 — XLSX | ⬜ | なし | importer/exporter、compatibility report、opaque OOXML preservation |
| Phase 4 — Document Core | ⬜ | Explorer上のdocument見本のみ | Univer Docs、Document IR、Djot、layout KDL、双方向同期、docctl、Document Skill |
| Phase 5 — DOCX | ⬜ | なし | importer/exporter、compatibility report、opaque OOXML preservation |
| Phase 6 — Git / External MCP | ⬜ | Source Diff風の表示surfaceのみ | Git panel、実diff/履歴連携、semantic git diff、任意MCP server |

### MVP機能別

| 分野 | できること | まだできないこと |
| --- | --- | --- |
| Spreadsheet | sample KDLの表示、セル値/式文字列の編集、Sourceとの双方向反映、Undo/Redo | Univer描画、式評価、style、行列操作、複数sheet操作、ファイルsave/load |
| Document | IDE shell内のresource表現 | Djot/Visual editor、Document IR、同期、履歴、保存 |
| Agent | pane、tab、context barのUI | Agent process起動、PTY、prompt送信、sheetctl/docctl、Skill実行 |
| IDE | Explorer、editor tabs、command palette、Source/Diff/History/Problems/Terminal view、responsive layout | quick open、global search、実terminal、実Git、autosave/recovery、Light/System theme |
| Compatibility | なし | XLSX/DOCX import/exportとunsupported feature report |

## 3. 仕様上の重要な未達点

次の見た目は存在するが、backendや実データ処理はまだ接続されていない。

- Terminal: UI surfaceのみ。xterm.jsとPTY transportは未実装。
- Agent tabs: 切り替え用UIのみ。CLI processは起動しない。
- Diff: 表示デモ。source/semantic diff engineではない。
- Problems: KDL parse diagnosticsの表示経路はあるが、仕様書のvalidation項目全体は未実装。
- History: in-memoryのcell/source変更履歴。任意transactionへの永続的revertやagent attributionは未実装。
- Explorer: sample resource tree。filesystem-backed workspaceではない。
- Tauri/Rust: sourceとcrate構成はあるが、Rust compilerがない環境だったためcompile未確認。

仕様書のNorth Star Scenario A/Bはいずれも未達。現状はScenario Aの「KDL source ↔ spreadsheet visual ↔ Undo」のごく一部だけを、sample dataと自作gridで確認できる。

## 4. 主要ファイル

| Path | 役割 |
| --- | --- |
| `apps/desktop/src/state/useOfficeWorkspace.ts` | UI state、source parse debounce、cell edit、history、Undo/Redo |
| `apps/desktop/src/components/SpreadsheetEditor.tsx` | Spreadsheet editorの交換境界 |
| `apps/desktop/src/components/SpreadsheetGrid.tsx` | 現在の自作grid adapter |
| `apps/desktop/src/components/WorkbenchPanel.tsx` | Source/Diff/History/Problems/Terminal views |
| `packages/core/spreadsheet-ir/src/index.ts` | Spreadsheet IR |
| `packages/core/operations/src/index.ts` | semantic operationとtransaction |
| `packages/kdl/src/index.ts` | 最小KDL parser |
| `packages/sheet-source/src/index.ts` | Spreadsheet KDL parse/serialize |
| `packages/sheet-source/src/index.test.ts` | 現在のunit tests 3件 |
| `packages/core/protocol/src/index.ts` | editor/diagnostic/context contract |
| `apps/desktop/src-tauri/` | Tauri appの雛形 |
| `crates/office-core/`, `crates/ipc/` | Rust core/IPCの雛形 |
| `docs/IMPLEMENTATION.md` | UI fidelityとMVP deviationの短い記録 |

## 5. 実行と検証

Bunを使う。Node/npm前提のcommandへ置き換えないこと。

```bash
bun install
bun run dev
```

desktop shell:

```bash
bun run tauri dev
```

検証:

```bash
bun run typecheck
bun test
bun run build
```

直近の検証結果:

- TypeScript typecheck: pass
- Bun tests: 3 passed / 0 failed
- Vite production build: pass
- Browser QA: 1440×900と980×760でbody overflowなし、console warning/errorなし
- Rust/Tauri compile: 未確認（検証環境にRust toolchainなし）

## 6. 次に実装する順序

最初にPhase 1の受け入れ条件を本物の構成で満たす。

1. `SpreadsheetEditor`へUniver Sheets adapterを実装する。
2. Visual editを既存のsemantic operationへ変換し、IRを唯一のruntime stateに保つ。
3. KDL parserをKDL 2.0対応へ進め、CST/ASTとsource spanを保持する。
4. serializerの全体再生成をやめ、コメントとformatを保つAST-aware patchを実装する。
5. workspace directoryのopen/create/save/loadをTauri command経由で実装する。
6. formula、style、row/columnのoperationとtestsを追加する。
7. integration testで `source → IR → visual` と `visual → operation → IR → source` を固定する。
8. その後にPhase 2としてxterm.js、portable-pty、local IPC、`sheetctl`を接続する。

最小の次ゴール:

```text
bun run tauri dev
→ workspaceを開く
→ sales.kdlをUniverで表示
→ GridとSourceのどちらから編集しても相互反映
→ saveして再起動後も保持
→ Undo/Redo可能
```

## 7. 実装時に維持する設計原則

元仕様書の次の制約は変更しない。

1. Spreadsheet native sourceはKDL、Document native sourceはDjot + KDL。
2. `.xlsx` / `.docx` はnative formatではなくcompatibility format。
3. GUI、Source、CLI、AgentはIRを操作する。
4. 変更はsemantic transactionとして記録し、Undo/Diff/Review可能にする。
5. KDL/Djotを文字列置換で編集しない。source AST patchを使う。
6. parse error時にsourceを破棄せず、Visualは最後のvalid IRを維持する。
7. 未対応OOXMLを黙って落とさず、compatibility reportとopaque preservationを行う。
8. local Agentの中心はSkills + CLI。MCPは外部client向けの任意機能。
9. resource typeに依存しないshellを保ち、Spreadsheet専用architectureにしない。
10. Agent/Terminal processはRust backendで管理し、WebViewへ無制限shell権限を渡さない。

## 8. 現在の既知の技術的負債

- `packages/kdl`は仕様準拠parserではなくMVP subset。
- Source編集はCodeMirror 6ではなくnative `textarea`。
- serializerはsource全体を再生成するため、コメントと元formatを保持しない。
- source編集で作るtransactionのoperationsは空配列で、semantic diff/inverse operationが不足。
- Undo/Redoはworkbook snapshot方式。仕様のinverse operation方式ではない。
- formulaは文字列として保持するだけで計算しない。
- style fieldはIRにあるがsource parsing/rendering/editingへ未接続。
- sample workbookがReact module内の初期stateで、filesystem persistenceがない。
- UIはdark themeのみ。
- unit testsはsheet-sourceの3件だけで、integration/round-trip/visual regressionは未整備。

## 9. Codexへの作業ルール

- 変更前にこのファイルと`docs/IMPLEMENTATION.md`を読む。
- 1回の作業では上記「次に実装する順序」の1項目を完了可能な範囲へ分割する。
- UIだけ追加して完了扱いにしない。Implementation、tests、error state、keyboard、persistence、Undoの該当項目を確認する。
- 既存の双方向vertical sliceを壊さない。
- Bun scriptsを使い、完了時にtypecheck、tests、buildを実行する。
- 実装範囲と未達をこのファイルへ追記し、コミット単位で現在地を更新する。

