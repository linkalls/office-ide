mod codex_host;

use codex_host::{CodexHost, CodexHostStatus};
use office_core::WorkspaceInfo;
use office_ipc::OpenWorkspaceRequest;
use serde_json::Value;
use tauri::{AppHandle, State};

#[tauri::command]
fn open_workspace(request: OpenWorkspaceRequest) -> Result<WorkspaceInfo, String> {
    office_ipc::open_workspace(request).map_err(|error| error.to_string())
}

#[tauri::command]
fn platform_summary() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
    })
}

#[tauri::command]
async fn codex_start(app: AppHandle, host: State<'_, CodexHost>) -> Result<Value, String> {
    host.start(app).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_start_thread(host: State<'_, CodexHost>, cwd: String) -> Result<Value, String> {
    host.start_thread(cwd)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_resume_thread(
    host: State<'_, CodexHost>,
    thread_id: String,
) -> Result<Value, String> {
    host.resume_thread(thread_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_start_turn(
    host: State<'_, CodexHost>,
    thread_id: String,
    prompt: String,
    cwd: String,
) -> Result<Value, String> {
    host.start_turn(thread_id, prompt, cwd)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_interrupt_turn(
    host: State<'_, CodexHost>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    host.interrupt_turn(thread_id, turn_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_respond_to_server_request(
    host: State<'_, CodexHost>,
    id: Value,
    result: Value,
) -> Result<(), String> {
    host.respond_to_server_request(id, result)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_shutdown(app: AppHandle, host: State<'_, CodexHost>) -> Result<(), String> {
    host.stop(&app).await;
    Ok(())
}

#[tauri::command]
async fn codex_status(host: State<'_, CodexHost>) -> Result<CodexHostStatus, String> {
    Ok(host.status().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CodexHost::default())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            platform_summary,
            codex_start,
            codex_start_thread,
            codex_resume_thread,
            codex_start_turn,
            codex_interrupt_turn,
            codex_respond_to_server_request,
            codex_shutdown,
            codex_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Office IDE");
}
