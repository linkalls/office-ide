import {
  ChevronDown,
  FileImage,
  FileText,
  MoreHorizontal,
  Plus,
  Sheet,
} from "lucide-react";
import type { ReactNode } from "react";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

interface ResourceRowProps {
  icon: ReactNode;
  name: string;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}

function ResourceRow({ icon, name, active, muted, onClick }: ResourceRowProps) {
  return (
    <button
      type="button"
      className="resource-row"
      data-active={active}
      data-muted={muted}
      onClick={onClick}
    >
      <span className="resource-icon">{icon}</span>
      <span>{name}</span>
    </button>
  );
}

export function Explorer({ workspace }: Props) {
  return (
    <aside className="explorer-pane">
      <div className="pane-title-row">
        <span>WORKSPACE</span>
        <span className="pane-actions">
          <button
            className="icon-button subtle"
            type="button"
            aria-label="New spreadsheet"
            onClick={workspace.addSheet}
          >
            <Plus size={14} />
          </button>
          <button className="icon-button subtle" type="button" aria-label="More workspace actions">
            <MoreHorizontal size={15} />
          </button>
        </span>
      </div>

      <div className="tree-section">
        <button className="tree-heading" type="button">
          <ChevronDown size={14} /> Spreadsheets <span>{workspace.workbook.sheets.length}</span>
        </button>
        {workspace.workbook.sheets.map((sheet) => (
          <ResourceRow
            key={sheet.id}
            icon={<Sheet size={15} />}
            name={sheet.name}
            active={workspace.activeSheet.id === sheet.id && workspace.activeResource !== "report"}
            onClick={() => workspace.activateSheet(sheet.id)}
          />
        ))}
      </div>

      <div className="tree-section">
        <button className="tree-heading" type="button">
          <ChevronDown size={14} /> Documents <span>1</span>
        </button>
        <ResourceRow
          icon={<FileText size={15} />}
          name="report"
          active={workspace.activeResource === "report"}
          onClick={() => workspace.setActiveResource("report")}
        />
      </div>

      <div className="tree-section">
        <button className="tree-heading" type="button">
          <ChevronDown size={14} /> Assets <span>1</span>
        </button>
        <ResourceRow icon={<FileImage size={15} />} name="logo.png" muted />
      </div>

      <div className="explorer-spacer" />
      <div className="collapsed-section"><ChevronDown size={13} /> OUTLINE</div>
      <div className="collapsed-section"><ChevronDown size={13} /> TIMELINE</div>
    </aside>
  );
}
