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
