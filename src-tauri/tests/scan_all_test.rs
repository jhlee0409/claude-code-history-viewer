// 集成测试：直接调用 scan_all_projects 的内部逻辑
// 运行: cargo test test_scan_all_projects -- --nocapture

#[cfg(test)]
mod integration_tests {
    use claude_code_history_viewer_lib::{commands, providers};

    #[test]
    fn test_detect_providers() {
        let providers = providers::detect_providers();
        println!("\n=== detect_providers ===");
        println!("Total detected: {}", providers.len());
        for p in &providers {
            println!(
                "  Provider: id={:?}, name={:?}, path={:?}, available={}",
                p.id, p.display_name, p.base_path, p.is_available
            );
        }
        assert!(
            providers.iter().all(|p| !p.id.is_empty()),
            "Every detected provider should expose a non-empty id"
        );
    }

    #[test]
    fn test_antigravity_scan_projects() {
        println!("\n=== providers::antigravity::scan_projects ===");
        match providers::antigravity::scan_projects() {
            Ok(projects) => {
                println!("Projects returned: {}", projects.len());
                for p in &projects {
                    println!(
                        "  Project: name={:?}, session_count={}, message_count={}, provider={:?}, last_modified={:?}",
                        p.name, p.session_count, p.message_count, p.provider, p.last_modified
                    );
                }
            }
            Err(e) => {
                println!("ERROR: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_scan_all_projects_full() {
        println!("\n=== scan_all_projects (all providers) ===");

        // Replicate exactly what the frontend calls
        let all_providers = vec![
            "claude".to_string(),
            "codex".to_string(),
            "gemini".to_string(),
            "opencode".to_string(),
            "cline".to_string(),
            "cursor".to_string(),
            "aider".to_string(),
            "antigravity".to_string(),
        ];

        // Get claude path
        let claude_path = providers::claude::get_base_path();
        println!("Claude base path: {:?}", claude_path);

        // Count per provider
        let detected = providers::detect_providers();
        println!("\nDetected providers:");
        for p in &detected {
            println!("  {} - available: {}", p.id, p.is_available);
        }

        // Scan each provider individually and report
        println!("\nPer-provider scan results:");

        if let Some(base) = claude_path.clone() {
            match commands::project::scan_projects(base).await {
                Ok(projects) => println!("  claude: {} projects", projects.len()),
                Err(e) => println!("  claude: ERROR {}", e),
            }
        }

        match providers::antigravity::scan_projects() {
            Ok(projects) => {
                println!("  antigravity: {} projects", projects.len());
                for p in &projects {
                    println!("    - {:?} (sessions={}, msg={})", p.name, p.session_count, p.message_count);
                }
            }
            Err(e) => println!("  antigravity: ERROR {}", e),
        }

        for provider in &["codex", "gemini", "opencode", "cline", "cursor", "aider"] {
            let result = match *provider {
                "codex" => providers::codex::scan_projects(),
                "gemini" => providers::gemini::scan_projects(),
                "opencode" => providers::opencode::scan_projects(),
                "cline" => providers::cline::scan_projects(),
                "cursor" => providers::cursor::scan_projects(),
                "aider" => providers::aider::scan_projects(),
                _ => Ok(vec![]),
            };
            match result {
                Ok(projects) => println!("  {}: {} projects", provider, projects.len()),
                Err(e) => println!("  {}: ERROR {}", provider, e),
            }
        }
    }
}
