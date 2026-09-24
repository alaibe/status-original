use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, IsTerminal, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine};
use interprocess::local_socket::{prelude::*, Stream};
use serde_json::{json, Value};

use super::{transport, BACKGROUND};

const SKILL: &str = include_str!("../../../skills/status-original/SKILL.md");
const HELP: &str = include_str!("../../cli/help.txt");

/// How long a copy started for the command line gets to open its socket.
const START_TIMEOUT: Duration = Duration::from_secs(90);

/// `Some(exit code)` when this process was asked to run a command rather than
/// to be the app.
pub fn run() -> Option<i32> {
    let args: Vec<String> = env::args().skip(1).collect();
    let app_launch =
        args.is_empty() || args.iter().all(|arg| arg == BACKGROUND) || args[0].starts_with("-psn_");
    if app_launch {
        return None;
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
    Some(offline(&args).unwrap_or_else(|| remote(args)))
}

fn offline(args: &[String]) -> Option<i32> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["--version" | "-V" | "version"] => {
            println!("status-original {}", env!("CARGO_PKG_VERSION"));
        }
        ["--help" | "-h" | "help"] => print!("{HELP}"),
        ["--skills" | "skills"] => print!("{SKILL}"),
        ["skills", "install", targets @ ..] => return Some(install_skill(targets)),
        _ => return None,
    }
    Some(0)
}

fn install_skill(targets: &[&str]) -> i32 {
    let home = dirs::home_dir().unwrap_or_default();
    let mut dirs = Vec::new();
    let mut rest = targets.iter();
    while let Some(target) = rest.next() {
        match *target {
            "--claude" => dirs.push(home.join(".claude/skills")),
            "--codex" => dirs.push(home.join(".codex/skills")),
            "--dir" => match rest.next() {
                Some(dir) => dirs.push(PathBuf::from(dir)),
                None => {
                    eprintln!("--dir needs a directory");
                    return 2;
                }
            },
            other => {
                eprintln!("Unknown option {other}. Use --claude, --codex or --dir <path>.");
                return 2;
            }
        }
    }
    if dirs.is_empty() {
        dirs.push(home.join(".claude/skills"));
    }
    for dir in dirs {
        let path = dir.join("status-original").join("SKILL.md");
        let written = path
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|_| fs::write(&path, SKILL));
        match written {
            Ok(()) => println!("Installed {}", path.display()),
            Err(error) => {
                eprintln!("Could not write {}: {error}", path.display());
                return 1;
            }
        }
    }
    0
}

fn remote(args: Vec<String>) -> i32 {
    let stream = match transport::connect() {
        Ok(stream) => stream,
        Err(_) if args[0] == "quit" => {
            eprintln!("Status Original is not running.");
            return 0;
        }
        Err(_) => match start_app() {
            Ok(stream) => stream,
            Err(error) => {
                eprintln!("Could not start Status Original: {error}");
                return 1;
            }
        },
    };
    let (reader, mut writer) = stream.split();

    let request = json!({
        "type": "request",
        "argv": args,
        "tty": io::stdout().is_terminal(),
        "stdinTty": io::stdin().is_terminal(),
    });
    if super::write_line(&mut writer, &request).is_err() {
        eprintln!("Status Original closed the connection.");
        return 1;
    }

    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let text = message["text"].as_str().unwrap_or_default();
        match message["type"].as_str().unwrap_or_default() {
            "out" => {
                print!("{text}");
                let _ = io::stdout().flush();
            }
            "err" => eprint!("{text}"),
            "exit" => return message["code"].as_i64().unwrap_or(1) as i32,
            "prompt" | "stdin" | "read" | "write" => {
                let reply = answer(&message);
                let reply = json!({ "type": "reply", "seq": message["seq"], "result": reply });
                if super::write_line(&mut writer, &reply).is_err() {
                    break;
                }
            }
            _ => {}
        }
    }
    eprintln!("Status Original closed the connection.");
    1
}

fn answer(message: &Value) -> Value {
    let path = message["path"].as_str().unwrap_or_default();
    let result: io::Result<Value> = match message["type"].as_str().unwrap_or_default() {
        "prompt" => prompt(
            message["text"].as_str().unwrap_or_default(),
            message["secret"].as_bool().unwrap_or(false),
        )
        .map(|text| json!({ "text": text })),
        "stdin" => {
            let mut data = Vec::new();
            io::stdin()
                .read_to_end(&mut data)
                .map(|_| json!({ "data": STANDARD.encode(data) }))
        }
        "read" => fs::read(path).map(|data| json!({ "data": STANDARD.encode(data) })),
        "write" => STANDARD
            .decode(message["data"].as_str().unwrap_or_default())
            .map_err(io::Error::other)
            .and_then(|data| fs::write(path, data))
            .map(|_| json!({})),
        _ => Ok(json!({})),
    };
    result.unwrap_or_else(|error| json!({ "error": error.to_string() }))
}

fn prompt(text: &str, secret: bool) -> io::Result<String> {
    if secret {
        return rpassword::prompt_password(text);
    }
    if !io::stdin().is_terminal() {
        return Err(io::Error::other("this needs an interactive terminal"));
    }
    eprint!("{text}");
    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

fn start_app() -> io::Result<Stream> {
    let exe = env::current_exe()?.canonicalize()?;
    let mut command = Command::new(exe);
    command
        .arg(BACKGROUND)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn()?;
    if io::stderr().is_terminal() {
        eprintln!("Starting Status Original…");
    }

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        match transport::connect() {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() > deadline => return Err(error),
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }
}
