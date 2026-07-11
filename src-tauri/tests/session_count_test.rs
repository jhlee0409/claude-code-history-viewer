// Regression test for project tree session count.
// Run: cargo test --test session_count_test -- --nocapture
//
// Bug: scan_projects counted every recursive *.jsonl, including sidechain/
// subagent files stored under `<project>/<session-uuid>/subagents/`. That
// inflated the project tree's session_count relative to load_project_sessions,
// which excludes sidechains. Fix: only top-level *.jsonl count as sessions.

#[cfg(test)]
mod session_count_tests {
    use claude_code_history_viewer_lib::commands;
    use std::fs;
    use tempfile::TempDir;

    fn jsonl_line(session_id: &str) -> String {
        format!(
            r#"{{"type":"user","sessionId":"{session_id}","timestamp":"2025-01-01T00:00:00Z","message":{{"role":"user","content":"hi"}}}}"#
        )
    }

    /// Build a `.claude/projects/test-proj` dir with `top_level` main sessions
    /// plus `sidechain` sidechain/subagent jsonl nested one level down, then
    /// return the `session_count` that `scan_projects` reports for that project.
    async fn counted_sessions(top_level: usize, sidechain: usize) -> usize {
        let temp = TempDir::new().expect("temp dir");
        let project_dir = temp
            .path()
            .join(".claude")
            .join("projects")
            .join("test-proj");
        fs::create_dir_all(&project_dir).expect("create project dir");

        // Top-level main sessions.
        for i in 0..top_level {
            let p = project_dir.join(format!("sess-{i}.jsonl"));
            fs::write(&p, jsonl_line(&format!("sess-{i}"))).expect("write main jsonl");
        }

        // Sidechain files one level down: <project>/<uuid>/subagents/*.jsonl
        // Mirrors Claude Code's native layout (see utils::find_subagent_files).
        if sidechain > 0 {
            let sub_dir = project_dir
                .join("00000000-0000-4000-8000-000000000000")
                .join("subagents");
            fs::create_dir_all(&sub_dir).expect("create subagents dir");
            for i in 0..sidechain {
                let p = sub_dir.join(format!("agent-{i}.jsonl"));
                fs::write(&p, jsonl_line(&format!("agent-{i}"))).expect("write sidechain jsonl");
            }
        }

        let claude_path = temp.path().join(".claude").to_string_lossy().to_string();
        let projects = commands::project::scan_projects(claude_path)
            .await
            .expect("scan_projects failed");

        projects
            .iter()
            .find(|p| p.name == "test-proj")
            .map(|p| p.session_count)
            .unwrap_or(0)
    }

    #[tokio::test]
    async fn sidechain_files_are_not_counted_as_sessions() {
        // Before the fix this returned 2 + 3 = 5 (recursive count).
        // After the fix only the 2 top-level sessions count.
        let count = counted_sessions(2, 3).await;
        assert_eq!(
            count, 2,
            "session_count must exclude sidechain/subagent jsonl in subdirectories"
        );
    }

    #[tokio::test]
    async fn only_top_level_sessions_are_counted() {
        let count = counted_sessions(4, 10).await;
        assert_eq!(count, 4);
    }

    #[tokio::test]
    async fn project_with_no_top_level_sessions_is_skipped() {
        // A dir containing only sidechain files has no main session and should
        // not appear at all (session_count == 0 -> continue).
        let temp = TempDir::new().expect("temp dir");
        let project_dir = temp
            .path()
            .join(".claude")
            .join("projects")
            .join("test-proj");
        let sub_dir = project_dir.join("subagents");
        fs::create_dir_all(&sub_dir).expect("create subagents dir");
        fs::write(sub_dir.join("agent-0.jsonl"), jsonl_line("agent-0"))
            .expect("write sidechain jsonl");

        let claude_path = temp.path().join(".claude").to_string_lossy().to_string();
        let projects = commands::project::scan_projects(claude_path)
            .await
            .expect("scan_projects failed");

        assert!(
            !projects.iter().any(|p| p.name == "test-proj"),
            "a project with only sidechain files should be skipped"
        );
    }
}
