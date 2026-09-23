#![recursion_limit = "256"]

mod contacts;
mod db;
mod ledger;
mod matrix;
mod media;
mod paths;
#[cfg(debug_assertions)]
mod probe;
mod tdlib;
mod vault;
mod web_login;

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
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(feature = "updater")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(db::Databases::default())
        .manage(vault::Vault::default())
        .manage(ledger::Ledger::default())
        .manage(tdlib::Telegram::default())
        .manage(matrix::Matrix::default())
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
            tdlib::td_create,
            tdlib::td_send,
            tdlib::td_receive,
            tdlib::td_destroy,
            paths::account_dir,
            paths::erase_account_dir,
            web_login::web_login_open,
            web_login::web_login_poll,
            web_login::web_login_close,
            matrix::mx_start,
            matrix::mx_login,
            matrix::mx_logout,
            matrix::mx_room,
            matrix::mx_messages,
            matrix::mx_members,
            matrix::mx_profile,
            matrix::mx_create_dm,
            matrix::mx_create_room,
            matrix::mx_invite,
            matrix::mx_kick,
            matrix::mx_set_name,
            matrix::mx_join,
            matrix::mx_leave,
            matrix::mx_ignore,
            matrix::mx_send,
            matrix::mx_toggle_reaction,
            matrix::mx_mark_read,
            matrix::mx_media,
            matrix::mx_close,
            matrix::mx_erase,
            set_badge,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        // matrix-sdk traces through `tracing`; only its warnings belong in the log.
                        .level_for("matrix_sdk", log::LevelFilter::Warn)
                        .level_for("matrix_sdk_base", log::LevelFilter::Warn)
                        .level_for("matrix_sdk_crypto", log::LevelFilter::Warn)
                        .level_for("matrix_sdk_sqlite", log::LevelFilter::Warn)
                        .level_for("matrix_sdk_ui", log::LevelFilter::Warn)
                        .level_for("tracing::span", log::LevelFilter::Off)
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
