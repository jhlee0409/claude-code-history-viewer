use std::fs;
use std::path::Path;

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
