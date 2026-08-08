# Agent runtime and approval boundaries

## Product model

```text
portable-pty + real CLI process = the Agent
Office IDE activity stream      = observable execution
semantic proposal               = reviewable Office mutation
```

The final Agent pane has two view layers beneath each provider tab:

- **Chat** renders prompts, tool activity, semantic proposals, applied results, errors, and transaction state as native Office IDE cards.
- **Terminal** attaches xterm.js directly to the real Codex, Claude, Cursor, or shell PTY. It is not a simulated transcript.

Both views observe one process session and one activity stream. Switching views must not start another Agent or duplicate messages.

## Approval ownership

Office IDE must not recreate every CLI approval in its own UI.

| Boundary | Owner | Surface |
| --- | --- | --- |
| CLI command, sandbox escape, network, filesystem access | Agent CLI | Terminal/PTTY approval prompt |
| Spreadsheet/Document semantic transaction | Office IDE | Chat proposal card with Apply/Dismiss |
| Import/export overwrite or destructive workspace action | Office IDE host | Explicit host confirmation |

For Codex, `workspace-write` allows routine edits and commands inside the workspace without a prompt; approvals are for crossing configured sandbox/network boundaries. Office IDE should preserve that CLI policy rather than implementing a second approval engine. See OpenAI's [Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security) documentation.

## Runtime flow

1. Rust starts the provider CLI under `portable-pty` with the workspace as its working directory.
2. xterm.js renders raw terminal input/output without rewriting the CLI interaction.
3. A structured activity adapter observes supported CLI events and `sheetctl`/`docctl` IPC calls.
4. Read-only context operations return immediately and appear as activity rows in Chat.
5. A mutating `sheetctl`/`docctl` call creates a pending semantic transaction instead of editing source text directly.
6. Chat renders its range, operation count, preview, validation result, and actor.
7. Apply commits the transaction to IR; Dismiss returns a structured rejection to the waiting CLI call.
8. History keeps the transaction permanently as `APPLIED` or `REVERTED`.

## Implementation order

1. `xterm.js` surface and resize-safe terminal adapter.
2. Rust `portable-pty` lifecycle: spawn, input, output, resize, exit, interrupt.
3. Provider launch profiles for Codex/Claude/Cursor/Shell.
4. Structured activity bus shared by Chat and Terminal.
5. `sheetctl` local IPC with read-only context/range commands.
6. Blocking semantic proposal handshake for mutating commands.
7. KDL Split editor mode, then XLSX import/export.

Do not add a fake CLI transcript while steps 1–3 are incomplete.
