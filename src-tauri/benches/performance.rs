//! Performance benchmarks for Claude Code History Viewer
//!
//! Run with: `cargo bench --bench performance`
//! Compare baselines: `cargo bench --bench performance -- --save-baseline NAME`
//! Compare: `cargo bench --bench performance -- --baseline OLD --load-baseline NEW`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use serde_json::json;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tempfile::TempDir;
use uuid::Uuid;

/// Generate a sample JSONL file with the specified number of messages
fn generate_sample_jsonl(dir: &TempDir, filename: &str, message_count: usize) -> PathBuf {
    let file_path = dir.path().join(filename);
    let mut file = File::create(&file_path).expect("Failed to create test file");

    let session_id = Uuid::new_v4().to_string();

    for i in 0..message_count {
        let uuid = Uuid::new_v4().to_string();
        let timestamp = format!("2025-01-{:02}T{:02}:00:00.000Z", (i % 28) + 1, i % 24);

        // Alternate between user and assistant messages
        let entry = if i % 2 == 0 {
            // User message
            json!({
                "uuid": uuid,
                "sessionId": session_id,
                "timestamp": timestamp,
                "type": "user",
                "message": {
                    "role": "user",
                    "content": format!("User message number {} with some additional content to make it realistic. This is a test message for benchmarking purposes.", i)
                }
            })
        } else {
            // Assistant message with usage
            json!({
                "uuid": uuid,
                "sessionId": session_id,
                "timestamp": timestamp,
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": format!("Assistant response number {}. Here is a detailed response with some code:\n\n```rust\nfn main() {{\n    println!(\"Hello, world!\");\n}}\n```\n\nThis should help with your request.", i)
                        }
                    ],
                    "id": format!("msg_{}", uuid),
                    "model": "claude-opus-4-20250514",
                    "stop_reason": "end_turn",
                    "usage": {
                        "input_tokens": 100 + (i % 500) as u32,
                        "output_tokens": 200 + (i % 300) as u32,
                        "cache_creation_input_tokens": 50,
                        "cache_read_input_tokens": 25
                    }
                }
            })
        };

        writeln!(file, "{}", serde_json::to_string(&entry).unwrap())
            .expect("Failed to write to file");
    }

    // Add a summary message at the end
    let summary = json!({
        "type": "summary",
        "summary": "This is a test session with multiple messages for benchmarking",
        "leafUuid": Uuid::new_v4().to_string()
    });
    writeln!(file, "{}", serde_json::to_string(&summary).unwrap())
        .expect("Failed to write summary");

    file_path
}

/// Generate a project structure with multiple sessions
fn generate_project_structure(
    base_dir: &TempDir,
    session_count: usize,
    messages_per_session: usize,
) -> PathBuf {
    let projects_dir = base_dir.path().join("projects");
    let project_dir = projects_dir.join("test-project");
    fs::create_dir_all(&project_dir).expect("Failed to create project directory");

    for i in 0..session_count {
        let filename = format!("session_{i}.jsonl");
        let session_path = project_dir.join(&filename);
        let mut file = File::create(&session_path).expect("Failed to create session file");

        let session_id = Uuid::new_v4().to_string();

        for j in 0..messages_per_session {
            let uuid = Uuid::new_v4().to_string();
            let timestamp = format!(
                "2025-01-{:02}T{:02}:{:02}:00.000Z",
                (j % 28) + 1,
                j % 24,
                j % 60
            );

            let entry = if j % 2 == 0 {
                json!({
                    "uuid": uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": format!("Message {} in session {}", j, i)
                    }
                })
            } else {
                json!({
                    "uuid": uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{
                            "type": "text",
                            "text": format!("Response {} in session {}", j, i)
                        }],
                        "usage": {
                            "input_tokens": 100,
                            "output_tokens": 200
                        }
                    }
                })
            };

            writeln!(file, "{}", serde_json::to_string(&entry).unwrap())
                .expect("Failed to write message");
        }
    }

    base_dir.path().to_path_buf()
}

/// Generate a project structure with edit operations for recent edits benchmarks
fn generate_project_with_edits(
    base_dir: &TempDir,
    session_count: usize,
    edits_per_session: usize,
) -> PathBuf {
    let projects_dir = base_dir.path().join("projects");
    let project_dir = projects_dir.join("test-project");
    fs::create_dir_all(&project_dir).expect("Failed to create project directory");

    let cwd = "/Users/test/project";

    for i in 0..session_count {
        let filename = format!("session_{i}.jsonl");
        let session_path = project_dir.join(&filename);
        let mut file = File::create(&session_path).expect("Failed to create session file");

        let session_id = Uuid::new_v4().to_string();

        for j in 0..edits_per_session {
            let uuid = Uuid::new_v4().to_string();
            let timestamp = format!(
                "2025-01-{:02}T{:02}:{:02}:00.000Z",
                (j % 28) + 1,
                j % 24,
                j % 60
            );
            let file_path = format!("{}/src/file_{}.rs", cwd, j % 10);

            // Create a mix of edit and write operations
            let entry = if j % 3 == 0 {
                // Write operation
                json!({
                    "uuid": uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "assistant",
                    "cwd": cwd,
                    "toolUseResult": {
                        "type": "create",
                        "filePath": file_path,
                        "content": format!("// File content for edit {}\nfn main() {{\n    println!(\"Hello\");\n}}\n", j)
                    },
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": "Created file" }]
                    }
                })
            } else if j % 3 == 1 {
                // Edit operation with edits array
                json!({
                    "uuid": uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "assistant",
                    "cwd": cwd,
                    "toolUseResult": {
                        "filePath": file_path,
                        "edits": [{
                            "old_string": "println!(\"Hello\");",
                            "new_string": format!("println!(\"Modified {}\");", j)
                        }],
                        "originalFile": "// Original content\nfn main() {\n    println!(\"Hello\");\n}\n"
                    },
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": "Edited file" }]
                    }
                })
            } else {
                // Regular assistant message with usage
                json!({
                    "uuid": uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "assistant",
                    "cwd": cwd,
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": format!("Response {}", j) }],
                        "usage": {
                            "input_tokens": 150 + (j % 200) as u32,
                            "output_tokens": 250 + (j % 150) as u32,
                            "cache_creation_input_tokens": 50,
                            "cache_read_input_tokens": 25
                        }
                    }
                })
            };

            writeln!(file, "{}", serde_json::to_string(&entry).unwrap())
                .expect("Failed to write message");
        }
    }

    base_dir.path().to_path_buf()
}

/// Benchmark: Load session messages (full)
fn bench_load_session_messages(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("load_session_messages");

    for size in &[100, 500, 1000, 5000] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let file_path = generate_sample_jsonl(&temp_dir, "test.jsonl", *size);
        let path_str = file_path.to_string_lossy().to_string();

        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                rt.block_on(async {
                    claude_code_history_viewer_lib::commands::session::load_session_messages(
                        black_box(path_str.clone()),
                    )
                    .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark: Load session messages paginated
fn bench_load_session_messages_paginated(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("load_session_messages_paginated");

    // Test with 1000 messages, varying page sizes
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let file_path = generate_sample_jsonl(&temp_dir, "test.jsonl", 1000);
    let path_str = file_path.to_string_lossy().to_string();

    for page_size in &[50, 100, 200] {
        group.throughput(Throughput::Elements(*page_size as u64));
        group.bench_with_input(
            BenchmarkId::new("page_size", page_size),
            page_size,
            |b, &size| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::session::load_session_messages_paginated(
                            black_box(path_str.clone()),
                            black_box(0),
                            black_box(size),
                            black_box(Some(false)),
                        )
                        .await
                    })
                });
            },
        );
    }

    // Test pagination at different offsets
    for offset in &[0, 100, 500, 900] {
        group.bench_with_input(
            BenchmarkId::new("offset", offset),
            offset,
            |b, &off| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::session::load_session_messages_paginated(
                            black_box(path_str.clone()),
                            black_box(off),
                            black_box(50),
                            black_box(Some(false)),
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

/// Benchmark: Get session message count
fn bench_get_session_message_count(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_session_message_count");

    for size in &[100, 500, 1000, 5000] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let file_path = generate_sample_jsonl(&temp_dir, "test.jsonl", *size);
        let path_str = file_path.to_string_lossy().to_string();

        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                rt.block_on(async {
                    claude_code_history_viewer_lib::commands::session::get_session_message_count(
                        black_box(path_str.clone()),
                        black_box(Some(false)),
                    )
                    .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark: Search messages
fn bench_search_messages(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("search_messages");

    // Create a project structure for search
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let base_path = generate_project_structure(&temp_dir, 10, 100); // 10 sessions, 100 msgs each

    // Search queries of varying complexity
    let queries = [
        ("simple", "Message"),
        ("number", "42"),
        ("not_found", "xyznonexistent"),
        ("partial", "sess"),
    ];

    for (name, query) in &queries {
        group.bench_with_input(BenchmarkId::new("query", name), query, |b, &q| {
            b.iter(|| {
                rt.block_on(async {
                    claude_code_history_viewer_lib::commands::session::search_messages(
                        black_box(base_path.to_string_lossy().to_string()),
                        black_box(q.to_string()),
                        black_box(serde_json::json!({})),
                        None,
                    )
                    .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark: Load project sessions
fn bench_load_project_sessions(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("load_project_sessions");

    for session_count in &[5, 10, 50] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = generate_project_structure(&temp_dir, *session_count, 50);
        let project_path = base_path.join("projects").join("test-project");
        let path_str = project_path.to_string_lossy().to_string();

        group.bench_with_input(
            BenchmarkId::from_parameter(session_count),
            session_count,
            |b, _| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::session::load_project_sessions(
                            black_box(path_str.clone()),
                            black_box(Some(false)),
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

/// Benchmark: Get project stats summary
fn bench_get_project_stats_summary(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_project_stats_summary");

    for session_count in &[5, 10, 20] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = generate_project_structure(&temp_dir, *session_count, 100);
        let project_path = base_path.join("projects").join("test-project");
        let path_str = project_path.to_string_lossy().to_string();

        group.bench_with_input(
            BenchmarkId::from_parameter(session_count),
            session_count,
            |b, _| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::stats::get_project_stats_summary(
                            black_box(path_str.clone()),
                            black_box(None),
                            black_box(None),
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

/// Benchmark: Get global stats summary
fn bench_get_global_stats_summary(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_global_stats_summary");
    group.sample_size(10); // Reduce sample size for slow benchmarks

    // Create multiple projects
    for project_count in &[3, 5] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let projects_dir = temp_dir.path().join("projects");
        fs::create_dir_all(&projects_dir).expect("Failed to create projects dir");

        for p in 0..*project_count {
            let project_dir = projects_dir.join(format!("project_{p}"));
            fs::create_dir_all(&project_dir).expect("Failed to create project dir");

            for s in 0..5 {
                // 5 sessions per project
                let filename = format!("session_{s}.jsonl");
                let session_path = project_dir.join(&filename);
                let mut file = File::create(&session_path).expect("Failed to create file");

                let session_id = Uuid::new_v4().to_string();

                for m in 0..50 {
                    // 50 messages per session
                    let entry = json!({
                        "uuid": Uuid::new_v4().to_string(),
                        "sessionId": session_id,
                        "timestamp": format!("2025-01-{:02}T{:02}:00:00.000Z", (m % 28) + 1, m % 24),
                        "type": if m % 2 == 0 { "user" } else { "assistant" },
                        "message": {
                            "role": if m % 2 == 0 { "user" } else { "assistant" },
                            "content": format!("Message {}", m),
                            "usage": if m % 2 == 1 {
                                json!({ "input_tokens": 100, "output_tokens": 200 })
                            } else {
                                json!(null)
                            }
                        }
                    });
                    writeln!(file, "{}", serde_json::to_string(&entry).unwrap())
                        .expect("Failed to write");
                }
            }
        }

        let path_str = temp_dir.path().to_string_lossy().to_string();

        group.bench_with_input(
            BenchmarkId::from_parameter(project_count),
            project_count,
            |b, _| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::stats::get_global_stats_summary(
                            black_box(path_str.clone()),
                            None,
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

/// Benchmark: Get session token stats
fn bench_get_session_token_stats(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_session_token_stats");

    for size in &[100, 500, 1000] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let file_path = generate_sample_jsonl(&temp_dir, "test.jsonl", *size);
        let path_str = file_path.to_string_lossy().to_string();

        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                rt.block_on(async {
                    claude_code_history_viewer_lib::commands::stats::get_session_token_stats(
                        black_box(path_str.clone()),
                    )
                    .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark: Get project token stats
fn bench_get_project_token_stats(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_project_token_stats");
    group.sample_size(10); // Reduce sample size for slower benchmarks

    for session_count in &[5, 10, 20] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = generate_project_structure(&temp_dir, *session_count, 100);
        let project_path = base_path.join("projects").join("test-project");
        let path_str = project_path.to_string_lossy().to_string();

        group.bench_with_input(
            BenchmarkId::from_parameter(session_count),
            session_count,
            |b, _| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::stats::get_project_token_stats(
                            black_box(path_str.clone()),
                            black_box(None),
                            black_box(None),
                            black_box(None),
                            black_box(None),
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

/// Benchmark: Get recent edits
fn bench_get_recent_edits(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("get_recent_edits");

    // Test with varying session counts and edits per session
    for (sessions, edits) in &[(5, 50), (10, 100), (20, 100)] {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = generate_project_with_edits(&temp_dir, *sessions, *edits);
        let project_path = base_path.join("projects").join("test-project");
        let path_str = project_path.to_string_lossy().to_string();

        let label = format!("{sessions}sessions_{edits}edits");
        group.bench_with_input(
            BenchmarkId::new("size", &label),
            &(sessions, edits),
            |b, _| {
                b.iter(|| {
                    rt.block_on(async {
                        claude_code_history_viewer_lib::commands::session::get_recent_edits(
                            black_box(path_str.clone()),
                            black_box(None),
                            black_box(None),
                        )
                        .await
                    })
                });
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_load_session_messages,
    bench_load_session_messages_paginated,
    bench_get_session_message_count,
    bench_search_messages,
    bench_load_project_sessions,
    bench_get_project_stats_summary,
    bench_get_global_stats_summary,
    bench_get_session_token_stats,
    bench_get_project_token_stats,
    bench_get_recent_edits,
);

criterion_main!(benches);
