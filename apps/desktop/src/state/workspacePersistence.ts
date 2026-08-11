import {
  parseSpreadsheetSource,
  serializeSpreadsheetSource,
} from "@office-ide/sheet-source";
import type { SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";

export const WORKSPACE_STORAGE_KEY = "office-ide.workspace.sales-report.v1";
const SNAPSHOT_VERSION = 3;
const LEGACY_SNAPSHOT_VERSIONS = [1, 2] as const;

export interface StoredDocument {
  id: string;
  name: string;
  source: string;
}

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RestoredWorkspace {
  workbook: SpreadsheetWorkbook;
  source: string;
  documentSource: string | null;
  documents: StoredDocument[] | null;
  savedAt: number;
}

interface WorkspaceSnapshot {
  version: typeof SNAPSHOT_VERSION | (typeof LEGACY_SNAPSHOT_VERSIONS)[number];
  savedAt: number;
  activeSheetId: string;
  source: string;
  documentSource?: string;
  documents?: StoredDocument[];
}

/**
 * SnapshotはKDLを正本として保存する。復元時にも必ずparserを通すため、
 * 古い・壊れたJSONをそのままruntime stateへ注入しない。
 */
export function loadWorkspaceSnapshot(storage: WorkspaceStorage): RestoredWorkspace | null {
  try {
    const serialized = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!serialized) return null;
    const snapshot = JSON.parse(serialized) as Partial<WorkspaceSnapshot>;
    if (
      (snapshot.version !== SNAPSHOT_VERSION && !LEGACY_SNAPSHOT_VERSIONS.includes(snapshot.version as 1 | 2))
      || typeof snapshot.savedAt !== "number"
      || typeof snapshot.source !== "string"
      || typeof snapshot.activeSheetId !== "string"
    ) return null;

    const parsed = parseSpreadsheetSource(snapshot.source);
    if (!parsed.workbook || parsed.diagnostics.length > 0) return null;
    if (parsed.workbook.sheets.some((sheet) => sheet.id === snapshot.activeSheetId)) {
      parsed.workbook.activeSheetId = snapshot.activeSheetId;
    }
    return {
      workbook: parsed.workbook,
      source: snapshot.source,
      documentSource: typeof snapshot.documentSource === "string" ? snapshot.documentSource : null,
      documents: Array.isArray(snapshot.documents)
        ? snapshot.documents.filter((document): document is StoredDocument => (
            Boolean(document)
            && typeof document.id === "string"
            && typeof document.name === "string"
            && typeof document.source === "string"
          ))
        : null,
      savedAt: snapshot.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(
  storage: WorkspaceStorage,
  workbook: SpreadsheetWorkbook,
  documents: StoredDocument[],
  savedAt = Date.now(),
): number {
  const snapshot: WorkspaceSnapshot = {
    version: SNAPSHOT_VERSION,
    savedAt,
    activeSheetId: workbook.activeSheetId,
    source: serializeSpreadsheetSource(workbook),
    documentSource: documents[0]?.source ?? "",
    documents,
  };
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  return savedAt;
}

export function clearWorkspaceSnapshot(storage: WorkspaceStorage): void {
  storage.removeItem(WORKSPACE_STORAGE_KEY);
}
