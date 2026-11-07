mod process;
use process::run;

use base64::Engine;
use once_cell::sync::Lazy;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(30 * 60);
const CSP_BASE: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; script-src";
static DOCUMENTS: Lazy<Mutex<Documents>> = Lazy::new(|| Mutex::new(Documents::default()));
static RENDER_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
pub struct PreparedDocument {
    pub document_id: String,
    pub capability: String,
    pub bridge_nonce: String,
    pub renderer_version: String,
}

struct Document {
    descriptor: PreparedDocument,
    standalone: String,
    embedded: String,
    policy: String,
    created: Instant,
}

#[derive(Default)]
struct Documents {
    entries: HashMap<String, Arc<Document>>,
}

impl Documents {
    fn insert(&mut self, standalone: String, policy: String) -> PreparedDocument {
        self.entries
            .retain(|_, entry| entry.created.elapsed() < TTL);
        while self.entries.len() >= 4
            || self
                .entries
                .values()
                .map(|d| d.embedded.len())
                .sum::<usize>()
                > MAX_BYTES * 2
        {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, d)| d.created)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
        let descriptor = PreparedDocument {
            document_id: uuid::Uuid::new_v4().to_string(),
            capability: uuid::Uuid::new_v4().to_string(),
            bridge_nonce: uuid::Uuid::new_v4().to_string(),
            renderer_version: "1.7.0".into(),
        };
        let bridge =
            include_str!("bridge.js").replace("__BRIDGE_NONCE__", &descriptor.bridge_nonce);
        let embedded_policy = policy.replace(
            "; sandbox allow-scripts",
            &format!(" {}; sandbox allow-scripts", script_hash(&bridge)),
        );
        let embedded = match standalone.rfind("</body>") {
            Some(index) => format!(
                "{}<script>{bridge}</script>{}",
                &standalone[..index],
                &standalone[index..]
            ),
            None => standalone.clone(),
        };
        self.entries.insert(
            descriptor.document_id.clone(),
            Arc::new(Document {
                descriptor: descriptor.clone(),
                standalone,
                embedded,
                policy: embedded_policy,
                created: Instant::now(),
            }),
        );
        descriptor
    }

    fn get(&self, id: &str, capability: &str) -> Result<Arc<Document>, String> {
        self.entries
            .get(id)
            .filter(|entry| {
                entry.created.elapsed() < TTL && entry.descriptor.capability == capability
            })
            .cloned()
            .ok_or_else(|| "Reading document expired or unavailable".into())
    }
}

fn script_hash(script: &str) -> String {
    format!(
        "'sha256-{}'",
        base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()))
    )
}

fn script_bodies(html: &str) -> Result<HashSet<String>, String> {
    let pattern =
        regex::Regex::new(r"(?is)<script\b[^>]*>(.*?)</script\s*>").map_err(|e| e.to_string())?;
    Ok(pattern
        .captures_iter(html)
        .map(|capture| capture[1].to_string())
        .collect())
}

fn secure_document(html: &str, trusted: &HashSet<String>) -> Result<(String, String), String> {
    let scripts = script_bodies(html)?;
    if scripts.is_empty()
        || !html.contains("</head>")
        || !html.contains("</body>")
        || !scripts.is_subset(trusted)
    {
        return Err("renderer_output: unsupported or unexpected script in reading document".into());
    }
    // This is a snapshot, not the upstream serve --watch endpoint. Disable its
    // self-poll before hashing; never grant connect-src merely to silence it.
    let pattern = regex::Regex::new(r"(?is)(<script\b[^>]*>)(.*?)(</script\s*>)")
        .map_err(|e| e.to_string())?;
    let document = pattern
        .replace_all(html, |capture: &regex::Captures<'_>| {
            let script = capture[2].replace(
                "if (location.protocol !== 'http:' && location.protocol !== 'https:') return;",
                "return; // Snapshot: refresh is owned by the host.",
            );
            format!("{}{script}{}", &capture[1], &capture[3])
        })
        .into_owned();
    let scripts = script_bodies(&document)?;
    let mut hashes: Vec<String> = scripts.iter().map(|script| script_hash(script)).collect();
    hashes.sort();
    let policy = format!("{CSP_BASE} {}; sandbox allow-scripts", hashes.join(" "));
    let style = "<style>#toggleTimeline,#resumeSession,#followUpdates,[data-mn-theme],.mn-title-row,.navigation,.archive-search-link{display:none!important}html{font-size:calc(16px * var(--reading-font-scale,1))}body.theme-minimal{font-size:calc(14px * var(--reading-font-scale,1))}html[data-reading-contrast=true]{filter:contrast(1.2)}</style>";
    // Only adapt the first real head terminator; escaped conversation text is
    // never searched/replaced as if it were a template control.
    let document = document.replacen("</head>", &format!("{style}</head>"), 1);
    Ok((document, policy))
}

fn roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = crate::utils::home_dir() {
        roots.push(home.join(".claude/projects"));
    }
    for directory in crate::commands::session::configured_claude_dirs() {
        if let Ok(root) = crate::utils::validate_custom_claude_path(Path::new(&directory)) {
            roots.push(root);
        }
    }
    if let Ok(archives) = crate::commands::archive::get_archives_dir() {
        roots.push(archives);
    }
    // Preserve configured root spelling too: it may use a platform/home alias.
    // validate_source canonicalizes for confinement but checks relative links.
    roots
}

fn validate_source(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("reading_source: expected an absolute Claude JSONL path".into());
    }
    validate_history_file(path, roots)
}

fn canonical_history_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map(|path| crate::utils::strip_windows_extended_prefix(&path))
        .map_err(|_| "reading_source: file unavailable".into())
}

fn validate_history_file(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = canonical_history_path(path)?;
    let canonical_roots: Vec<_> = roots
        .iter()
        .filter_map(|root| canonical_history_path(root).ok())
        .collect();
    let root = canonical_roots
        .iter()
        .find(|root| canonical.starts_with(root))
        .ok_or("reading_source: outside configured Claude history roots")?;
    // Canonicalize platform aliases, but retain relative components for link checks.
    let path = crate::utils::strip_windows_extended_prefix(path);
    let lexical = if path.starts_with(root) {
        path.clone()
    } else {
        let original = roots
            .iter()
            .find(|original| {
                path.starts_with(original)
                    && canonical_history_path(original).ok().as_ref() == Some(root)
            })
            .ok_or("reading_source: unsupported symlinked path")?;
        root.join(path.strip_prefix(original).map_err(|e| e.to_string())?)
    };
    let relative = lexical
        .strip_prefix(root)
        .map_err(|_| "reading_source: unsupported symlinked path")?;
    let mut cursor = root.clone();
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err("reading_source: invalid path component".into());
        }
        cursor.push(component);
        if fs::symlink_metadata(&cursor)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("reading_source: symlinks are not supported".into());
        }
    }
    if !fs::metadata(&canonical)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("reading_source: not a regular file".into());
    }
    Ok(canonical)
}

fn validate_loader_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 200
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("reading_source: invalid transcript identifier".into());
    }
    Ok(())
}

// Sidecar discovery follows the tested renderer, not every Claude Code producer:
// daaain/claude-code-log@9834d25c88dc4dbe8f8ade40ae4b74602ae7669d
// converter.py:716-766,834-875; workflow.py:1-25,368-405.
// See docs/reading-mode.md for source links and version/format coverage limits.
#[derive(Default)]
struct LoaderReferences {
    agents: HashSet<String>,
    tool_uses: HashSet<String>,
}

fn checked_records(input: fs::File, output: &mut impl Write) -> Result<LoaderReferences, String> {
    use std::io::BufRead;
    let mut references = LoaderReferences::default();
    for line in std::io::BufReader::new(input).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(&line).map_err(|_| "reading_source: malformed JSONL record")?;
        // These are loader fields; identically named application payload keys are data.
        for key in ["sessionId", "runId", "agentId", "spawnedAgentId"] {
            if let Some(id) = value.get(key).and_then(serde_json::Value::as_str) {
                validate_loader_id(id)?;
                if key == "agentId" || key == "spawnedAgentId" {
                    references.agents.insert(id.to_owned());
                }
            }
        }
        if let Some(id) = value
            .pointer("/toolUseResult/agentId")
            .and_then(serde_json::Value::as_str)
        {
            validate_loader_id(id)?;
            references.agents.insert(id.to_owned());
        }
        if let Some(content) = value
            .pointer("/message/content")
            .and_then(serde_json::Value::as_array)
        {
            for item in content {
                let key = match item.get("type").and_then(serde_json::Value::as_str) {
                    Some("tool_use") => "id",
                    Some("tool_result") => "tool_use_id",
                    _ => continue,
                };
                if let Some(id) = item.get(key).and_then(serde_json::Value::as_str) {
                    references.tool_uses.insert(id.to_owned());
                }
            }
        }
        output
            .write_all(line.as_bytes())
            .and_then(|()| output.write_all(b"\n"))
            .map_err(|e| e.to_string())?;
    }
    Ok(references)
}

#[cfg(test)]
fn copy_checked_records(input: fs::File, output: &mut fs::File) -> Result<(), String> {
    checked_records(input, output).map(|_| ())
}

struct SourceStaging<'a> {
    roots: &'a [PathBuf],
    limit: u64,
    total: u64,
    counted: HashSet<PathBuf>,
    discovered: HashSet<(PathBuf, PathBuf)>,
}

impl SourceStaging<'_> {
    fn account(&mut self, path: &Path) -> Result<(), String> {
        if self.counted.insert(path.to_path_buf()) {
            self.total += fs::metadata(path).map_err(|e| e.to_string())?.len();
            if self.total > self.limit {
                return Err("reading_source: supporting files exceed size limit".into());
            }
        }
        Ok(())
    }

    fn copy(&mut self, source: &Path, destination: &Path) -> Result<LoaderReferences, String> {
        let checked = validate_history_file(source, self.roots)?;
        self.account(&checked)?;
        let mut bytes = Vec::new();
        let references = if source.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            checked_records(
                fs::File::open(&checked).map_err(|e| e.to_string())?,
                &mut bytes,
            )?
        } else {
            bytes = fs::read(&checked).map_err(|e| e.to_string())?;
            LoaderReferences::default()
        };
        if destination.exists() && fs::read(destination).map_err(|e| e.to_string())? != bytes {
            return Err(
                "reading_source: conflicting supporting files across continuation chain".into(),
            );
        }
        fs::create_dir_all(destination.parent().ok_or("Invalid staging path")?)
            .map_err(|e| e.to_string())?;
        fs::write(destination, bytes).map_err(|e| e.to_string())?;
        Ok(references)
    }

    fn agents(
        &mut self,
        source: &Path,
        destination: &Path,
        mut references: LoaderReferences,
    ) -> Result<(), String> {
        let checked = validate_source(source, self.roots)?;
        if !self.discovered.insert((checked, destination.to_path_buf())) {
            return Ok(());
        }
        let parent = source.parent().ok_or("Invalid source parent")?;
        let staged_parent = destination.parent().ok_or("Invalid staging parent")?;
        // The renderer matches sidecar toolUseId to this transcript's tool uses.
        // Ignore unrelated unreadable/malformed metadata, as its loader does.
        for (directory, staged_directory) in [
            (
                source.with_extension("").join("subagents"),
                destination.with_extension("").join("subagents"),
            ),
            (parent.to_path_buf(), staged_parent.to_path_buf()),
        ] {
            if !directory.is_dir() || references.tool_uses.is_empty() {
                continue;
            }
            for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
                let Ok(entry) = entry else { continue };
                let name = entry.file_name();
                let name = name.to_string_lossy();
                let Some(id) = name
                    .strip_prefix("agent-")
                    .and_then(|name| name.strip_suffix(".meta.json"))
                else {
                    continue;
                };
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if !metadata.is_file() || metadata.len() > self.limit {
                    continue;
                }
                let Ok(checked) = validate_history_file(&entry.path(), self.roots) else {
                    continue;
                };
                let Ok(bytes) = fs::read(&checked) else {
                    continue;
                };
                let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
                    continue;
                };
                if value
                    .get("toolUseId")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|id| references.tool_uses.contains(id))
                {
                    validate_loader_id(id)?;
                    references.agents.insert(id.to_owned());
                    self.copy(&entry.path(), &staged_directory.join(name.as_ref()))?;
                }
            }
        }
        for id in references.agents {
            let name = format!("agent-{id}.jsonl");
            // Match upstream precedence: legacy siblings, then own subagents.
            let legacy = parent.join(&name);
            let (agent, staged) = if fs::symlink_metadata(&legacy).is_ok() {
                (legacy, staged_parent.join(&name))
            } else {
                (
                    source.with_extension("").join("subagents").join(&name),
                    destination.with_extension("").join("subagents").join(&name),
                )
            };
            if fs::symlink_metadata(&agent).is_err() {
                continue;
            }
            let checked = validate_source(&agent, self.roots)?;
            if self.discovered.contains(&(checked, staged.clone())) {
                continue;
            }
            let references = self.copy(&agent, &staged)?;
            self.agents(&agent, &staged, references)?;
        }
        Ok(())
    }
}

fn stage(path: &Path, directory: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    stage_with_limit(path, directory, roots, MAX_BYTES as u64)
}

fn stage_with_limit(
    path: &Path,
    directory: &Path,
    roots: &[PathBuf],
    limit: u64,
) -> Result<PathBuf, String> {
    let sources = crate::commands::session::resolve_session_chain(path);
    let target = directory.join("reading.jsonl");
    let mut output = fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut staging = SourceStaging {
        roots,
        limit,
        total: 0,
        counted: HashSet::new(),
        discovered: HashSet::new(),
    };
    for source in sources {
        let source = validate_source(&source, roots)?;
        staging.account(&source)?;
        let references = checked_records(
            fs::File::open(&source).map_err(|e| e.to_string())?,
            &mut output,
        )?;
        staging.agents(&source, &target, references)?;
        for kind in ["subagents", "workflows"] {
            let sidecars = source.with_extension("").join(kind);
            if !sidecars.is_dir() {
                continue;
            }
            for entry in walkdir::WalkDir::new(&sidecars)
                .follow_links(false)
                .max_depth(4)
            {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_type().is_symlink() {
                    return Err("reading_source: symlinked sidecar".into());
                }
                if !entry.file_type().is_file() {
                    continue;
                }
                let extension = entry.path().extension().and_then(|e| e.to_str());
                if extension != Some("jsonl") && extension != Some("json") {
                    continue;
                }
                let relative = entry
                    .path()
                    .strip_prefix(&sidecars)
                    .map_err(|e| e.to_string())?;
                // Preserve both original hierarchy and aggregate single-file discovery.
                for destination in [
                    directory
                        .join(source.file_stem().unwrap_or_default())
                        .join(kind)
                        .join(relative),
                    directory.join("reading").join(kind).join(relative),
                ] {
                    let references = staging.copy(entry.path(), &destination)?;
                    if extension == Some("jsonl") {
                        staging.agents(entry.path(), &destination, references)?;
                    }
                }
            }
        }
    }
    Ok(target)
}

fn executable() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("CCHV_READING_RENDERER") {
        let path = PathBuf::from(value);
        return if path.is_absolute() && path.is_file() {
            Ok(path)
        } else {
            Err(
                "renderer_missing: CCHV_READING_RENDERER must be an absolute executable path"
                    .into(),
            )
        };
    }
    let name = if cfg!(windows) {
        "claude-code-log.exe"
    } else {
        "claude-code-log"
    };
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) {
            if directory.is_absolute() && directory.join(name).is_file() {
                return Ok(directory.join(name));
            }
        }
    }
    if let Some(home) = crate::utils::home_dir() {
        let path = home.join(".local/bin").join(name);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("renderer_missing: install claude-code-log 1.7.0 or configure CCHV_READING_RENDERER".into())
}

fn render(executable: &Path, input: &Path, cwd: &Path) -> Result<String, String> {
    let args: Vec<&std::ffi::OsStr> = vec![
        "convert".as_ref(),
        input.as_os_str(),
        "--theme".as_ref(),
        "minimal".as_ref(),
        "--depth".as_ref(),
        "hook".as_ref(),
        "--format".as_ref(),
        "html".as_ref(),
        "--image-export-mode".as_ref(),
        "embedded".as_ref(),
        "--output".as_ref(),
        "-".as_ref(),
        "--no-cache".as_ref(),
    ];
    run(executable, &args, cwd)
}

fn acquire_render_slot() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    RENDER_LOCK
        .lock()
        .map_err(|_| "renderer_unavailable: render queue unavailable".into())
}

fn prepare(path: String) -> Result<PreparedDocument, String> {
    let _guard = acquire_render_slot()?;
    let roots = roots();
    let path = validate_source(Path::new(&path), &roots)?;
    let executable = executable()?;
    let temporary = tempfile::tempdir().map_err(|e| e.to_string())?;
    let version = run(&executable, &["--version".as_ref()], temporary.path())?;
    if !version.trim().ends_with("version 1.7.0") {
        return Err(
            "renderer_version: reading mode currently requires claude-code-log 1.7.0".into(),
        );
    }
    let baseline = temporary.path().join("baseline.jsonl");
    fs::write(&baseline, r#"{"type":"user","uuid":"00000000-1111-2222-3333-444444444444","sessionId":"11111111-2222-3333-4444-555555555555","timestamp":"2026-01-01T00:00:00Z","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/nonexistent-reading-fixture","version":"2.1.0","message":{"role":"user","content":"Reading"}}"#).map_err(|e| e.to_string())?;
    let trusted = script_bodies(&render(&executable, &baseline, temporary.path())?)?;
    let input = stage(&path, temporary.path(), &roots)?;
    let (document, policy) =
        secure_document(&render(&executable, &input, temporary.path())?, &trusted)?;
    Ok(DOCUMENTS
        .lock()
        .map_err(|_| "Reading cache unavailable")?
        .insert(document, policy))
}

#[tauri::command]
pub async fn prepare_reading_document(
    session_path: String,
    force_refresh: Option<bool>,
) -> Result<PreparedDocument, String> {
    // Explicit refresh and initial load both render a new, bounded snapshot.
    let _ = force_refresh;
    tauri::async_runtime::spawn_blocking(move || prepare(session_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn export_reading_document(document_id: String, capability: String) -> Result<String, String> {
    let document = DOCUMENTS
        .lock()
        .map_err(|_| "Reading cache unavailable")?
        .get(&document_id, &capability)?;
    // Standalone exports have no host bridge and remain offline/hash locked.
    let scripts = script_bodies(&document.standalone)?;
    let policy = format!(
        "{CSP_BASE} {}",
        scripts
            .iter()
            .map(|s| script_hash(s))
            .collect::<Vec<_>>()
            .join(" ")
    );
    Ok(document.standalone.replace(
        "<head>",
        &format!("<head><meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">"),
    ))
}

pub fn document_response(uri: &str) -> tauri::http::Response<Vec<u8>> {
    let parsed = tauri::Url::parse(uri);
    let result = parsed
        .map_err(|_| "Invalid document URL".to_string())
        .and_then(|url| {
            let id = url
                .path()
                .trim_start_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or_default();
            let capability = url
                .query_pairs()
                .find(|(key, _)| key == "capability")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            DOCUMENTS
                .lock()
                .map_err(|_| "Reading cache unavailable".to_string())?
                .get(id, &capability)
        });
    match result {
        Ok(document) => tauri::http::Response::builder()
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", &document.policy)
            .header("Cache-Control", "no-store")
            .header("Referrer-Policy", "no-referrer")
            .header("X-Content-Type-Options", "nosniff")
            .body(document.embedded.as_bytes().to_vec())
            .unwrap(),
        Err(_) => tauri::http::Response::builder()
            .status(404)
            .header("Cache-Control", "no-store")
            .body(b"Reading document expired or unavailable".to_vec())
            .unwrap(),
    }
}

#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
