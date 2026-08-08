import { describe, expect, test } from "bun:test";
import {
  codexRuntimeReducer,
  createCodexRuntimeState,
  readThreadId,
  readTurnId,
} from "./codexRuntime";

describe("Codex runtime reducer", () => {
  test("tracks one thread and one running turn", () => {
    const initial = createCodexRuntimeState(true);
    const withThread = codexRuntimeReducer(initial, {
      type: "threadStarted",
      threadId: "thr_123",
    });
    const running = codexRuntimeReducer(withThread, {
      type: "backend",
      event: {
        kind: "notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr_123", turn: { id: "turn_456" } },
        },
      },
    });

    expect(running.threadId).toBe("thr_123");
    expect(running.turnId).toBe("turn_456");
    expect(running.phase).toBe("running");
    expect(running.activities).toHaveLength(1);
  });

  test("merges streamed agent deltas instead of duplicating cards", () => {
    let state = createCodexRuntimeState(true);
    for (const delta of ["Hello", " world"]) {
      state = codexRuntimeReducer(state, {
        type: "backend",
        event: {
          kind: "notification",
          payload: {
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_123",
              turnId: "turn_456",
              itemId: "item_1",
              delta,
            },
          },
        },
      });
    }

    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]?.detail).toBe("Hello world");

    state = codexRuntimeReducer(state, {
      type: "backend",
      event: {
        kind: "notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr_123",
            turnId: "turn_456",
            item: { id: "item_1", type: "agentMessage", text: "Hello world!" },
          },
        },
      },
    });
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]?.detail).toBe("Hello world!");
    expect(state.activities[0]?.status).toBe("completed");
  });

  test("keeps server approvals pending until the UI answers them", () => {
    let state = codexRuntimeReducer(createCodexRuntimeState(true), {
      type: "backend",
      event: {
        kind: "serverRequest",
        payload: {
          id: 7,
          method: "item/commandExecution/requestApproval",
          params: { command: "bun test" },
        },
      },
    });

    expect(state.pendingRequests).toEqual([{
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { command: "bun test" },
    }]);
    expect(state.activities[0]?.status).toBe("pending");

    state = codexRuntimeReducer(state, {
      type: "backend",
      event: {
        kind: "notification",
        payload: {
          method: "serverRequest/resolved",
          params: { requestId: 7, threadId: "thr_123" },
        },
      },
    });
    expect(state.pendingRequests).toHaveLength(0);
    expect(state.activities[0]?.status).toBe("completed");
  });

  test("surfaces turn errors instead of pretending the runtime stayed ready", () => {
    const state = codexRuntimeReducer(createCodexRuntimeState(true), {
      type: "backend",
      event: {
        kind: "notification",
        payload: {
          method: "error",
          params: {
            threadId: "thr_123",
            turnId: "turn_456",
            error: { message: "Not logged in" },
          },
        },
      },
    });
    expect(state.phase).toBe("error");
    expect(state.statusMessage).toBe("Not logged in");
  });

  test("reads version-matched response envelopes without hard-coding full schema", () => {
    expect(readThreadId({ thread: { id: "thr_1", extra: true } })).toBe("thr_1");
    expect(readTurnId({ turn: { id: "turn_1", status: "inProgress" } })).toBe("turn_1");
  });
});
