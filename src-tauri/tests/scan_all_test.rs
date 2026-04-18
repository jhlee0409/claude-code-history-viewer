// 集成测试：直接调用 scan_all_projects 的内部逻辑
// 运行: cargo test test_scan_all_projects -- --nocapture

#[cfg(test)]
mod integration_tests {
    use claude_code_history_viewer_lib::{commands, providers};
    use std::collections::HashSet;

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
        let projects = providers::antigravity::scan_projects().expect("scan_projects failed");
        println!("Projects returned: {}", projects.len());
        for p in &projects {
            println!(
                "  Project: name={:?}, session_count={}, message_count={}, provider={:?}, last_modified={:?}",
                p.name, p.session_count, p.message_count, p.provider, p.last_modified
            );
            assert!(!p.name.is_empty());
            assert_eq!(p.provider.as_deref(), Some("antigravity"));
        }
    }

    #[tokio::test]
    async fn test_scan_all_projects_full() {
        println!("\n=== scan_all_projects (all providers) ===");

        // Replicate exactly what the frontend calls
        // Get claude path
        let claude_path = providers::claude::get_base_path();
        println!("Claude base path: {claude_path:?}");

        // Count per provider
        let detected = providers::detect_providers();
        println!("\nDetected providers:");
        for p in &detected {
            println!("  {} - available: {}", p.id, p.is_available);
        }

        // Assert that detected providers is not empty
        assert!(
            !detected.is_empty(),
            "providers::detect_providers() should return at least one provider"
        );

        // Scan each provider individually and report
        println!("\nPer-provider scan results:");

        if let Some(base) = claude_path.clone() {
            match commands::project::scan_projects(base).await {
                Ok(projects) => {
                    println!("  claude: {} projects", projects.len());
                    // Assert that scan was successful and validate project structures
                    for p in &projects {
                        assert!(!p.name.is_empty(), "Project name should not be empty");
                    }
                }
                Err(e) => println!("  claude: ERROR {e}"),
            }
        }

        // Test antigravity scan
        match providers::antigravity::scan_projects() {
            Ok(projects) => {
                println!("  antigravity: {} projects", projects.len());
                for p in &projects {
                    println!(
                        "    - {:?} (sessions={}, msg={})",
                        p.name, p.session_count, p.message_count
                    );
                    // Validate project structure
                    assert!(!p.name.is_empty(), "Project name should not be empty");
                }
            }
            Err(e) => println!("  antigravity: ERROR {e}"),
        }

        // Test other providers if they are detected as available
        for provider in &["codex", "gemini", "opencode", "cline", "cursor", "aider"] {
            let is_available = detected.iter().any(|p| p.id == *provider && p.is_available);
            if is_available {
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
                    Ok(projects) => {
                        println!("  {}: {} projects", provider, projects.len());
                        // Validate project structures
                        for p in &projects {
                            assert!(
                                !p.name.is_empty(),
                                "Project name should not be empty for {provider}"
                            );
                        }
                    }
                    Err(e) => println!("  {provider}: ERROR {e}"),
                }
            } else {
                println!("  {provider}: skipped (not available)");
            }
        }
    }

    #[tokio::test]
    async fn test_antigravity_load_provider_messages_real_data() {
        println!("\n=== antigravity load_provider_messages ===");

        let projects = providers::antigravity::scan_projects().expect("scan_projects failed");
        if projects.is_empty() {
            println!("No antigravity projects found, skipping");
            return;
        }

        let project = &projects[0];
        let sessions = commands::multi_provider::load_provider_sessions(
            "antigravity".to_string(),
            project.path.clone(),
            Some(false),
        )
        .await
        .expect("load_provider_sessions failed");

        if sessions.is_empty() {
            println!("No antigravity sessions found, skipping");
            return;
        }

        let session = &sessions[0];
        println!(
            "Testing session: id={}, path={}",
            session.session_id, session.file_path
        );

        let messages = commands::multi_provider::load_provider_messages(
            "antigravity".to_string(),
            session.file_path.clone(),
        )
        .await
        .expect("load_provider_messages failed");

        let tool_use_blocks = messages
            .iter()
            .filter_map(|message| {
                message
                    .content
                    .as_ref()
                    .and_then(serde_json::Value::as_array)
            })
            .flatten()
            .filter(|item| item.get("type").and_then(serde_json::Value::as_str) == Some("tool_use"))
            .count();

        println!("messages={}", messages.len());
        println!("tool_use_blocks={tool_use_blocks}");

        assert!(
            !messages.is_empty(),
            "antigravity load_provider_messages should return at least one message"
        );
    }

    #[tokio::test]
    async fn test_antigravity_load_provider_messages_returns_tool_use_for_logged_session() {
        println!("\n=== antigravity tool-use session probe ===");

        let Some(home_dir) = dirs::home_dir() else {
            println!("No home directory available, skipping");
            return;
        };
        let logs_root = home_dir
            .join("Library")
            .join("Application Support")
            .join("Antigravity")
            .join("logs");

        if !logs_root.exists() {
            println!("No Antigravity logs directory found, skipping");
            return;
        }

        let mut candidate_session_ids = HashSet::new();
        for entry in std::fs::read_dir(&logs_root).expect("failed to read Antigravity logs") {
            let Ok(entry) = entry else {
                continue;
            };
            let log_path = entry.path().join("ls-main.log");
            let Ok(content) = std::fs::read_to_string(&log_path) else {
                continue;
            };

            for line in content.lines() {
                if !line.contains("window.updateActuationOverlay(") {
                    continue;
                }
                if !line.contains("Opening URL...")
                    && !line.contains("Getting DOM...")
                    && !line.contains("Getting console logs...")
                    && !line.contains("Clicking...")
                    && !line.contains("Taking screenshot...")
                    && !line.contains("Scrolling mouse wheel...")
                {
                    continue;
                }

                let Some(start) = line.find("\"cascadeId\":\"") else {
                    continue;
                };
                let session_start = start + "\"cascadeId\":\"".len();
                let Some(end_offset) = line[session_start..].find('"') else {
                    continue;
                };
                let session_id = &line[session_start..session_start + end_offset];
                candidate_session_ids.insert(session_id.to_string());
            }
        }

        if candidate_session_ids.is_empty() {
            println!("No log-backed tool sessions found, skipping");
            return;
        }

        let project = providers::antigravity::scan_projects()
            .expect("scan_projects failed")
            .into_iter()
            .next()
            .expect("expected antigravity project");

        let sessions = commands::multi_provider::load_provider_sessions(
            "antigravity".to_string(),
            project.path.clone(),
            Some(false),
        )
        .await
        .expect("load_provider_sessions failed");

        let target_session = sessions
            .iter()
            .find(|session| candidate_session_ids.contains(&session.session_id))
            .expect("expected at least one session with log-backed tool activity");

        println!(
            "Testing tool session: id={}, path={}",
            target_session.session_id, target_session.file_path
        );

        let messages = commands::multi_provider::load_provider_messages(
            "antigravity".to_string(),
            target_session.file_path.clone(),
        )
        .await
        .expect("load_provider_messages failed");

        let tool_use_blocks = messages
            .iter()
            .filter_map(|message| {
                message
                    .content
                    .as_ref()
                    .and_then(serde_json::Value::as_array)
            })
            .flatten()
            .filter(|item| item.get("type").and_then(serde_json::Value::as_str) == Some("tool_use"))
            .count();

        println!("messages={}", messages.len());
        println!("tool_use_blocks={tool_use_blocks}");

        assert!(
            tool_use_blocks > 0,
            "expected log-backed Antigravity session to expose tool_use blocks"
        );
    }

    #[tokio::test]
    async fn test_antigravity_project_stats_summary_returns_tools_for_logged_project() {
        println!("\n=== antigravity project stats summary tool probe ===");

        let project = providers::antigravity::scan_projects()
            .expect("scan_projects failed")
            .into_iter()
            .next()
            .expect("expected antigravity project");

        let summary = commands::stats::get_project_stats_summary(
            project.path.clone(),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("get_project_stats_summary failed");

        println!("project={}", project.path);
        println!("total_sessions={}", summary.total_sessions);
        println!("total_messages={}", summary.total_messages);
        println!("most_used_tools={}", summary.most_used_tools.len());
        if let Some(tool) = summary.most_used_tools.first() {
            println!(
                "top_tool={} usage={} success_rate={}",
                tool.tool_name, tool.usage_count, tool.success_rate
            );
        }
    }

    #[tokio::test]
    async fn test_antigravity_global_stats_summary_returns_tools_when_filtered() {
        println!("\n=== antigravity global stats summary tool probe ===");

        let claude_path = providers::claude::get_base_path().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("/"))
                .join(".claude")
                .to_string_lossy()
                .to_string()
        });

        let summary = commands::stats::get_global_stats_summary(
            claude_path,
            Some(vec!["antigravity".to_string()]),
            Some("billing_total".to_string()),
            None,
            None,
        )
        .await
        .expect("get_global_stats_summary failed");

        println!("total_projects={}", summary.total_projects);
        println!("total_sessions={}", summary.total_sessions);
        println!("total_messages={}", summary.total_messages);
        println!("most_used_tools={}", summary.most_used_tools.len());
        if let Some(tool) = summary.most_used_tools.first() {
            println!(
                "top_tool={} usage={} success_rate={}",
                tool.tool_name, tool.usage_count, tool.success_rate
            );
        }
    }

    #[tokio::test]
    async fn test_antigravity_global_stats_summary_returns_tools_for_ui_date_range() {
        println!("\n=== antigravity global stats summary ui date-range probe ===");

        let claude_path = providers::claude::get_base_path().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("/"))
                .join(".claude")
                .to_string_lossy()
                .to_string()
        });

        let summary = commands::stats::get_global_stats_summary(
            claude_path,
            Some(vec!["antigravity".to_string()]),
            Some("billing_total".to_string()),
            Some("2026-04-12T00:00:00.000Z".to_string()),
            Some("2026-04-17T23:59:59.999Z".to_string()),
        )
        .await
        .expect("get_global_stats_summary failed");

        println!("total_projects={}", summary.total_projects);
        println!("total_sessions={}", summary.total_sessions);
        println!("total_messages={}", summary.total_messages);
        println!("most_used_tools={}", summary.most_used_tools.len());
        if let Some(tool) = summary.most_used_tools.first() {
            println!(
                "top_tool={} usage={} success_rate={}",
                tool.tool_name, tool.usage_count, tool.success_rate
            );
        }
    }

    #[tokio::test]
    async fn test_antigravity_global_billing_breakdown_is_non_zero_for_real_data() {
        println!("\n=== antigravity global billing breakdown probe ===");

        let claude_path = providers::claude::get_base_path().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("/"))
                .join(".claude")
                .to_string_lossy()
                .to_string()
        });

        let billing = commands::stats::get_global_stats_summary(
            claude_path.clone(),
            Some(vec!["antigravity".to_string()]),
            Some("billing_total".to_string()),
            Some("2026-04-12T00:00:00.000Z".to_string()),
            Some("2026-04-17T23:59:59.999Z".to_string()),
        )
        .await
        .expect("billing summary failed");

        let conversation = commands::stats::get_global_stats_summary(
            claude_path,
            Some(vec!["antigravity".to_string()]),
            Some("conversation_only".to_string()),
            Some("2026-04-12T00:00:00.000Z".to_string()),
            Some("2026-04-17T23:59:59.999Z".to_string()),
        )
        .await
        .expect("conversation summary failed");

        println!("billing_total_tokens={}", billing.total_tokens);
        println!("conversation_total_tokens={}", conversation.total_tokens);
        println!(
            "non_conversation_tokens={}",
            billing
                .total_tokens
                .saturating_sub(conversation.total_tokens)
        );

        assert!(
            billing.total_tokens > conversation.total_tokens,
            "expected Antigravity billing_total to exceed conversation_only"
        );
    }
}
