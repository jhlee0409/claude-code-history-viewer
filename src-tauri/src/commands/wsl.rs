use crate::wsl;

#[tauri::command]
pub async fn detect_wsl_distros() -> Result<Vec<wsl::WslDistro>, String> {
    Ok(wsl::detect_distros())
}

#[tauri::command]
pub async fn is_wsl_available() -> Result<bool, String> {
    Ok(wsl::is_wsl_available())
}
