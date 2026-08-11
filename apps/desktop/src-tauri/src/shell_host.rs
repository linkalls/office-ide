use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

pub const SHELL_EVENT_NAME: &str = "shell://output";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHostStatus {
    pub running: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutputEvent {
    pub stream: &'static str,
    pub text: String,
}

#[derive(Default)]
struct ShellState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

pub struct ShellHost {
    state: Arc<Mutex<ShellState>>,
}

#[derive(Debug, Error)]
pub enum ShellHostError {
    #[error("shell is not running")]
    NotRunning,
    #[error("shell is already running")]
    AlreadyRunning,
    #[error("failed to start shell: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("failed to write to shell: {0}")]
    Write(#[source] std::io::Error),
}

impl Default for ShellHost {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(ShellState::default())),
        }
    }
}

impl ShellHost {
    pub async fn start(
        &self,
        app: AppHandle,
        cwd: String,
    ) -> Result<ShellHostStatus, ShellHostError> {
        let mut state = self.state.lock().await;
        if state.child.is_some() {
            return Err(ShellHostError::AlreadyRunning);
        }
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("powershell.exe");
            command.args(["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"]);
            command
        };
        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-i"]);
            command
        };
        command
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().map_err(ShellHostError::Spawn)?;
        let stdin = child.stdin.take().expect("piped shell stdin");
        if let Some(stdout) = child.stdout.take() {
            spawn_reader(app.clone(), stdout, "stdout");
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_reader(app, stderr, "stderr");
        }
        state.stdin = Some(stdin);
        state.child = Some(child);
        Ok(snapshot(&state))
    }

    pub async fn write(&self, input: String) -> Result<(), ShellHostError> {
        let mut state = self.state.lock().await;
        let stdin = state.stdin.as_mut().ok_or(ShellHostError::NotRunning)?;
        stdin
            .write_all(input.as_bytes())
            .await
            .map_err(ShellHostError::Write)?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(ShellHostError::Write)?;
        stdin.flush().await.map_err(ShellHostError::Write)
    }

    pub async fn stop(&self) {
        let mut state = self.state.lock().await;
        state.stdin.take();
        if let Some(mut child) = state.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    pub async fn status(&self) -> ShellHostStatus {
        let state = self.state.lock().await;
        snapshot(&state)
    }
}

fn snapshot(state: &ShellState) -> ShellHostStatus {
    ShellHostStatus {
        running: state.child.is_some(),
    }
}

fn spawn_reader<R>(app: AppHandle, reader: R, stream: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(SHELL_EVENT_NAME, ShellOutputEvent { stream, text: line });
        }
    });
}
