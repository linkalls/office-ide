# Office IDE — Codex handoff

最終更新: 2026-08-09  
対象仕様: `Office IDE — Agent-first Office Suite`  
実装基準: このファイルを含む最新の`main`

## 1. 現在地

このリポジトリは**完成版MVPではない**。現在は次の段階にある。

> Phase 0〜2の主要vertical sliceに加え、XLSX/DOCX compatibility bridge、native workspace save/open・recovery、Git/PTY host、Codex app-server、Djot文書編集とdocctlを実装した状態。完成版MVPではなく、Univer置換・OOXML fidelity・外部変更監視などが残る。

動作している中心経路は以下。

```text
KDL source
  ↕ parse / serialize
Spreadsheet IR
  ↕ semantic operation
editable grid
  ↕ formula calculation
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
| Phase 0 — Foundation | 🟡 | Bun monorepo、React/Vite/Tauri、Explorer、closable tabs、Quick Open、command palette、workspace directory save/open、crash recovery、drag/drop、external source watcherと安全な採用／保持 | 外部版との比較・merge UI |
| Phase 1 — Spreadsheet Core | 🟡 | Spreadsheet IR、KDL parser/serializer、Grid/Source双方向更新、formula、Shift/非連続選択、Ctrl+矢印、fill handle、row/column resize・構造操作、Undo/Redo、autosave | Univer Sheets、Excel完全互換計算、AST-preserving patch、完全KDL 2.0 |
| Phase 2 — Agent Infrastructure | 🟡 | resizable/closable Agent pane、persistent Rust shell、sheetctl/docctl loopback IPC、review proposal、Codex app-serverとmodel/thinking選択、Skill injection、Claude/Cursor/Shell terminal routing | xterm.js/portable-pty、Tauri window内のapproval visual suite、完全semantic diff |
| Phase 3 — XLSX | 🟡 | native importer/exporter、drag/drop、compatibility report、values/formulas/basic styles/dimensions/frozen panes round-trip test | merged cells、charts、drawings、macros、tables、validation、conditional formatting、opaque OOXML preservation |
| Phase 4 — Document Core | 🟡 | Djot source/visual editor、Document Workbench (Source/Diff)、document history、docctl、Document Skill、native workspace documents | Univer Docs、layout.kdl、stable Document IR/block IDs、rich table editing |
| Phase 5 — DOCX | 🟡 | native importer/exporter、drag/drop、basic Djot round-trip test、compatibility report | advanced formatting、headers/footnotes/comments、opaque OOXML preservation |
| Phase 6 — Git / External MCP | 🟡 | native Git status/diff/stage/unstage/commit UI、semantic diff surface | semantic Git diff、external MCP server |
| Phase 0 — Foundation | 🟡 | Bun monorepo、React/Vite shell、Tauri 2/Rustの雛形、Explorer、tabs、command palette、resource-neutralなeditor shell | 実workspace作成/読込/保存、Tauri commandの実接続、Rust toolchain上でのdesktop起動確認 |
| Phase 1 — Spreadsheet Core | 🟡 | Spreadsheet IR、KDL MVP parser/serializer、Grid/Source双方向更新、cell value/formula編集、cell styleの最小semantic operationとKDL round-trip、基本transaction、Undo/Redo | Univer Sheets、完全な数式計算、named style/row/column操作、AST-preserving patch、永続化、完全なKDL 2.0 |
| Phase 2 — Agent Infrastructure | 🟡 | Agent pane、Claude/Codex/Cursor/Shell tabs、context表示、History/Diff/Problems/TerminalのUI surface | xterm.js、portable-pty、CLI launcher、sheetctl、local IPC、Skills、agent transaction、semantic diff実処理 |
| Phase 3 — XLSX | ⬜ | なし | importer/exporter、compatibility report、opaque OOXML preservation |
| Phase 4 — Document Core | ⬜ | Explorer上のdocument見本のみ | Univer Docs、Document IR、Djot、layout KDL、双方向同期、docctl、Document Skill |
| Phase 5 — DOCX | ⬜ | なし | importer/exporter、compatibility report、opaque OOXML preservation |
| Phase 6 — Git / External MCP | ⬜ | Source Diff風の表示surfaceのみ | Git panel、実diff/履歴連携、semantic git diff、任意MCP server |

### MVP機能別

| 分野 | できること | まだできないこと |
| --- | --- | --- |
| Spreadsheet | sample KDLの表示、複数sheetの作成/切替/改名/削除、セル値/式、Shift range選択・相対数式フィル、四則演算・比較・参照・range・集計/論理/文字列/丸め関数、数式エラー診断、bold/italic/color/alignment、row/columnのsize・複数挿入・削除、Sourceとの双方向反映、browser autosave/recovery、Undo/Redo | Univer描画、Excel互換の完全な式評価、named style、ドラッグ選択、sheet間参照、filesystem save/load |
| Document | Djot文書のVisual/Source編集、basic table、source sync、Undo/Redo、native save/load、docctl proposal | Univer Docs、layout KDL、stable Document IR/block ID |
| Agent | Codex app-server、model/thinking、Skill injection、sheetctl/docctl proposal、persistent Shell、Claude/Cursor/Shell terminal routing、review/history | xterm.js/portable-pty、外部providerの専用chat integration、完全semantic diff |
| IDE | Explorer、closable editor tabs、Quick Open、command palette、global search、Source/Diff/History/Problems/Terminal/Git、native workspace/recovery、external source watcher、Light/Dark/System theme | external merge UI、accessibility/visual regression suite |
| Compatibility | XLSX/DOCX import/export、drag/drop、compatibility report、basic round-trip tests | OOXML opaque preservationとadvanced feature fidelity |
| Spreadsheet | sample KDLの表示、セル値/式文字列の編集、bold/italic/color/alignmentの最小style編集、Sourceとの双方向反映、Undo/Redo | Univer描画、完全な式評価、named style、行列操作、複数sheet操作、ファイルsave/load |
| Document | IDE shell内のresource表現 | Djot/Visual editor、Document IR、同期、履歴、保存 |
| Agent | pane、tab、context barのUI | Agent process起動、PTY、prompt送信、sheetctl/docctl、Skill実行 |
| IDE | Explorer、editor tabs、command palette、Source/Diff/History/Problems/Terminal view、responsive layout | quick open、global search、実terminal、実Git、autosave/recovery、Light/System theme |
| Compatibility | なし | XLSX/DOCX import/exportとunsupported feature report |

## 3. 仕様上の重要な未達点

次の見た目は存在するが、backendや実データ処理はまだ接続されていない。

- Terminal: Rust所有のpersistent shellは実装済み。xterm.js/portable-ptyへの置換は未実装。
- Agent tabs: browser previewではlocal plannerのreview/apply経路、Tauri desktopではCodex app-server/Skill injectionとShell launcherが動く。Codexのsigned-in turn smokeは通過済み。Tauri window内のapproval visual integrationは未整備。
- Diff: source diffと限定的semantic summaryはあるが、完全なsemantic diff engineではない。
- Problems: KDL parseと数式構文diagnosticsの表示経路はあるが、仕様書のvalidation項目全体は未実装。
- History: in-memoryのcell/source/Agent変更履歴。Agent attributionと最新transactionのUndo/Redoは動作するが、任意transactionへの永続的revertは未実装。
- Explorer: Spreadsheet/Document一覧はworkspace stateと同期。Asset browserとexternal filesystem watcherは未実装。
- Tauri/Rust: workspace save/open、XLSX/DOCX、Git、shell、Codex hostをコンパイル・Rust unit test済み。

仕様書のNorth Star Scenario A/Bは一部到達している。両方ともnative formatのdrag/drop、Visual/Source、review-first proposal、Undo、exportの経路があるが、Univer・完全なOOXML fidelity・Tauri windowでのend-to-end visual acceptanceは未達。

## 4. 主要ファイル

| Path | 役割 |
| --- | --- |
| `apps/desktop/src/state/useOfficeWorkspace.ts` | UI state、source parse debounce、cell edit、history、Undo/Redo |
| `apps/desktop/src/state/workspacePersistence.ts` | version付きKDL snapshotのautosave/recovery |
| `apps/desktop/src/state/agentPlanner.ts` | local natural-language plannerとreview可能なAgent proposal |
| `scripts/record-agent-demo.ts` | 大型カーソル・軌跡・字幕・クリック波紋付きREADME動画の再現可能な収録/QA |
| `docs/DEMO-DESIGN.md` | 公式製品デモを参照したREADME動画の構成原則とQA基準 |
| `docs/AGENT-RUNTIME.md` | PTY Agent、承認境界、activity可視化、semantic proposalの接続方針 |
| `apps/desktop/src/components/SpreadsheetEditor.tsx` | Spreadsheet editorの交換境界 |
| `apps/desktop/src/components/SpreadsheetGrid.tsx` | 現在の自作grid adapter |
| `apps/desktop/src/components/WorkbenchPanel.tsx` | Source/Diff/History/Problems/Terminal views |
| `packages/core/spreadsheet-ir/src/index.ts` | Spreadsheet IR |
| `packages/core/operations/src/index.ts` | semantic operationとtransaction |
| `packages/formula/src/index.ts` | 基本数式parser/evaluator、range関数、循環参照・error処理 |
| `packages/formula/src/index.test.ts` | formula engineのunit tests 7件 |
| `packages/kdl/src/index.ts` | 最小KDL parser |
| `packages/sheet-source/src/index.ts` | Spreadsheet KDL parse/serialize |
| `packages/sheet-source/src/index.test.ts` | KDL round-tripとdiagnosticsのunit tests 5件 |
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
bun run demo:record
```

一括完了ゲート:

```bash
bun run qa:complete
```

`demo:record`はPlaywrightで実際のUIを操作して動画を生成する必須検証であり、README更新時だけの任意作業ではない。コード変更を完了扱いにする前に毎回実行する。UI変更がない場合も再収録とQAを通し、意図しない表示・操作・recoveryの退行がないことを確認する。UIや操作フローが変わった場合は、収録シナリオとassertionを新しい挙動へ更新し、生成されたMP4とposter画像を一緒にコミットする。

直近の検証結果:

- TypeScript typecheck: pass
- Bun tests: 47 passed / 0 failed
- Vite production build: pass
- Browser QA: 文字単位のAgent prompt入力、地域別集計proposal review、31 operations適用、Agent History、Undo/Redo、Agent cardのReverted/Re-applied同期、reload recoveryがpass。売上50万円以上の4行を検出し24 operations適用/Undoもpass。1600×900と980×760でbody overflowなし、console warning/errorなし
- README media QA: 約22秒/15fps/1920×1080。1600×900 sourceからLanczos変換し、大型カーソルの各target到達、Undo後History REVERTED/Agent card Reverted、Redo後History APPLIED/Agent card Re-appliedを検証し、MP4全体をffmpegで再デコードする
- Rust/Tauri compile: GitHub ActionsのUbuntu 24.04でworkspace check/test/clippyがpass。追加runtime sliceも同じCIで継続検証する
- Codex CLI smoke: `codex-cli 0.147.0`、ChatGPT login、read-only ephemeral turnでpass

## 6. 次に実装する順序

次のvertical sliceは、既存proposal境界へ本物のCodex runtimeを接続する。UIを増やす前にprocess/protocol/error stateを通す。

1. Rust/Codex CLIがあるdesktopで新しいhostをcompileし、signed-in initialize → thread/start → turn/start → turn/completedをsmokeする。
2. `bun run codex:schema`のversion-matched schemaをprotocol packageへ取り込み、tolerant envelope型をgenerated wire typeへ段階的に置換する。
3. process exit後の再起動、thread resume、複数turn、timeout、invalid JSON、approval resolvedをintegration testする。
4. `sheetctl` local IPCを実装し、mutating commandを既存Office Proposalで停止させる。
5. Apply/Undo/RedoとAgent card/Historyのcorrelationを実Codex turnからintegration testする。
6. Claude/Cursor/Shell向けxterm.js/portable-ptyを追加する。Codexの別PTY sessionはapp-server threadと混ぜない。
7. その後、`SpreadsheetEditor`へUniver Sheets adapterを実装する。
8. KDL parserのCST/AST・source span、AST-aware patch、filesystem workspace、XLSX import/exportを順に進める。

### Codex app-server接続の実装契約

この項目はPhase 2で次に実装する仕様であり、現時点では未実装。見た目だけのCodex UI、固定transcript、ANSI出力のscrapingを完成扱いにしない。

#### 正式な接続経路

```text
Office IDE React UI
  ↕ typed Tauri commands / events
Rust Codex host
  ↕ newline-delimited JSON-RPC over stdio
codex app-server
  ↕ local Codex login
Codex runtime
```

- Rust backendだけが`codex app-server` process、stdin/stdout/stderr、request ID、pending response、shutdownを所有する。WebViewへshell権限やCodex credentialを渡さない。
- 起動時は`initialize`のresponseを待ってから`initialized`を送り、readyになる前の`thread/start`や`turn/start`を拒否する。
- promptは`thread/start`または`thread/resume`後に`turn/start`へ送る。`item/started`、delta、`item/completed`、`turn/completed`をTauri event経由で1本のactivity streamへ正規化する。
- wire typeはインストール済みCodex CLIから`codex app-server generate-ts`または`generate-json-schema`で生成する。推測した完全schemaを手書きしない。
- 認証はローカルCodexの既存loginを使う。Office IDEへOpenAI API key入力欄を追加せず、tokenをlog、History、frontend state、workspaceへ保存しない。
- Codexが未install、未login、protocol不一致、handshake timeout、process exitの場合は明示的なerror stateを表示する。local plannerへ黙ってfallbackしてCodexが動いたように見せない。

#### sheetctl capability

DesktopのCodex app-server起動時だけ、Rust hostは短命の`SHEETCTL_ENDPOINT`と`SHEETCTL_TOKEN`を子プロセス環境へ渡す。これらをWebView、KDL、History、prompt、ログへ出してはならない。Codexのsandbox内では次の形式でCLIを使える。

```bash
cargo run -q -p sheetctl -- context
cargo run -q -p sheetctl -- range A1:F10
cargo run -q -p sheetctl -- cell set B2 100
cargo run -q -p sheetctl -- formula set G2 '=ROUND(C2/D2,0)'
```

`sheetctl context`と最大1,000セルの`sheetctl range A1:F10`はread-only JSONを返す。変更コマンドだけがloopback/token認証でOffice IDEへ要求を送り、Workbookを直接変更しない。変更要求は必ずProposalカードで停止し、Apply/DismissでCLIへ結果が返る。配布版のsidecar packagingは次のdesktop packaging sliceで追加する。

#### Chat / Terminalの責務

- **Codex Chat**はapp-serverの構造化eventをOffice IDE native UIへ投影する正式surface。Codex AppやVS Code extensionと同じrich-client方式を使い、Codex画面へ独自UIを重ねない。
- **Codex Activity**は必要に応じてraw JSON-RPC method、command output、stderrを開発者向けに表示できるが、偽のCLI terminalとして装わない。
- **Terminal/PTTY**はClaude、Cursor、Shellなどgeneric CLI providerの正式surface。Codexを外部terminalで開く機能を追加する場合はapp-server sessionとは別sessionであることを明示し、同じthread/activityとして混ぜない。
- Chat/Activityのview切替ではprocess、thread、turnを増やさず、同一app-server sessionを観測する。

#### 二つの承認境界

| 対象 | 承認のowner | Office IDEでの扱い |
| --- | --- | --- |
| Codexのcommand、sandbox、network、filesystem escalation | Codex app-server | server-initiated approval requestをそのまま構造化表示し、documented decisionを返す。独自の二重approvalは作らない |
| Spreadsheet/Documentを変更するsemantic operations | Office IDE | range、operation数、diff、validationをProposal cardで確認し、Apply/Dismissする |
| 通常のworkspace-write内の読み書き | Codex policy | app-serverがapprovalを要求しない限り、Office IDE側で余計なApproveを挟まない |

Codexのapproval cardはapp-server requestが存在するときだけ表示する。Terminalの文字列を監視してApprove buttonを推測生成してはいけない。

#### transactionとAgent cardの唯一の状態源

Office変更をApplyした時点で、Agent cardへ独立した`applied: true`を保存しない。cardは`transactionId`、Codexの`threadId`、`turnId`、可能ならtool item IDだけを保持し、表示状態をappend-only Historyから導出する。

```text
Proposal → Applied → Reverted → Re-applied
```

- Apply: Historyにtransactionを追加し`APPLIED`。cardは`Applied`。
- Undo: transactionを削除せず`REVERTED`へ更新。cardは`Reverted`と`Redo available`。
- Redo: 同じtransactionを`APPLIED`へ戻す。cardは`Re-applied`。History entryやcardを重複追加しない。
- 新しい変更後にRedo stackが消えても、過去の`REVERTED` History entryは残す。
- app-serverのturn完了状態とOffice transaction状態を混同しない。Codex turnが成功してもProposalが未適用ならcardは`Proposal`のまま。

#### 完了判定

1. 実Codex CLIがinstall/login済みのdesktop環境でapp-serverを起動し、initializeからturn completionまで通る。
2. promptを1回送るとthread/turnが1つだけ作られ、streamed responseとtool activityがChatへ重複なく表示される。
3. app-serverが要求したapprovalだけが表示され、Accept/Accept for session/Decline/Cancelのresponseが対応request IDへ返る。
4. mutating `sheetctl` callはIRを直接変更せずProposalで停止し、Apply後だけ1 semantic transactionとして反映される。
5. Apply → Undo → RedoでHistoryとAgent cardが`APPLIED → REVERTED → APPLIED`へ同期し、監査記録は消えない。
6. Codex未install、未login、異常終了、invalid JSON、timeoutから安全に復旧でき、fake successを表示しない。
7. generated schemaとの差分、Rust unit test、frontend reducer test、Tauri integration smoke testを通す。

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
- formula engineは独自subset。集計、論理、文字列、丸めの主要関数と相対fillには対応したが、Excel完全互換、日付、配列、named range、sheet間参照は未実装。
- named style、継承、border、number-format rendererは未実装。
- version付きbrowser autosave/recoveryはあるが、filesystem persistenceとworkspace pickerは未実装。
- UIはLight/Dark/System themeを選択・保存できる。
- Agent plannerは平均単価/税込売上/売上しきい値強調/地域別集計sheetの4レシピに限定した決定的rule engineで、LLMや実CLIではない。PTY Agentと承認境界の設計は`docs/AGENT-RUNTIME.md`に固定済み。
- unit testsはformula/sheet-source/operations/persistence/agent-planner/history/Codex runtime reducer/document plannerを含む。`bun run codex:smoke --turn`は実CLIのread-only ephemeral turnを検証する。`bun run qa:complete`はtypecheck/tests/build/demo QAを通す。Tauri window内のapproval/exit visual integration suiteは未整備。

## 9. Codexへの作業ルール

- 変更前にこのファイルと`docs/IMPLEMENTATION.md`を読む。
- 1回の作業では上記「次に実装する順序」の1項目を完了可能な範囲へ分割する。
- UIだけ追加して完了扱いにしない。Implementation、tests、error state、keyboard、persistence、Undoの該当項目を確認する。
- 既存の双方向vertical sliceを壊さない。
- Bun scriptsを使い、完了時に`bun run qa:complete`を実行する。これはtypecheck、tests、buildに加えてPlaywrightによる実UI操作と動画生成を含む。動画生成を省略して完了扱いにしない。
- Playwright収録は対象フローを実際に操作し、console warning/error、framework overlay、viewport overflow、主要state transition、reload recovery、生成MP4の再デコードを検証する。UI変更で既存シナリオが古くなった場合は`scripts/record-agent-demo.ts`の操作とassertionも同じ変更内で更新する。
- UIや操作フローが変わった場合は`docs/media/office-ide-agent-demo.mp4`と`docs/images/office-ide-agent-*.png`を再生成してコミットする。非UI変更でも`bun run demo:record`を実行し、再生成物に意図しない差分がないことを確認する。
- 実装範囲と未達をこのファイルへ追記し、コミット単位で現在地を更新する。
