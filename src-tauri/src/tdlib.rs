//! Telegram through TDLib's JSON interface. `scripts/fetch-tdlib.sh` puts the
//! library where the bundle can reach it, and it is opened on first use:
//! `libtdjson.dylib` in the macOS bundle's Frameworks directory, `tdjson.dll`
//! or `libtdjson.so` as a bundled resource elsewhere. The prebuilt Linux and
//! Windows builds export their static OpenSSL, so `Library::new` must stay on
//! the default RTLD_LOCAL or it would interpose on SQLCipher's.
//! The page drives `td_json_client_*` the way the phone does through
//! react-native-tdlib: one client at a time, requests and replies correlated
//! by `@extra` on the JavaScript side.

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use libloading::Library;
use tauri::{AppHandle, Manager, State};

type CreateFn = unsafe extern "C" fn() -> *mut c_void;
type SendFn = unsafe extern "C" fn(*mut c_void, *const c_char);
type ReceiveFn = unsafe extern "C" fn(*mut c_void, f64) -> *const c_char;
type ExecuteFn = unsafe extern "C" fn(*mut c_void, *const c_char) -> *const c_char;
type DestroyFn = unsafe extern "C" fn(*mut c_void);

struct Api {
    _library: Library,
    create: CreateFn,
    send: SendFn,
    receive: ReceiveFn,
    execute: ExecuteFn,
    destroy: DestroyFn,
}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

fn api(app: &AppHandle) -> Result<&'static Api, String> {
    API.get_or_init(|| load(app)).as_ref().map_err(Clone::clone)
}

fn library_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libtdjson.dylib"
    } else if cfg!(target_os = "windows") {
        "tdjson.dll"
    } else {
        "libtdjson.so"
    }
}

fn library_path(app: &AppHandle) -> Option<PathBuf> {
    let name = library_name();
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
    {
        candidates.push(dir.join("../Frameworks").join(name));
        candidates.push(dir.join(name));
    }
    // Where the bundler puts it on Linux and Windows, which differs per package
    // format, so ask Tauri rather than guess.
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(name));
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("frameworks")
                .join(name),
        );
    }
    candidates.into_iter().find(|path| path.exists())
}

unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    library
        .get::<T>(name)
        .map(|found| *found)
        .map_err(|e| e.to_string())
}

fn load(app: &AppHandle) -> Result<Api, String> {
    let path = library_path(app).ok_or_else(|| {
        "TDLib is not part of this build: `scripts/fetch-tdlib.sh` fetches it.".to_string()
    })?;
    unsafe {
        let library = Library::new(&path).map_err(|e| e.to_string())?;
        Ok(Api {
            create: symbol(&library, b"td_json_client_create\0")?,
            send: symbol(&library, b"td_json_client_send\0")?,
            receive: symbol(&library, b"td_json_client_receive\0")?,
            execute: symbol(&library, b"td_json_client_execute\0")?,
            destroy: symbol(&library, b"td_json_client_destroy\0")?,
            _library: library,
        })
    }
}

struct Client {
    ptr: *mut c_void,
    /// Held while TDLib blocks in receive, and set once the client is gone:
    /// destroying underneath a receive, or receiving after, is undefined.
    gone: Mutex<bool>,
}

unsafe impl Send for Client {}
unsafe impl Sync for Client {}

#[derive(Default)]
pub struct Telegram(Mutex<Option<Arc<Client>>>);

fn current(state: &State<Telegram>) -> Result<Arc<Client>, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No TDLib client".to_string())
}

fn destroy(api: &Api, client: Arc<Client>) {
    let mut gone = client.gone.lock().unwrap();
    if !*gone {
        unsafe { (api.destroy)(client.ptr) };
        *gone = true;
    }
}

async fn discard(api: &'static Api, client: Option<Arc<Client>>) -> Result<(), String> {
    if let Some(client) = client {
        tauri::async_runtime::spawn_blocking(move || destroy(api, client))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn td_create(app: AppHandle, state: State<'_, Telegram>) -> Result<(), String> {
    let api = api(&app)?;
    let previous = state.0.lock().unwrap().take();
    discard(api, previous).await?;

    let ptr = unsafe { (api.create)() };
    let quiet =
        CString::new(r#"{"@type":"setLogVerbosityLevel","new_verbosity_level":0}"#).unwrap();
    unsafe { (api.execute)(ptr, quiet.as_ptr()) };
    *state.0.lock().unwrap() = Some(Arc::new(Client {
        ptr,
        gone: Mutex::new(false),
    }));
    Ok(())
}

#[tauri::command]
pub async fn td_send(
    app: AppHandle,
    state: State<'_, Telegram>,
    request: String,
) -> Result<(), String> {
    let api = api(&app)?;
    let client = current(&state)?;
    let request = CString::new(request).map_err(|e| e.to_string())?;
    unsafe { (api.send)(client.ptr, request.as_ptr()) };
    Ok(())
}

/// Blocks for up to `timeout` seconds; `None` means TDLib had nothing to say.
#[tauri::command]
pub async fn td_receive(
    app: AppHandle,
    state: State<'_, Telegram>,
    timeout: f64,
) -> Result<Option<String>, String> {
    let api = api(&app)?;
    let client = current(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let gone = client.gone.lock().unwrap();
        if *gone {
            return Err("TDLib client is closed".to_string());
        }
        let raw = unsafe { (api.receive)(client.ptr, timeout) };
        if raw.is_null() {
            return Ok(None);
        }
        Ok(Some(
            unsafe { CStr::from_ptr(raw) }
                .to_string_lossy()
                .into_owned(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn td_destroy(app: AppHandle, state: State<'_, Telegram>) -> Result<(), String> {
    let api = api(&app)?;
    let client = state.0.lock().unwrap().take();
    discard(api, client).await
}
