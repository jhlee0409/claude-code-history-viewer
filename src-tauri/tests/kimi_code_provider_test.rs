use claude_code_history_viewer_lib::providers;

#[test]
fn kimi_code_provider_scans_projects_from_sessions_tree() {
    let base = fixture_base();

    let projects = providers::kimi_code::scan_projects_from_path(base.to_str().unwrap())
        .expect("scan_projects_from_path should parse fixture");

    assert_eq!(projects.len(), 1);
    let project = &projects[0];
    assert_eq!(project.name, "demo-project");
    assert_eq!(
        project.path,
        format!(
            "kimicode://{}",
            base.join("sessions/wd_demo-project_a1b2c3d4e5f6").display()
        )
    );
    // cwd comes from the systemPrompt marker when the session_index entry does
    // not match, falling back to the workDirKey slug — both resolve to the
    // same project name here.
    assert!(
        project.actual_path == "/Users/dev/demo-project" || project.actual_path == "demo-project",
        "unexpected actual_path: {}",
        project.actual_path
    );
    assert_eq!(project.session_count, 2);
    assert_eq!(project.message_count, 8);
    assert_eq!(project.provider.as_deref(), Some("kimi-code"));
    assert_eq!(project.storage_type.as_deref(), Some("jsonl"));
}

#[test]
fn kimi_code_provider_loads_sessions_with_titles_and_timestamps() {
    let base = fixture_base();
    let project_path = format!(
        "kimicode://{}",
        base.join("sessions/wd_demo-project_a1b2c3d4e5f6").display()
    );

    let sessions = providers::kimi_code::load_sessions_from_base_path(
        base.to_str().unwrap(),
        &project_path,
        false,
    )
    .expect("load_sessions_from_base_path should parse fixture");

    assert_eq!(sessions.len(), 2);
    // Sessions are sorted by last_modified descending — session 2 is newer.
    let first = &sessions[0];
    assert_eq!(
        first.actual_session_id,
        "session_22222222-2222-4222-8222-222222222222"
    );
    // Empty state.json title falls back to the first user message text.
    assert_eq!(first.summary.as_deref(), Some("Second session prompt"));
    assert!(!first.has_tool_use);
    assert_eq!(first.message_count, 2);
    assert_eq!(first.last_message_time, "2026-07-21T02:20:03+00:00");

    let second = &sessions[1];
    assert_eq!(
        second.actual_session_id,
        "session_11111111-1111-4111-8111-111111111111"
    );
    assert_eq!(
        second.summary.as_deref(),
        Some("Implement Kimi Code provider")
    );
    assert!(second.has_tool_use);
    assert_eq!(second.message_count, 6);
    assert_eq!(second.first_message_time, "2026-07-21T02:18:18+00:00");
    assert_eq!(second.last_message_time, "2026-07-21T02:18:28+00:00");
    assert_eq!(second.provider.as_deref(), Some("kimi-code"));
}

#[test]
fn kimi_code_provider_loads_messages_without_internal_events() {
    let base = fixture_base();
    let session_dir = base
        .join("sessions/wd_demo-project_a1b2c3d4e5f6/session_11111111-1111-4111-8111-111111111111");

    let messages = providers::kimi_code::load_messages_from_base_path(
        base.to_str().unwrap(),
        session_dir.to_str().unwrap(),
    )
    .expect("load_messages_from_base_path should parse fixture");

    assert_eq!(messages.len(), 6);
    assert!(messages
        .iter()
        .all(|m| m.provider.as_deref() == Some("kimi-code")));

    // User message with array content.
    assert_eq!(messages[0].message_type, "user");
    assert_eq!(messages[0].timestamp, "2026-07-21T02:18:18+00:00");
    assert_eq!(
        messages[0].content.as_ref().unwrap()[0]["text"],
        "Implement the Kimi Code provider"
    );

    // Loop events of step-1 are aggregated into one assistant message,
    // timestamped by its step.end. The assistant message (with the tool_use
    // blocks) must come BEFORE the tool results — tool.result events arrive
    // mid-step in the wire but belong after the call, like Claude sessions.
    assert_eq!(messages[1].message_type, "assistant");
    assert_eq!(messages[1].timestamp, "2026-07-21T02:18:24+00:00");
    let blocks = messages[1].content.as_ref().unwrap().as_array().unwrap();
    assert_eq!(blocks.len(), 4);
    assert_eq!(blocks[0]["type"], "thinking");
    assert_eq!(
        blocks[0]["thinking"],
        "I should inspect the provider registry first."
    );
    assert_eq!(blocks[1]["type"], "text");
    assert_eq!(blocks[1]["text"], "Let me look at the existing providers.");
    assert_eq!(blocks[2]["type"], "tool_use");
    assert_eq!(blocks[2]["id"], "tool_abc123");
    assert_eq!(blocks[2]["name"], "Grep");
    assert_eq!(blocks[2]["input"]["pattern"], "kimi");
    assert_eq!(blocks[3]["type"], "tool_use");
    assert_eq!(blocks[3]["id"], "tool_def456");
    assert_eq!(blocks[3]["name"], "Read");
    assert_eq!(blocks[3]["input"]["file_path"], "src/providers/kimi.rs");

    // Both tool.results of step-1 follow the assistant message as standalone
    // tool messages, in arrival order.
    assert_eq!(messages[2].message_type, "tool");
    let tool_block = &messages[2].content.as_ref().unwrap()[0];
    assert_eq!(tool_block["type"], "tool_result");
    assert_eq!(tool_block["tool_use_id"], "tool_abc123");
    assert_eq!(tool_block["content"], "src/providers/kimi.rs");

    assert_eq!(messages[3].message_type, "tool");
    let tool_block = &messages[3].content.as_ref().unwrap()[0];
    assert_eq!(tool_block["type"], "tool_result");
    assert_eq!(tool_block["tool_use_id"], "tool_def456");
    assert_eq!(tool_block["content"], "pub fn scan()");

    // String message content is normalized into a text block.
    assert_eq!(messages[4].message_type, "user");
    assert_eq!(
        messages[4].content.as_ref().unwrap(),
        &serde_json::json!([{ "type": "text", "text": "Now add tests." }])
    );

    // step-2 never saw its step.end — flushed at EOF with the last event time.
    assert_eq!(messages[5].message_type, "assistant");
    assert_eq!(messages[5].timestamp, "2026-07-21T02:18:28+00:00");
    assert_eq!(
        messages[5].content.as_ref().unwrap(),
        &serde_json::json!([{ "type": "text", "text": "Done." }])
    );
}

#[test]
fn kimi_code_provider_searches_messages_from_base_path() {
    let base = fixture_base();

    let results = providers::kimi_code::search_from_base_path(
        base.to_str().unwrap(),
        "inspect the provider registry",
        10,
    )
    .expect("search_from_base_path should parse fixture");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].message_type, "assistant");
    assert_eq!(results[0].project_name.as_deref(), Some("demo-project"));
}

fn fixture_base() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("kimi-code")
}
