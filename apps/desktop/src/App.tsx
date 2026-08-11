import { useEffect, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AgentPane } from "./components/AgentPane";
import { CommandPalette } from "./components/CommandPalette";
import { Explorer } from "./components/Explorer";
import { GlobalSearch } from "./components/GlobalSearch";
import { MainEditor } from "./components/MainEditor";
import { QuickOpen } from "./components/QuickOpen";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { useOfficeWorkspace } from "./state/useOfficeWorkspace";
import { useSheetctlBridge } from "./state/useSheetctlBridge";
import { useCodexRuntime } from "./state/useCodexRuntime";
import { useXlsxTransfer } from "./state/useXlsxTransfer";
import { useDocxTransfer } from "./state/useDocxTransfer";
import { useNativeWorkspace } from "./state/useNativeWorkspace";
import { useDocctlBridge } from "./state/useDocctlBridge";
import { useAppTheme } from "./state/useAppTheme";
import { useDialogFocus } from "./hooks/useDialogFocus";

function readPaneWidth(key: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function App() {
  const workspace = useOfficeWorkspace();
  const sheetctl = useSheetctlBridge(workspace);
  const docctl = useDocctlBridge(workspace);
  const codexRuntime = useCodexRuntime();
  const xlsx = useXlsxTransfer(workspace);
  const docx = useDocxTransfer();
  const nativeWorkspace = useNativeWorkspace(workspace);
  const appTheme = useAppTheme();
  const [agentWidth, setAgentWidth] = useState(() => readPaneWidth("office-ide.agent-width", 450, 300, 680));
  const [explorerWidth, setExplorerWidth] = useState(() => readPaneWidth("office-ide.explorer-width", 238, 180, 500));
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [externalCompareOpen, setExternalCompareOpen] = useState(false);
  const recoveryDialogRef = useDialogFocus<HTMLDivElement>(Boolean(nativeWorkspace.recovery), () => undefined, "button");
  const externalChangeDialogRef = useDialogFocus<HTMLDivElement>(Boolean(nativeWorkspace.externalChange) && !externalCompareOpen, nativeWorkspace.keepLocalChanges, "button");
  const externalCompareDialogRef = useDialogFocus<HTMLElement>(externalCompareOpen, () => setExternalCompareOpen(false), "button");

  useEffect(() => { window.localStorage.setItem("office-ide.agent-width", String(agentWidth)); }, [agentWidth]);
  useEffect(() => { window.localStorage.setItem("office-ide.explorer-width", String(explorerWidth)); }, [explorerWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
      const editing = target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editing && key !== "s") return;
      if (key === "s") {
        event.preventDefault();
        void nativeWorkspace.save();
      }
      if (key === "p" && event.shiftKey) {
        event.preventDefault();
        workspace.setPaletteOpen(true);
      }
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        setQuickOpenOpen(true);
      }
      if (key === "j" && !event.shiftKey) {
        event.preventDefault();
        workspace.setAgentOpen(!workspace.agentOpen);
      }
      if (key === "w" && !event.shiftKey && workspace.activeResource !== "none") {
        event.preventDefault();
        workspace.closeResource(workspace.activeResource);
      }
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (event.key === "`") {
        event.preventDefault();
        workspace.setActiveView("terminal");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nativeWorkspace.save, workspace.activeResource, workspace.agentOpen, workspace.closeResource, workspace.setAgentOpen, workspace.setActiveView, workspace.setPaletteOpen]);

  useEffect(() => {
    if (!externalCompareOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExternalCompareOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [externalCompareOpen]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (!active || event.payload.type !== "drop") return;
      const path = event.payload.paths[0];
      if (!path) return;
      const extension = path.split(".").at(-1)?.toLowerCase();
      if (extension === "xlsx") {
        void xlsx.importWorkbookPath(path);
        return;
      }
      if (extension === "docx") {
        void docx.importDocxPath(path).then((source) => {
          if (!source) return;
          const filename = path.replace(/\\/g, "/").split("/").at(-1) ?? "imported document";
          workspace.importDocument(filename.replace(/\.docx$/i, ""), source);
        });
      }
    }).then((stop) => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, [docx, workspace, xlsx]);

  return (
    <div className="app-shell">
      <TitleBar workspace={workspace} nativeWorkspace={nativeWorkspace} appTheme={appTheme} />
      <div
        className="workspace-shell"
        style={{ "--agent-width": `${agentWidth}px`, "--explorer-width": `${explorerWidth}px` } as CSSProperties}
        data-agent-open={workspace.agentOpen}
        data-explorer-open={workspace.explorerOpen}
      >
        {workspace.explorerOpen ? <Explorer workspace={workspace} onResize={setExplorerWidth} /> : null}
        <MainEditor workspace={workspace} codexRuntime={codexRuntime} xlsx={xlsx} docx={docx} />
        {workspace.agentOpen ? <button className="agent-scrim" type="button" aria-label="Close agent pane" onClick={() => workspace.setAgentOpen(false)} /> : null}
        {workspace.agentOpen ? <AgentPane workspace={workspace} sheetctl={sheetctl} docctl={docctl} codexRuntime={codexRuntime} onClose={() => workspace.setAgentOpen(false)} onResize={setAgentWidth} /> : null}
      </div>
      <StatusBar workspace={workspace} />
      {workspace.paletteOpen ? <CommandPalette workspace={workspace} xlsx={xlsx} docx={docx} /> : null}
      {quickOpenOpen ? <QuickOpen workspace={workspace} onClose={() => setQuickOpenOpen(false)} /> : null}
      {globalSearchOpen ? <GlobalSearch workspace={workspace} onClose={() => setGlobalSearchOpen(false)} /> : null}
      {nativeWorkspace.recovery ? <div ref={recoveryDialogRef} className="recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title" tabIndex={-1}><strong id="recovery-title">Unsaved changes from the previous session were found.</strong><span>{nativeWorkspace.recovery.title}.office can be restored before continuing.</span><div><button type="button" onClick={() => void nativeWorkspace.restoreRecovery()}>Restore</button><button type="button" onClick={() => void nativeWorkspace.discardRecovery()}>Discard</button></div></div> : null}
      {nativeWorkspace.externalChange && !externalCompareOpen ? <div ref={externalChangeDialogRef} className="recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="external-change-title" tabIndex={-1}><strong id="external-change-title">Source changed outside Office IDE.</strong><span>{nativeWorkspace.externalChange.path.split(/[/\\]/).at(-1)} changed while local edits are unsaved.</span><div><button type="button" onClick={() => setExternalCompareOpen(true)}>Compare</button><button type="button" onClick={() => void nativeWorkspace.useExternalChange()}>Use external</button><button type="button" onClick={nativeWorkspace.keepLocalChanges}>Keep local</button></div></div> : null}
      {nativeWorkspace.externalChange && externalCompareOpen ? (
        <div className="external-compare-backdrop" role="presentation" onMouseDown={() => setExternalCompareOpen(false)}>
          <section ref={externalCompareDialogRef} className="external-compare" role="dialog" aria-modal="true" aria-labelledby="external-compare-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><strong id="external-compare-title">External change comparison</strong><span>Choose which workspace source to keep.</span></div><button type="button" aria-label="Close comparison" onClick={() => setExternalCompareOpen(false)}>×</button></header>
            <div className="external-compare-summary"><span>Local: {workspace.documents.length} documents</span><span>External: {nativeWorkspace.externalChange.external.documents.length} documents</span></div>
            <div className="external-compare-columns">
              <article><strong>Local unsaved source</strong><pre>{workspace.source}</pre></article>
              <article><strong>External source</strong><pre>{nativeWorkspace.externalChange.external.source}</pre></article>
            </div>
            <footer><button type="button" className="proposal-dismiss" onClick={() => { nativeWorkspace.keepLocalChanges(); setExternalCompareOpen(false); }}>Keep local</button><button type="button" className="proposal-apply" onClick={() => { void nativeWorkspace.useExternalChange(); setExternalCompareOpen(false); }}>Use external</button></footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
