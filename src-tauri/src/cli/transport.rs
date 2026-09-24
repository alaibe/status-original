use std::io;

use interprocess::local_socket::{prelude::*, Listener, ListenerOptions, Name, Stream};

#[cfg_attr(windows, allow(dead_code))]
/// `identifier` in tauri.conf.json: the client runs before Tauri and cannot ask it.
const IDENTIFIER: &str = "com.statusoriginal.app";

const NAME: &str = if cfg!(debug_assertions) {
    "cli-dev.sock"
} else {
    "cli.sock"
};

/// Unix: a 0600 socket file in the app's data directory. Its full path can
/// outgrow `sun_path` (104 bytes on macOS) inside the App Store container, so
/// it is bound and dialled relative to that directory.
#[cfg(unix)]
fn with_name<T>(f: impl FnOnce(Name) -> io::Result<T>) -> io::Result<T> {
    use interprocess::local_socket::GenericFilePath;
    use std::env;

    let dir = socket_dir()?;
    std::fs::create_dir_all(&dir)?;
    let previous = env::current_dir().ok();
    env::set_current_dir(&dir)?;
    let result = NAME.to_fs_name::<GenericFilePath>().and_then(f);
    if let Some(previous) = previous {
        let _ = env::set_current_dir(previous);
    }
    result
}

#[cfg(windows)]
fn with_name<T>(f: impl FnOnce(Name) -> io::Result<T>) -> io::Result<T> {
    use interprocess::local_socket::GenericNamespaced;

    let user = std::env::var("USERNAME").unwrap_or_default();
    format!("status-original-{user}-{NAME}")
        .to_ns_name::<GenericNamespaced>()
        .and_then(f)
}

#[cfg(unix)]
fn socket_dir() -> io::Result<std::path::PathBuf> {
    dirs::data_dir()
        .map(|dir| dir.join(IDENTIFIER))
        .ok_or_else(|| io::Error::other("no data directory"))
}

pub fn connect() -> io::Result<Stream> {
    with_name(Stream::connect)
}

pub fn listen() -> io::Result<Listener> {
    if connect().is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "another copy of the app is already serving the command line",
        ));
    }
    #[cfg(unix)]
    let umask = unsafe { libc::umask(0o177) };
    let listener = with_name(|name| {
        ListenerOptions::new()
            .name(name)
            .try_overwrite(true)
            .create_sync()
    });
    #[cfg(unix)]
    unsafe {
        libc::umask(umask);
    }
    listener
}

#[cfg(test)]
mod tests {
    #[test]
    fn identifier_matches_the_tauri_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], super::IDENTIFIER);
    }
}
