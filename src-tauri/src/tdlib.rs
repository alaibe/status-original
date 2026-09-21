//! Telegram through TDLib's JSON interface. The library is `libtdjson.dylib`
//! next to the app (`scripts/fetch-tdlib.sh` builds it), opened on first use.
//! The page drives `td_json_client_*` the way the phone does through
//! react-native-tdlib: one client at a time, requests and replies correlated
//! by `@extra` on the JavaScript side.

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use libloading::Library;
use tauri::{AppHandle, State};

use crate::paths::{data_dir, safe_component};

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

fn api() -> Result<&'static Api, String> {
    API.get_or_init(load).as_ref().map_err(Clone::clone)
}

fn library_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(PathBuf::from)) {
        candidates.push(dir.join("../Frameworks/libtdjson.dylib"));
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("frameworks/libtdjson.dylib"));
    }
    candidates.into_iter().find(|path| path.exists())
}

unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    library.get::<T>(name).map(|found| *found).map_err(|e| e.to_string())
}

fn load() -> Result<Api, String> {
    let path = library_path()
        .ok_or_else(|| "TDLib is not part of this build: `npm run desktop` fetches it.".to_string())?;
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
    state.0.lock().unwrap().clone().ok_or_else(|| "No TDLib client".to_string())
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
pub async fn td_create(state: State<'_, Telegram>) -> Result<(), String> {
    let api = api()?;
    let previous = state.0.lock().unwrap().take();
    discard(api, previous).await?;

    let ptr = unsafe { (api.create)() };
    let quiet = CString::new(r#"{"@type":"setLogVerbosityLevel","new_verbosity_level":0}"#).unwrap();
    unsafe { (api.execute)(ptr, quiet.as_ptr()) };
    *state.0.lock().unwrap() = Some(Arc::new(Client { ptr, gone: Mutex::new(false) }));
    Ok(())
}

#[tauri::command]
pub async fn td_send(state: State<'_, Telegram>, request: String) -> Result<(), String> {
    let api = api()?;
    let client = current(&state)?;
    let request = CString::new(request).map_err(|e| e.to_string())?;
    unsafe { (api.send)(client.ptr, request.as_ptr()) };
    Ok(())
}

/// Blocks for up to `timeout` seconds; `None` means TDLib had nothing to say.
#[tauri::command]
pub async fn td_receive(state: State<'_, Telegram>, timeout: f64) -> Result<Option<String>, String> {
    let api = api()?;
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
        Ok(Some(unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn td_destroy(state: State<'_, Telegram>) -> Result<(), String> {
    let api = api()?;
    let client = state.0.lock().unwrap().take();
    discard(api, client).await
}

#[tauri::command]
pub async fn td_database_directory(app: AppHandle, account_id: String) -> Result<String, String> {
    safe_component(&account_id, "account")?;
    let dir = data_dir(&app, "tdlib")?.join(&account_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn td_erase(app: AppHandle, account_id: String) -> Result<(), String> {
    safe_component(&account_id, "account")?;
    match std::fs::remove_dir_all(data_dir(&app, "tdlib")?.join(&account_id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
