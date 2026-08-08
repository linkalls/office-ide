import type { Transaction } from "@office-ide/operations";
import type { SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";

export type HistoryEntryState = "applied" | "reverted";

export interface HistoryEntry {
  transaction: Transaction;
  before: SpreadsheetWorkbook;
  after: SpreadsheetWorkbook;
  state: HistoryEntryState;
  stateChangedAt: number;
  stateRevision: number;
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
    stateRevision: 0,
  };
}

export function setHistoryEntryState(
  entries: HistoryEntry[],
  transactionId: string,
  state: HistoryEntryState,
  changedAt = Date.now(),
): HistoryEntry[] {
  return entries.map((entry) => entry.transaction.id === transactionId
    ? {
        ...entry,
        state,
        stateChangedAt: changedAt,
        stateRevision: entry.stateRevision + 1,
      }
    : entry);
}

export function getHistoryLifecycle(
  entry: HistoryEntry,
): "applied" | "reverted" | "re-applied" {
  if (entry.state === "reverted") return "reverted";
  return entry.stateRevision > 0 ? "re-applied" : "applied";
}
