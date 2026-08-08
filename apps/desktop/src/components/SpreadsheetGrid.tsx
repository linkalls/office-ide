import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  calculateSheet,
  isCalculatedError,
  type FormulaValue,
} from "@office-ide/formula";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

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
}

/** 計算結果の表示と、入力途中のformula draftを分離する。 */
function CellInput({ address, rawValue, displayValue, style, onCommit, onSelect }: CellInputProps) {
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
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
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
                      onCommit={(value) => workspace.applyCellEdit(address, value.replaceAll(",", ""))}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sheet-tabs">
        <button className="sheet-tab active" type="button">売上</button>
        <button className="sheet-tab-add" type="button">＋</button>
        <span className="sheet-tab-spacer" />
        <span className="zoom-label">100%</span>
      </div>
    </div>
  );
}
