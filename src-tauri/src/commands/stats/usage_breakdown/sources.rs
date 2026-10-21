//! Scope resolution (ADR 0002 §1, §7, §9): which session files a request
//! reads, per provider, and what could not be read.
//!
//! Claude reads the same roots and files as the old commands (default root +
//! custom roots for `all`, every `*.jsonl` under a project directory) through
//! the contribution cache; subagent transcripts are folded into the session
//! that spawned them (#577). Other providers go through their existing stats
//! paths per request.

use super::availability::{store_availability, StoreAvailability};
use super::contribution::{
    from_antigravity_records, from_messages, read_claude_file, FileContributions,
};
use super::contribution_cache::contribution_cache;
use super::{ProviderScanStatus, UsageScope};
use crate::commands::stats::session_files::{claude_project_dirs, walk_session_files};
use crate::commands::stats::{
    all_stats_providers, claude_session_heads, detect_project_provider,
    load_antigravity_usage_records_checked, load_stats_messages, load_stats_sessions,
    scan_stats_projects, stats_provider_id, StatsMode, StatsProvider,
};
use crate::models::{ClaudeProject, ClaudeSession};
use crate::providers::scan_report::ScanReport;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Whether the provider's history format carries token usage at all. A
/// provider without it is reported `not_supported` (never as zero usage) and
/// is not scanned. Exhaustive on purpose: a new provider must decide.
pub(super) fn reports_token_usage(provider: StatsProvider) -> bool {
    use StatsProvider as P;
    match provider {
        P::Claude
        | P::Antigravity
        | P::Cline
        | P::Codex
        | P::Copilot
        | P::Cursor
        | P::ForgeCode
        | P::Gemini
        | P::Grok
        | P::Kilo
        | P::Kimi
        | P::Llm
        | P::Ompi
        | P::OpenCode
        | P::OpenInterpreter
        | P::Pi
        | P::Qwen
        | P::Zcode => true,
        P::Aider
        | P::AmazonQ
        | P::Codebuddy
        | P::Continue
        | P::Crush
        | P::CursorAgent
        | P::Goose
        | P::Kiro
        | P::OpenHands
        | P::PearAI
        | P::Trae
        | P::Vibe
        | P::Zed => false,
    }
}

/// Whether the provider marks sidechain (subagent) rows, so that
/// `conversation_only` can exclude anything.
pub(super) fn records_sidechains(provider: StatsProvider) -> bool {
    matches!(provider, StatsProvider::Claude | StatsProvider::Zcode)
}

/// Strict provider id parse: an unknown id is a request error.
pub(super) fn parse_provider_id(id: &str) -> Result<StatsProvider, String> {
    all_stats_providers()
        .into_iter()
        .find(|provider| stats_provider_id(*provider) == id)
        .ok_or_else(|| format!("usage breakdown: unknown provider '{id}'"))
}

/// The validated scope, resolved before any file is read.
#[derive(Debug, Clone)]
pub(super) enum ScopePlan {
    Project {
        provider: StatsProvider,
        project_path: String,
    },
    All {
        /// Request order, duplicates dropped.
        providers: Vec<StatsProvider>,
        claude_path: String,
        custom_claude_paths: Vec<String>,
    },
}

impl ScopePlan {
    pub fn parse(scope: &UsageScope) -> Result<Self, String> {
        match scope {
            UsageScope::Project {
                project_path,
                provider,
            } => {
                let provider = parse_provider_id(provider)?;
                let detected = detect_project_provider(project_path);
                if detected != provider {
                    return Err(format!(
                        "usage breakdown: project '{project_path}' belongs to provider '{}', not '{}'",
                        stats_provider_id(detected),
                        stats_provider_id(provider)
                    ));
                }
                if provider == StatsProvider::Claude {
                    if project_path.trim().is_empty() {
                        return Err("project_path is required".to_string());
                    }
                    if !Path::new(project_path).is_absolute() {
                        return Err("project_path must be absolute".to_string());
                    }
                }
                Ok(Self::Project {
                    provider,
                    project_path: project_path.clone(),
                })
            }
            UsageScope::All {
                providers,
                claude_path,
                custom_claude_paths,
            } => {
                let mut parsed = Vec::with_capacity(providers.len());
                for id in providers {
                    let provider = parse_provider_id(id)?;
                    if !parsed.contains(&provider) {
                        parsed.push(provider);
                    }
                }
                Ok(Self::All {
                    providers: parsed,
                    claude_path: claude_path.clone(),
                    custom_claude_paths: custom_claude_paths
                        .iter()
                        .map(|custom| custom.path.clone())
                        .collect(),
                })
            }
        }
    }
}

/// One session of the response: its files' contributions and identity.
pub(super) struct SessionInput {
    pub provider: StatsProvider,
    pub file_path: String,
    pub project_path: String,
    /// Head transcript first, then the subagent transcripts folded into it.
    pub files: Vec<Arc<FileContributions>>,
    /// Used when no accepted row names a session id.
    pub fallback_session_id: String,
    pub title: Option<String>,
}

impl SessionInput {
    pub fn session_id(&self) -> String {
        self.files
            .iter()
            .find_map(|file| file.session_id.clone())
            .unwrap_or_else(|| self.fallback_session_id.clone())
    }
}

/// What one provider's scan read and failed to read (ADR §9).
#[derive(Debug, Clone)]
pub(super) struct ProviderScan {
    pub provider: StatsProvider,
    pub sessions_scanned: u64,
    pub sessions_failed: u64,
    /// Roots, project lists or session lists that could not be read at all.
    pub sources_failed: u64,
    pub not_supported: bool,
    /// The provider's store (or the requested project) is not on disk.
    pub store_missing: bool,
}

impl ProviderScan {
    fn new(provider: StatsProvider) -> Self {
        Self {
            provider,
            sessions_scanned: 0,
            sessions_failed: 0,
            sources_failed: 0,
            not_supported: !reports_token_usage(provider),
            store_missing: false,
        }
    }

    pub fn status(&self) -> ProviderScanStatus {
        if self.not_supported {
            return ProviderScanStatus::NotSupported;
        }
        match (
            self.sessions_failed + self.sources_failed,
            self.sessions_scanned,
        ) {
            (0, 0) if self.store_missing => ProviderScanStatus::NotFound,
            (0, _) => ProviderScanStatus::Scanned,
            (_, 0) => ProviderScanStatus::Unreadable,
            _ => ProviderScanStatus::Partial,
        }
    }

    /// Run `read` only when the provider's store can be read (ADR 0003 §7):
    /// a missing store is `not_found`, an unreadable one a failed source.
    /// Whatever `read` records in its [`ScanReport`] — a part of the store
    /// it went past without reading — is a failed source as well.
    fn when_store_present(
        &mut self,
        read: impl FnOnce(&mut Self, &ScanReport) -> Vec<(String, ClaudeSession)>,
    ) -> Vec<(String, ClaudeSession)> {
        let report = ScanReport::default();
        let tasks = match store_availability(self.provider) {
            StoreAvailability::Missing => {
                // Detection only looks at paths, and a path it may not look
                // into passes for an absent one. So the scan runs anyway,
                // on a probe: a store that is really absent records nothing
                // (a path that is not there is no failure), while one that
                // records what it could not read is there after all.
                let mut probe = Self::new(self.provider);
                let found = read(&mut probe, &report);
                if report.is_empty() {
                    self.store_missing = true;
                    Vec::new()
                } else {
                    self.sources_failed += probe.sources_failed;
                    found
                }
            }
            StoreAvailability::Unreadable(error) => {
                log::warn!(
                    "usage breakdown: {} store: {error}",
                    stats_provider_id(self.provider)
                );
                self.sources_failed += 1;
                Vec::new()
            }
            StoreAvailability::Present => read(self, &report),
        };
        self.account_report(report);
        tasks
    }

    /// What the provider's scan went past without reading (a directory it
    /// could not list, a file or database it could not open): each one is a
    /// source that was not read (ADR 0003 §7).
    fn account_report(&mut self, report: ScanReport) {
        for what in report.into_unread() {
            log::warn!(
                "usage breakdown: {}: cannot read {what}",
                stats_provider_id(self.provider)
            );
            self.sources_failed += 1;
        }
    }
}

/// Everything a request reads.
pub(super) struct Collected {
    pub sessions: Vec<SessionInput>,
    pub scans: Vec<ProviderScan>,
}

pub(super) fn collect(plan: &ScopePlan, mode: StatsMode) -> Collected {
    let mut collected = Collected {
        sessions: Vec::new(),
        scans: Vec::new(),
    };
    match plan {
        ScopePlan::Project {
            provider,
            project_path,
        } => {
            let mut scan = ProviderScan::new(*provider);
            if !scan.not_supported {
                let sessions = if *provider == StatsProvider::Claude {
                    collect_claude(
                        claude_project_scope(project_path, &mut scan)
                            .into_iter()
                            .collect(),
                        mode,
                        &mut scan,
                    )
                } else {
                    let tasks =
                        scan.when_store_present(|scan, report| {
                            match load_sessions_reporting(*provider, project_path, report) {
                                Ok(sessions) => sessions
                                    .into_iter()
                                    .map(|session| (project_path.clone(), session))
                                    .collect(),
                                Err(error) => {
                                    log::warn!("usage breakdown: {project_path}: {error}");
                                    scan.sources_failed += 1;
                                    Vec::new()
                                }
                            }
                        });
                    collect_provider_sessions(*provider, tasks, mode, &mut scan)
                };
                collected.sessions.extend(sessions);
            }
            collected.scans.push(scan);
        }
        ScopePlan::All {
            providers,
            claude_path,
            custom_claude_paths,
        } => {
            for provider in providers {
                let mut scan = ProviderScan::new(*provider);
                if !scan.not_supported {
                    let sessions = if *provider == StatsProvider::Claude {
                        let projects =
                            claude_root_projects(claude_path, custom_claude_paths, &mut scan);
                        collect_claude(projects, mode, &mut scan)
                    } else {
                        let provider = *provider;
                        let tasks = scan.when_store_present(|scan, report| {
                            provider_all_sessions(provider, scan, report)
                        });
                        collect_provider_sessions(provider, tasks, mode, &mut scan)
                    };
                    collected.sessions.extend(sessions);
                }
                collected.scans.push(scan);
            }
        }
    }
    collected
}

// ---- Claude -----------------------------------------------------------------

/// One Claude project directory, its `*.jsonl` files, and the canonical
/// directory every one of them must stay inside when it is read.
struct ClaudeProjectFiles {
    project_path: String,
    root: PathBuf,
    files: Vec<PathBuf>,
}

/// Account for the symlinks a walk did not follow (ADR 0003 §7). One that
/// resolves inside `roots` (the request's canonical history roots) is an
/// alias of history that is read directly, so it is skipped silently; any
/// other one — pointing out of the roots or nowhere — is refused and
/// reported like a source that could not be read.
fn account_links(links: &[PathBuf], roots: &[PathBuf], scan: &mut ProviderScan) {
    for link in links {
        match fs::canonicalize(link) {
            Ok(target) if roots.iter().any(|root| target.starts_with(root)) => {
                log::debug!(
                    "usage breakdown: {} is an alias inside the history root; not followed",
                    link.display()
                );
            }
            _ => {
                log::warn!(
                    "usage breakdown: {} leaves the history root; not followed",
                    link.display()
                );
                scan.sources_failed += 1;
            }
        }
    }
}

/// Entries a walk could not read (ADR 0003 §7): each one is a source that
/// was not read, so the provider is `partial` or `unreadable`, never
/// `scanned`.
fn account_unreadable(dir: &Path, errors: &[String], scan: &mut ProviderScan) {
    for error in errors {
        log::warn!(
            "usage breakdown: cannot read part of {}: {error}",
            dir.display()
        );
        scan.sources_failed += 1;
    }
}

/// Where a directory the request reads resolves to, or why it does not.
enum Located {
    Dir(PathBuf),
    /// Not on disk: nothing to read, not a failure.
    Missing,
    /// There but not a usable directory (permissions, not a directory).
    Unusable(String),
}

fn locate_dir(dir: &Path) -> Located {
    match fs::canonicalize(dir) {
        Ok(canonical) if canonical.is_dir() => Located::Dir(canonical),
        Ok(canonical) => Located::Unusable(format!("{} is not a directory", canonical.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => Located::Missing,
        Err(error) => Located::Unusable(format!("{}: {error}", dir.display())),
    }
}

/// Walk one project directory (canonical `root`) without following a
/// symlink. Returns its files and the links the walk skipped, for
/// [`account_links`]; what the walk could not read is accounted here.
fn walk_project(
    project_dir: &Path,
    project_path: &str,
    root: PathBuf,
    scan: &mut ProviderScan,
) -> (ClaudeProjectFiles, Vec<PathBuf>) {
    // Same file set as the old stats (`session_files`): any `*.jsonl` entry
    // that is not a symlink, so a non-file named like a session surfaces as
    // a failed session.
    let walk = walk_session_files(project_dir);
    account_unreadable(project_dir, &walk.errors, scan);
    let project = ClaudeProjectFiles {
        project_path: project_path.to_string(),
        root,
        files: walk.files,
    };
    (project, walk.links)
}

/// The one project of a project scope; the project directory is its only
/// history root. A project that is not on disk is `not_found`.
fn claude_project_scope(project_path: &str, scan: &mut ProviderScan) -> Option<ClaudeProjectFiles> {
    let project_dir = Path::new(project_path);
    let root = match locate_dir(project_dir) {
        Located::Dir(root) => root,
        Located::Missing => {
            scan.store_missing = true;
            return None;
        }
        Located::Unusable(error) => {
            log::warn!("usage breakdown: Claude project: {error}");
            scan.sources_failed += 1;
            return None;
        }
    };
    let (project, links) = walk_project(project_dir, project_path, root, scan);
    account_links(&links, std::slice::from_ref(&project.root), scan);
    Some(project)
}

/// The projects of the default root and every valid custom root, each root
/// read once even when listed twice. Symlinked project directories are never
/// walked. An empty `claude_path` is the default root
/// (`providers::claude::base_path_or_default`).
fn claude_root_projects(
    claude_path: &str,
    custom_claude_paths: &[String],
    scan: &mut ProviderScan,
) -> Vec<ClaudeProjectFiles> {
    let mut bases: Vec<PathBuf> = crate::providers::claude::base_path_or_default(claude_path)
        .into_iter()
        .collect();
    for custom in custom_claude_paths {
        let base = PathBuf::from(custom);
        match crate::utils::validate_custom_claude_path(&base) {
            Ok(_) => bases.push(base),
            Err(error) => {
                log::warn!("usage breakdown: skipping custom Claude path: {error}");
                scan.sources_failed += 1;
            }
        }
    }
    // Each root's `projects/` folder and its canonical path. A root without
    // one holds no history yet; none at all is `not_found`.
    let mut roots: Vec<(PathBuf, PathBuf)> = Vec::new();
    for base in bases {
        let projects_dir = base.join("projects");
        match locate_dir(&projects_dir) {
            Located::Dir(canonical) => {
                if roots.iter().all(|(_, seen)| *seen != canonical) {
                    roots.push((projects_dir, canonical));
                }
            }
            Located::Missing => {}
            Located::Unusable(error) => {
                log::warn!("usage breakdown: cannot read Claude projects: {error}");
                scan.sources_failed += 1;
            }
        }
    }
    scan.store_missing = roots.is_empty();
    let canonical_roots: Vec<PathBuf> = roots.iter().map(|(_, root)| root.clone()).collect();
    let mut projects = Vec::new();
    for (projects_dir, _) in &roots {
        let listing = match claude_project_dirs(projects_dir) {
            Ok(listing) => listing,
            Err(error) => {
                log::warn!(
                    "usage breakdown: cannot read {}: {error}",
                    projects_dir.display()
                );
                scan.sources_failed += 1;
                continue;
            }
        };
        account_unreadable(projects_dir, &listing.errors, scan);
        account_links(&listing.links, &canonical_roots, scan);
        for dir in listing.dirs {
            let root = match locate_dir(&dir) {
                Located::Dir(root) => root,
                // Removed since the listing.
                Located::Missing => continue,
                Located::Unusable(error) => {
                    log::warn!("usage breakdown: Claude project: {error}");
                    scan.sources_failed += 1;
                    continue;
                }
            };
            let project_path = dir.to_string_lossy().to_string();
            let (project, links) = walk_project(&dir, &project_path, root, scan);
            account_links(&links, &canonical_roots, scan);
            projects.push(project);
        }
    }
    projects
}

/// Load every file through the cache in parallel, then group transcripts
/// into sessions (a session fails when any of its transcripts fails).
fn collect_claude(
    projects: Vec<ClaudeProjectFiles>,
    mode: StatsMode,
    scan: &mut ProviderScan,
) -> Vec<SessionInput> {
    let all_files: Vec<(&PathBuf, &Path)> = projects
        .iter()
        .flat_map(|p| p.files.iter().map(|file| (file, p.root.as_path())))
        .collect();
    let loaded: HashMap<&PathBuf, Result<Arc<FileContributions>, String>> = all_files
        .par_iter()
        .map(|&(path, root)| {
            let result =
                contribution_cache().get_or_load(path, mode, || read_claude_file(path, root, mode));
            (path, result)
        })
        .collect();

    let mut sessions = Vec::new();
    for project in &projects {
        let in_project: HashSet<&PathBuf> = project.files.iter().collect();
        for head in claude_session_heads(project.files.clone()) {
            let subagents = crate::utils::find_subagent_files(&head);
            let paths = std::iter::once(&head)
                .chain(subagents.iter().filter(|path| in_project.contains(path)));
            let mut files = Vec::new();
            let mut failed = false;
            for path in paths {
                match loaded.get(path) {
                    Some(Ok(file)) => files.push(Arc::clone(file)),
                    Some(Err(error)) => {
                        log::warn!("usage breakdown: {error}");
                        failed = true;
                    }
                    None => failed = true,
                }
            }
            if failed {
                scan.sessions_failed += 1;
            } else {
                scan.sessions_scanned += 1;
            }
            if files.is_empty() {
                continue;
            }
            let title = files.first().and_then(|file| file.title.clone());
            sessions.push(SessionInput {
                provider: StatsProvider::Claude,
                file_path: head.to_string_lossy().to_string(),
                project_path: project.project_path.clone(),
                fallback_session_id: head
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or_default()
                    .to_string(),
                title,
                files,
            });
        }
    }
    sessions
}

// ---- other providers ----------------------------------------------------------

/// Every (project path, session) of a provider, as the old global stats list
/// them; what the scan could not read goes to `report`.
fn provider_all_sessions(
    provider: StatsProvider,
    scan: &mut ProviderScan,
    report: &ScanReport,
) -> Vec<(String, ClaudeSession)> {
    if provider == StatsProvider::Antigravity {
        let Some(root) = crate::commands::antigravity::resolve_antigravity_root() else {
            scan.sources_failed += 1;
            return Vec::new();
        };
        let root = root.to_string_lossy().to_string();
        return match load_sessions_reporting(provider, &root, report) {
            Ok(sessions) => sessions.into_iter().map(|s| (root.clone(), s)).collect(),
            Err(error) => {
                log::warn!("usage breakdown: antigravity: {error}");
                scan.sources_failed += 1;
                Vec::new()
            }
        };
    }
    let projects = match scan_projects_reporting(provider, report) {
        Ok(projects) => projects,
        Err(error) => {
            log::warn!("usage breakdown: {}: {error}", stats_provider_id(provider));
            scan.sources_failed += 1;
            return Vec::new();
        }
    };
    let mut tasks = Vec::new();
    for project in projects {
        match load_sessions_reporting(provider, &project.path, report) {
            Ok(sessions) => tasks.extend(sessions.into_iter().map(|s| (project.path.clone(), s))),
            Err(error) => {
                log::warn!("usage breakdown: {}: {error}", project.path);
                scan.sources_failed += 1;
            }
        }
    }
    tasks
}

/// The provider's project scan for a request that reports coverage: what the
/// scan could not read goes to `report` (ADR 0003 §7). Every other command
/// keeps [`scan_stats_projects`]: a reporting scanner may answer a store it
/// cannot read with nothing where the plain one fails (llm, Z Code), which
/// only a caller that counts the report may do (#708 review).
fn scan_projects_reporting(
    provider: StatsProvider,
    report: &ScanReport,
) -> Result<Vec<ClaudeProject>, String> {
    use crate::providers as p;
    use StatsProvider as P;
    match provider {
        P::Antigravity => p::antigravity::scan_projects_reporting(report),
        P::Cline => p::cline::scan_projects_reporting(report),
        P::Codex => p::codex::scan_projects_reporting(report),
        P::Copilot => p::copilot::scan_projects_reporting(report),
        P::Cursor => p::cursor::scan_projects_reporting(report),
        P::ForgeCode => p::forgecode::scan_projects_reporting(report),
        P::Gemini => p::gemini::scan_projects_reporting(report),
        P::Grok => p::grok::scan_projects_reporting(report),
        P::Kilo => p::kilo::scan_projects_reporting(report),
        P::Kimi => p::kimi::scan_projects_reporting(report),
        P::Llm => p::llm::scan_projects_reporting(report),
        P::Ompi => p::ompi::scan_projects_reporting(report),
        P::OpenCode => p::opencode::scan_projects_reporting(report),
        P::OpenInterpreter => p::openinterpreter::scan_projects_reporting(report),
        P::Pi => p::pi::scan_projects_reporting(report),
        P::Qwen => p::qwen::scan_projects_reporting(report),
        P::Zcode => p::zcode::scan_projects_reporting(report),
        // No token usage (`reports_token_usage`): never scanned here.
        P::Aider
        | P::AmazonQ
        | P::Claude
        | P::Codebuddy
        | P::Continue
        | P::Crush
        | P::CursorAgent
        | P::Goose
        | P::Kiro
        | P::OpenHands
        | P::PearAI
        | P::Trae
        | P::Vibe
        | P::Zed => scan_stats_projects(provider),
    }
}

/// The sessions of one project, for a request that reports coverage; as
/// [`scan_projects_reporting`], every other command keeps
/// [`load_stats_sessions`].
fn load_sessions_reporting(
    provider: StatsProvider,
    project_path: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeSession>, String> {
    use crate::providers as p;
    use StatsProvider as P;
    match provider {
        P::Antigravity => p::antigravity::load_sessions_reporting(project_path, report),
        P::Cline => p::cline::load_sessions_reporting(project_path, report),
        P::Codex => p::codex::load_sessions_reporting(project_path, report),
        P::Copilot => p::copilot::load_sessions_reporting(project_path, report),
        P::Cursor => p::cursor::load_sessions_reporting(project_path, report),
        P::ForgeCode => p::forgecode::load_sessions_reporting(project_path, report),
        P::Gemini => p::gemini::load_sessions_reporting(project_path, report),
        P::Grok => p::grok::load_sessions_reporting(project_path, report),
        P::Kilo => p::kilo::load_sessions_reporting(project_path, report),
        P::Kimi => p::kimi::load_sessions_reporting(project_path, report),
        P::Llm => p::llm::load_sessions_reporting(project_path, report),
        P::Ompi => p::ompi::load_sessions_reporting(project_path, report),
        P::OpenCode => p::opencode::load_sessions_reporting(project_path, report),
        P::OpenInterpreter => p::openinterpreter::load_sessions_reporting(project_path, report),
        P::Pi => p::pi::load_sessions_reporting(project_path, report),
        P::Qwen => p::qwen::load_sessions_reporting(project_path, report),
        P::Zcode => p::zcode::load_sessions_reporting(project_path, report),
        P::Aider
        | P::AmazonQ
        | P::Claude
        | P::Codebuddy
        | P::Continue
        | P::Crush
        | P::CursorAgent
        | P::Goose
        | P::Kiro
        | P::OpenHands
        | P::PearAI
        | P::Trae
        | P::Vibe
        | P::Zed => load_stats_sessions(provider, project_path),
    }
}

fn collect_provider_sessions(
    provider: StatsProvider,
    tasks: Vec<(String, ClaudeSession)>,
    mode: StatsMode,
    scan: &mut ProviderScan,
) -> Vec<SessionInput> {
    let results: Vec<(String, ClaudeSession, Result<FileContributions, String>)> = tasks
        .into_par_iter()
        .map(|(project_path, session)| {
            let result = load_provider_session(provider, &session, mode);
            (project_path, session, result)
        })
        .collect();
    let mut sessions = Vec::new();
    for (project_path, session, result) in results {
        match result {
            Ok(file) => {
                scan.sessions_scanned += 1;
                sessions.push(SessionInput {
                    provider,
                    file_path: session.file_path,
                    project_path,
                    files: vec![Arc::new(file)],
                    fallback_session_id: session.actual_session_id,
                    title: session.summary,
                });
            }
            Err(error) => {
                log::warn!("usage breakdown: {}: {error}", session.file_path);
                scan.sessions_failed += 1;
            }
        }
    }
    sessions
}

fn load_provider_session(
    provider: StatsProvider,
    session: &ClaudeSession,
    mode: StatsMode,
) -> Result<FileContributions, String> {
    if provider == StatsProvider::Antigravity {
        let records = load_antigravity_usage_records_checked(&session.file_path)?;
        return Ok(from_antigravity_records(
            &records,
            mode,
            &session.actual_session_id,
            session.summary.clone(),
        ));
    }
    // A Cline session lists a file (`tasks/<id>/ui_messages.json`, or
    // `<id>.messages.json` in the SDK store), but the Cline loader takes the
    // session's `cline://` id: the file alone does not name its store.
    let session_path = if provider == StatsProvider::Cline {
        &session.session_id
    } else {
        &session.file_path
    };
    let messages = load_stats_messages(provider, session_path)?;
    Ok(from_messages(&messages, mode, session.summary.clone()))
}
