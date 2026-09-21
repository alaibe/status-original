//! Debug builds only: JavaScript written to `probe.js` in the app data
//! directory runs in the window. Its console output reaches the Metro log,
//! which is the only console the desktop build has during development.

use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

pub fn watch(app: AppHandle) {
    let Ok(path) = app.path().app_data_dir().map(|dir| dir.join("probe.js")) else {
        return;
    };
    std::thread::spawn(move || {
        let mut seen = SystemTime::UNIX_EPOCH;
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else {
                continue;
            };
            if modified <= seen {
                continue;
            }
            seen = modified;
            if let (Ok(js), Some(window)) = (std::fs::read_to_string(&path), app.get_webview_window("main")) {
                let _ = window.eval(&js);
            }
        }
    });
}
