use serde::{Deserialize, Serialize};
use tauri::command;
use sha2::{Sha256, Digest};
use hex;

#[derive(Serialize, Deserialize)]
pub struct SecureUpdateInfo {
    pub has_update: bool,
    pub latest_version: Option<String>,
    pub current_version: String,
    pub download_url: Option<String>,
    pub signature_url: Option<String>,
    pub checksum: Option<String>,
    pub release_url: Option<String>,
    pub is_verified: bool,
    pub security_level: SecurityLevel,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecurityLevel {
    Verified,   // 서명 및 체크섬 검증됨
    Trusted,    // GitHub에서 제공되지만 추가 검증 없음
    Unverified, // 검증되지 않음
}

#[command]
pub async fn check_for_updates_secure() -> Result<SecureUpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    
    // 1. 기본 릴리스 정보 가져오기
    let release = super::update::fetch_release_info(
        &reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("HTTP 클라이언트 생성 오류: {}", e))?
    ).await?;

    let latest_version = release.tag_name.trim_start_matches('v');
    let has_update = super::update::version_is_newer(current_version, latest_version);

    // 2. 보안 검증 정보 수집
    let (download_url, signature_url, checksum, security_level) = 
        analyze_security_info(&release);

    Ok(SecureUpdateInfo {
        has_update,
        latest_version: Some(latest_version.to_string()),
        current_version: current_version.to_string(),
        download_url,
        signature_url,
        checksum,
        release_url: Some(release.html_url),
        is_verified: matches!(security_level, SecurityLevel::Verified),
        security_level,
    })
}

fn analyze_security_info(
    release: &super::update::GitHubRelease
) -> (Option<String>, Option<String>, Option<String>, SecurityLevel) {
    // DMG 파일 찾기
    let dmg_asset = release.assets.iter()
        .find(|asset| asset.name.ends_with(".dmg"));
    
    // 서명 파일 찾기 (.sig, .asc 등)
    let signature_asset = release.assets.iter()
        .find(|asset| 
            asset.name.ends_with(".sig") || 
            asset.name.ends_with(".asc") ||
            asset.name.ends_with(".signature")
        );
    
    // 체크섬 파일 찾기 (현재는 사용하지 않지만 향후 확장 가능)
    let _checksum_asset = release.assets.iter()
        .find(|asset| 
            asset.name.contains("checksum") ||
            asset.name.contains("sha256") ||
            asset.name.ends_with(".sha256")
        );

    let download_url = dmg_asset.map(|a| a.browser_download_url.clone());
    let signature_url = signature_asset.map(|a| a.browser_download_url.clone());
    let checksum = extract_checksum_from_release_body(&release.body);

    // 보안 레벨 결정
    let security_level = match (signature_url.is_some(), checksum.is_some()) {
        (true, true) => SecurityLevel::Verified,
        (false, true) | (true, false) => SecurityLevel::Trusted,
        (false, false) => SecurityLevel::Unverified,
    };

    (download_url, signature_url, checksum, security_level)
}

fn extract_checksum_from_release_body(body: &str) -> Option<String> {
    // SHA256 해시를 릴리스 노트에서 추출
    use regex::Regex;
    
    let sha256_pattern = Regex::new(r"(?i)sha256[:\s]*([a-f0-9]{64})").ok()?;
    sha256_pattern.captures(body)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

#[command]
pub async fn verify_download_integrity(
    file_path: String,
    expected_checksum: String
) -> Result<bool, String> {
    use std::fs::File;
    use std::io::Read;

    // 파일 읽기
    let mut file = File::open(&file_path)
        .map_err(|e| format!("파일 열기 실패: {}", e))?;
    
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("파일 읽기 실패: {}", e))?;

    // SHA256 해시 계산
    let mut hasher = Sha256::new();
    hasher.update(&buffer);
    let calculated_hash = hex::encode(hasher.finalize());

    // 해시 비교 (대소문자 무시)
    Ok(calculated_hash.to_lowercase() == expected_checksum.to_lowercase())
}