//! Secrets live in one AES-256-GCM encrypted file under the app data
//! directory. Its key is the only item in the operating system's credential
//! store (release builds) or a user-only file beside it (debug builds; see
//! `debug_key`).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::prelude::*;
use tauri::{AppHandle, State};

use crate::paths::app_data_dir;

const SERVICE: &str = "com.statusoriginal.app";
const MASTER_KEY_ENTRY: &str = "vault-key";
const NONCE_LEN: usize = 12;

/// The decrypted entries and the key they were sealed with, read once per run.
pub struct Loaded {
    entries: BTreeMap<String, String>,
    key: Key<Aes256Gcm>,
}

#[derive(Default)]
pub struct Vault(Mutex<Option<Loaded>>);

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("vault.bin"))
}

fn keychain_key() -> Result<Option<Vec<u8>>, String> {
    let entry = keyring::Entry::new(SERVICE, MASTER_KEY_ENTRY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(encoded) => Ok(Some(
            BASE64_STANDARD.decode(encoded).map_err(|e| e.to_string())?,
        )),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn keychain_store(key: &[u8]) -> Result<(), String> {
    keyring::Entry::new(SERVICE, MASTER_KEY_ENTRY)
        .map_err(|e| e.to_string())?
        .set_password(&BASE64_STANDARD.encode(key))
        .map_err(|e| e.to_string())
}

fn fresh_key() -> Result<Vec<u8>, String> {
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| e.to_string())?;
    Ok(key.to_vec())
}

/// Debug builds keep the key in a file next to the vault, readable by this
/// user only. The credential store grants access per code signature, and an
/// unsigned development binary has a new one after every compile, so it would
/// prompt on every run. A key a signed build already put there is moved over
/// once, so the accounts survive.
fn debug_key(app: &AppHandle) -> Result<Vec<u8>, String> {
    let path = app_data_dir(app)?.join("vault.key");
    match std::fs::read_to_string(&path) {
        Ok(encoded) => {
            return BASE64_STANDARD
                .decode(encoded.trim())
                .map_err(|e| e.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let key = match keychain_key() {
        Ok(Some(key)) => key,
        _ => fresh_key()?,
    };
    std::fs::write(&path, BASE64_STANDARD.encode(&key)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(key)
}

fn master_key(app: &AppHandle) -> Result<Key<Aes256Gcm>, String> {
    let bytes = if cfg!(debug_assertions) {
        debug_key(app)?
    } else {
        match keychain_key()? {
            Some(key) => key,
            None => {
                let key = fresh_key()?;
                keychain_store(&key)?;
                key
            }
        }
    };
    if bytes.len() != 32 {
        return Err("The vault key is malformed.".into());
    }
    Ok(*Key::<Aes256Gcm>::from_slice(&bytes))
}

fn load(app: &AppHandle) -> Result<Loaded, String> {
    let key = master_key(app)?;
    let path = vault_path(app)?;
    let sealed = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Loaded {
                entries: BTreeMap::new(),
                key,
            })
        }
        Err(e) => return Err(e.to_string()),
    };
    if sealed.len() < NONCE_LEN {
        return Err("The vault file is truncated.".into());
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let plain = Aes256Gcm::new(&key)
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "The vault file cannot be decrypted with the stored key.".to_string())?;
    let entries = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
    Ok(Loaded { entries, key })
}

fn save(app: &AppHandle, loaded: &Loaded) -> Result<(), String> {
    let plain = serde_json::to_vec(&loaded.entries).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
    let ciphertext = Aes256Gcm::new(&loaded.key)
        .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
        .map_err(|_| "Could not encrypt the vault.".to_string())?;

    let path = vault_path(app)?;
    let staging = path.with_extension("bin.tmp");
    std::fs::write(&staging, [&nonce[..], &ciphertext].concat()).map_err(|e| e.to_string())?;
    std::fs::rename(&staging, &path).map_err(|e| e.to_string())
}

fn with_vault<T>(
    app: &AppHandle,
    vault: &State<Vault>,
    work: impl FnOnce(&mut Loaded) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = vault.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(load(app)?);
    }
    work(guard.as_mut().expect("loaded above"))
}

#[tauri::command]
pub async fn vault_get(
    app: AppHandle,
    vault: State<'_, Vault>,
    key: String,
) -> Result<Option<String>, String> {
    with_vault(&app, &vault, |loaded| Ok(loaded.entries.get(&key).cloned()))
}

#[tauri::command]
pub async fn vault_set(
    app: AppHandle,
    vault: State<'_, Vault>,
    key: String,
    value: String,
) -> Result<(), String> {
    with_vault(&app, &vault, |loaded| {
        loaded.entries.insert(key, value);
        save(&app, loaded)
    })
}

#[tauri::command]
pub async fn vault_delete(
    app: AppHandle,
    vault: State<'_, Vault>,
    key: String,
) -> Result<(), String> {
    with_vault(&app, &vault, |loaded| {
        if loaded.entries.remove(&key).is_some() {
            save(&app, loaded)?;
        }
        Ok(())
    })
}
