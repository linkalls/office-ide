export type CodexRuntimePhase =
  | "browser"
  | "disconnected"
  | "starting"
  | "ready"
  | "running"
  | "error"
  | "exited";

export type CodexActivityKind =
  | "agentMessage"
  | "item"
  | "turn"
  | "approval"
  | "stderr"
  | "protocol";

export interface CodexActivity {
  id: string;
  kind: CodexActivityKind;
  title: string;
  detail?: string;
  status: "running" | "completed" | "error" | "pending";
  threadId?: string;
  turnId?: string;
  itemId?: string;
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export interface CodexRuntimeState {
  phase: CodexRuntimePhase;
  statusMessage: string;
  threadId: string | null;
  turnId: string | null;
  activities: CodexActivity[];
  pendingRequests: CodexServerRequest[];
}

export interface CodexBackendEvent {
  kind: "phase" | "notification" | "serverRequest" | "stderr" | "protocolError";
  phase?: CodexRuntimePhase;
  message?: string;
  payload?: unknown;
}

export type CodexRuntimeAction =
  | { type: "backend"; event: CodexBackendEvent }
  | { type: "threadStarted"; threadId: string }
  | { type: "turnStarted"; turnId: string }
  | { type: "failure"; message: string };

export function createCodexRuntimeState(isDesktop: boolean): CodexRuntimeState {
  return {
    phase: isDesktop ? "disconnected" : "browser",
    statusMessage: isDesktop
      ? "Codex app-server is disconnected"
      : "Browser preview uses the explicit local planner",
    threadId: null,
    turnId: null,
    activities: [],
    pendingRequests: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function getParams(payload: unknown): Record<string, unknown> {
  return asRecord(asRecord(payload)?.params) ?? {};
}

function getNestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record[key]);
}

function activityId(prefix: string, ...parts: Array<string | undefined>): string {
  return [prefix, ...parts.filter(Boolean)].join(":");
}

function upsertActivity(
  activities: CodexActivity[],
  activity: CodexActivity,
): CodexActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) => itemIndex === index
    ? { ...item, ...activity }
    : item);
}

function appendAgentDelta(
  activities: CodexActivity[],
  id: string,
  delta: string,
  ids: Pick<CodexActivity, "threadId" | "turnId" | "itemId">,
): CodexActivity[] {
  const existing = activities.find((activity) => activity.id === id);
  return upsertActivity(activities, {
    id,
    kind: "agentMessage",
    title: "Codex",
    detail: `${existing?.detail ?? ""}${delta}`,
    status: "running",
    ...ids,
  });
}

function reduceNotification(
  state: CodexRuntimeState,
  payload: unknown,
): CodexRuntimeState {
  const message = asRecord(payload);
  const method = readString(message, "method");
  if (!method) return state;

  const params = getParams(payload);
  const thread = getNestedRecord(params, "thread");
  const turn = getNestedRecord(params, "turn");
  const item = getNestedRecord(params, "item");
  const threadId = readString(params, "threadId") ?? readString(thread, "id") ?? state.threadId ?? undefined;
  const turnId = readString(params, "turnId") ?? readString(turn, "id") ?? state.turnId ?? undefined;
  const itemId = readString(params, "itemId") ?? readString(item, "id");

  if (method === "serverRequest/resolved") {
    const requestId = params.requestId;
    return {
      ...state,
      pendingRequests: state.pendingRequests.filter((request) => request.id !== requestId),
      activities: state.activities.map((activity) => (
        activity.id === activityId("approval", String(requestId))
          ? { ...activity, status: "completed" }
          : activity
      )),
    };
  }

  if (method === "turn/started") {
    return {
      ...state,
      phase: "running",
      statusMessage: "Codex is working",
      threadId: threadId ?? state.threadId,
      turnId: turnId ?? state.turnId,
      activities: upsertActivity(state.activities, {
        id: activityId("turn", turnId),
        kind: "turn",
        title: "Turn started",
        status: "running",
        threadId,
        turnId,
      }),
    };
  }

  if (method === "turn/completed") {
    const turnStatus = readString(turn, "status") ?? "completed";
    return {
      ...state,
      phase: turnStatus === "failed" ? "error" : "ready",
      statusMessage: turnStatus === "failed" ? "Codex turn failed" : "Codex app-server ready",
      activities: upsertActivity(state.activities, {
        id: activityId("turn", turnId),
        kind: "turn",
        title: turnStatus === "interrupted" ? "Turn interrupted" : "Turn completed",
        detail: turnStatus,
        status: turnStatus === "failed" ? "error" : "completed",
        threadId,
        turnId,
      }),
    };
  }

  if (method === "error") {
    const error = getNestedRecord(params, "error");
    const detail = readString(error, "message") ?? "Codex turn failed";
    return {
      ...state,
      phase: "error",
      statusMessage: detail,
      activities: [...state.activities, {
        id: activityId("error", turnId, String(state.activities.length)),
        kind: "protocol",
        title: "Codex error",
        detail,
        status: "error",
        threadId,
        turnId,
      }],
    };
  }

  if (method === "item/agentMessage/delta") {
    const delta = readString(params, "delta") ?? "";
    const id = activityId("agent", turnId, itemId ?? "message");
    return {
      ...state,
      activities: appendAgentDelta(state.activities, id, delta, {
        threadId,
        turnId,
        itemId,
      }),
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const itemType = readString(item, "type") ?? "item";
    const completed = method === "item/completed";
    const id = activityId(
      itemType === "agentMessage" ? "agent" : "item",
      turnId,
      itemId ?? itemType,
    );
    return {
      ...state,
      activities: upsertActivity(state.activities, {
        id,
        kind: itemType === "agentMessage" ? "agentMessage" : "item",
        title: itemType,
        detail: readString(item, "text") ?? readString(item, "command"),
        status: completed ? "completed" : "running",
        threadId,
        turnId,
        itemId,
      }),
    };
  }

  return {
    ...state,
    activities: [
      ...state.activities,
      {
        id: activityId("protocol", method, String(state.activities.length)),
        kind: "protocol",
        title: method,
        status: "completed",
        threadId,
        turnId,
        itemId,
      },
    ],
  };
}

export function codexRuntimeReducer(
  state: CodexRuntimeState,
  action: CodexRuntimeAction,
): CodexRuntimeState {
  if (action.type === "threadStarted") {
    return { ...state, threadId: action.threadId };
  }
  if (action.type === "turnStarted") {
    return {
      ...state,
      phase: "running",
      statusMessage: "Codex is working",
      turnId: action.turnId,
    };
  }
  if (action.type === "failure") {
    return { ...state, phase: "error", statusMessage: action.message };
  }

  const event = action.event;
  if (event.kind === "phase") {
    const phase = event.phase ?? state.phase;
    return {
      ...state,
      phase,
      statusMessage: event.message ?? state.statusMessage,
      threadId: phase === "exited" || phase === "disconnected" ? null : state.threadId,
      turnId: phase === "exited" || phase === "disconnected" ? null : state.turnId,
    };
  }
  if (event.kind === "notification") {
    return reduceNotification(state, event.payload);
  }
  if (event.kind === "serverRequest") {
    const request = asRecord(event.payload);
    const id = request?.id;
    const method = readString(request, "method");
    if ((typeof id !== "string" && typeof id !== "number") || !method) return state;
    const serverRequest: CodexServerRequest = {
      id,
      method,
      params: request?.params,
    };
    return {
      ...state,
      pendingRequests: [...state.pendingRequests, serverRequest],
      activities: [...state.activities, {
        id: activityId("approval", String(id)),
        kind: "approval",
        title: method,
        detail: "Codex app-server requested a decision",
        status: "pending",
      }],
    };
  }

  const detail = event.message ?? "Unknown Codex runtime diagnostic";
  return {
    ...state,
    phase: event.kind === "protocolError" ? "error" : state.phase,
    statusMessage: event.kind === "protocolError" ? detail : state.statusMessage,
    activities: [...state.activities, {
      id: activityId(event.kind, String(state.activities.length)),
      kind: event.kind === "stderr" ? "stderr" : "protocol",
      title: event.kind === "stderr" ? "stderr" : "Protocol error",
      detail,
      status: event.kind === "stderr" ? "completed" : "error",
    }],
  };
}

export function readThreadId(response: unknown): string | null {
  const result = asRecord(response);
  return readString(getNestedRecord(result ?? {}, "thread"), "id") ?? null;
}

export function readTurnId(response: unknown): string | null {
  const result = asRecord(response);
  return readString(getNestedRecord(result ?? {}, "turn"), "id") ?? null;
}
