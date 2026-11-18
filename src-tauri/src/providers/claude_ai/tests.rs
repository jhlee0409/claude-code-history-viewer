// Tests for the claude.ai export provider. Every export is built from the
// synthetic fixture under `tests/fixtures/claude-ai-export` (no account
// data) inside a sandboxed HOME, and registered in its `user-data.json`.

use super::test_support::{fixture, register, write_export_zip, write_zip};
use super::*;
use crate::test_utils::SandboxHome;
use serial_test::serial;

const CHATS_CONVERSATION: &str = "0b6a2f4e-1c3d-4e5f-8a9b-000000000001";
const PROJECT_CONVERSATION: &str = "0b6a2f4e-1c3d-4e5f-8a9b-000000000002";
const BRANCHED_CONVERSATION: &str = "0b6a2f4e-1c3d-4e5f-8a9b-000000000003";
const TEXT_ONLY_CONVERSATION: &str = "0b6a2f4e-1c3d-4e5f-8a9b-000000000004";

/// A registered zip export in the sandbox; returns its path.
fn zip_export(home: &SandboxHome) -> PathBuf {
    let path = home.path().join("Downloads").join("data-2026-11-18.zip");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    write_export_zip(&path);
    register(&[(&path, None)]);
    path
}

fn project_named<'a>(projects: &'a [ClaudeProject], name: &str) -> &'a ClaudeProject {
    projects
        .iter()
        .find(|p| p.name == name)
        .unwrap_or_else(|| panic!("no project {name} in {projects:?}"))
}

fn block_types(message: &ClaudeMessage) -> Vec<String> {
    message
        .content
        .as_ref()
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .map(|b| b["type"].as_str().unwrap().to_string())
        .collect()
}

fn session_of(project: &ClaudeProject, conversation: &str) -> String {
    format!("{}#{conversation}", project.path)
}

#[test]
#[serial]
fn a_zip_export_groups_conversations_by_claude_ai_project() {
    let home = SandboxHome::new();
    let path = zip_export(&home);

    let projects = scan_projects().unwrap();
    let mut names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        vec![
            "CLI design",
            "Claude.ai",
            "Claude.ai project c0000000",
            "Release engineering"
        ]
    );
    for project in &projects {
        assert_eq!(project.provider.as_deref(), Some(PROVIDER));
        assert_eq!(project.storage_type.as_deref(), Some("json"));
        assert_eq!(project.session_count, 1, "{project:?}");
        assert_eq!(project.message_count, 2, "{project:?}");
        assert_eq!(
            project.custom_directory_label.as_deref(),
            Some("data-2026-11-18.zip")
        );
        assert!(project.path.starts_with(&format!(
            "claude-ai://{}/",
            export_id(&path.to_string_lossy())
        )));
        assert_eq!(project.actual_path, project.path);
    }
    // The empty draft and the malformed entry are not listed anywhere.
    assert_eq!(projects.iter().map(|p| p.session_count).sum::<usize>(), 4);
    assert!(project_named(&projects, "Claude.ai")
        .path
        .ends_with("/chats"));
    assert!(project_named(&projects, "Release engineering")
        .path
        .ends_with("/project-c0000000-0000-4000-8000-000000000001"));
}

#[test]
#[serial]
fn an_extracted_folder_reads_like_the_zip_with_or_without_a_top_folder() {
    let home = SandboxHome::new();
    let flat = home.path().join("flat");
    let nested = home.path().join("nested");
    for dir in [&flat, &nested.join("data-2026-11-18")] {
        fs::create_dir_all(dir).unwrap();
        for name in ["conversations.json", "projects.json", "users.json"] {
            fs::write(dir.join(name), fixture(name)).unwrap();
        }
    }
    register(&[(&flat, Some("Flat")), (&nested, Some("Nested"))]);

    let projects = scan_projects().unwrap();
    for label in ["Flat", "Nested"] {
        let mut names: Vec<&str> = projects
            .iter()
            .filter(|p| p.custom_directory_label.as_deref() == Some(label))
            .map(|p| p.name.as_str())
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            vec![
                "CLI design",
                "Claude.ai",
                "Claude.ai project c0000000",
                "Release engineering"
            ],
            "{label}"
        );
    }
}

#[test]
#[serial]
fn a_zip_with_one_top_level_folder_is_read() {
    let home = SandboxHome::new();
    let path = home.path().join("export.zip");
    let conversations = fixture("conversations.json");
    let projects = fixture("projects.json");
    write_zip(
        &path,
        &[
            ("data-export/conversations.json", &conversations),
            ("data-export/projects.json", &projects),
        ],
    );
    assert_eq!(
        inspect(&path).unwrap(),
        ExportSummary {
            conversations: 4,
            projects: 3
        }
    );
    register(&[(&path, None)]);
    let projects = scan_projects().unwrap();
    project_named(&projects, "Release engineering");
}

#[test]
#[serial]
fn sessions_carry_titles_times_and_tool_use() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();

    let chats = load_sessions(&project_named(&projects, "Claude.ai").path, false).unwrap();
    assert_eq!(chats.len(), 1);
    let session = &chats[0];
    assert_eq!(session.actual_session_id, CHATS_CONVERSATION);
    assert_eq!(session.file_path, session.session_id);
    assert_eq!(
        session.file_path,
        session_of(project_named(&projects, "Claude.ai"), CHATS_CONVERSATION)
    );
    assert_eq!(
        session.summary.as_deref(),
        Some("Postgres vs MongoDB for metrics")
    );
    assert_eq!(session.first_message_time, "2026-02-14T10:04:22.100Z");
    assert_eq!(session.last_message_time, "2026-02-14T10:04:41.000Z");
    assert_eq!(session.project_name, "Claude.ai");
    assert_eq!(session.provider.as_deref(), Some(PROVIDER));
    assert!(!session.has_tool_use);

    let release =
        load_sessions(&project_named(&projects, "Release engineering").path, false).unwrap();
    assert!(release[0].has_tool_use);
    assert!(!release[0].has_errors);

    // A conversation without a title is named by its first prompt.
    let untitled = load_sessions(
        &project_named(&projects, "Claude.ai project c0000000").path,
        false,
    )
    .unwrap();
    assert_eq!(
        untitled[0].summary.as_deref(),
        Some("What does the borrow checker guard against?")
    );
}

#[test]
#[serial]
fn messages_map_text_thinking_tools_and_attachments() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();
    let project = project_named(&projects, "Release engineering");

    let messages = load_messages(&session_of(project, PROJECT_CONVERSATION)).unwrap();
    assert_eq!(messages.len(), 2);
    let (prompt, answer) = (&messages[0], &messages[1]);

    assert_eq!(prompt.message_type, "user");
    assert_eq!(prompt.session_id, PROJECT_CONVERSATION);
    assert_eq!(block_types(prompt), vec!["document", "document", "text"]);
    let blocks = prompt.content.as_ref().unwrap();
    assert_eq!(blocks[0]["title"], "release-checklist.md");
    assert_eq!(blocks[0]["context"], "text/markdown · 2 KB");
    assert_eq!(blocks[0]["source"]["type"], "file");
    // Metadata only: the attachment's extracted text is not shown.
    assert!(!blocks[0].to_string().contains("bump version"));
    // `files` and `files_v2` list the same upload once.
    assert_eq!(blocks[1]["title"], "screenshot.png");
    assert_eq!(blocks[1]["context"], "image");

    assert_eq!(answer.message_type, "assistant");
    assert_eq!(answer.model.as_deref(), Some("claude-opus-4-1"));
    assert_eq!(answer.stop_reason.as_deref(), Some("end_turn"));
    assert_eq!(answer.parent_uuid.as_deref(), Some(prompt.uuid.as_str()));
    assert!(answer.usage.is_none(), "exports record no token usage");
    assert_eq!(
        block_types(answer),
        vec![
            "thinking",
            "tool_use",
            "tool_result",
            "tool_use",
            "tool_result",
            "text"
        ]
    );
    let blocks = answer.content.as_ref().unwrap();
    assert_eq!(
        blocks[0]["thinking"],
        "I should search for the release notes first."
    );
    assert_eq!(blocks[1]["id"], "toolu_01ReleaseSearch");
    assert_eq!(blocks[1]["input"]["query"], "Tauri 2 release notes");
    assert_eq!(blocks[2]["tool_use_id"], "toolu_01ReleaseSearch");
    assert_eq!(
        blocks[2]["content"],
        "Tauri 2.0 Release\nhttps://v2.tauri.app/blog/tauri-20/\nTauri 2.0 is stable."
    );
    // A call and result without ids are paired by tool name.
    assert_eq!(blocks[3]["name"], "artifacts");
    assert_eq!(blocks[4]["tool_use_id"], blocks[3]["id"]);
    assert_eq!(blocks[4]["content"], "OK");
    assert_eq!(blocks[4]["is_error"], false);
}

#[test]
#[serial]
fn only_the_active_branch_of_an_edited_conversation_is_shown() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();
    let messages = load_messages(&session_of(
        project_named(&projects, "CLI design"),
        BRANCHED_CONVERSATION,
    ))
    .unwrap();
    let texts: Vec<&str> = messages
        .iter()
        .map(|m| m.content.as_ref().unwrap()[0]["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        texts,
        vec![
            "Name a flag that skips the cache, as a long option with a verb.",
            "--bypass-cache"
        ]
    );
}

#[test]
#[serial]
fn text_only_messages_of_older_exports_are_read() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();
    let messages = load_messages(&session_of(
        project_named(&projects, "Claude.ai project c0000000"),
        TEXT_ONLY_CONVERSATION,
    ))
    .unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].timestamp, "2024-06-01T09:00:00.000Z");
    assert_eq!(
        messages[1].content.as_ref().unwrap()[0]["text"],
        "Data races and use-after-free, at compile time."
    );
    assert_eq!(messages[1].model, None);
}

#[test]
#[serial]
fn search_finds_shown_messages_with_their_project() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();

    let hits = search("BYPASS-cache", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let project = project_named(&projects, "CLI design");
    assert_eq!(hits[0].provider.as_deref(), Some(PROVIDER));
    assert_eq!(hits[0].session_id, BRANCHED_CONVERSATION);
    assert_eq!(hits[0].project_name.as_deref(), Some("CLI design"));
    assert_eq!(hits[0].project_path.as_deref(), Some(project.path.as_str()));

    // The replaced branch is not part of the conversation any more.
    assert!(search("--no-cache", 10).unwrap().is_empty());
    // Attachment names are searchable.
    assert_eq!(search("release-checklist", 10).unwrap().len(), 1);
    assert_eq!(search("the", 1).unwrap().len(), 1);
}

#[test]
#[serial]
fn a_chatgpt_export_is_refused_with_the_reason() {
    let home = SandboxHome::new();
    let path = home.path().join("chatgpt.zip");
    write_zip(
        &path,
        &[(
            "conversations.json",
            br#"[{"title":"Hi","mapping":{},"current_node":null}]"#,
        )],
    );
    assert_eq!(inspect(&path).unwrap_err(), CHATGPT_EXPORT);
}

#[test]
#[serial]
fn entries_outside_the_export_are_never_read() {
    let home = SandboxHome::new();
    let conversations = fixture("conversations.json");
    for (name, entry) in [
        ("slip.zip", "../conversations.json"),
        ("deep.zip", "a/b/conversations.json"),
        ("absolute.zip", "/conversations.json"),
    ] {
        let path = home.path().join(name);
        write_zip(&path, &[(entry, &conversations)]);
        let error = inspect(&path).unwrap_err();
        assert!(error.starts_with(NOT_AN_EXPORT), "{name}: {error}");
    }

    let not_zip = home.path().join("notes.txt");
    fs::write(&not_zip, "hello").unwrap();
    assert!(inspect(&not_zip)
        .unwrap_err()
        .contains("neither a zip archive nor a folder"));

    let empty_dir = home.path().join("empty");
    fs::create_dir_all(&empty_dir).unwrap();
    assert!(inspect(&empty_dir).unwrap_err().starts_with(NOT_AN_EXPORT));
}

#[test]
fn reads_stop_at_the_size_cap_whatever_the_source_declares() {
    let conversations = fixture("conversations.json");
    let error = parse_conversations(conversations.as_slice(), 64).unwrap_err();
    assert!(error.contains("larger than"), "{error}");

    let limit = u64::try_from(conversations.len()).unwrap();
    assert_eq!(
        parse_conversations(conversations.as_slice(), limit)
            .unwrap()
            .len(),
        5
    );
}

#[test]
fn a_byte_order_mark_is_skipped() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend(fixture("conversations.json"));
    assert_eq!(
        parse_conversations(bytes.as_slice(), MAX_CONVERSATIONS_BYTES)
            .unwrap()
            .len(),
        5
    );
}

#[test]
#[serial]
fn ids_name_registered_exports_only() {
    let home = SandboxHome::new();
    let path = zip_export(&home);
    let id = export_id(&path.to_string_lossy());

    assert!(load_sessions("claude-ai://00ff00ff00ff00ff/chats", false).is_err());
    assert!(load_sessions(&format!("claude-ai://{id}/../chats"), false).is_err());
    assert!(load_sessions(&format!("claude-ai://{id}/project-a/b"), false).is_err());
    assert!(load_messages(&format!("claude-ai://{id}/chats#../x")).is_err());
    assert!(load_messages(&format!("claude-ai://{id}/chats")).is_err());
    // A conversation is found only under the project it belongs to.
    assert!(load_messages(&format!("claude-ai://{id}/chats#{PROJECT_CONVERSATION}")).is_err());
    assert!(load_messages(&format!("claude-ai://{id}/chats#{CHATS_CONVERSATION}")).is_ok());
}

#[test]
#[serial]
fn removing_an_export_from_settings_removes_it_and_keeps_the_file() {
    let home = SandboxHome::new();
    let path = zip_export(&home);
    assert!(detect().is_some());
    assert!(!scan_projects().unwrap().is_empty());

    register(&[]);
    assert!(scan_projects().unwrap().is_empty());
    assert!(detect().is_none());
    assert!(search("Postgres", 10).unwrap().is_empty());
    assert!(
        !CACHE
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains_key(&path),
        "a removed export's parsed copy is dropped"
    );
    assert!(path.is_file(), "the export itself is never touched");
}

#[test]
#[serial]
fn a_changed_export_is_read_again() {
    let home = SandboxHome::new();
    let path = zip_export(&home);
    assert_eq!(scan_projects().unwrap().len(), 4);

    let conversations = fixture("conversations.json");
    let only_first: Value = serde_json::from_slice(&conversations).unwrap();
    let first = serde_json::to_vec(&vec![only_first[0].clone()]).unwrap();
    // A different size: the fingerprint changes even within one mtime tick.
    write_zip(&path, &[("conversations.json", &first)]);
    let projects = scan_projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "Claude.ai");
}

#[cfg(unix)]
#[test]
#[serial]
fn a_symlinked_export_is_refused() {
    let home = SandboxHome::new();
    let elsewhere = tempfile::TempDir::new().unwrap();
    let real = elsewhere.path().join("export.zip");
    write_export_zip(&real);
    let link = home.path().join("export.zip");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(inspect(&link).unwrap_err().contains("symbolic link"));

    // Nor is a conversations.json that links out of an extracted folder.
    let folder = home.path().join("extracted");
    fs::create_dir_all(&folder).unwrap();
    let outside = elsewhere.path().join("conversations.json");
    fs::write(&outside, fixture("conversations.json")).unwrap();
    std::os::unix::fs::symlink(&outside, folder.join("conversations.json")).unwrap();
    assert!(inspect(&folder).is_err());
}

#[test]
fn export_ids_ignore_trailing_separators() {
    assert_eq!(export_id("/a/b/export.zip"), export_id("/a/b/export.zip/"));
    assert_ne!(export_id("/a/b/one.zip"), export_id("/a/b/two.zip"));
    assert_eq!(export_id("/a/b/one.zip").len(), 16);
}

#[test]
#[serial]
fn stats_names_resolve_through_the_export() {
    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();
    let project = project_named(&projects, "Release engineering");
    assert_eq!(project_name(&project.path), "Release engineering");
    assert_eq!(
        project_name_for_session(&session_of(project, PROJECT_CONVERSATION)),
        "Release engineering"
    );
    assert_eq!(project_name("claude-ai://nope/chats"), "Claude.ai");
}

/// Session statistics open a conversation (with no token usage recorded),
/// and the global summary never counts an export.
#[tokio::test]
#[serial]
async fn statistics_open_a_conversation_but_never_count_an_export() {
    use crate::commands::stats::{get_global_stats_summary, get_session_token_stats};
    use crate::models::TokenUsageRecording;

    let home = SandboxHome::new();
    zip_export(&home);
    let projects = scan_projects().unwrap();
    let session = session_of(project_named(&projects, "Claude.ai"), CHATS_CONVERSATION);

    let stats = get_session_token_stats(session, None, None, None)
        .await
        .unwrap();
    assert_eq!(stats.total_tokens, 0);
    assert_eq!(stats.message_count, 2);
    assert_eq!(stats.project_name, "Claude.ai");
    assert_ne!(stats.token_usage_recording, TokenUsageRecording::Recorded);

    let summary = get_global_stats_summary(
        home.path().join(".claude").to_string_lossy().to_string(),
        Some(vec![PROVIDER.to_string()]),
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(summary.total_sessions, 0);
    assert_eq!(summary.total_tokens, 0);
}
