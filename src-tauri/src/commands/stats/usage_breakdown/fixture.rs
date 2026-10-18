//! Test fixture builder and reference scan for the usage-breakdown
//! reconciliation tests.
//!
//! The builder writes Claude JSONL rows into a temporary `projects/<name>`
//! directory; the reference scan sums the **same rows** (kept in memory)
//! with an inclusion predicate passed as an argument. Called with the old
//! inclusive predicate it must reproduce the old commands; called with the
//! half-open interval predicate it is the expectation for `AN0b`.

use super::{timestamp_ms_floor, PricingSource, UsageInterval};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// One assistant request row. Build with [`row`] and the setters.
#[derive(Debug, Clone)]
pub struct FixtureRow {
    pub file: String,
    pub session_id: String,
    /// `None` omits the `uuid` field from the JSONL row.
    pub uuid: Option<String>,
    /// `None` omits `message.id`; `Some("")` writes an empty id.
    pub message_id: Option<String>,
    pub timestamp: Option<String>,
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
    pub cost_usd: Option<f64>,
    pub sidechain: bool,
}

/// A row in `file` (session file stem) with a unique uuid and message id.
pub fn row(file: &str, uuid: &str, timestamp: &str) -> FixtureRow {
    FixtureRow {
        file: file.to_string(),
        session_id: file.to_string(),
        uuid: Some(uuid.to_string()),
        message_id: Some(format!("msg-{uuid}")),
        timestamp: Some(timestamp.to_string()),
        model: Some(SONNET.to_string()),
        service_tier: None,
        input: 0,
        output: 0,
        cache_creation: 0,
        cache_read: 0,
        cost_usd: None,
        sidechain: false,
    }
}

pub const SONNET: &str = "claude-sonnet-4-5-20250929";
pub const HAIKU: &str = "claude-haiku-5-5";

impl FixtureRow {
    pub fn tokens(mut self, input: u64, output: u64, cache_creation: u64, cache_read: u64) -> Self {
        self.input = input;
        self.output = output;
        self.cache_creation = cache_creation;
        self.cache_read = cache_read;
        self
    }
    pub fn model(mut self, model: &str) -> Self {
        self.model = Some(model.to_string());
        self
    }
    pub fn no_model(mut self) -> Self {
        self.model = None;
        self
    }
    pub fn tier(mut self, tier: &str) -> Self {
        self.service_tier = Some(tier.to_string());
        self
    }
    pub fn cost(mut self, cost_usd: f64) -> Self {
        self.cost_usd = Some(cost_usd);
        self
    }
    pub fn undated(mut self) -> Self {
        self.timestamp = None;
        self
    }
    pub fn message_id(mut self, id: &str) -> Self {
        self.message_id = Some(id.to_string());
        self
    }
    pub fn no_message_id(mut self) -> Self {
        self.message_id = None;
        self
    }
    pub fn no_uuid(mut self) -> Self {
        self.uuid = None;
        self
    }
    /// Writes `sessionId` = `id` (defaults to the file stem).
    pub fn session(mut self, id: &str) -> Self {
        self.session_id = id.to_string();
        self
    }
    pub fn sidechain(mut self) -> Self {
        self.sidechain = true;
        self
    }

    fn to_json(&self) -> Value {
        let mut usage = json!({
            "input_tokens": self.input,
            "output_tokens": self.output,
            "cache_creation_input_tokens": self.cache_creation,
            "cache_read_input_tokens": self.cache_read,
        });
        if let Some(tier) = &self.service_tier {
            usage["service_tier"] = json!(tier);
        }
        let mut message = json!({
            "role": "assistant",
            "content": [{"type": "text", "text": "fixture"}],
            "usage": usage,
        });
        if let Some(id) = &self.message_id {
            message["id"] = json!(id);
        }
        if let Some(model) = &self.model {
            message["model"] = json!(model);
        }
        let mut entry = json!({
            "sessionId": self.session_id,
            "type": "assistant",
            "isSidechain": self.sidechain,
            "message": message,
        });
        if let Some(uuid) = &self.uuid {
            entry["uuid"] = json!(uuid);
        }
        if let Some(ts) = &self.timestamp {
            entry["timestamp"] = json!(ts);
        }
        if let Some(cost) = self.cost_usd {
            entry["costUSD"] = json!(cost);
        }
        entry
    }

    pub fn timestamp_ms(&self) -> Option<i64> {
        self.timestamp
            .as_deref()
            .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
            .map(|dt| timestamp_ms_floor(&dt.with_timezone(&Utc)))
    }
}

/// A Claude root with one project whose session files hold the given rows.
pub struct UsageFixture {
    _temp: TempDir,
    root: PathBuf,
    project_dir: PathBuf,
    pub rows: Vec<FixtureRow>,
}

impl UsageFixture {
    pub fn write(project: &str, rows: Vec<FixtureRow>) -> Self {
        let temp = TempDir::new().expect("temp dir");
        let root = temp.path().to_path_buf();
        let project_dir = root.join("projects").join(project);
        fs::create_dir_all(&project_dir).expect("project dir");
        let mut files: BTreeMap<&str, String> = BTreeMap::new();
        for r in &rows {
            let body = files.entry(r.file.as_str()).or_default();
            body.push_str(&r.to_json().to_string());
            body.push('\n');
        }
        for (file, body) in files {
            fs::write(project_dir.join(format!("{file}.jsonl")), body).expect("session file");
        }
        Self {
            _temp: temp,
            root,
            project_dir,
            rows,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn project_path(&self) -> String {
        self.project_dir.to_string_lossy().to_string()
    }
}

/// Summed usage of one reference bucket.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RefTotals {
    pub message_count: u64,
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
    pub cost_usd: Option<f64>,
}

impl RefTotals {
    pub fn token_count(&self) -> u64 {
        self.input + self.output + self.cache_creation + self.cache_read
    }
}

/// (model, service tier, pricing source) — the bucket key inside one
/// provider (fixtures are Claude-only).
pub type RefKey = (String, Option<String>, PricingSource);

#[derive(Debug, Default)]
pub struct RefScan {
    pub buckets: BTreeMap<RefKey, RefTotals>,
    pub undated_rows: u64,
    pub sessions: HashSet<String>,
}

/// Dedup identity of a row — production's `dedup_usage_key` (#283) inside
/// the per-file state boundary (ADR 0002 §7).
///
/// The source file is the outer namespace (one file belongs to one
/// provider), then the session id. A non-empty message id wins; an empty
/// one counts as missing and the row falls back to its uuid. Message-id and
/// uuid keys are separate variants, so an id equal to another row's uuid
/// never merges them. A row with neither (missing or empty) has no identity
/// and always counts on its own: it is keyed by its row index, which no
/// other row shares.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum DedupIdentity {
    MessageId {
        file: String,
        session_id: String,
        message_id: String,
    },
    Uuid {
        file: String,
        session_id: String,
        uuid: String,
    },
    Unkeyed {
        row_index: usize,
    },
}

fn identity(row_index: usize, r: &FixtureRow) -> DedupIdentity {
    let non_empty = |id: &Option<String>| id.clone().filter(|id| !id.is_empty());
    match (non_empty(&r.message_id), non_empty(&r.uuid)) {
        (Some(message_id), _) => DedupIdentity::MessageId {
            file: r.file.clone(),
            session_id: r.session_id.clone(),
            message_id,
        },
        (None, Some(uuid)) => DedupIdentity::Uuid {
            file: r.file.clone(),
            session_id: r.session_id.clone(),
            uuid,
        },
        (None, None) => DedupIdentity::Unkeyed { row_index },
    }
}

/// Reference scan over `rows` in file order. Dedup state (streamed-request
/// growth and source cost) is kept per [`DedupIdentity`] for **all** rows,
/// before the predicate (ADR 0002 §7). The pricing source is decided per
/// dedup identity (one API request/message, not a user conversation turn):
/// if any row of the identity reports a cost, all of its growth is `Source`
/// and the cost counts once, on its first costed row (§4).
/// `include` receives the floored ms timestamp (`None` for undated rows,
/// which are then only counted).
pub fn reference_scan(rows: &[FixtureRow], include: impl Fn(Option<i64>) -> bool) -> RefScan {
    let mut scan = RefScan::default();
    let costed: HashSet<DedupIdentity> = rows
        .iter()
        .enumerate()
        .filter(|(_, r)| r.cost_usd.is_some())
        .map(|(i, r)| identity(i, r))
        .collect();
    let mut growth_seen: HashMap<DedupIdentity, [u64; 4]> = HashMap::new();
    let mut cost_seen: HashSet<DedupIdentity> = HashSet::new();
    for (row_index, r) in rows.iter().enumerate() {
        let ts = r.timestamp_ms();
        let key = identity(row_index, r);
        let seen = growth_seen.entry(key.clone()).or_default();
        let next = [r.input, r.output, r.cache_creation, r.cache_read];
        let mut grow = [0u64; 4];
        for i in 0..4 {
            grow[i] = next[i].saturating_sub(seen[i]);
            seen[i] = seen[i].max(next[i]);
        }
        let cost = r.cost_usd.filter(|_| cost_seen.insert(key.clone()));
        if ts.is_none() {
            scan.undated_rows += 1;
            continue;
        }
        if !include(ts) {
            continue;
        }
        let source = if costed.contains(&key) {
            PricingSource::Source
        } else {
            PricingSource::Estimate
        };
        let model = r.model.clone().unwrap_or_else(|| "unknown".to_string());
        let totals = scan
            .buckets
            .entry((model, r.service_tier.clone(), source))
            .or_default();
        totals.message_count += 1;
        totals.input += grow[0];
        totals.output += grow[1];
        totals.cache_creation += grow[2];
        totals.cache_read += grow[3];
        if source == PricingSource::Source {
            // A source bucket always carries a cost, 0 when its identity's
            // cost was counted on a row in another interval.
            *totals.cost_usd.get_or_insert(0.0) += cost.unwrap_or(0.0);
        }
        scan.sessions.insert(r.session_id.clone());
    }
    scan
}

/// The old commands' inclusive date filter as a predicate (`start <= ts <= end`).
pub fn legacy_inclusive(start_ms: i64, end_ms: i64) -> impl Fn(Option<i64>) -> bool {
    move |ts| ts.is_some_and(|ts| start_ms <= ts && ts <= end_ms)
}

/// The new API's half-open predicate for one interval.
pub fn half_open(interval: &UsageInterval) -> impl Fn(Option<i64>) -> bool + '_ {
    move |ts| ts.is_some_and(|ts| interval.contains_ms(ts))
}

/// No date filter: every dated row.
pub fn every_dated_row(ts: Option<i64>) -> bool {
    ts.is_some()
}

/// Epoch ms of an RFC 3339 literal.
pub fn ms(rfc3339: &str) -> i64 {
    timestamp_ms_floor(
        &DateTime::parse_from_rfc3339(rfc3339)
            .expect("rfc3339")
            .with_timezone(&Utc),
    )
}

pub fn interval(key: &str, start: &str, end: &str) -> UsageInterval {
    UsageInterval {
        key: key.to_string(),
        start_utc: ms(start),
        end_utc: ms(end),
    }
}
