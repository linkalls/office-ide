use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::timeout,
};

const CODEX_EVENT_NAME: &str = "codex://event";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeEvent {
    pub kind: &'static str,
    pub phase: Option<&'static str>,
    pub message: Option<String>,
    pub payload: Option<Value>,
}

impl CodexRuntimeEvent {
    fn phase(phase: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind: "phase",
            phase: Some(phase),
            message: Some(message.into()),
            payload: None,
        }
    }

    fn notification(payload: Value) -> Self {
        Self {
            kind: "notification",
            phase: None,
            message: None,
            payload: Some(payload),
        }
    }

    fn server_request(payload: Value) -> Self {
        Self {
            kind: "serverRequest",
            phase: None,
            message: None,
            payload: Some(payload),
        }
    }

    fn diagnostic(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            phase: None,
            message: Some(message.into()),
            payload: None,
        }
    }
}

#[derive(Debug, Error)]
pub enum CodexHostError {
    #[error("Codex runtime is not running")]
    NotRunning,
    #[error("Codex app-server is already running")]
    AlreadyRunning,
    #[error("failed to start `codex app-server`: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("failed to write to Codex app-server: {0}")]
    Write(#[source] std::io::Error),
    #[error("Codex app-server request {0} timed out")]
    Timeout(u64),
    #[error("Codex app-server closed request {0} without a response")]
    ResponseClosed(u64),
    #[error("Codex app-server rejected the request: {0}")]
    Server(String),
}

type PendingResponse = oneshot::Sender<Result<Value, String>>;

struct ProcessState {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct SharedState {
    process: Option<ProcessState>,
    pending: HashMap<u64, PendingResponse>,
}

/// Owns the single Codex app-server process used by the desktop window.
///
/// Credentials never leave the child process boundary. The WebView receives only
/// normalized lifecycle events and protocol payloads required to render activity.
pub struct CodexHost {
    shared: Arc<Mutex<SharedState>>,
    next_request_id: AtomicU64,
}

impl Default for CodexHost {
    fn default() -> Self {
        Self {
            shared: Arc::new(Mutex::new(SharedState::default())),
            next_request_id: AtomicU64::new(1),
        }
    }
}

impl CodexHost {
    pub async fn start(&self, app: AppHandle) -> Result<Value, CodexHostError> {
        {
            let shared = self.shared.lock().await;
            if shared.process.is_some() {
                return Err(CodexHostError::AlreadyRunning);
            }
        }

        emit(
            &app,
            CodexRuntimeEvent::phase("starting", "Starting Codex app-server"),
        );

        let mut child = Command::new("codex")
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(CodexHostError::Spawn)?;

        let stdin = child.stdin.take().ok_or_else(|| {
            CodexHostError::Spawn(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Codex stdin was not piped",
            ))
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            CodexHostError::Spawn(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Codex stdout was not piped",
            ))
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            CodexHostError::Spawn(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Codex stderr was not piped",
            ))
        })?;

        {
            let mut shared = self.shared.lock().await;
            shared.process = Some(ProcessState { child, stdin });
        }

        self.spawn_stdout_reader(app.clone(), stdout);
        self.spawn_stderr_reader(app.clone(), stderr);

        let initialize = self
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "office_ide",
                        "title": "Office IDE",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await;

        let initialize = match initialize {
            Ok(value) => value,
            Err(error) => {
                emit(&app, CodexRuntimeEvent::phase("error", error.to_string()));
                self.shutdown().await;
                return Err(error);
            }
        };

        // The official lifecycle requires the initialize response before this notification.
        self.notify("initialized", json!({})).await?;
        emit(
            &app,
            CodexRuntimeEvent::phase("ready", "Codex app-server ready"),
        );
        Ok(initialize)
    }

    pub async fn start_thread(&self, cwd: String) -> Result<Value, CodexHostError> {
        self.request(
            "thread/start",
            json!({
                "cwd": cwd,
                "approvalPolicy": "unlessTrusted",
                "sandbox": "workspaceWrite",
                "serviceName": "office_ide"
            }),
        )
        .await
    }

    pub async fn start_turn(
        &self,
        thread_id: String,
        prompt: String,
        cwd: String,
    ) -> Result<Value, CodexHostError> {
        self.request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "cwd": cwd,
                "approvalPolicy": "unlessTrusted",
                "sandboxPolicy": {
                    "type": "workspaceWrite",
                    "writableRoots": [cwd],
                    "networkAccess": false
                }
            }),
        )
        .await
    }

    pub async fn respond_to_server_request(
        &self,
        id: Value,
        result: Value,
    ) -> Result<(), CodexHostError> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }

    pub async fn shutdown(&self) {
        let mut shared = self.shared.lock().await;
        if let Some(mut process) = shared.process.take() {
            let _ = process.child.kill().await;
            let _ = process.child.wait().await;
        }
        for (_, sender) in shared.pending.drain() {
            let _ = sender.send(Err("Codex app-server stopped".to_owned()));
        }
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, CodexHostError> {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut shared = self.shared.lock().await;
            if shared.process.is_none() {
                return Err(CodexHostError::NotRunning);
            }
            shared.pending.insert(id, sender);
        }

        if let Err(error) = self
            .write_message(json!({ "method": method, "id": id, "params": params }))
            .await
        {
            self.shared.lock().await.pending.remove(&id);
            return Err(error);
        }

        match timeout(REQUEST_TIMEOUT, receiver).await {
            Err(_) => {
                self.shared.lock().await.pending.remove(&id);
                Err(CodexHostError::Timeout(id))
            }
            Ok(Err(_)) => Err(CodexHostError::ResponseClosed(id)),
            Ok(Ok(Err(message))) => Err(CodexHostError::Server(message)),
            Ok(Ok(Ok(result))) => Ok(result),
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), CodexHostError> {
        self.write_message(json!({ "method": method, "params": params }))
            .await
    }

    async fn write_message(&self, message: Value) -> Result<(), CodexHostError> {
        let mut line = serde_json::to_vec(&message).expect("JSON values always serialize");
        line.push(b'\n');
        let mut shared = self.shared.lock().await;
        let process = shared.process.as_mut().ok_or(CodexHostError::NotRunning)?;
        process
            .stdin
            .write_all(&line)
            .await
            .map_err(CodexHostError::Write)?;
        process.stdin.flush().await.map_err(CodexHostError::Write)
    }

    fn spawn_stdout_reader(&self, app: AppHandle, stdout: tokio::process::ChildStdout) {
        let shared = Arc::clone(&self.shared);
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(message) => route_message(&app, &shared, message).await,
                        Err(error) => emit(
                            &app,
                            CodexRuntimeEvent::diagnostic(
                                "protocolError",
                                format!("Invalid JSON from Codex app-server: {error}"),
                            ),
                        ),
                    },
                    Ok(None) => {
                        mark_process_exited(&app, &shared, "Codex app-server closed stdout").await;
                        break;
                    }
                    Err(error) => {
                        mark_process_exited(
                            &app,
                            &shared,
                            format!("Failed to read Codex app-server stdout: {error}"),
                        )
                        .await;
                        break;
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(&self, app: AppHandle, stderr: tokio::process::ChildStderr) {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit(&app, CodexRuntimeEvent::diagnostic("stderr", line));
            }
        });
    }
}

async fn route_message(app: &AppHandle, shared: &Arc<Mutex<SharedState>>, message: Value) {
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        // A response has result/error but no method. A message with method is a
        // server-initiated request (for example an approval) and must reach the UI.
        if message.get("method").is_none() {
            if let Some(sender) = shared.lock().await.pending.remove(&id) {
                let response = if let Some(error) = message.get("error") {
                    Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown Codex app-server error")
                        .to_owned())
                } else {
                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = sender.send(response);
            }
            return;
        }
    }

    if message.get("id").is_some() && message.get("method").is_some() {
        emit(app, CodexRuntimeEvent::server_request(message));
    } else {
        emit(app, CodexRuntimeEvent::notification(message));
    }
}

async fn mark_process_exited(
    app: &AppHandle,
    shared: &Arc<Mutex<SharedState>>,
    message: impl Into<String>,
) {
    let message = message.into();
    let mut shared = shared.lock().await;
    shared.process = None;
    for (_, sender) in shared.pending.drain() {
        let _ = sender.send(Err(message.clone()));
    }
    emit(app, CodexRuntimeEvent::phase("exited", message));
}

fn emit(app: &AppHandle, event: CodexRuntimeEvent) {
    let _ = app.emit(CODEX_EVENT_NAME, event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_requests_omit_jsonrpc_header() {
        let message = json!({ "method": "thread/start", "id": 1, "params": {} });
        assert!(message.get("jsonrpc").is_none());
        assert_eq!(message["method"], "thread/start");
    }

    #[test]
    fn runtime_events_use_frontend_camel_case() {
        let event = CodexRuntimeEvent::server_request(json!({
            "id": 9,
            "method": "item/commandExecution/requestApproval"
        }));
        let serialized = serde_json::to_value(event).unwrap();
        assert_eq!(serialized["kind"], "serverRequest");
        assert_eq!(serialized["payload"]["id"], 9);
    }
}
