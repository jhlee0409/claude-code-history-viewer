use super::*;

#[test]
fn application_identifiers_are_not_loader_paths() {
    let source = tempfile::tempdir().unwrap();
    let input = source.path().join("session.jsonl");
    let record = r#"{"sessionId":"session","message":{"content":[{"type":"tool_use","id":"call","input":{"sessionId":"customer/123","runId":"release.2026","agentId":"app/agent"}}]},"toolUseResult":{"data":{"sessionId":"customer/123","runId":"release.2026"}}}"#;
    fs::write(&input, record).unwrap();
    let mut output = fs::File::create(source.path().join("output.jsonl")).unwrap();
    copy_checked_records(fs::File::open(&input).unwrap(), &mut output).unwrap();
    assert_eq!(
        fs::read_to_string(source.path().join("output.jsonl")).unwrap(),
        format!("{record}\n")
    );
}

#[test]
fn actual_loader_identifiers_still_reject_traversal() {
    for record in [
        r#"{"sessionId":"../outside"}"#,
        r#"{"agentId":"../outside"}"#,
        r#"{"spawnedAgentId":"../outside"}"#,
        r#"{"toolUseResult":{"agentId":"../outside"}}"#,
    ] {
        let source = tempfile::tempdir().unwrap();
        let input = source.path().join("session.jsonl");
        fs::write(&input, record).unwrap();
        let mut output = fs::File::create(source.path().join("output.jsonl")).unwrap();
        assert!(copy_checked_records(fs::File::open(&input).unwrap(), &mut output).is_err());
    }
}

#[test]
fn stages_workflow_snapshots_with_and_without_journals() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let input = root.join("session.jsonl");
    fs::write(&input, "{}\n").unwrap();
    fs::create_dir_all(root.join("session/subagents/workflows/run-a")).unwrap();
    fs::create_dir_all(root.join("session/workflows")).unwrap();
    fs::write(
        root.join("session/subagents/workflows/run-a/journal.jsonl"),
        "{\"agentId\":\"worker\",\"result\":{\"runId\":\"app/value\"}}\n",
    )
    .unwrap();
    for run in ["run-a", "run-b"] {
        let snapshot = format!(
            "{{\"runId\":\"{run}\",\"status\":\"failed\",\"summary\":\"authoritative snapshot\"}}"
        );
        fs::write(
            root.join(format!("session/workflows/{run}.json")),
            &snapshot,
        )
        .unwrap();
    }
    stage(&input, target.path(), &[root]).unwrap();
    for stem in ["session", "reading"] {
        for run in ["run-a", "run-b"] {
            assert!(target
                .path()
                .join(format!("{stem}/workflows/{run}.json"))
                .is_file());
        }
        assert!(target
            .path()
            .join(format!("{stem}/subagents/workflows/run-a/journal.jsonl"))
            .is_file());
    }
}

#[test]
fn stages_only_referenced_legacy_agents_recursively() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let input = root.join("session.jsonl");
    fs::write(&input, "{\"toolUseResult\":{\"agentId\":\"parent\"}}\n").unwrap();
    fs::write(
        root.join("agent-parent.jsonl"),
        "{\"spawnedAgentId\":\"child\"}\n",
    )
    .unwrap();
    fs::write(root.join("agent-child.jsonl"), "{}\n").unwrap();
    fs::write(
        root.join("agent-unrelated.jsonl"),
        "malformed unrelated session",
    )
    .unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.join("missing.jsonl"), root.join("agent-symlink.jsonl"))
        .unwrap();
    stage(&input, target.path(), &[root]).unwrap();
    assert!(target.path().join("agent-parent.jsonl").is_file());
    assert!(target.path().join("agent-child.jsonl").is_file());
    assert!(!target.path().join("agent-unrelated.jsonl").exists());
    assert!(!target.path().join("agent-symlink.jsonl").exists());
}

#[test]
fn legacy_metadata_links_follow_tool_uses_recursively() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let input = root.join("session.jsonl");
    fs::write(
        &input,
        "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"spawn-parent\"}]}}\n",
    )
    .unwrap();
    fs::write(
        root.join("agent-parent.meta.json"),
        r#"{"toolUseId":"spawn-parent"}"#,
    )
    .unwrap();
    fs::write(
        root.join("agent-parent.jsonl"),
        "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"spawn-child\"}]}}\n",
    )
    .unwrap();
    fs::write(
        root.join("agent-child.meta.json"),
        r#"{"toolUseId":"spawn-child"}"#,
    )
    .unwrap();
    fs::write(root.join("agent-child.jsonl"), "{}\n").unwrap();
    fs::write(root.join("agent-unrelated.meta.json"), "broken metadata").unwrap();
    fs::write(root.join("agent-unrelated.jsonl"), "broken transcript").unwrap();
    stage(&input, target.path(), &[root]).unwrap();
    for name in [
        "agent-parent.jsonl",
        "agent-parent.meta.json",
        "agent-child.jsonl",
        "agent-child.meta.json",
    ] {
        assert!(target.path().join(name).is_file(), "missing {name}");
    }
    assert!(!target.path().join("agent-unrelated.jsonl").exists());
}

#[test]
fn supporting_bytes_are_counted_once_across_agent_discovery_paths() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let input = root.join("session.jsonl");
    let transcript = "{\"toolUseResult\":{\"agentId\":\"parent\"}}\n";
    let agent = format!(
        "{{\"padding\":\"{}\",\"agentId\":\"parent\"}}\n",
        "x".repeat(1000)
    );
    fs::write(&input, transcript).unwrap();
    fs::write(root.join("agent-parent.jsonl"), &agent).unwrap();
    stage_with_limit(
        &input,
        target.path(),
        &[root],
        (transcript.len() + agent.len()) as u64,
    )
    .unwrap();
}

#[test]
fn modern_agent_and_metadata_bytes_are_counted_once() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let input = root.join("session.jsonl");
    let transcript = "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"spawn\"}]}}\n";
    let agent = format!("{{\"padding\":\"{}\"}}\n", "x".repeat(1000));
    let metadata = r#"{"toolUseId":"spawn"}"#;
    fs::write(&input, transcript).unwrap();
    fs::create_dir_all(root.join("session/subagents")).unwrap();
    fs::write(root.join("session/subagents/agent-worker.jsonl"), &agent).unwrap();
    fs::write(
        root.join("session/subagents/agent-worker.meta.json"),
        metadata,
    )
    .unwrap();
    stage_with_limit(
        &input,
        target.path(),
        &[root],
        (transcript.len() + agent.len() + metadata.len()) as u64,
    )
    .unwrap();
    for stem in ["session", "reading"] {
        assert!(target
            .path()
            .join(format!("{stem}/subagents/agent-worker.jsonl"))
            .is_file());
        assert!(target
            .path()
            .join(format!("{stem}/subagents/agent-worker.meta.json"))
            .is_file());
    }
}

#[test]
fn real_renderer_retains_legacy_meta_agents_and_snapshot_only_workflows() {
    let Ok(renderer) = executable() else { return };
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    let sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    let input = root.join(format!("{sid}.jsonl"));
    let row = |uuid: &str,
               kind: &str,
               content: serde_json::Value,
               parent: Option<&str>,
               sidechain: bool| {
        let mut row = serde_json::json!({"type":kind,"uuid":uuid,"sessionId":sid,"timestamp":"2026-01-01T00:00:00Z","parentUuid":parent,"isSidechain":sidechain,"userType":"external","cwd":"/nonexistent-reading-fixture","version":"2.1.0","message":{"role":kind,"content":content}});
        if kind == "assistant" {
            row["message"]["id"] = serde_json::json!(format!("msg-{uuid}"));
            row["message"]["type"] = serde_json::json!("message");
            row["message"]["model"] = serde_json::json!("fixture-model");
        }
        if sidechain {
            row["agentId"] = serde_json::json!("worker");
        }
        row
    };
    let records = [
        row(
            "start",
            "user",
            serde_json::json!("SOURCE_INTEGRATION_START"),
            None,
            false,
        ),
        row(
            "spawn",
            "assistant",
            serde_json::json!([{"type":"tool_use","id":"spawn-worker","name":"Task","input":{"prompt":"source investigation","sessionId":"customer/123","runId":"release.2026"}}]),
            Some("start"),
            false,
        ),
        row(
            "result",
            "user",
            serde_json::json!([{"type":"tool_result","tool_use_id":"spawn-worker","content":"done"}]),
            Some("spawn"),
            false,
        ),
        row(
            "workflow",
            "assistant",
            serde_json::json!([{"type":"tool_use","id":"workflow-run","name":"Workflow","input":{"script":"return 'test'"}}]),
            Some("result"),
            false,
        ),
        row(
            "workflow-result",
            "user",
            serde_json::json!([{"type":"tool_result","tool_use_id":"workflow-run","content":"Task ID: snapshot-task"}]),
            Some("workflow"),
            false,
        ),
    ];
    let mut transcript = fs::File::create(&input).unwrap();
    for row in records {
        writeln!(transcript, "{row}").unwrap();
    }
    fs::write(
        root.join("agent-worker.meta.json"),
        r#"{"toolUseId":"spawn-worker"}"#,
    )
    .unwrap();
    let agent = row(
        "agent-answer",
        "assistant",
        serde_json::json!([{"type":"text","text":"SOURCE_LEGACY_AGENT_ANSWER"}]),
        None,
        true,
    );
    fs::write(root.join("agent-worker.jsonl"), format!("{agent}\n")).unwrap();
    fs::write(root.join("agent-unrelated.jsonl"), "not valid json").unwrap();
    fs::create_dir_all(root.join(sid).join("workflows")).unwrap();
    fs::write(root.join(sid).join("workflows/snapshot.json"), r#"{"runId":"snapshot","taskId":"snapshot-task","workflowName":"SOURCE_WORKFLOW_SNAPSHOT","status":"failed","summary":"SOURCE_SNAPSHOT_FAILURE","error":"snapshot-only failure"}"#).unwrap();
    let staged = stage(&input, target.path(), &[root]).unwrap();
    let html = render(&renderer, &staged, target.path()).unwrap();
    for marker in [
        "SOURCE_INTEGRATION_START",
        "SOURCE_LEGACY_AGENT_ANSWER",
        "SOURCE_WORKFLOW_SNAPSHOT",
        "SOURCE_SNAPSHOT_FAILURE",
    ] {
        assert!(html.contains(marker), "renderer omitted {marker}");
    }
}

#[test]
fn metadata_confinement_canonicalizes_configured_root_aliases() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let input = source.path().join("session.jsonl");
    fs::write(&input, "{}\n").unwrap();
    fs::create_dir_all(source.path().join("session/subagents")).unwrap();
    fs::write(
        source
            .path()
            .join("session/subagents/agent-worker.meta.json"),
        "{}",
    )
    .unwrap();
    let alias = source.path().join(".");
    stage(&input, target.path(), &[alias]).unwrap();
}

#[test]
#[cfg(unix)]
fn referenced_legacy_agents_and_workflow_snapshots_reject_symlinks() {
    for workflow in [false, true] {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let root = source.path().canonicalize().unwrap();
        let input = root.join("session.jsonl");
        fs::write(&input, "{\"agentId\":\"worker\"}\n").unwrap();
        let real = root.join("real.jsonl");
        fs::write(&real, "{}\n").unwrap();
        if workflow {
            fs::create_dir_all(root.join("session/workflows")).unwrap();
            std::os::unix::fs::symlink(&real, root.join("session/workflows/run.json")).unwrap();
        } else {
            std::os::unix::fs::symlink(&real, root.join("agent-worker.jsonl")).unwrap();
        }
        assert!(stage(&input, target.path(), &[root]).is_err());
    }
}
