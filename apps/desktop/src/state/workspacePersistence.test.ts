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

    expect(saveWorkspaceSnapshot(storage, workbook, 1234)).toBe(1234);
    const restored = loadWorkspaceSnapshot(storage);
    expect(restored?.savedAt).toBe(1234);
    expect(restored?.workbook.activeSheetId).toBe("sheet-2");
    expect(restored?.workbook.sheets[1]?.cells.A1?.value).toBe("保存済み");
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
