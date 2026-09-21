//! Attachments and other downloaded media, one directory per account under
//! the app data directory. The page displays them through the asset protocol.

use std::path::PathBuf;

use base64::prelude::*;
use tauri::AppHandle;

use crate::paths::{data_dir, safe_component};

fn media_path(app: &AppHandle, account_id: &str, area: &str, name: &str) -> Result<PathBuf, String> {
    safe_component(account_id, "account")?;
    safe_component(area, "area")?;
    safe_component(name, "name")?;
    Ok(data_dir(app, "media")?.join(account_id).join(area).join(name))
}

/// Writes the file unless it already exists, and returns its path.
#[tauri::command]
pub async fn media_write(
    app: AppHandle,
    account_id: String,
    area: String,
    name: String,
    base64: String,
) -> Result<String, String> {
    let path = media_path(&app, &account_id, &area, &name)?;
    if !path.exists() {
        let bytes = BASE64_STANDARD.decode(base64).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(path.parent().expect("media dir")).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn media_stat(
    app: AppHandle,
    account_id: String,
    area: String,
    name: String,
) -> Result<Option<(String, u64)>, String> {
    let path = media_path(&app, &account_id, &area, &name)?;
    match std::fs::metadata(&path) {
        Ok(meta) => Ok(Some((path.to_string_lossy().into_owned(), meta.len()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn media_erase(app: AppHandle, account_id: String) -> Result<(), String> {
    safe_component(&account_id, "account")?;
    let dir = data_dir(&app, "media")?.join(&account_id);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
