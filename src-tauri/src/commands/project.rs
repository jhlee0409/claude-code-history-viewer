use crate::models::*;
use crate::utils::{extract_project_name, estimate_message_count_from_size};
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::{DateTime, Utc};

#[tauri::command]
pub async fn get_claude_folder_path() -> Result<String, String> {
    let home_dir = dirs::home_dir().ok_or("HOME_DIRECTORY_NOT_FOUND:Could not determine home directory")?;
    let claude_path = home_dir.join(".claude");

    if !claude_path.exists() {
        return Err(format!(
            "CLAUDE_FOLDER_NOT_FOUND:Claude folder not found at {}",
            claude_path.display()
        ));
    }

    if fs::read_dir(&claude_path).is_err() {
        return Err("PERMISSION_DENIED:Cannot access Claude folder. Please check permissions.".to_string());
    }

    Ok(claude_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn validate_claude_folder(path: String) -> Result<bool, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Ok(false);
    }

    if path_buf.file_name().and_then(|n| n.to_str()) == Some(".claude") {
        let projects_path = path_buf.join("projects");
        return Ok(projects_path.exists() && projects_path.is_dir());
    }

    let claude_path = path_buf.join(".claude");
    if claude_path.exists() && claude_path.is_dir() {
        let projects_path = claude_path.join("projects");
        return Ok(projects_path.exists() && projects_path.is_dir());
    }

    Ok(false)
}

#[tauri::command]
pub async fn scan_projects(claude_path: String) -> Result<Vec<ClaudeProject>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();
    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    for entry in WalkDir::new(&projects_path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let raw_project_name = entry.file_name().to_string_lossy().to_string();
        let project_path = entry.path().to_string_lossy().to_string();
        let project_name = extract_project_name(&raw_project_name);

        let mut session_count = 0;
        let mut message_count = 0;
        let mut last_modified = None;

        for jsonl_entry in WalkDir::new(entry.path())
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            session_count += 1;

            if let Ok(metadata) = jsonl_entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if last_modified.is_none() || modified > last_modified.unwrap() {
                        last_modified = Some(modified);
                    }
                }
                
                // 파일 크기로 메시지 수 추정 - 훨씬 빠름
                let estimated_messages = estimate_message_count_from_size(metadata.len());
                message_count += estimated_messages;
            }
        }

        let last_modified_str = last_modified
            .map(|lm| {
                let dt: DateTime<Utc> = lm.into();
                dt.to_rfc3339()
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        projects.push(ClaudeProject {
            name: project_name,
            path: project_path,
            session_count,
            message_count,
            last_modified: last_modified_str,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        println!("📊 scan_projects 성능: {}개 프로젝트, {}ms 소요",
                 projects.len(), elapsed.as_millis());
    }

    Ok(projects)
}
