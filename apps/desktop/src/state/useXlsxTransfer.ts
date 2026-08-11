import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { SpreadsheetWorkbook } from "@office-ide/spreadsheet-ir";
import type { OfficeWorkspace } from "./useOfficeWorkspace";

export interface XlsxCompatibilityReport {
  path: string;
  importedCells: number;
  exportedCells: number;
  warnings: string[];
}

interface XlsxImportResult {
  workbook: SpreadsheetWorkbook;
  report: XlsxCompatibilityReport;
}

export function useXlsxTransfer(workspace: OfficeWorkspace) {
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [report, setReport] = useState<XlsxCompatibilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyImport = useCallback(async (request: () => Promise<XlsxImportResult | null>) => {
    setBusy("import");
    setError(null);
    try {
      const result = await request();
      if (!result) return;
      workspace.importWorkbook(result.workbook, result.report);
      setReport(result.report);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }, [workspace]);

  const importWorkbook = useCallback(async () => {
    if (!isTauri()) {
      setError("XLSX import is available in the desktop app only.");
      return;
    }
    await applyImport(() => invoke<XlsxImportResult | null>("xlsx_import"));
  }, [applyImport]);

  const importWorkbookPath = useCallback(async (path: string) => {
    if (!isTauri()) return;
    await applyImport(() => invoke<XlsxImportResult>("xlsx_import_path", { path }));
  }, [applyImport]);

  const exportWorkbook = useCallback(async () => {
    if (!isTauri()) {
      setError("XLSX export is available in the desktop app only.");
      return;
    }
    setBusy("export");
    setError(null);
    try {
      const nextReport = await invoke<XlsxCompatibilityReport | null>("xlsx_export", {
        workbook: workspace.workbook,
      });
      if (nextReport) setReport(nextReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }, [workspace]);

  return { busy, report, error, importWorkbook, importWorkbookPath, exportWorkbook };
}

export type XlsxTransfer = ReturnType<typeof useXlsxTransfer>;
