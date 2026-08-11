import { describe, expect, test } from "bun:test";
import { createEmptyWorkbook } from "@office-ide/spreadsheet-ir";
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  type WorkspaceStorage,
  WORKSPACE_STORAGE_KEY,
} from "./workspacePersistence";

function createMemoryStorage(): WorkspaceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("workspace persistence", () => {
  test("round trips KDL and the active sheet through a versioned snapshot", () => {
    const storage = createMemoryStorage();
    const workbook = createEmptyWorkbook("売上分析", "売上");
    workbook.sheets.push({
      ...structuredClone(workbook.sheets[0]!),
      id: "sheet-2",
      name: "集計",
      cells: { A1: { address: "A1", value: "保存済み" } },
    });
    workbook.activeSheetId = "sheet-2";

    expect(saveWorkspaceSnapshot(storage, workbook, [{ id: "report", name: "report", source: "# Report" }], 1234)).toBe(1234);
    const restored = loadWorkspaceSnapshot(storage);
    expect(restored?.savedAt).toBe(1234);
    expect(restored?.workbook.activeSheetId).toBe("sheet-2");
    expect(restored?.documentSource).toBe("# Report");
    expect(restored?.documents).toEqual([{ id: "report", name: "report", source: "# Report" }]);
    expect(restored?.workbook.sheets[1]?.cells.A1?.value).toBe("保存済み");
  });

  test("restores version 1 snapshots with a default document", () => {
    const storage = createMemoryStorage();
    const workbook = createEmptyWorkbook("Sales", "Sheet1");
    saveWorkspaceSnapshot(storage, workbook, [{ id: "report", name: "report", source: "# Ignored" }], 1234);
    const legacy = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY)!) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.documentSource;
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(legacy));

    expect(loadWorkspaceSnapshot(storage)?.documentSource).toBeNull();
  });

  test("round trips multiple Djot documents", () => {
    const storage = createMemoryStorage();
    const workbook = createEmptyWorkbook("Sales", "Sheet1");
    saveWorkspaceSnapshot(storage, workbook, [
      { id: "report", name: "report", source: "# Report" },
      { id: "notes", name: "notes", source: "# Notes" },
    ], 1234);
    expect(loadWorkspaceSnapshot(storage)?.documents?.map((document) => document.name)).toEqual(["report", "notes"]);
  });

  test("ignores corrupt or unsupported snapshots and can clear recovery data", () => {
    const storage = createMemoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, "not json");
    expect(loadWorkspaceSnapshot(storage)).toBeNull();
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 999 }));
    expect(loadWorkspaceSnapshot(storage)).toBeNull();
    clearWorkspaceSnapshot(storage);
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });
});
