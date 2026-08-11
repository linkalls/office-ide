import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeWorkspace } from "./useOfficeWorkspace";

interface NativeDocument { id: string; name: string; source: string; }
interface NativeWorkspace { title: string; source: string; documents: NativeDocument[]; }
interface OpenedNativeWorkspace { root: string; workspace: NativeWorkspace; }
interface WorkspaceExternalChange { root: string; path: string; external: NativeWorkspace; }
export function useNativeWorkspace(workspace: OfficeWorkspace) {
  const [message, setMessage] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<NativeWorkspace | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(!isTauri());
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<WorkspaceExternalChange | null>(null);
  const savedSnapshotRef = useRef<string | null>(null);
  const ignoreExternalUntilRef = useRef(0);
  const snapshot = JSON.stringify({ title: workspace.workspaceTitle, source: workspace.source, documents: workspace.documents });
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<NativeWorkspace | null>("workspace_recovery_load").then(setRecovery).catch(() => undefined).finally(() => setRecoveryChecked(true));
  }, []);
  useEffect(() => {
    if (!isTauri() || !workspaceRoot) return undefined;
    void invoke("workspace_watch_start", { root: workspaceRoot }).catch((error) => setMessage(String(error)));
    return () => { void invoke("workspace_watch_stop").catch(() => undefined); };
  }, [workspaceRoot]);
  const loadExternal = useCallback(async (root: string, message: string) => {
    const next = await invoke<NativeWorkspace>("workspace_load_at", { root });
    savedSnapshotRef.current = JSON.stringify(next);
    workspace.loadNativeWorkspace(next.title, next.source, next.documents);
    await invoke("workspace_recovery_clear");
    setRecovery(null);
    setExternalChange(null);
    setMessage(message);
  }, [workspace]);
  useEffect(() => {
    if (!isTauri()) return undefined;
    let active = true; let unlisten: (() => void) | undefined;
    void listen<Omit<WorkspaceExternalChange, "external">>("workspace://external-change", (event) => {
      if (!active || event.payload.root !== workspaceRoot || Date.now() < ignoreExternalUntilRef.current) return;
      if (savedSnapshotRef.current === snapshot) {
        void loadExternal(event.payload.root, "Reloaded external workspace changes").catch((error) => setMessage(String(error)));
      } else {
        // Read the changed workspace before showing the decision surface. This
        // makes Compare useful instead of a dead-end warning, while leaving
        // the local visual/source state untouched until the user chooses.
        void invoke<NativeWorkspace>("workspace_load_at", { root: event.payload.root })
          .then((external) => setExternalChange({ ...event.payload, external }))
          .catch((error) => setMessage(String(error)));
      }
    }).then((stop) => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, [loadExternal, snapshot, workspaceRoot]);
  useEffect(() => {
    if (!isTauri() || !recoveryChecked || recovery || savedSnapshotRef.current === snapshot) return;
    const timer = window.setTimeout(() => {
      void invoke("workspace_recovery_save", { workspace: { title: workspace.workspaceTitle, source: workspace.source, documents: workspace.documents } }).catch(() => undefined);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [recovery, recoveryChecked, snapshot, workspace.documents, workspace.source, workspace.workspaceTitle]);
  const save = useCallback(async () => {
    if (!isTauri()) { setMessage("Disk workspaces are available in the desktop app."); return; }
    const next = { title: workspace.workspaceTitle, source: workspace.source, documents: workspace.documents };
    try {
      ignoreExternalUntilRef.current = Date.now() + 1200;
      const path = workspaceRoot
        ? await invoke<void>("workspace_save_at", { root: workspaceRoot, workspace: next }).then(() => workspaceRoot)
        : await invoke<string | null>("workspace_save", { workspace: next });
      if (path) {
        setWorkspaceRoot(path);
        savedSnapshotRef.current = JSON.stringify(next);
        await invoke("workspace_recovery_clear");
        setRecovery(null);
      }
      setMessage(path ? `Saved ${path}` : null);
    } catch (error) { setMessage(String(error)); }
  }, [workspace, workspaceRoot]);
  const open = useCallback(async () => {
    if (!isTauri()) { setMessage("Disk workspaces are available in the desktop app."); return; }
    try {
      const opened = await invoke<OpenedNativeWorkspace | null>("workspace_open");
      if (opened) {
        const next = opened.workspace;
        setWorkspaceRoot(opened.root);
        savedSnapshotRef.current = JSON.stringify(next);
        workspace.loadNativeWorkspace(next.title, next.source, next.documents);
        await invoke("workspace_recovery_clear");
        setRecovery(null);
      }
      setMessage(opened ? `Opened ${opened.workspace.title}.office` : null);
    } catch (error) { setMessage(String(error)); }
  }, [workspace]);
  const restoreRecovery = useCallback(async () => {
    if (!recovery) return;
    workspace.loadNativeWorkspace(recovery.title, recovery.source, recovery.documents);
    await invoke("workspace_recovery_clear");
    setRecovery(null);
    setMessage(`Restored ${recovery.title}.office recovery`);
  }, [recovery, workspace]);
  const discardRecovery = useCallback(async () => { await invoke("workspace_recovery_clear"); savedSnapshotRef.current = snapshot; setRecovery(null); }, [snapshot]);
  const useExternalChange = useCallback(async () => {
    if (!externalChange) return;
    try { await loadExternal(externalChange.root, "Loaded external workspace changes"); }
    catch (error) { setMessage(String(error)); }
  }, [externalChange, loadExternal]);
  const keepLocalChanges = useCallback(() => setExternalChange(null), []);
  return { message, open, save, recovery, restoreRecovery, discardRecovery, externalChange, useExternalChange, keepLocalChanges };
}
