//! 入口：调用 lib 中的 `run`（Tauri 约定）
//!
//! release 下不附加控制台窗口（与旧版 egui 版同策略），debug 保留以查看 println! 日志。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rsicon_tauri_lib::run()
}
