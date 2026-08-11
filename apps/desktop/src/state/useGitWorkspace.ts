import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface GitFileStatus { path: string; indexStatus: string; worktreeStatus: string; }
export interface GitCommit { id: string; subject: string; author: string; date: string; }
export interface GitWorkspaceStatus { isRepository: boolean; branch: string | null; files: GitFileStatus[]; commits: GitCommit[]; }

export function useGitWorkspace(active: boolean) {
  const desktop = isTauri();
  const [status, setStatus] = useState<GitWorkspaceStatus | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      setError(null);
      setStatus(await invoke<GitWorkspaceStatus>("git_status", { cwd: "." }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);
  const selectFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    if (!desktop) return;
    try { setDiff(await invoke<string>("git_diff", { cwd: ".", path })); }
    catch (cause) { setDiff(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);
  const mutate = useCallback(async (command: "git_stage" | "git_unstage" | "git_commit", values: Record<string, string>) => {
    if (!desktop) return;
    try {
      setError(null);
      await invoke(command, { cwd: ".", ...values });
      await refresh();
      if (values.path) await selectFile(values.path);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop, refresh, selectFile]);
  const stage = useCallback((path: string) => mutate("git_stage", { path }), [mutate]);
  const unstage = useCallback((path: string) => mutate("git_unstage", { path }), [mutate]);
  const commit = useCallback((message: string) => mutate("git_commit", { message }), [mutate]);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  return { commit, desktop, diff, error, refresh, selectFile, selectedPath, stage, status, unstage };
}
