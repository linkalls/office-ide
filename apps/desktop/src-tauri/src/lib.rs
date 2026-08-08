use office_core::WorkspaceInfo;
use office_ipc::OpenWorkspaceRequest;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_workspace, platform_summary])
        .run(tauri::generate_context!())
        .expect("error while running Office IDE");
}
