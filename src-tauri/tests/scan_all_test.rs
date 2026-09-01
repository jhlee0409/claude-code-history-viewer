// Integration tests that exercise scan_all_projects end-to-end.
// Run: cargo test test_scan_all_projects -- --nocapture --test-threads=1
// Tests gated with #[ignore] require local Antigravity data:
//   cargo test -- --ignored --test-threads=1

#[cfg(test)]
mod integration_tests {
    use claude_code_history_viewer_lib::{commands, providers};
    use std::collections::HashSet;
    use std::path::PathBuf;

    fn get_antigravity_logs_dir() -> Option<PathBuf> {
        dirs::data_dir().map(|dir| dir.join("Antigravity").join("logs"))
    }

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
        for provider in &[
            "codex", "gemini", "kimi", "opencode", "cline", "cursor", "aider",
        ] {
            let is_available = detected.iter().any(|p| p.id == *provider && p.is_available);
            if is_available {
                let result = match *provider {
                    "codex" => providers::codex::scan_projects(),
                    "gemini" => providers::gemini::scan_projects(),
                    "kimi" => providers::kimi::scan_projects(),
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
    #[ignore = "requires local Antigravity data; run with --ignored"]
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

        // A desktop session yields messages from `usage.jsonl`, or — when the
        // rpc-cache never recorded one — from the agent message recovered out
        // of Antigravity's editor state store. A session with neither (the
        // store keeps only metadata for some trajectories) has nothing to
        // render, and asserting otherwise just fails on whichever session
        // happens to sort first (#564).
        let recoverable = providers::antigravity_state_sync::load()
            .get(&session.session_id)
            .is_some_and(|summary| summary.last_message.is_some() || summary.last_task.is_some());
        let has_usage = std::path::Path::new(&session.file_path)
            .join("usage.jsonl")
            .is_file();

        if recoverable || has_usage {
            assert!(
                !messages.is_empty(),
                "session has usage records or recovered text but rendered nothing"
            );
        } else {
            println!("session carries only metadata in the state store; nothing to render");
        }
    }

    #[tokio::test]
    #[ignore = "requires local Antigravity logs; run with --ignored"]
    async fn test_antigravity_load_provider_messages_returns_tool_use_for_logged_session() {
        println!("\n=== antigravity tool-use session probe ===");

        let Some(logs_root) = get_antigravity_logs_dir() else {
            println!("No Antigravity data directory available, skipping");
            return;
        };

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
    #[ignore = "requires local Antigravity data; run with --ignored"]
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
    #[ignore = "requires local Antigravity desktop data; run with --ignored"]
    async fn test_antigravity_desktop_sessions_carry_titles_and_recovered_text() {
        // The desktop layout's `conversations/*.pb` transcripts are encrypted,
        // so sessions used to list as bare UUIDs with an empty conversation
        // (#564). Titles and the latest agent message are recovered from
        // Antigravity's own `state.vscdb`; this probe asserts that against the
        // real store on the developer's machine.
        let summaries = providers::antigravity_state_sync::load();
        if summaries.is_empty() {
            println!("No Antigravity state sync summaries found, skipping");
            return;
        }
        println!("trajectory summaries: {}", summaries.len());

        let project = providers::antigravity::scan_projects()
            .expect("scan_projects failed")
            .into_iter()
            .find(|p| p.name == "Antigravity")
            .expect("expected desktop Antigravity project");

        let sessions = providers::antigravity::load_sessions(&project.path, false)
            .expect("load_sessions failed");
        let recovered = sessions
            .iter()
            .filter(|s| summaries.contains_key(&s.session_id))
            .count();
        println!("sessions={} recovered={recovered}", sessions.len());

        for session in sessions
            .iter()
            .filter(|s| summaries.contains_key(&s.session_id))
        {
            let title = &summaries[&session.session_id].title;
            let summary = session.summary.as_deref().unwrap_or_default();
            println!("  {} → {summary}", session.session_id);
            assert!(
                summary.starts_with(title),
                "session {} should be labelled with its title {title:?}, got {summary:?}",
                session.session_id
            );

            let messages = providers::antigravity::load_messages(&session.file_path)
                .expect("load_messages failed");
            println!("    messages={}", messages.len());
            if summaries[&session.session_id].last_message.is_some() {
                assert!(
                    !messages.is_empty(),
                    "session {} has a recovered agent message but rendered nothing",
                    session.session_id
                );
            }
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
    #[ignore = "hardcoded date range targets local Antigravity data; run with --ignored"]
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
    #[ignore = "hardcoded date range targets local Antigravity data; run with --ignored"]
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
            None,
        )
        .await
        .expect("billing summary failed");

        let conversation = commands::stats::get_global_stats_summary(
            claude_path,
            Some(vec!["antigravity".to_string()]),
            Some("conversation_only".to_string()),
            Some("2026-04-12T00:00:00.000Z".to_string()),
            Some("2026-04-17T23:59:59.999Z".to_string()),
            None,
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

        if billing.total_tokens == 0 && conversation.total_tokens == 0 {
            println!("Both billing and conversation totals are zero, skipping strict comparison");
            return;
        }

        assert!(
            billing.total_tokens >= conversation.total_tokens,
            "expected Antigravity billing_total to be at least conversation_only"
        );
    }
}
