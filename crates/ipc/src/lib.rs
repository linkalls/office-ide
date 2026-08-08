use office_core::{WorkspaceError, WorkspaceInfo};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorkspaceRequest {
    pub path: String,
}

pub fn open_workspace(request: OpenWorkspaceRequest) -> Result<WorkspaceInfo, WorkspaceError> {
    WorkspaceInfo::open(request.path)
}
