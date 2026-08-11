import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
  onToggleSelection: () => void;
  onNavigate: (direction: "up" | "down" | "left" | "right", jump?: boolean, extend?: boolean) => void;
  onFill: (direction: "down" | "right") => void;
  onClear: () => void;
}

/** 計算結果の表示と、入力途中のformula draftを分離する。 */
function CellInput({ address, rawValue, displayValue, style, onCommit, onSelect, onToggleSelection, onNavigate, onFill, onClear }: CellInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawValue);
  const cancelRef = useRef(false);
  const extendSelectionRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(rawValue);
  }, [editing, rawValue]);

  return (
    <input
      aria-label={`Cell ${address}`}
      readOnly={!editing}
      value={editing ? draft : displayValue}
      style={style}
      onMouseDown={(event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          onToggleSelection();
          extendSelectionRef.current = true;
          event.currentTarget.focus();
          return;
        }
        if (!event.shiftKey) return;
        event.preventDefault();
        extendSelectionRef.current = true;
        onSelect(true);
        event.currentTarget.focus();
      }}
      onFocus={(event) => {
        cancelRef.current = false;
        setDraft(rawValue);
        if (event.currentTarget.dataset.preserveSelection === "true") {
          delete event.currentTarget.dataset.preserveSelection;
          return;
        }
        if (extendSelectionRef.current) extendSelectionRef.current = false;
        else onSelect(false);
      }}
      onDoubleClick={() => {
        setDraft(rawValue);
        setEditing(true);
      }}
      onPointerEnter={(event) => {
        if (event.buttons === 1) onSelect(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!editing) return;
        setEditing(false);
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(rawValue);
          return;
        }
        if (draft !== rawValue) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (!editing && (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "d" || event.key.toLowerCase() === "r")) {
          event.preventDefault();
          onFill(event.key.toLowerCase() === "d" ? "down" : "right");
          return;
        }
        if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          onClear();
          return;
        }
        if (!editing && event.key === "F2") {
          event.preventDefault();
          setDraft(rawValue);
          setEditing(true);
          return;
        }
        if (!editing && event.key.startsWith("Arrow")) {
          event.preventDefault();
          const directions = {
            ArrowUp: "up",
            ArrowDown: "down",
            ArrowLeft: "left",
            ArrowRight: "right",
          } as const;
          onNavigate(
            directions[event.key as keyof typeof directions],
            event.ctrlKey || event.metaKey,
            event.shiftKey,
          );
          return;
        }
        if (!editing && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          setDraft(event.key);
          setEditing(true);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (!editing) return;
          event.preventDefault();
          const direction = event.key === "Enter"
            ? event.shiftKey ? "up" : "down"
            : event.shiftKey ? "left" : "right";
          event.currentTarget.blur();
          window.requestAnimationFrame(() => onNavigate(direction));
        }
        if (event.key === "Escape") {
          if (!editing) return;
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
  const [fillDragActive, setFillDragActive] = useState(false);
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

  useEffect(() => {
    if (!fillDragActive) return undefined;
    const finishFill = () => {
      workspace.applyFormulaFill();
      setFillDragActive(false);
    };
    window.addEventListener("pointerup", finishFill, { once: true });
    return () => window.removeEventListener("pointerup", finishFill);
  }, [fillDragActive, workspace.applyFormulaFill]);

  const navigateFrom = (
    address: string,
    direction: "up" | "down" | "left" | "right",
    jump = false,
    extend = false,
  ) => {
    const match = address.match(/^([A-Z]+)([1-9]\d*)$/);
    if (!match) return;
    let columnIndex = COLUMNS.indexOf(match[1]);
    let row = Number(match[2]);
    const moveOnce = () => {
      if (direction === "up") row = Math.max(1, row - 1);
      if (direction === "down") row = Math.min(ROWS.length, row + 1);
      if (direction === "left") columnIndex = Math.max(0, columnIndex - 1);
      if (direction === "right") columnIndex = Math.min(COLUMNS.length - 1, columnIndex + 1);
    };
    if (jump) {
      const initialValue = workspace.activeSheet.cells[address]?.value ?? workspace.activeSheet.cells[address]?.formula;
      while (true) {
        const beforeColumn = columnIndex;
        const beforeRow = row;
        moveOnce();
        if (beforeColumn === columnIndex && beforeRow === row) break;
        const candidate = workspace.activeSheet.cells[`${COLUMNS[columnIndex]}${row}`];
        const candidateValue = candidate?.value ?? candidate?.formula;
        if (Boolean(initialValue) !== Boolean(candidateValue)) {
          if (initialValue) {
            columnIndex = beforeColumn;
            row = beforeRow;
          }
          break;
        }
      }
    } else moveOnce();
    const nextAddress = `${COLUMNS[Math.max(0, columnIndex)]}${row}`;
    workspace.selectCell(nextAddress, extend);
    const nextInput = document.querySelector<HTMLInputElement>(`input[aria-label="Cell ${nextAddress}"]`);
    if (extend && nextInput) nextInput.dataset.preserveSelection = "true";
    nextInput?.focus();
  };

  const beginColumnResize = (column: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = workspace.activeSheet.columnWidths[column] ?? 14;
    const finish = (move: PointerEvent) => {
      workspace.applyColumnWidth(column, startWidth + (move.clientX - startX) / 7);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointerup", finish, { once: true });
  };

  const beginRowResize = (row: number, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = workspace.activeSheet.rowHeights[row] ?? 25;
    const finish = (move: PointerEvent) => {
      workspace.applyRowHeight(row, startHeight + move.clientY - startY);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointerup", finish, { once: true });
  };

  return (
    <div
      className="grid-viewport"
      onCopy={(event) => {
        event.preventDefault();
        event.clipboardData.setData("text/plain", workspace.copySelection());
      }}
      onPaste={(event) => {
        event.preventDefault();
        workspace.pasteCells(event.clipboardData.getData("text/plain"));
      }}
    >
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
            <th
              className="grid-corner"
              aria-label="Select all cells"
              onClick={() => {
                workspace.selectCell("A1");
                workspace.setSelection(`A1:${COLUMNS.at(-1)}${ROWS.at(-1)}`);
              }}
            />
            {COLUMNS.map((column) => (
              <th
                key={column}
                data-active={workspace.activeCell.startsWith(column)}
                style={{ "--column-index": columnToIndex(column) } as CSSProperties}
                onClick={() => {
                  workspace.selectCell(`${column}1`);
                  workspace.setSelection(`${column}1:${column}${ROWS.at(-1)}`);
                }}
              >
                {column}<span
                  className="column-resize-handle"
                  role="separator"
                  aria-label={`Resize column ${column}`}
                  aria-orientation="vertical"
                  onPointerDown={(event) => beginColumnResize(column, event)}
                />
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
              <th
                data-active={workspace.activeCell.endsWith(String(row))}
                onClick={() => {
                  workspace.selectCell(`A${row}`);
                  workspace.setSelection(`A${row}:${COLUMNS.at(-1)}${row}`);
                }}
              >{row}<span
                className="row-resize-handle"
                role="separator"
                aria-label={`Resize row ${row}`}
                aria-orientation="horizontal"
                onPointerDown={(event) => beginRowResize(row, event)}
              /></th>
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
                const secondarySelected = workspace.secondarySelections.includes(address);
                const rawValue = cell?.formula ? `=${cell.formula}` : String(cell?.value ?? "");
                return (
                  <td
                    key={address}
                    data-active={workspace.activeCell === address}
                    data-selected={selected}
                    data-secondary-selected={secondarySelected}
                    data-formula-error={isCalculatedError(calculated[address])}
                    data-header={isHeader}
                    data-total={isTotal}
                    data-fill-dragging={fillDragActive}
                    onPointerMove={() => {
                      if (fillDragActive) workspace.selectCell(address, true);
                    }}
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
                      onToggleSelection={() => workspace.toggleSecondarySelection(address)}
                      onCommit={(value) => workspace.applyCellEdit(
                        address,
                        value.startsWith("=") ? value : value.replaceAll(",", ""),
                      )}
                      onNavigate={(direction, jump, extend) => navigateFrom(address, direction, jump, extend)}
                      onFill={workspace.fillSelection}
                      onClear={workspace.clearSelection}
                    />
                    {workspace.activeCell === address && workspace.canFillFormula ? (
                      <button
                        type="button"
                        className="formula-fill-handle"
                        aria-label="Fill formula through selection"
                        title="Fill formula through selection"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          setFillDragActive(true);
                        }}
                      />
                    ) : null}
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
