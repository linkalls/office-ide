import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export function useDocxTransfer() {
  const desktop = isTauri();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const importDocx = useCallback(async (): Promise<string | null> => {
    if (!desktop) { setMessage("DOCX import is available in the desktop app."); return null; }
    setBusy(true);
    try {
      const source = await invoke<string | null>("docx_import");
      setMessage(source ? "DOCX imported into report.dj." : null);
      return source;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setBusy(false); }
  }, [desktop]);
  const importDocxPath = useCallback(async (path: string): Promise<string | null> => {
    if (!desktop) return null;
    setBusy(true);
    try {
      const source = await invoke<string>("docx_import_path", { path });
      setMessage("DOCX imported into report.dj.");
      return source;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setBusy(false); }
  }, [desktop]);
  const exportDocx = useCallback(async (source: string) => {
    if (!desktop) { setMessage("DOCX export is available in the desktop app."); return; }
    setBusy(true);
    try {
      const saved = await invoke<boolean>("docx_export", { source });
      setMessage(saved ? "DOCX exported." : null);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [desktop]);
  return { busy, exportDocx, importDocx, importDocxPath, message };
}
