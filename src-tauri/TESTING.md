# Rust Testing Guide

This document describes the world-class testing infrastructure for the Claude Code History Viewer Rust backend.

## Quick Start

```bash
# Install required tools
just rust-tools-install

# Run all tests
just rust-test        # Standard cargo test
just rust-nextest     # Faster parallel testing with nextest

# Run with coverage
just rust-coverage    # Generate HTML coverage report
```

## Testing Stack

| Tool | Purpose | Install |
|------|---------|---------|
| [cargo-nextest](https://nexte.st/) | Fast parallel test runner | `cargo install cargo-nextest` |
| [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) | Code coverage | `cargo install cargo-llvm-cov` |
| [proptest](https://proptest-rs.github.io/proptest/) | Property-based testing | (dev-dependency) |
| [insta](https://insta.rs/) | Snapshot testing | (dev-dependency) |
| [rstest](https://github.com/la10736/rstest) | Parameterized tests | (dev-dependency) |
| [mockall](https://github.com/asomers/mockall) | Mocking framework | (dev-dependency) |
| [criterion](https://bheisler.github.io/criterion.rs/) | Benchmarking | (dev-dependency) |

## Test Types

### 1. Unit Tests

Standard Rust unit tests using `#[test]` attribute:

```rust
#[test]
fn test_extract_project_name() {
    let result = extract_project_name("-Users-jack-myproject");
    assert_eq!(result, "myproject");
}
```

### 2. Async Tests

For testing async functions:

```rust
#[tokio::test]
async fn test_load_session_messages() {
    let result = load_session_messages(path).await;
    assert!(result.is_ok());
}
```

### 3. Property-Based Tests

Use proptest for generating random test inputs:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn prop_never_panics(input in ".*") {
        let _ = extract_project_name(&input);
    }
}
```

### 4. Snapshot Tests

Use insta for snapshot testing:

```rust
use insta::assert_json_snapshot;

#[test]
fn snapshot_user_message() {
    let message = create_user_message();
    assert_json_snapshot!("user_message", message);
}
```

Review snapshots with:
```bash
just rust-snapshot-review
# or
cargo insta review
```

### 5. Parameterized Tests

Use rstest for parameterized tests:

```rust
use rstest::rstest;

#[rstest]
#[case("user", true)]
#[case("assistant", true)]
#[case("system", false)]
fn test_is_valid_message_type(#[case] input: &str, #[case] expected: bool) {
    assert_eq!(is_valid_message_type(input), expected);
}
```

### 6. Benchmark Tests

Use criterion for benchmarking:

```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn bench_message_parsing(c: &mut Criterion) {
    c.bench_function("parse_message", |b| {
        b.iter(|| parse_message(sample_data))
    });
}

criterion_group!(benches, bench_message_parsing);
criterion_main!(benches);
```

Run benchmarks:
```bash
just rust-bench
```

## Test Organization

```
src-tauri/
├── src/
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── project.rs          # Unit tests at bottom
│   │   ├── stats.rs            # Unit tests at bottom
│   │   ├── proptest_examples.rs # Property-based tests
│   │   └── session/
│   │       ├── load.rs         # Unit tests at bottom
│   │       ├── search.rs       # Unit tests at bottom
│   │       └── edits.rs        # Unit tests at bottom
│   ├── models/
│   │   ├── mod.rs
│   │   ├── message.rs          # Unit tests at bottom
│   │   ├── session.rs          # Unit tests at bottom
│   │   ├── stats.rs            # Unit tests at bottom
│   │   ├── edit.rs             # Unit tests at bottom
│   │   └── snapshot_tests.rs   # Snapshot tests
│   ├── utils.rs                # Unit tests at bottom
│   └── test_utils.rs           # Test helpers & builders
├── benches/
│   └── performance.rs          # Criterion benchmarks
└── .config/
    └── nextest.toml            # Nextest configuration
```

## Test Utilities

### MockClaudeProject

Create temporary Claude project structures for testing:

```rust
use crate::test_utils::MockClaudeProject;

#[tokio::test]
async fn test_scan_projects() {
    let mock = MockClaudeProject::new();
    mock.add_session("my-project", "session1", "{}");

    let result = scan_projects(mock.claude_path()).await;
    assert!(result.is_ok());
}
```

### MessageBuilder

Fluent builder for creating test messages:

```rust
use crate::test_utils::MessageBuilder;

let user_msg = MessageBuilder::user()
    .with_text_content("Hello!")
    .build();

let assistant_msg = MessageBuilder::assistant()
    .with_usage(100, 50)
    .build();
```

## Coverage

### Generate Coverage Report

```bash
# HTML report (opens in browser)
just rust-coverage-open

# LCOV format (for CI/CD)
cd src-tauri && cargo llvm-cov nextest --lcov --output-path lcov.info
```

### Coverage Targets

| Category | Target | Notes |
|----------|--------|-------|
| Overall | 80%+ | Minimum acceptable |
| Core logic | 90%+ | Message parsing, stats |
| Security | 100% | Path validation, input sanitization |

## CI/CD Integration

The GitHub Actions workflow (`.github/workflows/rust-tests.yml`) runs:

1. **Lint & Format** - clippy, rustfmt
2. **Test Suite** - nextest on Ubuntu & macOS
3. **Coverage** - llvm-cov with Codecov upload
4. **Benchmarks** - criterion (main branch only)
5. **Security Audit** - cargo-audit
6. **Documentation** - cargo doc

## Commands Reference

| Command | Description |
|---------|-------------|
| `just rust-test` | Run tests with cargo test |
| `just rust-nextest` | Run tests with nextest (faster) |
| `just rust-coverage` | Generate coverage report |
| `just rust-coverage-open` | Generate and open coverage |
| `just rust-lint` | Run clippy |
| `just rust-fmt` | Format code |
| `just rust-fmt-check` | Check formatting |
| `just rust-bench` | Run benchmarks |
| `just rust-audit` | Security audit |
| `just rust-check-all` | Run all checks |
| `just rust-watch` | Watch mode |
| `just rust-proptest` | Property tests only |
| `just rust-snapshot-review` | Review snapshots |

## Best Practices

### 1. Test Naming

```rust
#[test]
fn test_<function>_<scenario>_<expected>() {
    // test_extract_project_name_with_prefix_returns_last_segment
}
```

### 2. Arrange-Act-Assert

```rust
#[test]
fn test_message_parsing() {
    // Arrange
    let input = create_test_input();

    // Act
    let result = parse_message(&input);

    // Assert
    assert_eq!(result.message_type, "user");
}
```

### 3. Test Isolation

- Use `tempfile` for file system tests
- Each test should be independent
- Clean up resources in test fixtures

### 4. Property-Based Testing

- Use for input validation functions
- Test invariants that should always hold
- Include regression tests for found edge cases

### 5. Snapshot Testing

- Use for serialization formats
- Review changes carefully
- Keep snapshots in version control

## Troubleshooting

### Tests failing locally but passing in CI

```bash
# Clean and rebuild
cargo clean
cargo test
```

### Nextest not finding tests

```bash
# Ensure the configuration is correct
cargo nextest list
```

### Coverage not working

```bash
# Install llvm-tools
rustup component add llvm-tools-preview
```

### Snapshot mismatch

```bash
# Review and accept changes
cargo insta review
```
