use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace path does not exist: {0}")]
    Missing(PathBuf),
    #[error("workspace path is not a directory: {0}")]
    NotDirectory(PathBuf),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: Uuid,
    pub name: String,
    pub root_path: PathBuf,
}

impl WorkspaceInfo {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(WorkspaceError::Missing(path.to_path_buf()));
        }
        if !path.is_dir() {
            return Err(WorkspaceError::NotDirectory(path.to_path_buf()));
        }

        Ok(Self {
            id: Uuid::new_v4(),
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("workspace")
                .to_owned(),
            root_path: path.to_path_buf(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_missing_workspace() {
        let result = WorkspaceInfo::open("/definitely/missing/office-ide-workspace");
        assert!(matches!(result, Err(WorkspaceError::Missing(_))));
    }
}
