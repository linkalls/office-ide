import { useMemo, type CSSProperties } from "react";
import type { SpreadsheetCell } from "@office-ide/spreadsheet-ir";
import type { OfficeWorkspace } from "../state/useOfficeWorkspace";

interface Props {
  workspace: OfficeWorkspace;
}

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G"];
const ROWS = Array.from({ length: 18 }, (_, index) => index + 1);

function columnToIndex(column: string): number {
  return column.charCodeAt(0) - 64;
}

function evaluateFormula(
  formula: string,
  cells: Record<string, SpreadsheetCell>,
): number | string {
  const match = formula.match(/^SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/i);
  if (!match) return `=${formula}`;
  const [, startColumn, startRowText, endColumn, endRowText] = match;
  if (startColumn !== endColumn) return `=${formula}`;
  let total = 0;
  for (let row = Number(startRowText); row <= Number(endRowText); row += 1) {
    const value = cells[`${startColumn.toUpperCase()}${row}`]?.value;
    if (typeof value === "number") total += value;
  }
  return total;
}

function formatCell(cell: SpreadsheetCell | undefined): string {
  if (!cell) return "";
  const computed = cell.formula ? evaluateFormula(cell.formula, {}) : cell.value;
  const displayValue = cell.formula ? computed : cell.value;
  if (typeof displayValue === "number") return displayValue.toLocaleString("ja-JP");
  return String(displayValue ?? "");
}

export function SpreadsheetGrid({ workspace }: Props) {
  const cells = workspace.activeSheet.cells;
  const rendered = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of ROWS) {
      for (const column of COLUMNS) {
        const address = `${column}${row}`;
        const cell = cells[address];
        if (cell?.formula) {
          const evaluated = evaluateFormula(cell.formula, cells);
          result.set(address, typeof evaluated === "number" ? evaluated.toLocaleString("ja-JP") : evaluated);
        } else {
          result.set(address, formatCell(cell));
        }
      }
    }
    return result;
  }, [cells]);

  return (
    <div className="grid-viewport">
      <table className="spreadsheet-grid" aria-label="売上 spreadsheet">
        <colgroup>
          <col className="row-number-column" />
          {COLUMNS.map((column) => (
            <col key={column} className={`sheet-column column-${column.toLowerCase()}`} />
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
            <tr key={row}>
              <th data-active={workspace.activeCell.endsWith(String(row))}>{row}</th>
              {COLUMNS.map((column) => {
                const address = `${column}${row}`;
                const cell = cells[address];
                const isHeader = row === 1 && column !== "G";
                const isTotal = row === 16 && column !== "G";
                return (
                  <td
                    key={address}
                    data-active={workspace.activeCell === address}
                    data-header={isHeader}
                    data-total={isTotal}
                    style={{
                      backgroundColor: cell?.style?.background,
                      color: cell?.style?.foreground,
                    }}
                    onClick={() => {
                      workspace.setActiveCell(address);
                      workspace.setSelection(address);
                    }}
                  >
                    <input
                      aria-label={`Cell ${address}`}
                      value={rendered.get(address) ?? ""}
                      style={{
                        color: cell?.style?.foreground,
                        fontWeight: cell?.style?.bold ? 700 : undefined,
                        fontStyle: cell?.style?.italic ? "italic" : undefined,
                        textAlign: cell?.style?.horizontalAlign,
                      }}
                      onFocus={() => {
                        workspace.setActiveCell(address);
                        workspace.setSelection(address);
                      }}
                      onChange={(event) => workspace.applyCellEdit(address, event.target.value.replaceAll(",", ""))}
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
