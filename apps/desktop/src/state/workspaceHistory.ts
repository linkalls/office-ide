import type { Transaction } from "@office-ide/operations";
import type { SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";

export type HistoryEntryState = "applied" | "reverted";

export interface HistoryEntry {
  transaction: Transaction;
  before: SpreadsheetWorkbook;
  after: SpreadsheetWorkbook;
  state: HistoryEntryState;
  stateChangedAt: number;
}

export function createHistoryEntry(
  transaction: Transaction,
  before: SpreadsheetWorkbook,
  after: SpreadsheetWorkbook,
): HistoryEntry {
  return {
    transaction,
    before,
    after,
    state: "applied",
    stateChangedAt: transaction.timestamp,
  };
}

export function setHistoryEntryState(
  entries: HistoryEntry[],
  transactionId: string,
  state: HistoryEntryState,
  changedAt = Date.now(),
): HistoryEntry[] {
  return entries.map((entry) => entry.transaction.id === transactionId
    ? { ...entry, state, stateChangedAt: changedAt }
    : entry);
}
