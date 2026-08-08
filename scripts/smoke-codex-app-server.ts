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
const timeoutMilliseconds = includeTurn ? 120_000 : 15_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMilliseconds);
    }),
  ]);
}

const child = Bun.spawn(["codex", "app-server"], {
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

  const account = await request("account/read", {
    refreshToken: false,
  }) as AccountReadResult;
  if (account.requiresOpenaiAuth && !account.account) {
    throw new Error("Codex is installed but not signed in");
  }

  console.log(JSON.stringify({
    initialized: initialize !== null,
    accountType: account.account?.type ?? "external",
    planType: account.account?.planType ?? null,
    codexTurnTest: includeTurn,
  }));

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
    }));
    const thread = asRecord(threadResponse?.thread);
    const threadId = typeof thread?.id === "string" ? thread.id : null;
    if (!threadId) throw new Error("thread/start returned no thread id");

    await request("turn/start", {
      threadId,
      cwd: workspace,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      input: [{
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
    }));
  }
} finally {
  stdin.end();
  child.kill();
  await child.exited;
  await stdoutTask.catch(() => undefined);
}
