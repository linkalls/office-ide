# Office IDE

Agent-first Office Suite。Spreadsheet / Document / Source / Git / Terminal / Agentを、同じローカルworkspaceで扱うためのデスクトップIDEです。

現在の実装はPhase 0と最初の縦方向sliceを対象にしています。

- React + TypeScript + ViteによるIDE shell
- Tauri 2 / Rust IPCの土台
- resource typeに依存しないExplorerとeditor tab
- Spreadsheet IR
- KDL sourceのparse / serialize
- semantic operationとUndo / Redo
- GridとSourceの双方向更新デモ
- Agent context pane、Diff、History、Problems、Terminal surface
- command paletteとkeyboard shortcuts

## 開発

```bash
bun install
bun run dev
```

Desktop shellを起動する場合：

```bash
bun run tauri dev
```

## 検証

```bash
bun run typecheck
bun test
bun run build
```

## 次の実装

1. Univer Sheets adapterを`ResourceEditor`として接続
2. KDL 2.0完全parserへ差し替え
3. Tauri channel + `portable-pty`によるterminal接続
4. `sheetctl`とlocal IPC
5. AST-preserving source patch
