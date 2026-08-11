import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { planDocctlCommand, readDocctlCommand, type DocumentProposal } from "./documentPlanner";
import type { OfficeWorkspace } from "./useOfficeWorkspace";

const DOCCTL_EVENT_NAME = "docctl://request";
interface Incoming { id: string; command: string; }
export interface PendingDocctlProposal { id: string; proposal: DocumentProposal; }

/** Keeps document CLI writes behind the same UI approval boundary as agents. */
export function useDocctlBridge(workspace: OfficeWorkspace) {
  const desktop = isTauri();
  const [pending, setPending] = useState<PendingDocctlProposal | null>(null);
  const sourceRef = useRef(workspace.documentSource);
  const selectionRef = useRef(workspace.documentSelection);
  const openAgentRef = useRef(workspace.setAgentOpen);
  useEffect(() => { sourceRef.current = workspace.documentSource; selectionRef.current = workspace.documentSelection; openAgentRef.current = workspace.setAgentOpen; }, [workspace.documentSelection, workspace.documentSource, workspace.setAgentOpen]);
  const respond = useCallback(async (id: string, approved: boolean, message?: string) => {
    if (desktop) await invoke("docctl_respond", { id, approved, message });
    setPending((current) => current?.id === id ? null : current);
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return undefined;
    let active = true; let unsubscribe: (() => void) | undefined;
    void invoke("docctl_start").catch(() => undefined);
    void listen<Incoming>(DOCCTL_EVENT_NAME, (event) => {
      if (!active) return;
      const read = readDocctlCommand(event.payload.command, sourceRef.current, selectionRef.current);
      if (read.handled) {
        void respond(event.payload.id, true, read.message);
        return;
      }
      const result = planDocctlCommand(event.payload.command, sourceRef.current, selectionRef.current);
      if (!result.ok) { void respond(event.payload.id, false, result.message); return; }
      openAgentRef.current(true);
      setPending({ id: event.payload.id, proposal: result.proposal });
    }).then((stop) => { if (active) unsubscribe = stop; else stop(); });
    return () => { active = false; unsubscribe?.(); };
  }, [desktop, respond]);
  return { pending, respond };
}
