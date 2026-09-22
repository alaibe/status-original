//! Where the app keeps its files, and the names the page may choose for them.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub fn safe_component(value: &str, what: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && !value.starts_with('.')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid {what}: {value}"))
    }
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The areas a protocol may keep under the app data directory, one subdirectory per account.
const ACCOUNT_AREAS: &[&str] = &["tdlib", "matrix"];

fn account_path(app: &AppHandle, area: &str, account_id: &str) -> Result<PathBuf, String> {
    if !ACCOUNT_AREAS.contains(&area) {
        return Err(format!("Unknown area: {area}"));
    }
    safe_component(account_id, "account")?;
    Ok(data_dir(app, area)?.join(account_id))
}

#[tauri::command]
pub async fn account_dir(
    app: AppHandle,
    area: String,
    account_id: String,
) -> Result<String, String> {
    let dir = account_path(&app, &area, &account_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn erase_account_dir(
    app: AppHandle,
    area: String,
    account_id: String,
) -> Result<(), String> {
    remove_dir(&account_path(&app, &area, &account_id)?)
}

pub fn remove_dir(dir: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
