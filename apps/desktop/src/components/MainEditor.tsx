import { FileText, Plus, Sheet, X } from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import { SpreadsheetEditor } from "./SpreadsheetEditor";
import { WelcomeEditor } from "./WelcomeEditor";

interface Props {
  workspace: OfficeWorkspace;
}

export function MainEditor({ workspace }: Props) {
  const isSpreadsheet = workspace.activeResource !== "report";

  return (
    <main className="main-editor">
      <div className="editor-tabs" role="tablist" aria-label="Open resources">
        <button
          className="editor-tab"
          data-active={isSpreadsheet}
          role="tab"
          type="button"
          onClick={() => workspace.setActiveResource("sales")}
        >
          <Sheet size={14} /> sales.kdl <X size={13} />
        </button>
        <button
          className="editor-tab"
          data-active={!isSpreadsheet}
          role="tab"
          type="button"
          onClick={() => workspace.setActiveResource("report")}
        >
          <FileText size={14} /> report.dj <X size={13} />
        </button>
        <button className="new-tab-button" type="button" aria-label="New editor tab">
          <Plus size={15} />
        </button>
      </div>
      {isSpreadsheet ? <SpreadsheetEditor workspace={workspace} /> : <WelcomeEditor />}
    </main>
  );
}
