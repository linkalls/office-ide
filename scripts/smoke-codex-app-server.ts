interface RpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
  params?: unknown;
}

interface AccountReadResult {
  account: null | { type?: string; planType?: string };
  requiresOpenaiAuth: boolean;
}

const args = new Set(Bun.argv.slice(2));
const includeTurn = args.has("--turn");
const workspace = process.cwd();
const officeSkillPath = `${workspace}${process.platform === "win32" ? "\\" : "/"}skills${process.platform === "win32" ? "\\" : "/"}office-ide-agent${process.platform === "win32" ? "\\" : "/"}SKILL.md`;
const officeSkillRoot = `${workspace}${process.platform === "win32" ? "\\" : "/"}skills`;
const timeoutMilliseconds = includeTurn ? 120_000 : 15_000;
// Keep this smoke runner aligned with the native host. On Windows, `codex`
// may be a stale global shim even when the official package is available via
// Bun. The desktop host launches the pinned package through bunx as well.
const defaultLauncher = process.platform === "win32"
  ? { executable: "bunx", prefixArguments: ["--yes", "@openai/codex@0.147.0"] }
  : { executable: "codex", prefixArguments: [] };
const executable = process.env.CODEX_APP_SERVER_BIN ?? defaultLauncher.executable;
const prefixArguments = process.env.CODEX_APP_SERVER_PREFIX_ARGS
  ? JSON.parse(process.env.CODEX_APP_SERVER_PREFIX_ARGS) as unknown
  : defaultLauncher.prefixArguments;
if (!Array.isArray(prefixArguments) || !prefixArguments.every((argument) => typeof argument === "string")) {
  throw new Error("CODEX_APP_SERVER_PREFIX_ARGS must be a JSON array of strings");
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMilliseconds);
    }),
  ]);
}

const child = Bun.spawn([executable, ...prefixArguments, "app-server"], {
  cwd: workspace,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

const stdin = child.stdin;
const decoder = new TextDecoder();
let nextRequestId = 1;
let stdoutBuffer = "";
let agentText = "";
let completedTurnStatus: string | null = null;
const pending = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

let resolveTurnCompleted: (() => void) | undefined;
const turnCompleted = new Promise<void>((resolve) => {
  resolveTurnCompleted = resolve;
});

function write(message: RpcMessage): Promise<void> {
  // Bun.spawn exposes a native FileSink for piped stdin rather than a Web
  // WritableStream. Promise.resolve keeps the call site uniform if Bun changes
  // the return type between a byte count and a promise in a future release.
  return Promise.resolve(stdin.write(`${JSON.stringify(message)}\n`)).then(() => undefined);
}

async function request(method: string, params: unknown): Promise<unknown> {
  const id = nextRequestId;
  nextRequestId += 1;
  const response = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  await write({ id, method, params });
  return withTimeout(response, method);
}

async function notify(method: string, params: unknown): Promise<void> {
  await write({ method, params });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function receive(message: RpcMessage): void {
  if (typeof message.id === "number" && !message.method) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message ?? "Unknown app-server error"));
    else waiter.resolve(message.result);
    return;
  }

  if (message.method === "item/agentMessage/delta") {
    const params = asRecord(message.params);
    if (typeof params?.delta === "string") agentText += params.delta;
  }

  if (message.method === "turn/completed") {
    const params = asRecord(message.params);
    const turn = asRecord(params?.turn);
    completedTurnStatus = typeof turn?.status === "string" ? turn.status : "completed";
    resolveTurnCompleted?.();
  }
}

async function readStdout(): Promise<void> {
  for await (const chunk of child.stdout) {
    stdoutBuffer += decoder.decode(chunk, { stream: true });
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) receive(JSON.parse(line) as RpcMessage);
      newline = stdoutBuffer.indexOf("\n");
    }
  }
}

const stdoutTask = readStdout();

try {
  const initialize = asRecord(await request("initialize", {
    clientInfo: {
      name: "office_ide_smoke",
      title: "Office IDE smoke test",
      version: "0.1.0",
    },
  }));
  await notify("initialized", {});

  await request("skills/extraRoots/set", { extraRoots: [officeSkillRoot] });
  const skills = asRecord(await request("skills/list", { cwds: [workspace], forceReload: true }));
  const skillEntries = Array.isArray(skills?.data)
    ? skills.data.flatMap((entry) => {
        const record = asRecord(entry);
        return Array.isArray(record?.skills) ? record.skills : [];
      })
    : [];
  if (!skillEntries.some((entry) => asRecord(entry)?.name === "office-ide-agent")) {
    throw new Error("Office IDE skill was not discovered by the app-server");
  }

  const account = await request("account/read", {
    refreshToken: false,
  }) as AccountReadResult;
  if (account.requiresOpenaiAuth && !account.account) {
    throw new Error("Codex is installed but not signed in");
  }

  const modelList = asRecord(await request("model/list", { includeHidden: false }));
  const models = Array.isArray(modelList?.data) ? modelList.data : [];
  const selectedModel = models
    .map(asRecord)
    .find((model) => typeof model?.model === "string") ?? null;
  if (!selectedModel || typeof selectedModel.model !== "string") {
    throw new Error("model/list returned no selectable model");
  }
  const selectedEffort = typeof selectedModel.defaultReasoningEffort === "string"
    ? selectedModel.defaultReasoningEffort
    : null;

  console.log(JSON.stringify({
    initialized: initialize !== null,
    accountType: account.account?.type ?? "external",
    planType: account.account?.planType ?? null,
    codexTurnTest: includeTurn,
    officeIdeSkillDiscovered: true,
    modelPickerAvailable: true,
  }));

  const threadList = asRecord(await request("thread/list", {
    limit: 1,
    cwd: workspace,
  }));
  if (!Array.isArray(threadList?.data)) {
    throw new Error("thread/list returned no data array");
  }
  console.log(JSON.stringify({ threadListRead: true, returnedThreadCount: threadList.data.length }));

  if (includeTurn) {
    // Ephemeral keeps the smoke conversation out of normal thread history.
    // Read-only plus approvalPolicy=never guarantees this test cannot mutate
    // the repository or pause for a command approval.
    const threadResponse = asRecord(await request("thread/start", {
      cwd: workspace,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "office_ide_smoke",
      developerInstructions: "Use the attached $office-ide-agent skill for Office IDE workbook work.",
      model: selectedModel.model,
    }));
    const thread = asRecord(threadResponse?.thread);
    const threadId = typeof thread?.id === "string" ? thread.id : null;
    if (!threadId) throw new Error("thread/start returned no thread id");

    await request("turn/start", {
      threadId,
      cwd: workspace,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      model: selectedModel.model,
      effort: selectedEffort,
      input: [{
        type: "skill",
        name: "office-ide-agent",
        path: officeSkillPath,
      }, {
        type: "text",
        text: "Reply with exactly OFFICE_IDE_SMOKE_OK. Do not use tools.",
      }],
    });
    await withTimeout(turnCompleted, "turn/completed");

    if (completedTurnStatus !== "completed") {
      throw new Error(`Codex turn ended with status ${completedTurnStatus}`);
    }
    if (!agentText.includes("OFFICE_IDE_SMOKE_OK")) {
      throw new Error("Codex turn completed without the expected marker");
    }
    console.log(JSON.stringify({
      threadStarted: true,
      turnCompleted: true,
      responseMarkerMatched: true,
      modelOverrideAccepted: true,
    }));
  }
} finally {
  stdin.end();
  child.kill();
  await child.exited;
  await stdoutTask.catch(() => undefined);
}
