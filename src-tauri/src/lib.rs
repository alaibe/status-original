#![recursion_limit = "256"]

pub mod cli;
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

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

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

/// An app opened from Finder gets launchd's soft limit of 256 open files, too
/// few for TDLib, Matrix and SQLCipher together. 10240 is the most macOS allows.
#[cfg(unix)]
fn raise_open_file_limit() {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    unsafe {
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
            return;
        }
        limit.rlim_cur = limit.rlim_cur.max(limit.rlim_max.min(10240));
        libc::setrlimit(libc::RLIMIT_NOFILE, &limit);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    raise_open_file_limit();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Release only: a debug build must be able to run beside the installed app.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            cli::show_main(app)
        }));
    }
    #[cfg(feature = "updater")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .manage(db::Databases::default())
        .manage(vault::Vault::default())
        .manage(ledger::Ledger::default())
        .manage(tdlib::Telegram::default())
        .manage(matrix::Matrix::default())
        .manage(cli::Cli::default())
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
            matrix::mx_preview_public_room,
            matrix::mx_join_public_room,
            matrix::mx_knock_public_room,
            matrix::mx_create_dm,
            matrix::mx_create_room,
            matrix::mx_invite,
            matrix::mx_kick,
            matrix::mx_ban,
            matrix::mx_set_power_level,
            matrix::mx_set_name,
            matrix::mx_join,
            matrix::mx_leave,
            matrix::mx_ignore,
            matrix::mx_send,
            matrix::mx_toggle_reaction,
            matrix::mx_redact,
            matrix::mx_pinned_messages,
            matrix::mx_set_pinned,
            matrix::mx_edit,
            matrix::mx_mark_read,
            matrix::mx_set_marked_unread,
            matrix::mx_set_typing,
            matrix::mx_create_poll,
            matrix::mx_vote_poll,
            matrix::mx_media,
            matrix::mx_close,
            matrix::mx_erase,
            cli::cli_install,
            cli::cli_ready,
            cli::cli_send,
            cli::cli_show,
            set_badge,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let webview = window.app_handle().get_webview_window(window.label());
                if let Some(webview) = webview.filter(|_| window.state::<cli::Cli>().has_clients())
                {
                    api.prevent_close();
                    cli::hide_main(&webview);
                }
            }
        })
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
            cli::serve(app.handle());
            if cli::launched_in_background() {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            } else {
                cli::show_main(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                cli::show_main(app);
            }
        });
}
