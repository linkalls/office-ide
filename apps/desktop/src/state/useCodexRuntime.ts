import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  codexRuntimeReducer,
  createCodexRuntimeState,
  readThreadId,
  readTurnId,
  type CodexApprovalDecision,
  type CodexBackendEvent,
} from "./codexRuntime";

const CODEX_EVENT_NAME = "codex://event";

interface CodexHostStatus {
  running: boolean;
  pendingResponseCount: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCodexRuntime() {
  const desktop = isTauri();
  const [state, dispatch] = useReducer(
    codexRuntimeReducer,
    desktop,
    createCodexRuntimeState,
  );
  const connectPromise = useRef<Promise<void> | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const turnIdRef = useRef<string | null>(null);

  useEffect(() => {
    threadIdRef.current = state.threadId;
  }, [state.threadId]);

  useEffect(() => {
    turnIdRef.current = state.turnId;
  }, [state.turnId]);

  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void listen<CodexBackendEvent>(CODEX_EVENT_NAME, (event) => {
      if (active) dispatch({ type: "backend", event: event.payload });
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    // A WebView reload must query the Rust owner instead of assuming the old
    // process disappeared. No PID, environment, or account data crosses here.
    void invoke<CodexHostStatus>("codex_status")
      .then((status) => {
        if (status.running) dispatch({ type: "hostRestored" });
      })
      .catch(() => undefined);
  }, [desktop]);

  const startHost = useCallback(async () => {
    if (connectPromise.current) return connectPromise.current;
    const pending = invoke("codex_start")
      .then(() => undefined)
      .catch((error: unknown) => {
        dispatch({ type: "failure", message: errorMessage(error) });
        throw error;
      })
      .finally(() => {
        connectPromise.current = null;
      });
    connectPromise.current = pending;
    return pending;
  }, []);

  const connect = useCallback(async () => {
    if (!desktop) return;
    if (state.phase === "ready" || state.phase === "running") return;
    // A failed turn does not imply that the app-server process or thread died.
    if (state.phase === "error" && threadIdRef.current) return;
    return startHost();
  }, [desktop, startHost, state.phase]);

  const sendPrompt = useCallback(async (prompt: string, cwd: string) => {
    if (!desktop) throw new Error("Codex app-server is available only in the Tauri desktop app");
    await connect();

    let threadId = threadIdRef.current;
    if (!threadId) {
      const response = await invoke<unknown>("codex_start_thread", { cwd });
      threadId = readThreadId(response);
      if (!threadId) throw new Error("Codex app-server returned no thread id");
      threadIdRef.current = threadId;
      dispatch({ type: "threadStarted", threadId });
    }

    try {
      const response = await invoke<unknown>("codex_start_turn", {
        threadId,
        prompt,
        cwd,
      });
      const turnId = readTurnId(response);
      if (turnId) dispatch({ type: "turnStarted", turnId });
    } catch (error) {
      dispatch({ type: "failure", message: errorMessage(error) });
      throw error;
    }
  }, [connect, desktop]);

  const answerRequest = useCallback(async (
    id: string | number,
    decision: CodexApprovalDecision,
  ) => {
    if (!desktop) return;
    try {
      await invoke("codex_respond_to_server_request", {
        id,
        result: { decision },
      });
      // A successful JSON-RPC write resolves this UI control exactly once. The
      // app-server does not owe us a custom "serverRequest/resolved" event.
      dispatch({ type: "requestAnswered", id });
    } catch (error) {
      dispatch({ type: "failure", message: errorMessage(error) });
      throw error;
    }
  }, [desktop]);

  const resumeThread = useCallback(async (threadId: string) => {
    if (!desktop) return;
    await connect();
    const response = await invoke<unknown>("codex_resume_thread", { threadId });
    const resumedThreadId = readThreadId(response);
    if (!resumedThreadId) throw new Error("Codex app-server returned no resumed thread id");
    threadIdRef.current = resumedThreadId;
    dispatch({ type: "threadStarted", threadId: resumedThreadId });
  }, [connect, desktop]);

  const cancelTurn = useCallback(async () => {
    const threadId = threadIdRef.current;
    const turnId = turnIdRef.current;
    if (!desktop || !threadId || !turnId) return;
    await invoke("codex_interrupt_turn", { threadId, turnId });
  }, [desktop]);

  const disconnect = useCallback(async () => {
    if (!desktop) return;
    await invoke("codex_shutdown");
    dispatch({ type: "stopped" });
  }, [desktop]);

  const reconnect = useCallback(async () => {
    if (!desktop) return;
    try {
      await invoke("codex_shutdown");
    } catch {
      // A dead/missing process is already in the desired pre-reconnect state.
    }
    dispatch({ type: "stopped" });
    await startHost();
  }, [desktop, startHost]);

  return {
    ...state,
    isDesktop: desktop,
    connect,
    sendPrompt,
    answerRequest,
    resumeThread,
    cancelTurn,
    disconnect,
    reconnect,
  };
}

export type CodexRuntime = ReturnType<typeof useCodexRuntime>;
