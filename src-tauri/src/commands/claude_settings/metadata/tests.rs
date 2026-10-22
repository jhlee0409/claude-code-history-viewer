use super::*;
use serde_json::{json, Value};
use std::path::Path;
use tempfile::TempDir;

const SCOPES: [&str; 4] = ["user", "project", "local", "managed"];
fn fixture_path(root: &Path, scope: &str) -> PathBuf {
    root.join(scope).join("settings.json")
}
fn fixture_response(root: &Path) -> Value {
    serde_json::to_value(collect_settings(
        Some(root.to_path_buf()),
        Some("selected"),
        true,
        |scope| Ok(fixture_path(root, scope)),
    ))
    .unwrap()
}

#[test]
fn settings_metadata_all_resolved_scopes_preserve_raw_bytes_and_missing_evidence() {
    let temp = TempDir::new().unwrap();
    let absent = fixture_response(temp.path());
    assert_eq!(
        fs::read_dir(temp.path()).unwrap().count(),
        0,
        "reading must not create parents"
    );
    for scope in SCOPES {
        assert_eq!(absent[scope], "{}");
        assert_eq!(
            absent["metadata"]["scopes"][scope],
            json!({
                "path": fixture_path(temp.path(), scope), "state": "missing", "readOnly": scope == "managed"
            })
        );
        fs::create_dir(temp.path().join(scope)).unwrap();
    }
    for raw in [
        "{}",
        "",
        "null",
        "9007199254740993",
        "{invalid",
        " \n{\"env\":{\"A\":\"B\"}}\n",
    ] {
        for scope in SCOPES {
            fs::write(fixture_path(temp.path(), scope), raw).unwrap();
        }
        let result = fixture_response(temp.path());
        for scope in SCOPES {
            assert_eq!(result[scope], raw);
            assert_eq!(
                result[scope],
                super::super::read_settings_file(&fixture_path(temp.path(), scope)).unwrap()
            );
            assert_eq!(result["metadata"]["scopes"][scope]["state"], "present");
            assert_eq!(
                fs::read_to_string(fixture_path(temp.path(), scope)).unwrap(),
                raw
            );
            assert_eq!(fs::read_dir(temp.path().join(scope)).unwrap().count(), 1);
        }
    }
}

#[test]
fn settings_metadata_unavailable_and_resolver_errors_never_fabricate_paths() {
    let temp = TempDir::new().unwrap();
    let calls = std::cell::RefCell::new(Vec::new());
    let result = serde_json::to_value(collect_settings(None, None, false, |scope| {
        calls.borrow_mut().push(scope.to_owned());
        Err("no home".into())
    }))
    .unwrap();
    assert_eq!(*calls.borrow(), vec!["user"]);
    assert_eq!(result["metadata"]["serverHome"], Value::Null);
    for (scope, state) in [
        ("user", "resolve_error"),
        ("project", "no_project"),
        ("local", "no_project"),
        ("managed", "unsupported"),
    ] {
        assert_eq!(result[scope], Value::Null);
        assert_eq!(
            result["metadata"]["scopes"][scope],
            json!({"path":null,"state":state,"readOnly":scope=="managed"})
        );
    }
    let failed = serde_json::to_value(collect_settings(
        Some(temp.path().to_path_buf()),
        Some("invalid"),
        true,
        |_| Err("resolver error".into()),
    ))
    .unwrap();
    for scope in SCOPES {
        assert_eq!(failed[scope], Value::Null);
        assert_eq!(
            failed["metadata"]["scopes"][scope]["state"],
            "resolve_error"
        );
        assert_eq!(failed["metadata"]["scopes"][scope]["path"], Value::Null);
    }
}

#[test]
fn settings_metadata_read_errors_are_distinct_from_missing_and_keep_legacy_contents() {
    let temp = TempDir::new().unwrap();
    for scope in SCOPES {
        fs::create_dir(temp.path().join(scope)).unwrap();
    }
    fs::write(fixture_path(temp.path(), "user"), [0xff]).unwrap();
    fs::create_dir(fixture_path(temp.path(), "project")).unwrap();
    // Non-directory parent: legacy exists() was false and returned "{}", but
    // this is an observation failure, not proof the settings target is missing.
    let blocked_parent = temp.path().join("blocked");
    fs::write(&blocked_parent, "parent file").unwrap();
    let result = serde_json::to_value(collect_settings(
        Some(temp.path().into()),
        Some("selected"),
        true,
        |scope| {
            Ok(if scope == "local" {
                blocked_parent.join("settings.json")
            } else {
                fixture_path(temp.path(), scope)
            })
        },
    ))
    .unwrap();
    for scope in ["user", "project"] {
        assert_eq!(result[scope], Value::Null);
        assert_eq!(result["metadata"]["scopes"][scope]["state"], "read_error");
    }
    assert_eq!(result["local"], "{}");
    assert_eq!(result["metadata"]["scopes"]["local"]["state"], "read_error");
    assert_eq!(result["managed"], "{}");
    assert_eq!(result["metadata"]["scopes"]["managed"]["state"], "missing");
}

#[cfg(unix)]
#[test]
fn settings_metadata_permission_failure_is_read_error_not_missing() {
    use std::os::unix::fs::PermissionsExt;
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("unreadable.json");
    fs::write(&file, "{}").unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
    let old = super::super::read_settings_file(&file);
    let result = serde_json::to_value(collect_settings(
        Some(temp.path().into()),
        Some("selected"),
        true,
        |_| Ok(file.clone()),
    ))
    .unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(
        old.is_err(),
        "fixture must really be unreadable (do not run as root)"
    );
    for scope in SCOPES {
        assert_eq!(result[scope], Value::Null);
        assert_eq!(result["metadata"]["scopes"][scope]["state"], "read_error");
    }
}

#[cfg(unix)]
#[test]
fn settings_metadata_fifo_is_rejected_without_opening_a_blocking_reader() {
    let temp = TempDir::new().unwrap();
    let fifo = temp.path().join("fifo.json");
    assert!(std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    let result = serde_json::to_value(collect_settings(
        Some(temp.path().into()),
        Some("selected"),
        true,
        |_| Ok(fifo.clone()),
    ))
    .unwrap();
    for scope in SCOPES {
        assert_eq!(result[scope], Value::Null);
        assert_eq!(result["metadata"]["scopes"][scope]["state"], "read_error");
    }
}

#[cfg(unix)]
#[test]
fn settings_metadata_regular_and_dangling_file_symlinks_keep_write_target_spelling() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let original = temp.path().join("original.json");
    let alias = temp.path().join("alias.json");
    fs::write(&original, "null").unwrap();
    symlink(&original, &alias).unwrap();
    let collect = || {
        serde_json::to_value(collect_settings(
            Some(temp.path().into()),
            Some("selected"),
            true,
            |_| Ok(alias.clone()),
        ))
        .unwrap()
    };
    let result = collect();
    assert_eq!(result["user"], "null");
    assert_eq!(result["metadata"]["scopes"]["user"]["path"], json!(alias));
    assert_eq!(result["metadata"]["scopes"]["user"]["state"], "present");
    fs::rename(&original, temp.path().join("held.json")).unwrap();
    let dangling = collect();
    assert_eq!(dangling["user"], "{}");
    assert_eq!(dangling["metadata"]["scopes"]["user"]["state"], "missing");
    assert!(fs::symlink_metadata(&alias)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn settings_metadata_actual_project_resolver_preserves_missing_roots_and_rejects_traversal() {
    let temp = TempDir::new().unwrap();
    for project in [
        temp.path().join("missing-parent/project"),
        temp.path().to_path_buf(),
    ] {
        let expected = super::super::get_settings_path("project", project.to_str()).unwrap();
        let result = serde_json::to_value(collect_settings(
            Some(temp.path().into()),
            project.to_str(),
            false,
            |scope| {
                if scope == "user" {
                    Ok(temp.path().join("user.json"))
                } else {
                    super::super::get_settings_path(scope, project.to_str())
                }
            },
        ))
        .unwrap();
        assert_eq!(
            result["metadata"]["scopes"]["project"]["path"],
            json!(expected)
        );
        assert_eq!(result["metadata"]["scopes"]["project"]["state"], "missing");
        assert!(!project.join(".claude").exists());
    }
    for invalid in [
        "relative/project".to_owned(),
        temp.path().join("../escape").to_string_lossy().into_owned(),
    ] {
        let result = serde_json::to_value(collect_settings(
            Some(temp.path().into()),
            Some(&invalid),
            false,
            |scope| {
                if scope == "user" {
                    Ok(temp.path().join("user.json"))
                } else {
                    super::super::get_settings_path(scope, Some(&invalid))
                }
            },
        ))
        .unwrap();
        for scope in ["project", "local"] {
            assert_eq!(result[scope], Value::Null);
            assert_eq!(
                result["metadata"]["scopes"][scope]["state"],
                "resolve_error"
            );
            assert_eq!(result["metadata"]["scopes"][scope]["path"], Value::Null);
        }
    }
}

#[cfg(unix)]
#[test]
fn settings_metadata_actual_resolver_canonicalizes_only_existing_project_roots() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let real = temp.path().join("real");
    let alias = temp.path().join("alias");
    fs::create_dir(&real).unwrap();
    symlink(&real, &alias).unwrap();
    for project in [&alias, &alias.join("not-created")] {
        let expected_root = if project.exists() {
            fs::canonicalize(project).unwrap()
        } else {
            project.clone()
        };
        let result = serde_json::to_value(collect_settings(
            Some(temp.path().into()),
            project.to_str(),
            false,
            |scope| {
                if scope == "user" {
                    Ok(temp.path().join("user.json"))
                } else {
                    super::super::get_settings_path(scope, project.to_str())
                }
            },
        ))
        .unwrap();
        for (scope, filename) in [
            ("project", "settings.json"),
            ("local", "settings.local.json"),
        ] {
            assert_eq!(
                result["metadata"]["scopes"][scope]["path"],
                json!(expected_root.join(".claude").join(filename))
            );
        }
    }
    assert!(!real.join(".claude").exists());
}

#[test]
fn settings_metadata_old_four_field_responses_still_deserialize() {
    let old: AllSettings =
        serde_json::from_value(json!({"user":"42","project":null,"local":"null","managed":"{}"}))
            .unwrap();
    assert!(old.metadata.is_none());
    assert_eq!(old.user.as_deref(), Some("42"));
    assert_eq!(old.local.as_deref(), Some("null"));
}
