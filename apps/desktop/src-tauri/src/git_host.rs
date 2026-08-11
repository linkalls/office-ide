use serde::Serialize;
use std::path::{Component, Path};
use tokio::process::Command;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub id: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceStatus {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
    pub commits: Vec<GitCommit>,
}

pub async fn status(cwd: &Path) -> Result<GitWorkspaceStatus, String> {
    if !matches!(run(cwd, ["rev-parse", "--is-inside-work-tree"]).await, Ok(value) if value.trim() == "true")
    {
        return Ok(GitWorkspaceStatus {
            is_repository: false,
            branch: None,
            files: vec![],
            commits: vec![],
        });
    }
    let branch = run(cwd, ["branch", "--show-current"])
        .await?
        .trim()
        .to_owned();
    let porcelain = run(cwd, ["status", "--porcelain=v1", "-uall"]).await?;
    let files = porcelain
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            Some(GitFileStatus {
                index_status: line[0..1].to_owned(),
                worktree_status: line[1..2].to_owned(),
                path: line[3..].to_owned(),
            })
        })
        .collect();
    let log = run(cwd, ["log", "-n", "12", "--format=%H%x1f%s%x1f%an%x1f%as"])
        .await
        .unwrap_or_default();
    let commits = log
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            Some(GitCommit {
                id: parts.next()?.to_owned(),
                subject: parts.next()?.to_owned(),
                author: parts.next()?.to_owned(),
                date: parts.next()?.to_owned(),
            })
        })
        .collect();
    Ok(GitWorkspaceStatus {
        is_repository: true,
        branch: (!branch.is_empty()).then_some(branch),
        files,
        commits,
    })
}

pub async fn diff(cwd: &Path, path: String) -> Result<String, String> {
    validate_path(&path)?;
    let staged = run(cwd, ["diff", "--cached", "--no-ext-diff", "--", &path]).await?;
    let unstaged = run(cwd, ["diff", "--no-ext-diff", "--", &path]).await?;
    Ok(match (staged.trim(), unstaged.trim()) {
        ("", "") => String::new(),
        ("", _) => unstaged,
        (_, "") => staged,
        _ => format!("# Staged changes\n{staged}\n# Unstaged changes\n{unstaged}"),
    })
}

pub async fn stage(cwd: &Path, path: String) -> Result<(), String> {
    validate_path(&path)?;
    run(cwd, ["add", "--", &path]).await.map(|_| ())
}

pub async fn unstage(cwd: &Path, path: String) -> Result<(), String> {
    validate_path(&path)?;
    run(cwd, ["restore", "--staged", "--", &path])
        .await
        .map(|_| ())
}

pub async fn commit(cwd: &Path, message: String) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Enter a commit message first.".to_owned());
    }
    run(cwd, ["commit", "-m", message]).await.map(|_| ())
}

fn validate_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Git paths must be relative files within the workspace.".to_owned());
    }
    Ok(())
}

async fn run<const N: usize>(cwd: &Path, args: [&str; N]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|error| format!("Could not start git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(cwd: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn stages_and_unstages_only_a_relative_workspace_file() {
        let path = std::env::temp_dir().join(format!("office-ide-git-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        git(&path, &["init"]);
        git(&path, &["config", "user.email", "test@example.com"]);
        git(&path, &["config", "user.name", "Office IDE test"]);
        std::fs::write(path.join("note.dj"), "before\n").unwrap();
        git(&path, &["add", "note.dj"]);
        git(&path, &["commit", "-m", "initial"]);
        std::fs::write(path.join("note.dj"), "after\n").unwrap();

        let before = tauri::async_runtime::block_on(status(&path)).unwrap();
        assert_eq!(before.files[0].index_status, " ");
        assert_eq!(before.files[0].worktree_status, "M");
        tauri::async_runtime::block_on(stage(&path, "note.dj".to_owned())).unwrap();
        let staged = tauri::async_runtime::block_on(status(&path)).unwrap();
        assert_eq!(staged.files[0].index_status, "M");
        assert_eq!(staged.files[0].worktree_status, " ");
        tauri::async_runtime::block_on(unstage(&path, "note.dj".to_owned())).unwrap();
        let unstaged = tauri::async_runtime::block_on(status(&path)).unwrap();
        assert_eq!(unstaged.files[0].index_status, " ");
        assert!(validate_path("../outside").is_err());
        let _ = std::fs::remove_dir_all(path);
    }
}
