import {
  AlignLeft,
  Bold,
  ChevronDown,
  Italic,
  PaintBucket,
  Percent,
  Redo2,
  Search,
  Sigma,
  Undo2,
} from "lucide-react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { WorkbenchPanel } from "./WorkbenchPanel";

interface Props {
  workspace: OfficeWorkspace;
}

export function SpreadsheetEditor({ workspace }: Props) {
  const cell = workspace.activeSheet.cells[workspace.activeCell];
  const formulaValue = cell?.formula ? `=${cell.formula}` : String(cell?.value ?? "");

  return (
    <div className="spreadsheet-editor">
      <div className="formula-row">
        <button className="name-box" type="button">
          {workspace.activeCell}
          <ChevronDown size={13} />
        </button>
        <span className="formula-symbol">ƒx</span>
        <input
          aria-label="Formula bar"
          className="formula-input"
          value={formulaValue}
          onChange={(event) => workspace.applyCellEdit(workspace.activeCell, event.target.value)}
        />
      </div>
      <div className="format-toolbar" role="toolbar" aria-label="Spreadsheet formatting">
        <button className="toolbar-button" type="button" onClick={workspace.undo} disabled={!workspace.canUndo}>
          <Undo2 size={15} />
        </button>
        <button className="toolbar-button" type="button" onClick={workspace.redo} disabled={!workspace.canRedo}>
          <Redo2 size={15} />
        </button>
        <span className="toolbar-divider" />
        <button className="toolbar-select" type="button">Inter <ChevronDown size={12} /></button>
        <button className="toolbar-select compact" type="button">11 <ChevronDown size={12} /></button>
        <button className="toolbar-button" type="button" aria-label="Bold" aria-pressed={cell?.style?.bold ?? false} onClick={() => workspace.applyCellStyle({ bold: !cell?.style?.bold })}><Bold size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Italic" aria-pressed={cell?.style?.italic ?? false} onClick={() => workspace.applyCellStyle({ italic: !cell?.style?.italic })}><Italic size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Align" aria-pressed={cell?.style?.horizontalAlign === "left"} onClick={() => workspace.applyCellStyle({ horizontalAlign: cell?.style?.horizontalAlign === "left" ? "right" : "left" })}><AlignLeft size={15} /></button>
        <button className="toolbar-button" type="button" aria-label="Fill color" aria-pressed={Boolean(cell?.style?.background)} onClick={() => workspace.applyCellStyle({ background: cell?.style?.background ? "" : "#254f7d" })}><PaintBucket size={15} /></button>
        <button className="toolbar-button" type="button"><Percent size={15} /></button>
        <button className="toolbar-button" type="button"><Sigma size={15} /></button>
        <span className="toolbar-spacer" />
        <button className="toolbar-button" type="button"><Search size={15} /></button>
      </div>
      <div className="editor-work-area">
        <SpreadsheetGrid workspace={workspace} />
        <WorkbenchPanel workspace={workspace} />
      </div>
    </div>
  );
}
