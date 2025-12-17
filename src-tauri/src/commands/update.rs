use serde::{Deserialize, Serialize};
use tauri::command;
use regex::Regex;
use chrono::{DateTime, Utc};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum UpdatePriority {
    Critical,
    Recommended,
    Optional,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum UpdateType {
    Hotfix,
    Feature,
    Patch,
    Major,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateMessage {
    pub title: String,
    pub description: String,
    pub features: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateMetadata {
    pub priority: UpdatePriority,
    pub r#type: UpdateType,
    pub force_update: bool,
    pub minimum_version: Option<String>,
    pub deadline: Option<String>,
    pub message: UpdateMessage,
}

#[derive(Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: Option<String>,
    pub current_version: String,
    pub download_url: Option<String>,
    pub release_url: Option<String>,
    pub metadata: Option<UpdateMetadata>,
    pub is_forced: bool,
    pub days_until_deadline: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub html_url: String,
    pub published_at: String,
    pub body: String,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10)) // 30초 → 10초로 단축
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 오류: {}", e))?;

    // 재시도 로직 (최대 2회 시도로 단축)
    let mut last_error = String::new();
    for attempt in 1..=2 {
        match fetch_release_info(&client).await {
            Ok(release) => {
                return process_release_info(current_version, release);
            }
            Err(e) => {
                last_error = e;
                if attempt < 2 {
                    // 재시도 전 짧은 대기 (500ms)
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            }
        }
    }

    Err(format!("2번 시도 후 실패: {}", last_error))
}

pub async fn fetch_release_info(client: &reqwest::Client) -> Result<GitHubRelease, String> {
    let response = client
        .get("https://api.github.com/repos/jhlee0409/claude-code-history-viewer/releases/latest")
        .header("User-Agent", "Claude-Code-History-Viewer")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("네트워크 오류: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("릴리즈 정보를 가져올 수 없습니다 (HTTP {}): {}", status, error_text));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("응답 해석 오류: {}", e))?;

    Ok(release)
}

fn process_release_info(current_version: &str, release: GitHubRelease) -> Result<UpdateInfo, String> {
    let latest_version = release.tag_name.trim_start_matches('v');
    let has_update = version_is_newer(current_version, latest_version);

    let metadata = parse_metadata_from_body(&release.body);
    let is_forced = metadata.as_ref()
        .map(|m| m.force_update)
        .unwrap_or(false);

    let days_until_deadline = metadata.as_ref()
        .and_then(|m| m.deadline.as_ref())
        .and_then(|deadline| calculate_days_until_deadline(deadline).ok());

    // 최소 버전 체크
    let meets_minimum_version = metadata.as_ref()
        .and_then(|m| m.minimum_version.as_ref())
        .map(|min_ver| version_is_newer_or_equal(current_version, min_ver))
        .unwrap_or(true);

    let final_is_forced = is_forced && meets_minimum_version;

    // DMG 다운로드 URL 찾기 (macOS)
    let dmg_asset = release.assets.iter()
        .find(|asset| asset.name.ends_with(".dmg"));

    Ok(UpdateInfo {
        has_update,
        latest_version: Some(latest_version.to_string()),
        current_version: current_version.to_string(),
        download_url: dmg_asset.map(|asset| asset.browser_download_url.clone()),
        release_url: Some(release.html_url),
        metadata,
        is_forced: final_is_forced,
        days_until_deadline,
    })
}

pub fn parse_metadata_from_body(body: &str) -> Option<UpdateMetadata> {
    let re = Regex::new(r"<!-- UPDATE_METADATA\s*\n(.*?)\n-->");

    if let Ok(regex) = re {
        if let Some(captures) = regex.captures(body) {
            let json_str = captures.get(1)?.as_str();
            serde_json::from_str(json_str).ok()
        } else {
            None
        }
    } else {
        None
    }
}

fn calculate_days_until_deadline(deadline: &str) -> Result<i64, String> {
    let deadline_dt = DateTime::parse_from_rfc3339(deadline)
        .map_err(|e| format!("날짜 형식 오류: {}", e))?;
    let now = Utc::now();
    let duration = deadline_dt.signed_duration_since(now);

    Ok(duration.num_days())
}

/// Parses a semantic version string into (major, minor, patch, prerelease_type, prerelease_num)
/// Examples:
/// - "1.0.0" -> (1, 0, 0, None, None)
/// - "1.0.0-beta.3" -> (1, 0, 0, Some("beta"), Some(3))
/// - "1.0.0-alpha.1" -> (1, 0, 0, Some("alpha"), Some(1))
fn parse_semver(version: &str) -> (u32, u32, u32, Option<String>, Option<u32>) {
    // Split version and prerelease parts
    let parts: Vec<&str> = version.splitn(2, '-').collect();
    let version_str = parts[0];
    let prerelease_str = parts.get(1);

    // Parse major.minor.patch
    let version_parts: Vec<u32> = version_str
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    let major = *version_parts.first().unwrap_or(&0);
    let minor = *version_parts.get(1).unwrap_or(&0);
    let patch = *version_parts.get(2).unwrap_or(&0);

    // Parse prerelease if present (e.g., "beta.3" or "alpha.1")
    let (prerelease_type, prerelease_num) = if let Some(pre) = prerelease_str {
        let pre_parts: Vec<&str> = pre.splitn(2, '.').collect();
        let pre_type = Some(pre_parts[0].to_lowercase());
        let pre_num = pre_parts.get(1).and_then(|s| s.parse().ok());
        (pre_type, pre_num)
    } else {
        (None, None)
    };

    (major, minor, patch, prerelease_type, prerelease_num)
}

pub fn version_is_newer(current: &str, latest: &str) -> bool {
    let (cur_major, cur_minor, cur_patch, cur_pre_type, cur_pre_num) = parse_semver(current);
    let (lat_major, lat_minor, lat_patch, lat_pre_type, lat_pre_num) = parse_semver(latest);

    // Compare major.minor.patch first
    match lat_major.cmp(&cur_major) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }

    match lat_minor.cmp(&cur_minor) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }

    match lat_patch.cmp(&cur_patch) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }

    // Same version number, compare prerelease
    // A release version (no prerelease) is newer than any prerelease
    match (&cur_pre_type, &lat_pre_type) {
        (Some(_), None) => true,  // current is prerelease, latest is release
        (None, Some(_)) => false, // current is release, latest is prerelease
        (None, None) => false,    // both are releases, same version
        (Some(cur_type), Some(lat_type)) => {
            // Compare prerelease types: alpha < beta < rc
            let type_order = |t: &str| -> u32 {
                match t {
                    "alpha" => 0,
                    "beta" => 1,
                    "rc" => 2,
                    _ => 3,
                }
            };

            let cur_order = type_order(cur_type);
            let lat_order = type_order(lat_type);

            match lat_order.cmp(&cur_order) {
                std::cmp::Ordering::Greater => return true,
                std::cmp::Ordering::Less => return false,
                std::cmp::Ordering::Equal => {}
            }

            // Same prerelease type, compare numbers
            match (cur_pre_num, lat_pre_num) {
                (Some(cur_n), Some(lat_n)) => lat_n > cur_n,
                (None, Some(_)) => true,
                (Some(_), None) => false,
                (None, None) => false,
            }
        }
    }
}

fn version_is_newer_or_equal(current: &str, minimum: &str) -> bool {
    // current >= minimum: returns true if current is newer than or equal to minimum
    !version_is_newer(current, minimum)
}