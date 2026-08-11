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

export interface CodexModelOption {
  model: string;
  displayName: string;
  efforts: string[];
  defaultEffort: string | null;
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

  const sendPrompt = useCallback(async (
    prompt: string,
    cwd: string,
    settings?: { model?: string; effort?: string },
  ) => {
    if (!desktop) throw new Error("Codex app-server is available only in the Tauri desktop app");
    await connect();

    try {
      let threadId = threadIdRef.current;
      if (!threadId) {
        const response = await invoke<unknown>("codex_start_thread", { cwd, model: settings?.model ?? null });
        threadId = readThreadId(response);
        if (!threadId) throw new Error("Codex app-server returned no thread id");
        threadIdRef.current = threadId;
        dispatch({ type: "threadStarted", threadId });
      }
      const response = await invoke<unknown>("codex_start_turn", {
        threadId,
        prompt,
        cwd,
        model: settings?.model ?? null,
        effort: settings?.effort ?? null,
      });
      const turnId = readTurnId(response);
      if (turnId) dispatch({ type: "turnStarted", turnId });
    } catch (error) {
      // A request can be rejected while the app-server itself remains healthy.
      // Keep the composer live; only host startup/protocol failures require a
      // reconnect.
      dispatch({ type: "turnFailed", message: errorMessage(error) });
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

  const listModels = useCallback(async (): Promise<CodexModelOption[]> => {
    if (!desktop) return [];
    await connect();
    const response = await invoke<unknown>("codex_list_models");
    const data = response && typeof response === "object" && "data" in response
      ? (response as { data?: unknown }).data
      : [];
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.model !== "string") return [];
      const efforts = Array.isArray(record.supportedReasoningEfforts)
        ? record.supportedReasoningEfforts.flatMap((item) => (
            item && typeof item === "object" && typeof (item as Record<string, unknown>).reasoningEffort === "string"
              ? [(item as Record<string, string>).reasoningEffort]
              : []
          ))
        : [];
      return [{
        model: record.model,
        displayName: typeof record.displayName === "string" ? record.displayName : record.model,
        efforts,
        defaultEffort: typeof record.defaultReasoningEffort === "string" ? record.defaultReasoningEffort : null,
      }];
    });
  }, [connect, desktop]);

  const listThreads = useCallback(async (cwd: string) => {
    if (!desktop) return [] as Array<{ id: string; name: string | null; preview: string }>;
    await connect();
    const response = await invoke<unknown>("codex_list_threads", { cwd });
    const data = response && typeof response === "object" && "data" in response
      ? (response as { data?: unknown }).data
      : [];
    if (!Array.isArray(data)) return [];
    return data.flatMap((thread) => {
      if (!thread || typeof thread !== "object") return [];
      const record = thread as Record<string, unknown>;
      return typeof record.id === "string"
        ? [{
            id: record.id,
            name: typeof record.name === "string" ? record.name : null,
            preview: typeof record.preview === "string" ? record.preview : "Untitled thread",
          }]
        : [];
    });
  }, [connect, desktop]);

  const cancelTurn = useCallback(async () => {
    const threadId = threadIdRef.current;
    const turnId = turnIdRef.current;
    if (!desktop || !threadId || !turnId) return;
    await invoke("codex_interrupt_turn", { threadId, turnId });
  }, [desktop]);

  const newThread = useCallback(async () => {
    if (!desktop) return;
    if (state.phase === "running") throw new Error("Stop the active Codex turn before starting a new chat");
    await connect();
    threadIdRef.current = null;
    turnIdRef.current = null;
    dispatch({ type: "newThread" });
  }, [connect, desktop, state.phase]);

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
    listModels,
    answerRequest,
    resumeThread,
    listThreads,
    cancelTurn,
    newThread,
    disconnect,
    reconnect,
  };
}

export type CodexRuntime = ReturnType<typeof useCodexRuntime>;
