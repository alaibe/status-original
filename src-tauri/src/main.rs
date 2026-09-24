// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = status_original_lib::cli::client::run() {
        std::process::exit(code);
    }
    status_original_lib::run();
}
