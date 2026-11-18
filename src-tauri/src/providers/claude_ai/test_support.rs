//! Synthetic claude.ai exports for tests, built from the committed fixture
//! (`tests/fixtures/claude-ai-export`, see its README for provenance).

use crate::models::{ClaudeAiExport, UserMetadata};
use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/claude-ai-export")
}

pub(crate) fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture_dir().join(name)).expect("claude.ai export fixture")
}

/// Write a zip holding `entries` (name, bytes), deflate-compressed as
/// claude.ai's exports are.
pub(crate) fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = std::fs::File::create(path).expect("create zip");
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        zip.start_file(*name, options).expect("zip entry");
        zip.write_all(bytes).expect("zip write");
    }
    zip.finish().expect("finish zip");
}

/// The fixture export as the zip claude.ai sends, entries at the top level.
pub(crate) fn write_export_zip(path: &Path) {
    let conversations = fixture("conversations.json");
    let projects = fixture("projects.json");
    let users = fixture("users.json");
    write_zip(
        path,
        &[
            ("conversations.json", &conversations),
            ("projects.json", &projects),
            ("users.json", &users),
        ],
    );
}

/// Record `exports` (path, label) in the sandboxed `user-data.json`.
pub(crate) fn register(exports: &[(&Path, Option<&str>)]) {
    let mut metadata = UserMetadata::new();
    metadata.settings.claude_ai_exports = exports
        .iter()
        .map(|(path, label)| ClaudeAiExport {
            path: path.to_string_lossy().to_string(),
            label: label.map(str::to_string),
        })
        .collect();
    crate::commands::metadata::save_metadata_to_disk(&metadata).expect("save metadata");
}
