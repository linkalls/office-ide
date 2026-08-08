import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  codexRuntimeReducer,
  createCodexRuntimeState,
  readThreadId,
  readTurnId,
  type CodexBackendEvent,
} from "./codexRuntime";

const CODEX_EVENT_NAME = "codex://event";

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

  useEffect(() => {
    threadIdRef.current = state.threadId;
  }, [state.threadId]);

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

  const connect = useCallback(async () => {
    if (!desktop) return;
    if (state.phase === "ready" || state.phase === "running") return;
    // A failed turn does not imply that the app-server process or thread died.
    if (state.phase === "error" && threadIdRef.current) return;
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
  }, [desktop, state.phase]);

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
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => {
    if (!desktop) return;
    await invoke("codex_respond_to_server_request", {
      id,
      result: { decision },
    });
  }, [desktop]);

  return {
    ...state,
    isDesktop: desktop,
    connect,
    sendPrompt,
    answerRequest,
  };
}

export type CodexRuntime = ReturnType<typeof useCodexRuntime>;
