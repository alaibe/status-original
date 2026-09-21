mod contacts;
mod db;
mod ledger;
mod media;
mod paths;
#[cfg(debug_assertions)]
mod probe;
mod vault;

use tauri::{AppHandle, Manager};

/// The unread count on the Dock icon; zero clears it.
#[tauri::command]
async fn set_badge(app: AppHandle, count: i64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count(if count > 0 { Some(count) } else { None })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(db::Databases::default())
        .manage(vault::Vault::default())
        .manage(ledger::Ledger::default())
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_exec,
            db::db_run,
            db::db_all,
            db::db_close,
            db::db_delete,
            vault::vault_get,
            vault::vault_set,
            vault::vault_delete,
            ledger::ledger_list,
            ledger::ledger_open,
            ledger::ledger_exchange,
            ledger::ledger_close,
            media::media_write,
            media::media_stat,
            media::media_erase,
            contacts::contacts_access,
            contacts::contacts_request,
            contacts::contacts_read,
            set_badge,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(debug_assertions)]
            probe::watch(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
