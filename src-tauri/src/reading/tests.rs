use super::*;

#[test]
fn preparations_wait_for_the_active_render_instead_of_failing_busy() {
    let active = RENDER_LOCK.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let waiter = std::thread::spawn(move || {
        let result = acquire_render_slot();
        tx.send(result.is_ok()).unwrap();
    });
    assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    drop(active);
    assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap());
    waiter.join().unwrap();
}

#[test]
fn reading_font_scale_targets_the_minimal_body() {
    let html =
        "<html><head></head><body class='theme-minimal'><script>safe()</script></body></html>";
    let (document, _) = secure_document(html, &script_bodies(html).unwrap()).unwrap();
    assert!(
        document.contains("body.theme-minimal{font-size:calc(14px * var(--reading-font-scale,1))}")
    );
}

#[test]
fn capability_is_required_and_export_has_no_bridge_secret() {
    let service = Documents::default();
    let mut cache = service;
    let prepared = cache.insert("<!doctype html><p>safe</p>".into(), "test".into());
    assert!(cache.get(&prepared.document_id, "wrong").is_err());
    let entry = cache
        .get(&prepared.document_id, &prepared.capability)
        .unwrap();
    assert!(!entry.standalone.contains(&prepared.bridge_nonce));
}

#[test]
fn documents_expire_and_cache_is_bounded() {
    let mut cache = Documents::default();
    let first = cache.insert(
        "<html><head></head><body>first</body></html>".into(),
        "script-src 'none'".into(),
    );
    for _ in 0..5 {
        cache.insert(
            "<html><body>next</body></html>".into(),
            "script-src 'none'".into(),
        );
    }
    assert!(cache.entries.len() <= 4);
    assert!(cache.get(&first.document_id, &first.capability).is_err());
    let prepared = cache.insert(
        "<html><body>expire</body></html>".into(),
        "script-src 'none'".into(),
    );
    let entry = Arc::get_mut(cache.entries.get_mut(&prepared.document_id).unwrap()).unwrap();
    entry.created = Instant::now()
        .checked_sub(TTL + Duration::from_secs(1))
        .unwrap();
    assert!(cache
        .get(&prepared.document_id, &prepared.capability)
        .is_err());
}

#[test]
fn rejects_path_like_transcript_identifiers() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.jsonl");
    fs::write(&source, r#"{"toolUseResult":{"agentId":"../../outside"}}"#).unwrap();
    let mut output = fs::File::create(directory.path().join("staged.jsonl")).unwrap();
    assert!(copy_checked_records(fs::File::open(source).unwrap(), &mut output).is_err());
}

#[test]
fn scripts_must_match_the_trusted_baseline() {
    let trusted = script_bodies("<script>safe()</script>").unwrap();
    assert!(secure_document(
        "<html><head></head><body><script>safe()</script></body></html>",
        &trusted
    )
    .is_ok());
    assert!(secure_document(
        "<html><head></head><body><script>evil()</script></body></html>",
        &trusted
    )
    .is_err());
}

#[test]
fn snapshot_disables_polling_without_changing_conversation_text() {
    let guard = "if (location.protocol !== 'http:' && location.protocol !== 'https:') return;";
    let script = format!("(() => {{ {guard} fetch(location.href); }})();");
    let html =
        format!("<html><head></head><body><p>{guard}</p><script>{script}</script></body></html>");
    let trusted = script_bodies(&html).unwrap();
    let (document, _) = secure_document(&html, &trusted).unwrap();
    assert!(document.contains(&format!("<p>{guard}</p>")));
    assert!(document.contains("return; // Snapshot: refresh is owned by the host."));
}

#[test]
fn real_renderer_produces_a_script_verified_document() {
    let Ok(renderer) = executable() else { return };
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("session.jsonl");
    fs::write(&input, r#"{"type":"user","uuid":"11111111-1111-1111-1111-111111111111","sessionId":"22222222-2222-2222-2222-222222222222","timestamp":"2026-01-01T00:00:00Z","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/nonexistent-reading-fixture","version":"2.1.0","message":{"role":"user","content":"Reading smoke test"}}"#).unwrap();
    let html = render(&renderer, &input, temp.path()).unwrap();
    let scripts = script_bodies(&html).unwrap();
    assert!(!scripts.is_empty());
    let (document, policy) = secure_document(&html, &scripts).unwrap();
    assert!(document.contains("Reading smoke test"));
    assert!(policy.contains("sha256-"));
    assert!(!policy.contains("script-src 'unsafe-inline'"));
}

#[test]
fn stages_continuation_and_agent_sidecars_without_writing_sources() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let previous = source.path().join("previous.jsonl");
    let leaf = source.path().join("leaf.jsonl");
    fs::write(
        &previous,
        "{\"type\":\"user\",\"uuid\":\"previous-message\",\"message\":{\"content\":\"First\"}}\n",
    )
    .unwrap();
    fs::write(&leaf, "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary\",\"logicalParentUuid\":\"previous-message\"}\n{\"type\":\"user\",\"uuid\":\"last-message\",\"message\":{\"content\":\"Last\"}}\n").unwrap();
    let agents = source.path().join("leaf/subagents");
    fs::create_dir_all(&agents).unwrap();
    fs::write(agents.join("agent-a.jsonl"), "{}\n").unwrap();
    let original = fs::read(&leaf).unwrap();
    let source_root = source.path().canonicalize().unwrap();
    let leaf_canonical = leaf.canonicalize().unwrap();
    let staged = stage(&leaf_canonical, target.path(), &[source_root]).unwrap();
    let raw = fs::read_to_string(staged).unwrap();
    assert!(raw.find("First").unwrap() < raw.find("Last").unwrap());
    assert!(target
        .path()
        .join("reading/subagents/agent-a.jsonl")
        .is_file());
    assert!(target.path().join("leaf/subagents/agent-a.jsonl").is_file());
    assert_eq!(fs::read(leaf).unwrap(), original);
}

#[test]
fn continuation_counts_legacy_agents_only_once() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let root = source.path().canonicalize().unwrap();
    fs::write(
        root.join("previous.jsonl"),
        "{\"type\":\"user\",\"uuid\":\"previous-message\",\"agentId\":\"legacy\"}\n",
    )
    .unwrap();
    let leaf = root.join("leaf.jsonl");
    fs::write(&leaf, "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary\",\"logicalParentUuid\":\"previous-message\"}\n").unwrap();
    fs::write(
        root.join("agent-legacy.jsonl"),
        format!("{{\"padding\":\"{}\"}}\n", "x".repeat(1000)),
    )
    .unwrap();
    assert!(stage_with_limit(&leaf, target.path(), &[root], 1600).is_ok());
    assert!(target.path().join("agent-legacy.jsonl").is_file());
}

#[test]
fn reading_paths_reject_non_jsonl_and_symlinks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.txt");
    std::fs::write(&path, "{}").unwrap();
    assert!(validate_source(&path, &[dir.path().to_path_buf()]).is_err());
    #[cfg(unix)]
    {
        let target = dir.path().join("real.jsonl");
        std::fs::write(&target, "{}").unwrap();
        let link = dir.path().join("link.jsonl");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(validate_source(&link, &[dir.path().to_path_buf()]).is_err());
        assert!(validate_source(&target, &[dir.path().to_path_buf()]).is_ok());
    }
}
