//! The window where the user signs in to a website for a Matrix bridge. The page
//! gets no IPC: the capabilities only cover `main`.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

const LABEL: &str = "web-login";

/// Sites like Slack refuse a web view they take for an old or unknown browser,
/// so the window says it is the browser this system ships.
#[cfg(target_os = "macos")]
fn browser_user_agent() -> Option<String> {
    let version = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    let major: u32 = String::from_utf8_lossy(&version.stdout)
        .split('.')
        .next()?
        .trim()
        .parse()
        .ok()?;
    // Safari took the macOS version number at 26; before that it ran three ahead.
    let safari = if major >= 26 { major } else { major + 3 };
    Some(format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari}.0 Safari/605.1.15"
    ))
}

#[cfg(target_os = "linux")]
fn browser_user_agent() -> Option<String> {
    Some("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36".into())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn browser_user_agent() -> Option<String> {
    None
}

#[derive(Serialize)]
pub struct WebCookie {
    name: String,
    value: String,
    domain: String,
}

#[derive(Serialize)]
pub struct WebLoginSnapshot {
    open: bool,
    url: String,
    cookies: Vec<WebCookie>,
    page: Option<String>,
}

#[tauri::command]
pub async fn web_login_open(
    app: AppHandle,
    url: String,
    title: String,
    user_agent: Option<String>,
    script: String,
    hidden: bool,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LABEL) {
        existing.destroy().map_err(|e| e.to_string())?;
    }
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
        return Err("A sign-in page must use https.".into());
    }
    let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title(title)
        .inner_size(480.0, 760.0)
        .incognito(true)
        .visible(!hidden)
        .initialization_script(script)
        .on_new_window({
            let app = app.clone();
            move |url, _| {
                if let Some(window) = app.get_webview_window(LABEL) {
                    let _ = window.navigate(url);
                }
                NewWindowResponse::Deny
            }
        });
    if let Some(agent) = user_agent
        .filter(|agent| !agent.is_empty())
        .or_else(browser_user_agent)
    {
        builder = builder.user_agent(&agent);
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn web_login_poll(app: AppHandle, readback: String) -> Result<WebLoginSnapshot, String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(WebLoginSnapshot {
            open: false,
            url: String::new(),
            cookies: Vec::new(),
            page: None,
        });
    };
    let url = window.url().map(|url| url.to_string()).unwrap_or_default();
    let cookies = window
        .cookies()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|cookie| WebCookie {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain: cookie.domain().unwrap_or_default().to_string(),
        })
        .collect();

    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(readback, move |result| {
            if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = sender.send(result);
            }
        })
        .map_err(|e| e.to_string())?;
    let page = tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .ok()
        .and_then(Result::ok);

    Ok(WebLoginSnapshot {
        open: true,
        url,
        cookies,
        page,
    })
}

#[tauri::command]
pub async fn web_login_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}
