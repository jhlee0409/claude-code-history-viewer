use std::fs;
use std::path::Path;
use tauri::command;

/// Moves a session's JSONL file and its associated folder (subagents, tool-results) to the system trash.
///
/// For a session at `<dir>/<uuid>.jsonl`, also trashes `<dir>/<uuid>/` if it exists.
/// Validates that the target is an absolute, plain `.jsonl` file (not a symlink) with a
/// well-formed session ID before moving anything.
#[command]
pub async fn delete_session(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }

    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("Only .jsonl session files can be deleted".to_string());
    }

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid session filename".to_string())?;

    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid session ID format".to_string());
    }

    let metadata =
        fs::symlink_metadata(path).map_err(|_| format!("Session file not found: {file_path}"))?;

    if metadata.file_type().is_symlink() {
        return Err("Session file cannot be a symlink".to_string());
    }

    if !metadata.file_type().is_file() {
        return Err("Session target must be a regular .jsonl file".to_string());
    }

    // Trash the .jsonl first (authoritative artifact), then the associated folder
    trash::delete(path).map_err(|e| format!("Failed to move session file to trash: {e}"))?;

    // Best-effort trash of associated folder — don't fail if it can't be trashed
    // since the primary .jsonl file is already gone
    let associated_dir = path.with_extension("");
    if let Ok(dir_meta) = fs::symlink_metadata(&associated_dir) {
        if !dir_meta.file_type().is_symlink() && dir_meta.is_dir() {
            let _ = trash::delete(&associated_dir);
        }
    }

    Ok(())
}
