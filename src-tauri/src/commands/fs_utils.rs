use std::fs;
use std::path::Path;

/// Write `content` to a freshly created temp file at `temp_path`, for an
/// atomic write followed by [`atomic_rename`].
///
/// Any leftover entry at that name, including a link to somewhere else, is
/// removed first and the file is opened with `create_new`, so the write never
/// goes through a link.
pub fn write_fresh_temp_file(temp_path: &Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let _ = fs::remove_file(temp_path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp_path)
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(content)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file: {e}"))
}

/// Cross-platform atomic rename.
///
/// On Unix, `fs::rename` atomically replaces the target.
/// On Windows, `fs::rename` fails if the target already exists,
/// so we remove the target first.
pub fn atomic_rename(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if to.exists() {
            fs::remove_file(to)
                .map_err(|e| format!("Failed to remove existing file {}: {e}", to.display()))?;
        }
    }

    fs::rename(from, to).map_err(|e| {
        // Clean up temp file on failure
        let _ = fs::remove_file(from);
        format!(
            "Failed to rename {} to {}: {e}",
            from.display(),
            to.display()
        )
    })
}
