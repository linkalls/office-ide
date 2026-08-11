import { FileText, Plus, Sheet, X } from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { CodexRuntime } from "../state/useCodexRuntime";
import type { XlsxTransfer } from "../state/useXlsxTransfer";
import type { useDocxTransfer } from "../state/useDocxTransfer";
import { SpreadsheetEditor } from "./SpreadsheetEditor";
import { DocumentEditor } from "./DocumentEditor";
import { WelcomeEditor } from "./WelcomeEditor";
import { WorkbenchPanel } from "./WorkbenchPanel";

interface Props {
  workspace: OfficeWorkspace;
  codexRuntime: CodexRuntime;
  xlsx: XlsxTransfer;
  docx: ReturnType<typeof useDocxTransfer>;
  onCloseResource: (resource: string) => void;
}

export function MainEditor({ workspace, codexRuntime, xlsx, docx, onCloseResource }: Props) {
  const isSpreadsheet = workspace.activeResource === "sales";

  return (
    <main className="main-editor">
      <div className="editor-tabs" role="tablist" aria-label="Open resources">
        {workspace.openResources.includes("sales") ? <div className="editor-tab-wrap"><button
          className="editor-tab"
          data-active={isSpreadsheet}
          role="tab"
          type="button"
          onClick={() => workspace.openResource("sales")}
        >
          <Sheet size={14} /> sales.kdl
        </button><button className="editor-tab-close" type="button" aria-label="Close sales.kdl tab" onClick={() => onCloseResource("sales")}><X size={13} /></button></div> : null}
        {workspace.documents.filter((document) => workspace.openResources.includes(document.id)).map((document) => <div className="editor-tab-wrap" key={document.id}><button
          className="editor-tab"
          data-active={workspace.activeResource === document.id}
          role="tab"
          type="button"
          onClick={() => workspace.openResource(document.id)}
        >
          <FileText size={14} /> {document.name}.dj
        </button><button className="editor-tab-close" type="button" aria-label={`Close ${document.name}.dj tab`} onClick={() => onCloseResource(document.id)}><X size={13} /></button></div>)}
        <button className="new-tab-button" type="button" aria-label="Open spreadsheet tab" onClick={() => workspace.openResource("sales")}>
          <Plus size={15} />
        </button>
      </div>
      {workspace.activeResource === "none" ? <WelcomeEditor /> : isSpreadsheet ? <SpreadsheetEditor workspace={workspace} codexRuntime={codexRuntime} xlsx={xlsx} /> : <>
        <DocumentEditor workspace={workspace} docx={docx} />
        <WorkbenchPanel workspace={workspace} codexRuntime={codexRuntime} />
      </>}
    </main>
  );
}
