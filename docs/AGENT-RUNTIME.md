# Agent runtime and approval boundaries

## Product model

```text
Codex app-server           = Codex thread/turn runtime
app-server event stream    = observable execution and approvals
semantic proposal          = reviewable Office mutation
PTY                        = raw terminal view and non-Codex providers
```

The final Agent pane has two view layers beneath each provider tab:

- **Chat** renders prompts, tool activity, semantic proposals, applied results, errors, and transaction state as native Office IDE cards.
- **Terminal** attaches xterm.js to a real terminal client or provider PTY. It is not a simulated transcript. Codex uses its official app-server integration rather than scraping ANSI output.

Both views observe one process session and one activity stream. Switching views must not start another Agent or duplicate messages. For Codex, the Office IDE host initializes `codex app-server`, starts or resumes a thread, and projects `turn/*`, `item/*`, approval, diff, and streamed message events into Chat.

## Codex integration

Codex is a first-class structured provider, not a generic terminal parser.

1. Start `codex app-server` locally using its stable stdio JSONL transport.
2. Send `initialize`/`initialized` with `clientInfo.name = "office_ide"`.
3. Generate TypeScript or JSON Schema definitions from the installed CLI version with `codex app-server generate-ts` or `generate-json-schema`; do not maintain guessed wire types.
4. Use `thread/start` or `thread/resume`, then `turn/start` for prompts.
5. Project `item/started`, `item/completed`, agent-message deltas, command-output deltas, and `turn/completed` into the shared activity stream.
6. Render app-server command/file approval requests in the Codex client surface and return the documented decision payload. This is the actual Codex approval lifecycle, not a second Office-specific approval engine.
7. Keep Office semantic proposals separate and correlate them to the originating Codex `threadId`, `turnId`, and tool item.

The app-server WebSocket transport is currently documented as experimental, so the first implementation uses local stdio. The generic PTY path remains for Claude/Cursor/Shell and for an optional raw terminal surface.

## Approval ownership

Office IDE must not recreate every CLI approval in its own UI.

| Boundary | Owner | Surface |
| --- | --- | --- |
| Codex command, sandbox escape, network, filesystem access | Codex app-server | Structured app-server approval request |
| Other provider CLI approval | Provider CLI | Terminal/PTTY prompt |
| Spreadsheet/Document semantic transaction | Office IDE | Chat proposal card with Apply/Dismiss |
| Import/export overwrite or destructive workspace action | Office IDE host | Explicit host confirmation |

For Codex, `workspace-write` allows routine edits and commands inside the workspace without a prompt; approvals are for crossing configured sandbox/network boundaries. Office IDE should preserve that CLI policy rather than implementing a second approval engine. See OpenAI's [Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security) documentation.

## Runtime flow

1. Rust starts Codex app-server or a provider CLI with the workspace as its working directory.
2. The Codex adapter consumes JSON-RPC events; xterm.js renders real PTY input/output for terminal providers.
3. A shared activity adapter normalizes supported provider events and `sheetctl`/`docctl` IPC calls.
4. Read-only context operations return immediately and appear as activity rows in Chat.
5. A mutating `sheetctl`/`docctl` call creates a pending semantic transaction instead of editing source text directly.
6. Chat renders its range, operation count, preview, validation result, and actor.
7. Apply commits the transaction to IR; Dismiss returns a structured rejection to the waiting CLI call.
8. History keeps the transaction permanently as `APPLIED` or `REVERTED`.

## Implementation order

1. Rust Codex app-server stdio lifecycle and version-matched generated schema.
2. Codex thread/turn/event/approval adapter.
3. Structured activity bus shared by Chat and Terminal.
4. `xterm.js` plus Rust `portable-pty` for Claude/Cursor/Shell and raw terminal access.
5. `sheetctl` local IPC with read-only context/range commands.
6. Blocking semantic proposal handshake for mutating commands.
7. KDL Split editor mode, then XLSX import/export.

Do not scrape Codex ANSI output or add a fake CLI transcript while steps 1–3 are incomplete. See the official [Codex app-server documentation](https://developers.openai.com/codex/app-server).
