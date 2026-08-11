use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
    time::timeout,
};
use uuid::Uuid;

const SHEETCTL_EVENT_NAME: &str = "sheetctl://request";
const DECISION_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetctlHostStatus {
    pub running: bool,
    pub endpoint: Option<String>,
    pub pending_request_count: usize,
}

/// Short-lived capability passed only to the Rust-owned Codex child process.
/// It is intentionally not serializable and never crosses the Tauri boundary.
#[derive(Clone)]
pub struct SheetctlCapability {
    pub endpoint: String,
    pub token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetctlIncomingRequest {
    pub id: String,
    pub command: String,
}

#[derive(Deserialize)]
struct WireRequest {
    token: String,
    command: String,
}

#[derive(Serialize)]
struct WireResponse<'a> {
    ok: bool,
    message: &'a str,
}

#[derive(Default)]
struct SheetctlState {
    endpoint: Option<String>,
    token: Option<String>,
    decisions: HashMap<String, oneshot::Sender<Result<String, String>>>,
}

#[derive(Debug, Error)]
pub enum SheetctlHostError {
    #[error("sheetctl request is no longer pending: {0}")]
    UnknownRequest(String),
    #[error("failed to bind sheetctl loopback listener: {0}")]
    Bind(#[source] std::io::Error),
}

pub struct SheetctlHost {
    state: Arc<Mutex<SheetctlState>>,
}

impl Default for SheetctlHost {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(SheetctlState::default())),
        }
    }
}

impl SheetctlHost {
    pub async fn start(&self, app: AppHandle) -> Result<SheetctlHostStatus, SheetctlHostError> {
        let mut state = self.state.lock().await;
        if state.endpoint.is_some() {
            return Ok(snapshot(&state));
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(SheetctlHostError::Bind)?;
        let endpoint = listener
            .local_addr()
            .expect("bound listener has an address")
            .to_string();
        state.endpoint = Some(endpoint);
        state.token = Some(Uuid::new_v4().to_string());
        drop(state);
        let shared = Arc::clone(&self.state);
        tauri::async_runtime::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let app = app.clone();
                let shared = Arc::clone(&shared);
                tauri::async_runtime::spawn(async move {
                    handle_connection(stream, app, shared).await;
                });
            }
        });
        Ok(self.status().await)
    }

    pub async fn status(&self) -> SheetctlHostStatus {
        let state = self.state.lock().await;
        snapshot(&state)
    }

    pub async fn capability(
        &self,
        app: AppHandle,
    ) -> Result<SheetctlCapability, SheetctlHostError> {
        self.start(app).await?;
        let state = self.state.lock().await;
        Ok(SheetctlCapability {
            endpoint: state
                .endpoint
                .clone()
                .expect("running sheetctl host has an endpoint"),
            token: state
                .token
                .clone()
                .expect("running sheetctl host has a capability token"),
        })
    }

    pub async fn respond(
        &self,
        id: String,
        approved: bool,
        message: Option<String>,
    ) -> Result<(), SheetctlHostError> {
        let sender = self
            .state
            .lock()
            .await
            .decisions
            .remove(&id)
            .ok_or(SheetctlHostError::UnknownRequest(id))?;
        let _ = sender.send(if approved {
            Ok(message.unwrap_or_else(|| "Applied after Office IDE review".to_owned()))
        } else {
            Err(message.unwrap_or_else(|| "Dismissed in Office IDE".to_owned()))
        });
        Ok(())
    }
}

fn snapshot(state: &SheetctlState) -> SheetctlHostStatus {
    SheetctlHostStatus {
        running: state.endpoint.is_some(),
        endpoint: state.endpoint.clone(),
        pending_request_count: state.decisions.len(),
    }
}

async fn handle_connection(stream: TcpStream, app: AppHandle, state: Arc<Mutex<SheetctlState>>) {
    let (reader, mut writer) = stream.into_split();
    let mut line = String::new();
    let mut reader = BufReader::new(reader);
    if reader
        .read_line(&mut line)
        .await
        .ok()
        .filter(|count| *count > 0)
        .is_none()
    {
        return;
    }
    let request: WireRequest = match serde_json::from_str(&line) {
        Ok(request) => request,
        Err(_) => {
            let _ = write_response(&mut writer, false, "Invalid sheetctl JSON").await;
            return;
        }
    };
    let expected = state.lock().await.token.clone();
    if expected.as_deref() != Some(request.token.as_str()) {
        let _ = write_response(&mut writer, false, "Unauthorized sheetctl request").await;
        return;
    }
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    state.lock().await.decisions.insert(id.clone(), sender);
    if app
        .emit(
            SHEETCTL_EVENT_NAME,
            SheetctlIncomingRequest {
                id: id.clone(),
                command: request.command,
            },
        )
        .is_err()
    {
        state.lock().await.decisions.remove(&id);
        let _ = write_response(&mut writer, false, "Office IDE cannot review this request").await;
        return;
    }
    let decision = timeout(DECISION_TIMEOUT, receiver).await;
    state.lock().await.decisions.remove(&id);
    match decision {
        Ok(Ok(Ok(message))) => {
            let _ = write_response(&mut writer, true, &message).await;
        }
        Ok(Ok(Err(message))) => {
            let _ = write_response(&mut writer, false, &message).await;
        }
        Ok(Err(_)) => {
            let _ = write_response(
                &mut writer,
                false,
                "Office IDE stopped reviewing this request",
            )
            .await;
        }
        Err(_) => {
            let _ = write_response(&mut writer, false, "Office IDE review timed out").await;
        }
    }
}

async fn write_response(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    ok: bool,
    message: &str,
) -> std::io::Result<()> {
    let body =
        serde_json::to_string(&WireResponse { ok, message }).expect("response is serializable");
    writer.write_all(format!("{body}\n").as_bytes()).await
}
