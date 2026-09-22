//! A Ledger over USB. The window's WebKit has no WebHID, so the APDUs travel
//! through here; the Ethereum app protocol itself stays in JavaScript.

use std::sync::{Arc, Mutex};

use ledger_apdu::APDUCommand;
use ledger_transport_hid::{hidapi::HidApi, TransportNativeHID};
use serde::Serialize;
use tauri::State;

#[derive(Default)]
pub struct Ledger(Arc<Mutex<Option<TransportNativeHID>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerDevice {
    path: String,
    name: String,
}

fn api() -> Result<HidApi, String> {
    HidApi::new().map_err(|e| e.to_string())
}

fn describe(device: &ledger_transport_hid::hidapi::DeviceInfo) -> LedgerDevice {
    LedgerDevice {
        path: device.path().to_string_lossy().into_owned(),
        name: device.product_string().unwrap_or("Ledger").to_string(),
    }
}

#[tauri::command]
pub async fn ledger_list() -> Result<Vec<LedgerDevice>, String> {
    let api = api()?;
    Ok(TransportNativeHID::list_ledgers(&api)
        .map(describe)
        .collect())
}

#[tauri::command]
pub async fn ledger_open(ledger: State<'_, Ledger>, path: String) -> Result<(), String> {
    let api = api()?;
    let device = TransportNativeHID::list_ledgers(&api)
        .find(|d| d.path().to_string_lossy() == path)
        .ok_or_else(|| "That Ledger is no longer plugged in.".to_string())?;
    let transport = TransportNativeHID::open_device(&api, device).map_err(|e| e.to_string())?;
    *ledger.0.lock().map_err(|e| e.to_string())? = Some(transport);
    Ok(())
}

/// `apdu` is what `@ledgerhq/hw-transport` builds: class, instruction, two
/// parameters, a length byte, then the data. The answer comes back the same
/// way it does there: data followed by the two status bytes.
#[tauri::command]
pub async fn ledger_exchange(ledger: State<'_, Ledger>, apdu: Vec<u8>) -> Result<Vec<u8>, String> {
    if apdu.len() < 4 {
        return Err("APDU is too short.".into());
    }
    let command = APDUCommand {
        cla: apdu[0],
        ins: apdu[1],
        p1: apdu[2],
        p2: apdu[3],
        data: apdu.get(5..).unwrap_or(&[]).to_vec(),
    };
    let shared = ledger.0.clone();
    // The device waits for a button press, so this can block for a long time.
    tauri::async_runtime::spawn_blocking(move || {
        let guard = shared.lock().map_err(|e| e.to_string())?;
        let transport = guard
            .as_ref()
            .ok_or_else(|| "No Ledger is connected.".to_string())?;
        let answer = transport.exchange(&command).map_err(|e| e.to_string())?;
        let mut out = answer.apdu_data().to_vec();
        out.extend_from_slice(&answer.retcode().to_be_bytes());
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ledger_close(ledger: State<'_, Ledger>) -> Result<(), String> {
    *ledger.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
