# Agent runtime and approval boundaries

## Implementation status (2026-08-09)

The first Tauri connection slice is implemented in `apps/desktop/src-tauri/src/codex_host.rs`, `apps/desktop/src/state/codexRuntime.ts`, and `apps/desktop/src/state/useCodexRuntime.ts`.

- Implemented: single Rust-owned child process, JSONL stdio, request routing, 20-second timeout, initialize → initialized ordering, account/read authentication gate, thread start/resume, turn start/interrupt, host status/reattach, explicit reconnect/disconnect, stderr/protocol diagnostics, shutdown, normalized frontend event reducer, streamed Agent message merging, turn/error states, and four-way command/file approval decisions.
- Preserved: browser preview is explicitly the local planner; desktop connection failures never silently masquerade as Codex success; Office semantic Apply remains separate from Codex runtime approval.
- Verified with `codex-cli 0.147.0` and an existing ChatGPT login: version-matched schema generation, `initialize → initialized → account/read → cwd-scoped thread/list → ephemeral thread/start → turn/start → streamed marker → turn/completed`. The smoke uses read-only sandboxing, no approvals, and does not retain the thread.
- Verification still required in the actual Tauri window: real server-initiated approval round-trip, visual reconnect/cancel interaction, and process-exit recovery while a turn is active.

`bun run codex:schema` generates the installed CLI's complete bindings into an ignored directory, verifies the shared command/file approval literals, and updates the compact checked-in `@office-ide/codex-protocol` adapter. `bun run codex:smoke --turn` runs the redacted real-CLI lifecycle check. For development only, `CODEX_APP_SERVER_BIN` may override the executable and `CODEX_APP_SERVER_PREFIX_ARGS` may provide a JSON array of launcher arguments; production continues to invoke `codex app-server` directly.

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

For Codex, “Terminal” must not mean drawing Office IDE controls over the Codex TUI or scraping its ANSI output. The official app-server connection is the canonical session. A raw Activity/Protocol view may expose the same app-server events for debugging. A separately launched Codex CLI PTY is a separate session and must be labeled as such; its output must not be merged into the app-server thread.

## Codex integration

Codex is a first-class structured provider, not a generic terminal parser.

1. Start `codex app-server` locally using its stable stdio JSONL transport.
2. Send `initialize`/`initialized` with `clientInfo.name = "office_ide"`.
3. Generate TypeScript or JSON Schema definitions from the installed CLI version with `codex app-server generate-ts` or `generate-json-schema`; do not maintain guessed wire types.
4. Use `thread/start` or `thread/resume`, then `turn/start` for prompts.
5. Project `item/started`, `item/completed`, agent-message deltas, command-output deltas, and `turn/completed` into the shared activity stream.
6. Render app-server command/file approval requests in the Codex client surface and return the documented decision payload. This is the actual Codex approval lifecycle, not a second Office-specific approval engine.
7. Keep Office semantic proposals separate and correlate them to the originating Codex `threadId`, `turnId`, and tool item.

Authentication comes from the local Codex installation and its existing login. Office IDE does not collect an OpenAI API key for this path, copy Codex tokens into the workspace, or expose credentials to the WebView. Missing installation and missing login are explicit connection states, never silent fallbacks to the local demo planner.

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

The Codex approval component exists only while app-server has an outstanding server-initiated request. It keeps the JSON-RPC request ID and returns exactly one documented decision. Closing the pane does not imply acceptance. Disconnecting or cancelling resolves the request as cancelled where supported. Office IDE must never infer approval state from terminal text.

## Process and protocol state

The Rust host is the sole owner of the child process and transport.

| State | Entered when | Allowed actions | Exit behavior |
| --- | --- | --- | --- |
| `disconnected` | initial state or clean stop | start | no process or writer retained |
| `starting` | process spawned | stop | buffer no turns; wait for initialize response |
| `ready` | initialize response received and initialized sent | thread start/resume, turn start, approval response, stop | emit structured connection status |
| `busy` | a turn is active | stream events, approval response, cancel, stop | return to ready on turn completion |
| `failed` | spawn, protocol, timeout, auth, or unexpected-exit failure | retry, stop | preserve diagnostic without credentials |

Each client request has a monotonic ID and one pending response waiter. A timeout removes that waiter. Responses are matched by ID; server notifications and server-initiated requests enter the event stream. Invalid JSON is reported with bounded, redacted context and does not become a fake activity item. Shutdown closes stdin, cancels pending waiters, terminates the owned child, and emits one disconnected event.

The initial desktop command surface is intentionally narrow:

| Host command | Responsibility |
| --- | --- |
| `codex_app_server_start(workspace)` | validate workspace, spawn app-server, complete handshake |
| `codex_thread_start(options)` | create a thread after ready |
| `codex_thread_resume(thread_id)` | resume an existing thread after ready |
| `codex_turn_start(thread_id, prompt)` | submit user input and return the turn identity |
| `codex_approval_respond(request_id, decision)` | resolve one outstanding app-server approval |
| `codex_turn_cancel(thread_id, turn_id)` | cancel the active turn |
| `codex_app_server_stop()` | deterministic process cleanup |

Frontend code consumes typed Tauri events and never writes directly to child stdin. Version-matched generated types are checked into the adapter boundary or generated as part of setup; handwritten application types may normalize events but do not replace the generated wire schema.

## Activity correlation

Activity identity and Office transaction identity are related but not interchangeable.

| Data | Source | Purpose |
| --- | --- | --- |
| `threadId`, `turnId`, item ID | Codex app-server | conversation and tool execution correlation |
| `transactionId` | Office IDE operation engine | mutation, History, Undo/Redo, semantic diff |
| Agent card lifecycle | derived from both | `Proposal` until Apply, then History-derived transaction state |

An Agent card stores correlation IDs, not an independent applied boolean. Its Office lifecycle is:

```text
Proposal → Applied → Reverted → Re-applied
```

Undo marks the original History entry `REVERTED`; it does not delete it. Redo marks the same entry `APPLIED`; it does not create another card or transaction. A completed Codex turn does not imply that a pending Office proposal was applied.

## Runtime flow

1. Rust starts Codex app-server or a provider CLI with the workspace as its working directory.
2. The Codex adapter consumes JSON-RPC events; xterm.js renders real PTY input/output for terminal providers.
3. A shared activity adapter normalizes supported provider events and `sheetctl`/`docctl` IPC calls.
4. Read-only context operations return immediately and appear as activity rows in Chat.
5. A mutating `sheetctl`/`docctl` call creates a pending semantic transaction instead of editing source text directly.
6. Chat renders its range, operation count, preview, validation result, and actor.
7. Apply commits the transaction to IR; Dismiss returns a structured rejection to the waiting CLI call.
8. History keeps the transaction permanently as `APPLIED` or `REVERTED`.

## Failure and recovery requirements

- `codex` not found: show install/setup guidance and keep the provider disconnected.
- not authenticated: show login guidance from Codex without requesting or logging a token.
- handshake timeout or incompatible protocol: stop the child, clear pending requests, show the installed Codex version when safely available.
- unexpected process exit: keep completed activity and Office History, fail the active turn, and allow an explicit reconnect.
- UI reload: never claim the old process is live; query host status and resume only when the Rust-owned session still exists.
- local planner fallback: only an explicit user-selected demo/development mode may use it. It must stay labeled `Local planner` and must not impersonate Codex.

## Acceptance criteria

1. A signed-in desktop installation completes `initialize → initialized → thread/start → turn/start → turn/completed` against a real local Codex app-server.
2. One prompt creates one turn and every streamed item is deduplicated by its stable correlation identity.
3. Only real server-initiated approvals render approval controls, and each control resolves its original request ID exactly once.
4. A mutating Office tool call blocks at a semantic Proposal; Apply produces one transaction and Dismiss produces none.
5. Apply, Undo, and Redo keep Agent card and append-only History synchronized without deleting or duplicating audit records.
6. Disconnect, cancellation, invalid input, missing Codex, missing login, timeout, and child exit all have tested non-success states.
7. Tests cover protocol parsing/request routing in Rust, activity/lifecycle reduction in TypeScript, and a real Tauri smoke path where Codex is available.

## Implementation order

1. ✅ Compile the Rust host in CI and smoke stdio lifecycle against a signed-in Codex CLI.
2. 🟡 Generate version-matched schema and replace tolerant envelopes with generated wire types. The approval adapter is pinned; broad notification envelopes remain tolerant.
3. 🟡 Complete reconnect/resume and the structured activity bus shared by Chat and Activity. Host recovery controls, cwd-scoped saved-thread selection, and a separate Activity view are implemented; real Tauri-window end-to-end coverage remains.
4. `xterm.js` plus Rust `portable-pty` for Claude/Cursor/Shell and raw terminal access.
5. `sheetctl` local IPC with read-only context/range commands.
6. Blocking semantic proposal handshake for mutating commands.
7. KDL Split editor mode, then XLSX import/export.

Do not scrape Codex ANSI output or add a fake CLI transcript while steps 1–3 are incomplete. See the official [Codex app-server documentation](https://developers.openai.com/codex/app-server).
