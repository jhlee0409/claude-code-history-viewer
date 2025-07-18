use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub app_version: String,
    pub os_type: String,
    pub os_version: String,
    pub arch: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedbackData {
    pub subject: String,
    pub body: String,
    pub include_system_info: bool,
    pub feedback_type: String, // "bug", "feature", "improvement", "other"
}

#[tauri::command]
pub async fn send_feedback(feedback: FeedbackData) -> Result<(), String> {
    let mut email_body = feedback.body.clone();

    // 시스템 정보 포함
    if feedback.include_system_info {
        let system_info = get_system_info().await?;
        email_body.push_str("\n\n---\n");
        email_body.push_str("System Information:\n");
        email_body.push_str(&format!("App Version: {}\n", system_info.app_version));
        email_body.push_str(&format!("OS: {} {}\n", system_info.os_type, system_info.os_version));
        email_body.push_str(&format!("Architecture: {}\n", system_info.arch));
    }

    // 피드백 타입에 따른 이메일 주제 조정
    let email_subject = match feedback.feedback_type.as_str() {
        "bug" => format!("[Bug Report] {}", feedback.subject),
        "feature" => format!("[Feature Request] {}", feedback.subject),
        "improvement" => format!("[Improvement] {}", feedback.subject),
        _ => format!("[Feedback] {}", feedback.subject),
    };

    // URL 인코딩
    let encoded_subject = urlencoding::encode(&email_subject);
    let encoded_body = urlencoding::encode(&email_body);

    // mailto 링크 생성

    let feedback_email = std::env::var("FEEDBACK_EMAIL")
        .unwrap_or_else(|_| "feedback@claude-history-viewer.app".to_string());
    let mailto_url = format!(
         "mailto:{}?subject={}&body={}",
         feedback_email,
         encoded_subject,
         encoded_body
    );

    // 시스템 기본 이메일 앱으로 열기
    tauri_plugin_opener::open_url(mailto_url, None::<String>)
        .map_err(|e| format!("Failed to open email client: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os_type: std::env::consts::OS.to_string(),
        os_version: "Unknown".to_string(), // OS 플러그인에서 가져올 수 있음
        arch: std::env::consts::ARCH.to_string(),
    })
}

#[tauri::command]
pub async fn open_github_issues() -> Result<(), String> {
    let github_url = "https://github.com/jhlee0409/claude-code-history-viewer/issues/new";

    tauri_plugin_opener::open_url(github_url, None::<String>)
        .map_err(|e| format!("Failed to open GitHub: {}", e))?;

    Ok(())
}