// Quick ad-hoc tool to count tools across all .pb files
use std::path::Path;

fn extract_pb_tool_names(pb_path: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(pb_path) else {
        return vec![];
    };
    let clean_bytes: Vec<u8> = bytes
        .into_iter()
        .map(|byte| {
            if (32..=126).contains(&byte) || byte == b'\n' || byte == b'\r' || byte == b'\t' {
                byte
            } else {
                b' '
            }
        })
        .collect();
    let text = String::from_utf8_lossy(&clean_bytes).to_lowercase();
    let mut tool_names = Vec::new();
    const TOOL_PATTERNS: [(&str, &str); 6] = [
        ("opening url", "BrowserOpenUrl"),
        ("getting dom", "BrowserGetDom"),
        ("getting console logs", "BrowserGetConsoleLogs"),
        ("clicking", "BrowserClick"),
        ("taking screenshot", "BrowserScreenshot"),
        ("scrolling mouse wheel", "BrowserScrollMouseWheel"),
    ];
    for (pattern, tool_name) in TOOL_PATTERNS {
        let count = text.match_indices(pattern).count();
        for _ in 0..count {
            tool_names.push(tool_name.to_string());
        }
    }
    tool_names
}

fn main() {
    let pb_dir = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .or_else(|| {
            dirs::home_dir().map(|home| {
                home.join(".gemini")
                    .join("antigravity")
                    .join("conversations")
            })
        })
        .expect("failed to determine Antigravity conversations directory");

    let entries: Vec<_> = std::fs::read_dir(&pb_dir)
        .unwrap()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().map(|s| s == "pb").unwrap_or(false))
        .collect();

    let mut total = 0;
    let mut has_tools = 0;
    for entry in &entries {
        let tools = extract_pb_tool_names(&entry.path());
        let count = tools.len();
        if count > 0 {
            has_tools += 1;
            println!("{}: {} tools", entry.file_name().to_string_lossy(), count);
        }
        total += count;
    }
    println!("\n=== Summary ===");
    println!("Total .pb files: {}", entries.len());
    println!("Files with tools: {has_tools}");
    println!("Total tool calls: {total}");
}
