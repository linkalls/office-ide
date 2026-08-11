import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

const SHELL_EVENT_NAME = "shell://output";
const MAX_LINES = 500;

interface ShellOutputEvent {
  stream: "stdout" | "stderr";
  text: string;
}

export function usePersistentShell(active: boolean) {
  const desktop = isTauri();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<ShellOutputEvent[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  const append = useCallback((entry: ShellOutputEvent) => {
    setLines((current) => [...current, entry].slice(-MAX_LINES));
  }, []);

  const start = useCallback(async () => {
    if (!desktop) return;
    try {
      await invoke("shell_start", { cwd: "." });
      setRunning(true);
    } catch (error) {
      if (String(error).includes("already running")) setRunning(true);
      else append({ stream: "stderr", text: error instanceof Error ? error.message : String(error) });
    }
  }, [append, desktop]);

  const send = useCallback(async (input: string) => {
    if (!desktop || !input.trim()) return;
    if (!running) await start();
    append({ stream: "stdout", text: `$ ${input}` });
    try {
      await invoke("shell_write", { input });
    } catch (error) {
      append({ stream: "stderr", text: error instanceof Error ? error.message : String(error) });
      setRunning(false);
    }
  }, [append, desktop, running, start]);

  const stop = useCallback(async () => {
    if (!desktop) return;
    await invoke("shell_stop");
    setRunning(false);
  }, [desktop]);

  const clear = useCallback(() => setLines([]), []);

  useEffect(() => {
    if (!desktop || !active) return undefined;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void listen<ShellOutputEvent>(SHELL_EVENT_NAME, (event) => {
      if (mounted) append(event.payload);
    }).then((dispose) => {
      if (mounted) unsubscribe = dispose;
      else dispose();
    });
    void invoke<{ running: boolean }>("shell_status")
      .then((status) => status.running ? setRunning(true) : start())
      .catch(() => start());
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [active, append, desktop, start]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines]);

  return { desktop, lines, outputRef, running, send, start, stop, clear };
}
