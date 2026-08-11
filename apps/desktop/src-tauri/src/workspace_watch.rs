use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_EXTERNAL_CHANGE_EVENT: &str = "workspace://external-change";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceExternalChange {
    root: String,
    path: String,
}

#[derive(Default)]
pub struct WorkspaceWatchHost {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl WorkspaceWatchHost {
    pub fn start(&self, app: AppHandle, raw_root: String) -> Result<(), String> {
        let root = PathBuf::from(raw_root)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !root.is_dir() {
            return Err("Workspace watcher root is not a directory.".to_owned());
        }
        let event_root = root.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                let Ok(event) = result else {
                    return;
                };
                if !matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    return;
                }
                for path in event.paths {
                    if is_workspace_source(&path) {
                        let _ = app.emit(
                            WORKSPACE_EXTERNAL_CHANGE_EVENT,
                            WorkspaceExternalChange {
                                root: event_root.to_string_lossy().into_owned(),
                                path: path.to_string_lossy().into_owned(),
                            },
                        );
                        break;
                    }
                }
            },
            Config::default(),
        )
        .map_err(|error| error.to_string())?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
        *self
            .watcher
            .lock()
            .map_err(|_| "Workspace watcher lock poisoned".to_owned())? = Some(watcher);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        *self
            .watcher
            .lock()
            .map_err(|_| "Workspace watcher lock poisoned".to_owned())? = None;
        Ok(())
    }
}

fn is_workspace_source(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("sales.kdl") | Some("document.dj") | Some("project.kdl")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn watches_only_workspace_source_files() {
        assert!(is_workspace_source(Path::new("sheets/sales.kdl")));
        assert!(is_workspace_source(Path::new("docs/report/document.dj")));
        assert!(is_workspace_source(Path::new("project.kdl")));
        assert!(!is_workspace_source(Path::new("assets/logo.png")));
    }
}
