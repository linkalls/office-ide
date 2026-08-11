import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  planSheetctlCommand,
  readSheetctlCommand,
  type AgentProposal,
} from "./agentPlanner";
import type { OfficeWorkspace } from "./useOfficeWorkspace";

const SHEETCTL_EVENT_NAME = "sheetctl://request";

interface SheetctlIncomingRequest {
  id: string;
  command: string;
}

export interface PendingSheetctlProposal {
  id: string;
  proposal: AgentProposal;
}

/** Receives Rust-owned local IPC requests and keeps them review-only in React. */
export function useSheetctlBridge(workspace: OfficeWorkspace) {
  const desktop = isTauri();
  const [pending, setPending] = useState<PendingSheetctlProposal | null>(null);
  const workbookRef = useRef(workspace.workbook);
  const openAgentRef = useRef(workspace.setAgentOpen);

  useEffect(() => {
    workbookRef.current = workspace.workbook;
    openAgentRef.current = workspace.setAgentOpen;
  }, [workspace.workbook, workspace.setAgentOpen]);

  const respond = useCallback(async (id: string, approved: boolean, message?: string) => {
    if (desktop) await invoke("sheetctl_respond", { id, approved, message });
    setPending((current) => current?.id === id ? null : current);
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void invoke("sheetctl_start").catch(() => undefined);
    void listen<SheetctlIncomingRequest>(SHEETCTL_EVENT_NAME, (event) => {
      if (!active) return;
      const readResult = readSheetctlCommand(event.payload.command, workbookRef.current);
      if (readResult) {
        void respond(event.payload.id, readResult.ok, readResult.message);
        return;
      }
      const result = planSheetctlCommand(event.payload.command, workbookRef.current);
      if (!result.ok) {
        void respond(event.payload.id, false);
        return;
      }
      openAgentRef.current(true);
      setPending({ id: event.payload.id, proposal: result.proposal });
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [desktop, respond]);

  return { pending, respond };
}
