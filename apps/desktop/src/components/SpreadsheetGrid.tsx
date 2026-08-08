import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  calculateSheet,
  isCalculatedError,
  type FormulaValue,
} from "@office-ide/formula";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";
import type { SpreadsheetSheet } from "@office-ide/spreadsheet-ir";

interface Props {
  workspace: OfficeWorkspace;
}

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G"];
const ROWS = Array.from({ length: 18 }, (_, index) => index + 1);

function columnToIndex(column: string): number {
  return column.charCodeAt(0) - 64;
}

function formatCell(value: FormulaValue | undefined): string {
  if (typeof value === "number") return value.toLocaleString("ja-JP");
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value ?? "");
}

interface CellInputProps {
  address: string;
  rawValue: string;
  displayValue: string;
  style: CSSProperties;
  onCommit: (value: string) => void;
  onSelect: (extend: boolean) => void;
  onNavigate: (direction: "up" | "down" | "left" | "right") => void;
}

/** 計算結果の表示と、入力途中のformula draftを分離する。 */
function CellInput({ address, rawValue, displayValue, style, onCommit, onSelect, onNavigate }: CellInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawValue);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(rawValue);
  }, [editing, rawValue]);

  return (
    <input
      aria-label={`Cell ${address}`}
      value={editing ? draft : displayValue}
      style={style}
      onMouseDown={(event) => {
        if (!event.shiftKey) return;
        event.preventDefault();
        onSelect(true);
      }}
      onFocus={() => {
        cancelRef.current = false;
        setDraft(rawValue);
        setEditing(true);
        onSelect(false);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(rawValue);
          return;
        }
        if (draft !== rawValue) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const direction = event.key === "Enter"
            ? event.shiftKey ? "up" : "down"
            : event.shiftKey ? "left" : "right";
          event.currentTarget.blur();
          window.requestAnimationFrame(() => onNavigate(direction));
        }
        if (event.key === "Escape") {
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface SheetTabProps {
  sheet: SpreadsheetSheet;
  active: boolean;
  canDelete: boolean;
  onActivate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SheetTab({ sheet, active, canDelete, onActivate, onRename, onDelete }: SheetTabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sheet.name);
  const cancelRenameRef = useRef(false);

  useEffect(() => setDraft(sheet.name), [sheet.name]);

  const commitRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setDraft(sheet.name);
      setEditing(false);
      return;
    }
    const cleanName = draft.trim();
    setEditing(false);
    if (cleanName && cleanName !== sheet.name) onRename(cleanName);
    else setDraft(sheet.name);
  };

  return (
    <div className="sheet-tab-wrap" data-active={active}>
      {editing ? (
        <input
          autoFocus
          aria-label={`Rename sheet ${sheet.name}`}
          className="sheet-tab-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelRenameRef.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          className="sheet-tab"
          type="button"
          data-active={active}
          aria-label={`Open sheet ${sheet.name}`}
          onClick={onActivate}
          onDoubleClick={() => {
            cancelRenameRef.current = false;
            setEditing(true);
          }}
        >
          {sheet.name}
        </button>
      )}
      {canDelete ? (
        <button
          className="sheet-tab-delete"
          type="button"
          aria-label={`Delete sheet ${sheet.name}`}
          title="Delete sheet (Undo available)"
          onClick={onDelete}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function SpreadsheetGrid({ workspace }: Props) {
  const cells = workspace.activeSheet.cells;
  const calculated = useMemo(
    () => calculateSheet(workspace.activeSheet),
    [workspace.activeSheet],
  );
  const rendered = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of ROWS) {
      for (const column of COLUMNS) {
        const address = `${column}${row}`;
        result.set(address, formatCell(calculated[address]));
      }
    }
    return result;
  }, [calculated]);

  const navigateFrom = (
    address: string,
    direction: "up" | "down" | "left" | "right",
  ) => {
    const match = address.match(/^([A-Z]+)([1-9]\d*)$/);
    if (!match) return;
    let columnIndex = COLUMNS.indexOf(match[1]);
    let row = Number(match[2]);
    if (direction === "up") row = Math.max(1, row - 1);
    if (direction === "down") row = Math.min(ROWS.length, row + 1);
    if (direction === "left") {
      if (columnIndex > 0) columnIndex -= 1;
      else if (row > 1) { columnIndex = COLUMNS.length - 1; row -= 1; }
    }
    if (direction === "right") {
      if (columnIndex < COLUMNS.length - 1) columnIndex += 1;
      else if (row < ROWS.length) { columnIndex = 0; row += 1; }
    }
    const nextAddress = `${COLUMNS[Math.max(0, columnIndex)]}${row}`;
    workspace.selectCell(nextAddress);
    document.querySelector<HTMLInputElement>(`input[aria-label="Cell ${nextAddress}"]`)?.focus();
  };

  return (
    <div className="grid-viewport">
      <table className="spreadsheet-grid" aria-label="売上 spreadsheet">
        <colgroup>
          <col className="row-number-column" />
          {COLUMNS.map((column) => (
            <col
              key={column}
              className={`sheet-column column-${column.toLowerCase()}`}
              style={workspace.activeSheet.columnWidths[column]
                ? { width: `${workspace.activeSheet.columnWidths[column] * 7 + 16}px` }
                : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="grid-corner" />
            {COLUMNS.map((column) => (
              <th
                key={column}
                data-active={workspace.activeCell.startsWith(column)}
                style={{ "--column-index": columnToIndex(column) } as CSSProperties}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr
              key={row}
              style={workspace.activeSheet.rowHeights[row]
                ? { height: `${workspace.activeSheet.rowHeights[row]}px` }
                : undefined}
            >
              <th data-active={workspace.activeCell.endsWith(String(row))}>{row}</th>
              {COLUMNS.map((column) => {
                const address = `${column}${row}`;
                const cell = cells[address];
                const isHeader = row === 1 && column !== "G";
                const isTotal = row === 16 && column !== "G";
                const bounds = workspace.selectionBounds;
                const selected = Boolean(
                  bounds
                  && columnToIndex(column) >= bounds.firstColumn
                  && columnToIndex(column) <= bounds.lastColumn
                  && row >= bounds.firstRow
                  && row <= bounds.lastRow,
                );
                const rawValue = cell?.formula ? `=${cell.formula}` : String(cell?.value ?? "");
                return (
                  <td
                    key={address}
                    data-active={workspace.activeCell === address}
                    data-selected={selected}
                    data-formula-error={isCalculatedError(calculated[address])}
                    data-header={isHeader}
                    data-total={isTotal}
                    style={{
                      backgroundColor: cell?.style?.background,
                      color: cell?.style?.foreground,
                    }}
                  >
                    <CellInput
                      address={address}
                      rawValue={rawValue}
                      displayValue={rendered.get(address) ?? ""}
                      style={{
                        color: cell?.style?.foreground,
                        fontWeight: cell?.style?.bold ? 700 : undefined,
                        fontStyle: cell?.style?.italic ? "italic" : undefined,
                        textAlign: cell?.style?.horizontalAlign,
                      }}
                      onSelect={(extend) => workspace.selectCell(address, extend)}
                      onCommit={(value) => workspace.applyCellEdit(
                        address,
                        value.startsWith("=") ? value : value.replaceAll(",", ""),
                      )}
                      onNavigate={(direction) => navigateFrom(address, direction)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sheet-tabs">
        {workspace.workbook.sheets.map((sheet) => (
          <SheetTab
            key={sheet.id}
            sheet={sheet}
            active={workspace.activeSheet.id === sheet.id}
            canDelete={workspace.workbook.sheets.length > 1}
            onActivate={() => workspace.activateSheet(sheet.id)}
            onRename={(name) => workspace.renameSheet(sheet.id, name)}
            onDelete={() => workspace.deleteSheet(sheet.id)}
          />
        ))}
        <button
          className="sheet-tab-add"
          type="button"
          aria-label="Add sheet"
          onClick={workspace.addSheet}
        >
          ＋
        </button>
        <span className="sheet-tab-spacer" />
        <span className="zoom-label">100%</span>
      </div>
    </div>
  );
}
