use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDocument {
    pub id: String,
    pub name: String,
    pub source: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWorkspace {
    pub title: String,
    pub source: String,
    pub documents: Vec<NativeDocument>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedWorkspace {
    pub root: String,
    pub workspace: NativeWorkspace,
}

#[derive(Deserialize, Serialize)]
struct RecoveryJournal {
    version: u8,
    saved_at: u64,
    workspace: NativeWorkspace,
}

pub fn save_with_picker(workspace: NativeWorkspace) -> Result<Option<String>, String> {
    let Some(parent) = FileDialog::new()
        .set_title("Choose folder for Office workspace")
        .pick_folder()
    else {
        return Ok(None);
    };
    let root = parent.join(format!("{}.office", safe_name(&workspace.title)));
    save_at(&root, &workspace)?;
    Ok(Some(root.to_string_lossy().into_owned()))
}
pub fn save_at(root: &Path, workspace: &NativeWorkspace) -> Result<(), String> {
    save(root, workspace)
}
pub fn open_with_picker() -> Result<Option<OpenedWorkspace>, String> {
    let Some(root) = FileDialog::new()
        .set_title("Open .office workspace folder")
        .pick_folder()
    else {
        return Ok(None);
    };
    load(&root).map(|workspace| {
        Some(OpenedWorkspace {
            root: root.to_string_lossy().into_owned(),
            workspace,
        })
    })
}
pub fn load_at(root: &Path) -> Result<NativeWorkspace, String> {
    load(root)
}
pub fn save_recovery(app: &AppHandle, workspace: NativeWorkspace) -> Result<(), String> {
    let path = recovery_path(app)?;
    save_recovery_at(&path, workspace)
}
pub fn load_recovery(app: &AppHandle) -> Result<Option<NativeWorkspace>, String> {
    load_recovery_at(&recovery_path(app)?)
}
pub fn clear_recovery(app: &AppHandle) -> Result<(), String> {
    clear_recovery_at(&recovery_path(app)?)
}
fn save_recovery_at(path: &Path, workspace: NativeWorkspace) -> Result<(), String> {
    let journal = RecoveryJournal {
        version: 1,
        saved_at: now_millis(),
        workspace,
    };
    let serialized = serde_json::to_vec(&journal).map_err(|error| error.to_string())?;
    fs::create_dir_all(path.parent().expect("recovery path has parent"))
        .map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}
fn load_recovery_at(path: &Path) -> Result<Option<NativeWorkspace>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let source = fs::read(path).map_err(|error| error.to_string())?;
    let journal: RecoveryJournal = serde_json::from_slice(&source)
        .map_err(|error| format!("Invalid recovery journal: {error}"))?;
    if journal.version != 1 {
        return Err("Unsupported recovery journal version".to_owned());
    }
    Ok(Some(journal.workspace))
}
fn clear_recovery_at(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
fn recovery_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|root| root.join(".officeide").join("recovery").join("latest.json"))
}
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn save(root: &Path, workspace: &NativeWorkspace) -> Result<(), String> {
    fs::create_dir_all(root.join("sheets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("docs")).map_err(|e| e.to_string())?;
    fs::write(root.join("sheets/sales.kdl"), &workspace.source).map_err(|e| e.to_string())?;
    let mut resources =
        vec!["resource \"sales\" type=\"spreadsheet\" path=\"./sheets/sales.kdl\"".to_owned()];
    for document in &workspace.documents {
        let name = safe_name(&document.name);
        let path = format!("docs/{name}/document.dj");
        fs::create_dir_all(root.join("docs").join(&name)).map_err(|e| e.to_string())?;
        fs::write(root.join(&path), &document.source).map_err(|e| e.to_string())?;
        resources.push(format!(
            "resource \"{}\" type=\"document\" path=\"./{}\"",
            document.id, path
        ));
    }
    fs::write(
        root.join("project.kdl"),
        format!(
            "office-project version=\"1\"\n\nmetadata {{ title \"{}\" }}\n\n{}\n",
            workspace.title.replace('"', "'"),
            resources.join("\n")
        ),
    )
    .map_err(|e| e.to_string())
}
fn load(root: &Path) -> Result<NativeWorkspace, String> {
    let source = fs::read_to_string(root.join("sheets/sales.kdl"))
        .map_err(|e| format!("Missing sheets/sales.kdl: {e}"))?;
    let mut documents = vec![];
    let docs = root.join("docs");
    if docs.exists() {
        for entry in fs::read_dir(&docs).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().join("document.dj");
            if path.exists() {
                let name = entry.file_name().to_string_lossy().into_owned();
                documents.push(NativeDocument {
                    id: name.clone(),
                    name,
                    source: fs::read_to_string(path).map_err(|e| e.to_string())?,
                });
            }
        }
    }
    Ok(NativeWorkspace {
        title: root
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        source,
        documents,
    })
}
fn safe_name(value: &str) -> String {
    let output: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if output.is_empty() {
        "untitled".to_owned()
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_project_sources_and_loads_them_again() {
        let root =
            std::env::temp_dir().join(format!("office-ide-workspace-{}", uuid::Uuid::new_v4()));
        let workspace = NativeWorkspace {
            title: "Sales Report".to_owned(),
            source: "spreadsheet version=\"1\" {}".to_owned(),
            documents: vec![NativeDocument {
                id: "report".to_owned(),
                name: "report".to_owned(),
                source: "# Report".to_owned(),
            }],
        };
        save(&root, &workspace).unwrap();
        assert!(root.join("project.kdl").exists());
        assert!(root.join("sheets/sales.kdl").exists());
        assert!(root.join("docs/report/document.dj").exists());
        let restored = load(&root).unwrap();
        assert_eq!(restored.source, workspace.source);
        assert_eq!(restored.documents[0].source, "# Report");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recovery_journal_round_trips_and_can_be_discarded() {
        let root =
            std::env::temp_dir().join(format!("office-ide-recovery-{}", uuid::Uuid::new_v4()));
        let path = root.join(".officeide/recovery/latest.json");
        let workspace = NativeWorkspace {
            title: "Recovery".to_owned(),
            source: "sheet {}".to_owned(),
            documents: vec![NativeDocument {
                id: "notes".to_owned(),
                name: "notes".to_owned(),
                source: "# Notes".to_owned(),
            }],
        };
        save_recovery_at(&path, workspace.clone()).unwrap();
        let restored = load_recovery_at(&path).unwrap().unwrap();
        assert_eq!(restored.title, workspace.title);
        assert_eq!(restored.documents[0].source, "# Notes");
        clear_recovery_at(&path).unwrap();
        assert!(load_recovery_at(&path).unwrap().is_none());
        let _ = fs::remove_dir_all(root);
    }
}
