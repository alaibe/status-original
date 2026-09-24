pub mod client;
mod transport;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use interprocess::local_socket::{prelude::*, SendHalf, Stream};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub const BACKGROUND: &str = "--background";

/// A copy started for the command line, with no window and nobody talking to
/// it, quits after this long.
const IDLE_QUIT: Duration = Duration::from_secs(10 * 60);

pub struct Cli {
    clients: Mutex<HashMap<u64, Arc<Mutex<SendHalf>>>>,
    /// Requests that arrived before the page was listening.
    queue: Mutex<Option<Vec<Value>>>,
    next_id: AtomicU64,
    last_activity: Mutex<Instant>,
}

impl Default for Cli {
    fn default() -> Self {
        Self {
            clients: Mutex::default(),
            queue: Mutex::new(Some(Vec::new())),
            next_id: AtomicU64::new(1),
            last_activity: Mutex::new(Instant::now()),
        }
    }
}

impl Cli {
    pub fn has_clients(&self) -> bool {
        !self.clients.lock().unwrap().is_empty()
    }

    fn touch(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    fn deliver<R: Runtime>(&self, app: &AppHandle<R>, payload: Value) {
        let mut queue = self.queue.lock().unwrap();
        match queue.as_mut() {
            Some(pending) => pending.push(payload),
            None => {
                let _ = app.emit("cli://message", payload);
            }
        }
    }

    /// Written outside the map lock, so a terminal slow to read holds up only itself.
    fn write(&self, id: u64, message: &Value) -> std::io::Result<()> {
        let writer = if message["type"] == "exit" {
            self.clients.lock().unwrap().remove(&id)
        } else {
            self.clients.lock().unwrap().get(&id).cloned()
        };
        match writer {
            Some(writer) => write_line(&mut *writer.lock().unwrap(), message),
            None => Ok(()),
        }
    }
}

pub(crate) fn write_line(writer: &mut impl Write, message: &Value) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(message)?;
    line.push(b'\n');
    writer.write_all(&line)
}

pub fn launched_in_background() -> bool {
    std::env::args().any(|arg| arg == BACKGROUND)
}

pub fn serve<R: Runtime>(app: &AppHandle<R>) {
    let listener = match transport::listen() {
        Ok(listener) => listener,
        Err(error) => {
            log::warn!("[cli] not accepting commands: {error}");
            return;
        }
    };
    let accepting = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming().filter_map(Result::ok) {
            let app = accepting.clone();
            thread::spawn(move || converse(app, stream));
        }
    });
    let idle = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let cli = idle.state::<Cli>();
        let hidden = idle
            .get_webview_window("main")
            .is_none_or(|window| !window.is_visible().unwrap_or(false));
        if hidden && !cli.has_clients() && cli.last_activity.lock().unwrap().elapsed() > IDLE_QUIT {
            idle.exit(0);
        }
    });
}

fn converse<R: Runtime>(app: AppHandle<R>, stream: Stream) {
    let cli = app.state::<Cli>();
    let id = cli.next_id.fetch_add(1, Ordering::Relaxed);
    let (reader, writer) = stream.split();
    cli.clients
        .lock()
        .unwrap()
        .insert(id, Arc::new(Mutex::new(writer)));
    cli.touch();

    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        cli.touch();
        if message["type"] == "request" && message["argv"][0] == "quit" {
            let _ = cli.write(id, &json!({ "type": "exit", "code": 0 }));
            app.exit(0);
            return;
        }
        cli.deliver(&app, json!({ "id": id, "message": message }));
    }

    cli.clients.lock().unwrap().remove(&id);
    cli.deliver(&app, json!({ "id": id, "closed": true }));
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_main<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// The page is listening: hand it whatever came in while it loaded.
#[tauri::command]
pub fn cli_ready(app: AppHandle, cli: tauri::State<'_, Cli>) {
    let pending = cli.queue.lock().unwrap().take();
    for payload in pending.into_iter().flatten() {
        let _ = app.emit("cli://message", payload);
    }
}

#[tauri::command(async)]
pub fn cli_send(cli: tauri::State<'_, Cli>, id: u64, message: Value) -> Result<(), String> {
    cli.write(id, &message).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cli_show(app: AppHandle) {
    show_main(&app);
}

#[derive(serde::Serialize)]
pub struct Install {
    installed: bool,
    /// What to run in a terminal to put `status-original` on the PATH.
    command: Option<String>,
}

/// The installers put the command on the PATH; a copy dragged out of a disk
/// image, the App Store build and an AppImage cannot, so they get a one-liner.
#[tauri::command]
pub fn cli_install() -> Install {
    let exe = std::env::current_exe()
        .and_then(|exe| exe.canonicalize())
        .unwrap_or_default();
    let links_here = |link: &std::path::Path| {
        link.canonicalize()
            .is_ok_and(|target| target == exe || Some(target.as_os_str()) == appimage().as_deref())
    };
    let quoted =
        |path: &std::ffi::OsStr| format!("'{}'", path.to_string_lossy().replace('\'', r"'\''"));

    if cfg!(target_os = "macos") {
        let link = std::path::Path::new("/usr/local/bin/status-original");
        return Install {
            installed: links_here(link),
            command: Some(format!(
                "sudo mkdir -p /usr/local/bin && sudo ln -sf {} /usr/local/bin/status-original",
                quoted(exe.as_os_str())
            )),
        };
    }
    if let Some(image) = appimage() {
        let link = dirs::home_dir()
            .unwrap_or_default()
            .join(".local/bin/status-original");
        return Install {
            installed: links_here(&link),
            command: Some(format!(
                "mkdir -p ~/.local/bin && ln -sf {} ~/.local/bin/status-original",
                quoted(&image)
            )),
        };
    }
    Install {
        installed: true,
        command: None,
    }
}

fn appimage() -> Option<std::ffi::OsString> {
    std::env::var_os("APPIMAGE")
}
