mod codex_host;
mod docctl_host;
mod docx_host;
mod git_host;
mod sheetctl_host;
mod shell_host;
mod workspace_host;
mod workspace_watch;
mod xlsx_host;

use codex_host::{CodexHost, CodexHostStatus};
use docctl_host::{DocctlHost, DocctlHostStatus};
use docx_host::{export_docx, import_docx, pick_docx_for_export, pick_docx_for_import};
use git_host::GitWorkspaceStatus;
use office_core::WorkspaceInfo;
use office_ipc::OpenWorkspaceRequest;
use serde_json::Value;
use sheetctl_host::{SheetctlHost, SheetctlHostStatus};
use shell_host::{ShellHost, ShellHostStatus};
use std::path::Path;
use tauri::{AppHandle, State};
use tokio::process::Command;
use workspace_watch::WorkspaceWatchHost;
use xlsx_host::{
    export_xlsx, import_xlsx, pick_xlsx_for_export, pick_xlsx_for_import, SpreadsheetWorkbookInput,
    XlsxCompatibilityReport, XlsxImportResult,
};

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
fn xlsx_import() -> Result<Option<XlsxImportResult>, String> {
    let Some(path) = pick_xlsx_for_import() else {
        return Ok(None);
    };
    import_xlsx(&path).map(Some)
}

#[tauri::command]
fn xlsx_import_path(path: String) -> Result<XlsxImportResult, String> {
    let path = import_path(&path, "xlsx")?;
    import_xlsx(path)
}

#[tauri::command]
fn xlsx_export(
    workbook: SpreadsheetWorkbookInput,
) -> Result<Option<XlsxCompatibilityReport>, String> {
    let Some(path) = pick_xlsx_for_export(&workbook.name) else {
        return Ok(None);
    };
    export_xlsx(&path, workbook).map(Some)
}

#[tauri::command]
fn docx_import() -> Result<Option<String>, String> {
    let Some(path) = pick_docx_for_import() else {
        return Ok(None);
    };
    import_docx(&path).map(Some)
}

#[tauri::command]
fn docx_import_path(path: String) -> Result<String, String> {
    let path = import_path(&path, "docx")?;
    import_docx(path)
}

#[tauri::command]
fn docx_export(source: String) -> Result<bool, String> {
    let Some(path) = pick_docx_for_export() else {
        return Ok(false);
    };
    export_docx(&path, &source)?;
    Ok(true)
}
#[tauri::command]
fn workspace_save(workspace: workspace_host::NativeWorkspace) -> Result<Option<String>, String> {
    workspace_host::save_with_picker(workspace)
}

#[tauri::command]
fn workspace_save_at(
    root: String,
    workspace: workspace_host::NativeWorkspace,
) -> Result<(), String> {
    workspace_host::save_at(Path::new(&root), &workspace)
}
#[tauri::command]
fn workspace_open() -> Result<Option<workspace_host::OpenedWorkspace>, String> {
    workspace_host::open_with_picker()
}
#[tauri::command]
fn workspace_load_at(root: String) -> Result<workspace_host::NativeWorkspace, String> {
    workspace_host::load_at(Path::new(&root))
}
#[tauri::command]
fn workspace_watch_start(
    app: AppHandle,
    host: State<'_, WorkspaceWatchHost>,
    root: String,
) -> Result<(), String> {
    host.start(app, root)
}
#[tauri::command]
fn workspace_watch_stop(host: State<'_, WorkspaceWatchHost>) -> Result<(), String> {
    host.stop()
}
#[tauri::command]
fn workspace_recovery_save(
    app: AppHandle,
    workspace: workspace_host::NativeWorkspace,
) -> Result<(), String> {
    workspace_host::save_recovery(&app, workspace)
}
#[tauri::command]
fn workspace_recovery_load(
    app: AppHandle,
) -> Result<Option<workspace_host::NativeWorkspace>, String> {
    workspace_host::load_recovery(&app)
}
#[tauri::command]
fn workspace_recovery_clear(app: AppHandle) -> Result<(), String> {
    workspace_host::clear_recovery(&app)
}

#[tauri::command]
async fn git_status(cwd: String) -> Result<GitWorkspaceStatus, String> {
    git_host::status(Path::new(&absolute_workspace_path(cwd)?)).await
}

#[tauri::command]
async fn git_diff(cwd: String, path: String) -> Result<String, String> {
    git_host::diff(Path::new(&absolute_workspace_path(cwd)?), path).await
}

#[tauri::command]
async fn git_stage(cwd: String, path: String) -> Result<(), String> {
    git_host::stage(Path::new(&absolute_workspace_path(cwd)?), path).await
}

#[tauri::command]
async fn git_unstage(cwd: String, path: String) -> Result<(), String> {
    git_host::unstage(Path::new(&absolute_workspace_path(cwd)?), path).await
}

#[tauri::command]
async fn git_commit(cwd: String, message: String) -> Result<(), String> {
    git_host::commit(Path::new(&absolute_workspace_path(cwd)?), message).await
}

#[tauri::command]
async fn shell_run(command: String, cwd: String) -> Result<Value, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Enter a shell command first.".to_string());
    }
    let workspace = absolute_workspace_path(cwd)?;
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            trimmed,
        ]);
        command
    };
    #[cfg(not(target_os = "windows"))]
    let mut process = {
        let mut command = Command::new("sh");
        command.args(["-lc", trimmed]);
        command
    };
    let output = process
        .current_dir(workspace)
        .output()
        .await
        .map_err(|error| format!("Could not start shell: {error}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    const MAX_OUTPUT_BYTES: usize = 128 * 1024;
    if text.len() > MAX_OUTPUT_BYTES {
        text.truncate(MAX_OUTPUT_BYTES);
        text.push_str("\n[output truncated]");
    }
    Ok(serde_json::json!({
        "exitCode": output.status.code(),
        "output": text,
    }))
}

#[tauri::command]
async fn shell_start(
    app: AppHandle,
    host: State<'_, ShellHost>,
    cwd: String,
) -> Result<ShellHostStatus, String> {
    host.start(app, absolute_workspace_path(cwd)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn shell_write(host: State<'_, ShellHost>, input: String) -> Result<(), String> {
    host.write(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn shell_stop(host: State<'_, ShellHost>) -> Result<(), String> {
    host.stop().await;
    Ok(())
}

#[tauri::command]
async fn shell_status(host: State<'_, ShellHost>) -> Result<ShellHostStatus, String> {
    Ok(host.status().await)
}

fn absolute_workspace_path(cwd: String) -> Result<String, String> {
    let requested = Path::new(&cwd);
    let resolved = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(requested)
    };
    resolved
        .canonicalize()
        .or(Ok(resolved))
        .map(|path: std::path::PathBuf| path.to_string_lossy().into_owned())
        .map_err(|error: std::io::Error| error.to_string())
}

fn import_path<'a>(raw: &'a str, expected_extension: &str) -> Result<&'a Path, String> {
    let path = Path::new(raw);
    if !path.is_file() {
        return Err("Dropped item is not a readable file.".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case(expected_extension) {
        return Err(format!("Expected a .{expected_extension} file."));
    }
    Ok(path)
}

#[tauri::command]
async fn codex_start(
    app: AppHandle,
    host: State<'_, CodexHost>,
    sheetctl: State<'_, SheetctlHost>,
    docctl: State<'_, DocctlHost>,
) -> Result<Value, String> {
    let capability = sheetctl
        .capability(app.clone())
        .await
        .map_err(|error| error.to_string())?;
    let document_capability = docctl
        .capability(app.clone())
        .await
        .map_err(|error| error.to_string())?;
    host.start(app, capability, document_capability)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_start_thread(
    host: State<'_, CodexHost>,
    cwd: String,
    model: Option<String>,
) -> Result<Value, String> {
    host.start_thread(absolute_workspace_path(cwd)?, model)
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
async fn codex_list_threads(host: State<'_, CodexHost>, cwd: String) -> Result<Value, String> {
    host.list_threads(absolute_workspace_path(cwd)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_list_models(host: State<'_, CodexHost>) -> Result<Value, String> {
    host.list_models().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn codex_start_turn(
    host: State<'_, CodexHost>,
    thread_id: String,
    prompt: String,
    cwd: String,
    model: Option<String>,
    effort: Option<String>,
) -> Result<Value, String> {
    host.start_turn(
        thread_id,
        prompt,
        absolute_workspace_path(cwd)?,
        model,
        effort,
    )
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

#[tauri::command]
async fn sheetctl_start(
    app: AppHandle,
    host: State<'_, SheetctlHost>,
) -> Result<SheetctlHostStatus, String> {
    host.start(app).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn sheetctl_status(host: State<'_, SheetctlHost>) -> Result<SheetctlHostStatus, String> {
    Ok(host.status().await)
}

#[tauri::command]
async fn docctl_start(
    app: AppHandle,
    host: State<'_, DocctlHost>,
) -> Result<DocctlHostStatus, String> {
    host.start(app).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn docctl_respond(
    host: State<'_, DocctlHost>,
    id: String,
    approved: bool,
    message: Option<String>,
) -> Result<(), String> {
    host.respond(id, approved, message)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn sheetctl_respond(
    host: State<'_, SheetctlHost>,
    id: String,
    approved: bool,
    message: Option<String>,
) -> Result<(), String> {
    host.respond(id, approved, message)
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CodexHost::default())
        .manage(ShellHost::default())
        .manage(SheetctlHost::default())
        .manage(DocctlHost::default())
        .manage(WorkspaceWatchHost::default())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            platform_summary,
            xlsx_import,
            xlsx_import_path,
            xlsx_export,
            docx_import,
            docx_import_path,
            docx_export,
            workspace_save,
            workspace_save_at,
            workspace_open,
            workspace_load_at,
            workspace_watch_start,
            workspace_watch_stop,
            workspace_recovery_save,
            workspace_recovery_load,
            workspace_recovery_clear,
            git_status,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            shell_run,
            shell_start,
            shell_write,
            shell_stop,
            shell_status,
            codex_start,
            codex_start_thread,
            codex_resume_thread,
            codex_list_threads,
            codex_list_models,
            codex_start_turn,
            codex_interrupt_turn,
            codex_respond_to_server_request,
            codex_shutdown,
            codex_status,
            sheetctl_start,
            sheetctl_status,
            sheetctl_respond,
            docctl_start,
            docctl_respond,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Office IDE");
}
