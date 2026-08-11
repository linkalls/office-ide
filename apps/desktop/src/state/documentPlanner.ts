export interface DocumentProposal {
  id: string;
  title: string;
  summary: string;
  nextSource: string;
}

export type DocumentPlanResult =
  | { ok: true; proposal: DocumentProposal }
  | { ok: false; message: string };

export interface DocumentReadResult {
  handled: boolean;
  message: string;
}

/** Returns data for the docctl commands which must never open an edit proposal. */
export function readDocctlCommand(command: string, source: string, selection = { start: 0, end: 0 }): DocumentReadResult {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== "docctl") return { handled: false, message: "" };
  if (parts[1] === "context" && parts.length === 2) {
    return { handled: true, message: source };
  }
  if (parts[1] === "selection" && parts[2] === "read" && parts.length === 3) {
    const start = Math.max(0, Math.min(source.length, Math.min(selection.start, selection.end)));
    const end = Math.max(start, Math.min(source.length, Math.max(selection.start, selection.end)));
    return { handled: true, message: start === end ? "No document text is selected." : source.slice(start, end) };
  }
  return { handled: false, message: "" };
}

/** Converts a narrow, documented docctl command into a reviewable source edit. */
export function planDocctlCommand(command: string, source: string, selection = { start: 0, end: 0 }): DocumentPlanResult {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== "docctl") return { ok: false, message: "Unsupported document command." };
  if (parts[1] === "append" && parts.length > 2) {
    const text = parts.slice(2).join(" ");
    return { ok: true, proposal: { id: `docctl-append-${Date.now()}`, title: "Append document paragraph", summary: `docctl will append: ${text}`, nextSource: `${source.trimEnd()}\n\n${text}\n` } };
  }
  if (parts[1] === "selection" && parts[2] === "replace" && parts.length > 3) {
    const text = parts.slice(3).join(" ");
    const start = Math.max(0, Math.min(selection.start, selection.end));
    const end = Math.min(source.length, Math.max(selection.start, selection.end));
    if (start === end) return { ok: false, message: "Select document text before running docctl selection replace." };
    return { ok: true, proposal: { id: `docctl-replace-${Date.now()}`, title: "Replace document selection", summary: `docctl will replace the selected text with: ${text}`, nextSource: `${source.slice(0, start)}${text}${source.slice(end)}` } };
  }
  return { ok: false, message: "Unsupported docctl command. Use context, selection read, selection replace <text>, or append <text>." };
}

function quotedReplacement(input: string): { from: string; to: string } | null {
  const japanese = input.match(/「(.+?)」を「(.+?)」に(?:置換|変更)/);
  if (japanese) return { from: japanese[1]!, to: japanese[2]! };
  const english = input.match(/replace\s+["']?(.+?)["']?\s+with\s+["']?(.+?)["']?$/i);
  return english ? { from: english[1]!, to: english[2]! } : null;
}

function quotedAppend(input: string): string | null {
  const japanese = input.match(/「(.+?)」を(?:追加|追記)/);
  if (japanese) return japanese[1]!;
  const english = input.match(/(?:append|add)\s+["']?(.+?)["']?$/i);
  return english?.[1] ?? null;
}

export function planDocumentRequest(input: string, source: string): DocumentPlanResult {
  const replacement = quotedReplacement(input.trim());
  if (replacement) {
    if (!source.includes(replacement.from)) return { ok: false, message: `「${replacement.from}」 is not in the active document.` };
    return { ok: true, proposal: {
      id: `document-replace-${Date.now()}`,
      title: "Replace document text",
      summary: `Replace “${replacement.from}” with “${replacement.to}”.`,
      nextSource: source.replace(replacement.from, replacement.to),
    } };
  }
  const appended = quotedAppend(input.trim());
  if (appended) return { ok: true, proposal: {
    id: `document-append-${Date.now()}`,
    title: "Append paragraph",
    summary: `Append a paragraph: “${appended}”.`,
    nextSource: `${source.trimEnd()}\n\n${appended}\n`,
  } };
  return { ok: false, message: "Try “「旧文」を「新文」に置換” or “「追記する段落」を追加”." };
}
