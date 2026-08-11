use crate::{docctl_host::DocctlCapability, sheetctl_host::SheetctlCapability};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
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
const OFFICE_IDE_SKILL_NAME: &str = "office-ide-agent";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeEvent {
    pub kind: &'static str,
    pub phase: Option<&'static str>,
    pub message: Option<String>,
    pub payload: Option<Value>,
}

/// A deliberately small process snapshot for WebView reload and reconnect logic.
///
/// The host never exposes child PIDs, environment variables, account details, or
/// credentials. The frontend only needs to know whether it can reuse the owned
/// process and whether requests are still awaiting a response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHostStatus {
    pub running: bool,
    pub pending_response_count: usize,
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
    #[error("Codex is installed but not signed in; run `codex` and sign in with ChatGPT")]
    NotAuthenticated,
    #[error("failed to start `codex app-server`: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("CODEX_APP_SERVER_PREFIX_ARGS must be a JSON array of strings: {0}")]
    InvalidLauncherArguments(#[source] serde_json::Error),
    #[error("failed to write to Codex app-server: {0}")]
    Write(#[source] std::io::Error),
    #[error("Codex app-server request {0} timed out")]
    Timeout(u64),
    #[error("Codex app-server closed request {0} without a response")]
    ResponseClosed(u64),
    #[error("Codex app-server rejected the request: {0}")]
    Server(String),
    #[error("Office IDE skill is unavailable for this workspace: {0}")]
    SkillUnavailable(String),
    #[error(
        "Office IDE control CLIs are unavailable; run `bun run tauri` from the workspace first"
    )]
    ControlCliUnavailable,
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

fn parse_launcher_prefix(value: Option<&str>) -> Result<Vec<String>, CodexHostError> {
    value
        .map(serde_json::from_str::<Vec<String>>)
        .transpose()
        .map_err(CodexHostError::InvalidLauncherArguments)
        .map(|arguments| arguments.unwrap_or_default())
}

fn default_launcher() -> (String, Vec<String>) {
    // The Windows Store desktop app does not expose its bundled Codex binary
    // as an executable child process. On Windows use Bun's official package
    // runner by default; it is cached after the first launch. An explicit
    // CODEX_APP_SERVER_BIN always takes precedence for managed installations.
    #[cfg(target_os = "windows")]
    {
        (
            "bunx".to_owned(),
            vec!["--yes".to_owned(), "@openai/codex@0.147.0".to_owned()],
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("codex".to_owned(), Vec::new())
    }
}

impl CodexHost {
    pub async fn start(
        &self,
        app: AppHandle,
        sheetctl: SheetctlCapability,
        docctl: DocctlCapability,
    ) -> Result<Value, CodexHostError> {
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

        let (default_executable, default_prefix) = default_launcher();
        let executable = env::var("CODEX_APP_SERVER_BIN").unwrap_or(default_executable);
        let prefix_arguments = match env::var("CODEX_APP_SERVER_PREFIX_ARGS") {
            Ok(value) => parse_launcher_prefix(Some(&value))?,
            Err(_) => default_prefix,
        };
        let control_cli_dir = control_cli_dir()?;
        let child_path = prepend_path(control_cli_dir, env::var_os("PATH"));
        let mut command = Command::new(executable);
        command
            .args(prefix_arguments)
            .arg("app-server")
            // Only the app-server child inherits the ephemeral loopback
            // capability. The WebView, events, history, and workspace files
            // never receive either value.
            .env("SHEETCTL_ENDPOINT", sheetctl.endpoint)
            .env("SHEETCTL_TOKEN", sheetctl.token)
            .env("DOCCTL_ENDPOINT", docctl.endpoint)
            .env("DOCCTL_TOKEN", docctl.token)
            .env("PATH", child_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(CodexHostError::Spawn)?;

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

        // Authentication is queried through the official app-server surface. We
        // intentionally inspect only presence/absence and never forward the account
        // object (which may contain an email address) into the WebView.
        let account = self
            .request("account/read", json!({ "refreshToken": false }))
            .await;
        let account = match account {
            Ok(value) => value,
            Err(error) => {
                emit(&app, CodexRuntimeEvent::phase("error", error.to_string()));
                self.shutdown().await;
                return Err(error);
            }
        };
        if !account_is_authenticated(&account) {
            let error = CodexHostError::NotAuthenticated;
            emit(&app, CodexRuntimeEvent::phase("error", error.to_string()));
            self.shutdown().await;
            return Err(error);
        }

        emit(
            &app,
            CodexRuntimeEvent::phase("ready", "Codex app-server ready"),
        );
        Ok(initialize)
    }

    pub async fn start_thread(
        &self,
        cwd: String,
        model: Option<String>,
    ) -> Result<Value, CodexHostError> {
        let skill_path = office_ide_skill_path(&cwd)?;
        self.register_skill_root(&skill_path).await?;
        self.request(
            "thread/start",
            json!({
                "cwd": cwd,
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "model": model,
                "serviceName": "office_ide",
                "developerInstructions": "Use the attached $office-ide-agent skill for Office IDE spreadsheet and document work. Inspect spreadsheets with sheetctl and Djot documents with docctl before proposing edits; every mutation remains review-first."
            }),
        )
        .await
    }

    pub async fn resume_thread(&self, thread_id: String) -> Result<Value, CodexHostError> {
        self.request(
            "thread/resume",
            json!({
                "threadId": thread_id
            }),
        )
        .await
    }

    pub async fn list_threads(&self, cwd: String) -> Result<Value, CodexHostError> {
        self.request("thread/list", json!({ "limit": 20, "cwd": cwd }))
            .await
    }

    pub async fn list_models(&self) -> Result<Value, CodexHostError> {
        self.request("model/list", json!({ "includeHidden": false }))
            .await
    }

    pub async fn start_turn(
        &self,
        thread_id: String,
        prompt: String,
        cwd: String,
        model: Option<String>,
        effort: Option<String>,
    ) -> Result<Value, CodexHostError> {
        let skill_path = office_ide_skill_path(&cwd)?;
        self.register_skill_root(&skill_path).await?;
        self.request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [
                    { "type": "skill", "name": OFFICE_IDE_SKILL_NAME, "path": skill_path },
                    { "type": "text", "text": prompt }
                ],
                "cwd": cwd,
                "model": model,
                "effort": effort,
                "approvalPolicy": "on-request",
                "sandboxPolicy": {
                    "type": "workspaceWrite",
                    "writableRoots": [cwd],
                    "networkAccess": false,
                    "excludeTmpdirEnvVar": false,
                    "excludeSlashTmp": false
                }
            }),
        )
        .await
    }

    async fn register_skill_root(&self, skill_path: &Path) -> Result<(), CodexHostError> {
        let root = skill_path
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| CodexHostError::SkillUnavailable(skill_path.display().to_string()))?;
        self.request(
            "skills/extraRoots/set",
            json!({
                "extraRoots": [root]
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn interrupt_turn(
        &self,
        thread_id: String,
        turn_id: String,
    ) -> Result<(), CodexHostError> {
        self.request(
            "turn/interrupt",
            json!({
                "threadId": thread_id,
                "turnId": turn_id
            }),
        )
        .await?;
        Ok(())
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

    pub async fn stop(&self, app: &AppHandle) {
        self.shutdown().await;
        emit(
            app,
            CodexRuntimeEvent::phase("disconnected", "Codex app-server stopped"),
        );
    }

    pub async fn status(&self) -> CodexHostStatus {
        let shared = self.shared.lock().await;
        CodexHostStatus {
            running: shared.process.is_some(),
            pending_response_count: shared.pending.len(),
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

fn control_cli_dir() -> Result<PathBuf, CodexHostError> {
    let suffix = env::consts::EXE_SUFFIX;
    let is_valid = |directory: &Path| {
        directory.join(format!("sheetctl{suffix}")).is_file()
            && directory.join(format!("docctl{suffix}")).is_file()
    };
    if let Some(directory) = env::var_os("OFFICE_IDE_CONTROL_CLI_DIR").map(PathBuf::from) {
        if is_valid(&directory) {
            return Ok(directory);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(current) = env::current_exe() {
        if let Some(directory) = current.parent() {
            candidates.push(directory.to_path_buf());
        }
    }
    if let Ok(current) = env::current_dir() {
        for root in current.ancestors() {
            candidates.push(root.join("target").join("debug"));
            candidates.push(root.join("target").join("release"));
        }
    }
    candidates
        .into_iter()
        .find(|directory| is_valid(directory))
        .ok_or(CodexHostError::ControlCliUnavailable)
}

fn prepend_path(directory: PathBuf, inherited: Option<std::ffi::OsString>) -> std::ffi::OsString {
    let mut paths = vec![directory];
    if let Some(inherited) = inherited {
        paths.extend(env::split_paths(&inherited));
    }
    env::join_paths(paths).expect("valid executable search path")
}

fn office_ide_skill_path(cwd: &str) -> Result<PathBuf, CodexHostError> {
    let candidate = Path::new(cwd)
        .ancestors()
        .map(|root| {
            root.join("skills")
                .join(OFFICE_IDE_SKILL_NAME)
                .join("SKILL.md")
        })
        .find(|path| path.is_file());
    candidate.ok_or_else(|| CodexHostError::SkillUnavailable(cwd.to_owned()))
}

#[derive(Debug)]
enum IncomingMessage {
    Response {
        id: u64,
        response: Result<Value, String>,
    },
    ServerRequest(Value),
    Notification(Value),
}

fn classify_message(message: Value) -> IncomingMessage {
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        // Client responses have an id but no method. A method plus id is a
        // server-initiated request and must be rendered by the frontend.
        if message.get("method").is_none() {
            let response = if let Some(error) = message.get("error") {
                Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown Codex app-server error")
                    .to_owned())
            } else {
                Ok(message.get("result").cloned().unwrap_or(Value::Null))
            };
            return IncomingMessage::Response { id, response };
        }
    }

    if message.get("id").is_some() && message.get("method").is_some() {
        IncomingMessage::ServerRequest(message)
    } else {
        IncomingMessage::Notification(message)
    }
}

fn account_is_authenticated(account: &Value) -> bool {
    let requires_openai_auth = account
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_account = account.get("account").is_some_and(|value| !value.is_null());
    !requires_openai_auth || has_account
}

async fn route_message(app: &AppHandle, shared: &Arc<Mutex<SharedState>>, message: Value) {
    match classify_message(message) {
        IncomingMessage::Response { id, response } => {
            if let Some(sender) = shared.lock().await.pending.remove(&id) {
                let _ = sender.send(response);
            }
        }
        IncomingMessage::ServerRequest(message) => {
            emit(app, CodexRuntimeEvent::server_request(message));
        }
        IncomingMessage::Notification(message) => {
            emit(app, CodexRuntimeEvent::notification(message));
        }
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
    fn parses_optional_development_launcher_arguments_without_shell_splitting() {
        assert_eq!(parse_launcher_prefix(None).unwrap(), Vec::<String>::new());
        assert_eq!(
            parse_launcher_prefix(Some(r#"["--yes","@openai/codex"]"#)).unwrap(),
            vec!["--yes", "@openai/codex"],
        );
        assert!(matches!(
            parse_launcher_prefix(Some("--yes @openai/codex")),
            Err(CodexHostError::InvalidLauncherArguments(_))
        ));
    }

    #[test]
    fn has_a_usable_windows_default_launcher_and_allows_environment_override() {
        let (executable, prefix) = default_launcher();
        #[cfg(target_os = "windows")]
        assert_eq!(
            (executable, prefix),
            (
                "bunx".to_owned(),
                vec!["--yes".to_owned(), "@openai/codex@0.147.0".to_owned()]
            )
        );
        #[cfg(not(target_os = "windows"))]
        assert_eq!((executable, prefix), ("codex".to_owned(), Vec::new()));
    }

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

    #[test]
    fn routes_results_errors_requests_and_notifications_without_guessing() {
        match classify_message(json!({ "id": 1, "result": { "ok": true } })) {
            IncomingMessage::Response { id, response } => {
                assert_eq!(id, 1);
                assert_eq!(response.unwrap()["ok"], true);
            }
            route => panic!("unexpected route: {route:?}"),
        }

        match classify_message(json!({
            "id": 2,
            "error": { "code": -32000, "message": "Not logged in" }
        })) {
            IncomingMessage::Response { id, response } => {
                assert_eq!(id, 2);
                assert_eq!(response.unwrap_err(), "Not logged in");
            }
            route => panic!("unexpected route: {route:?}"),
        }

        assert!(matches!(
            classify_message(json!({
                "id": "approval_1",
                "method": "item/commandExecution/requestApproval",
                "params": {}
            })),
            IncomingMessage::ServerRequest(_)
        ));
        assert!(matches!(
            classify_message(json!({ "method": "turn/completed", "params": {} })),
            IncomingMessage::Notification(_)
        ));
    }

    #[test]
    fn requires_an_account_only_when_openai_auth_is_required() {
        assert!(account_is_authenticated(&json!({
            "account": { "type": "chatgpt" },
            "requiresOpenaiAuth": true
        })));
        assert!(!account_is_authenticated(&json!({
            "account": null,
            "requiresOpenaiAuth": true
        })));
        assert!(account_is_authenticated(&json!({
            "account": null,
            "requiresOpenaiAuth": false
        })));
    }

    #[test]
    fn resolves_relative_workspace_paths_to_absolute_paths() {
        let path = crate::absolute_workspace_path(".".to_owned()).unwrap();
        assert!(Path::new(&path).is_absolute());
        assert!(Path::new(&path).is_dir());
    }
}
