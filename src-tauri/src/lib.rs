//! RsIcon（Tauri 版）后端入口：把「Zed 文件关联图标管理」暴露为 Tauri commands
//!
//! 与原 egui 版的分工保持一致，只替换通信层：
//! - `registry` / `zed` / `association` / `icon` / `refresh` 五个逻辑模块为纯 Rust，原样复用
//! - 原来的「后台线程 + mpsc GuiMessage」改为「async command + spawn_blocking + progress 事件」
//! - 窗口关闭拦截：任务进行中时 `prevent_close` 并广播 `close-requested`，由前端弹确认框
//!
//! 前后端协议（camelCase）：
//! - `initial_channel()` → 启动初始通道 key（stable / preview / nightly / zedg）
//! - `load_state(channel)` → { zedPath, associations[], log[] }
//! - `apply_icons(targets, mode, zedPath, customDir)` / `remove_icons(targets)` → 过程发 `progress`
//! - `refresh_explorer(clearCache, restartExplorer)` → log[]
//! - `scan_ico_count(dir)` / `confirm_quit()`

// 保留与原版一致的工具函数与字段（create_key / refresh_full / current_icon 展示等）
#![allow(dead_code)]

mod association;
mod icon;
mod refresh;
mod registry;
mod zed;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

use association::FileAssociation;
use icon::{IconMode, IconTarget};
use zed::Channel;

/// 跨 command 共享的状态
struct AppState {
    /// 是否有任务进行中（决定关闭窗口是否需要二次确认）
    busy: Arc<AtomicBool>,
}

/// 日志行（error=true 时前端标红）
#[derive(Serialize, Clone)]
struct LogLineDto {
    text: String,
    error: bool,
}

fn ok_line(text: impl Into<String>) -> LogLineDto {
    LogLineDto {
        text: text.into(),
        error: false,
    }
}

fn err_line(text: impl Into<String>) -> LogLineDto {
    LogLineDto {
        text: text.into(),
        error: true,
    }
}

/// 文件关联（前端 DTO）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssociationDto {
    extension: String,
    prog_id: String,
    shared_prog_id: bool,
    has_default_icon: bool,
    current_icon: Option<String>,
}

impl From<FileAssociation> for AssociationDto {
    fn from(a: FileAssociation) -> Self {
        Self {
            extension: a.extension,
            prog_id: a.prog_id,
            shared_prog_id: a.shared_prog_id,
            has_default_icon: a.has_default_icon,
            current_icon: a.current_icon,
        }
    }
}

/// 一次加载的结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadState {
    zed_path: Option<String>,
    associations: Vec<AssociationDto>,
    log: Vec<LogLineDto>,
}

/// 批量操作进度事件负载（扩展名标签由后端带上）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    current: usize,
    total: usize,
    extension: String,
}

/// 图标操作目标（前端传入）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetDto {
    extension: String,
    prog_id: String,
}

impl From<TargetDto> for IconTarget {
    fn from(t: TargetDto) -> Self {
        Self {
            extension: t.extension,
            prog_id: t.prog_id,
        }
    }
}

/// 通道 ↔ 稳定 ascii key（前后端以 key 通信，显示名只在前端用）
fn channel_key(channel: Channel) -> &'static str {
    match channel {
        Channel::Stable => "stable",
        Channel::Preview => "preview",
        Channel::Nightly => "nightly",
        Channel::Zedg => "zedg",
    }
}

fn channel_from_key(key: &str) -> Result<Channel, String> {
    match key {
        "stable" => Ok(Channel::Stable),
        "preview" => Ok(Channel::Preview),
        "nightly" => Ok(Channel::Nightly),
        "zedg" => Ok(Channel::Zedg),
        other => Err(format!("未知通道：{other}")),
    }
}

/// 启动初始通道：优先「注册表里已有该通道 ProgID」，其次「检测到 exe」，兜底稳定版
#[tauri::command]
fn initial_channel() -> String {
    if let Ok(subkeys) = registry::list_subkeys("") {
        if let Some(channel) = Channel::ALL
            .iter()
            .copied()
            .find(|c| subkeys.iter().any(|key| key.starts_with(c.prog_id_prefix())))
        {
            return channel_key(channel).to_string();
        }
    }
    Channel::ALL
        .iter()
        .copied()
        .find(|c| zed::detect_zed_path(*c).is_some())
        .unwrap_or(Channel::Stable)
        .key_owned()
}

impl Channel {
    /// 小工具：把 key 转成 String（避免在命令里写两遍 match）
    fn key_owned(self) -> String {
        channel_key(self).to_string()
    }
}

/// 扫描目录中的 .ico 文件数量（单层；目录未设置 / 不存在 / 读不到返回 None）
#[tauri::command]
fn scan_ico_count(dir: String) -> Option<usize> {
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = std::path::Path::new(trimmed);
    if !path.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(path).ok()?;
    Some(
        entries
            .flatten()
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("ico"))
                    .unwrap_or(false)
            })
            .count(),
    )
}

/// 加载：检测 Zed 路径 + 枚举关联列表（后台线程执行，完成后一次性返回）
#[tauri::command]
async fn load_state(state: State<'_, AppState>, channel: String) -> Result<LoadState, String> {
    let channel = channel_from_key(&channel)?;
    let busy = state.busy.clone();
    busy.store(true, Ordering::SeqCst);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut log = Vec::new();
        let zed_path = match zed::detect_zed_path(channel) {
            Some(path) => {
                log.push(ok_line(format!("已检测到 Zed：{}", path.display())));
                Some(path.display().to_string())
            }
            None => {
                log.push(ok_line(format!(
                    "未检测到 {}（「Zed 应用图标」模式不可用）",
                    channel.display_name()
                )));
                None
            }
        };
        match association::list_associations(channel) {
            Ok(list) => {
                log.push(ok_line(format!("已加载 {} 个文件关联", list.len())));
                Ok(LoadState {
                    zed_path,
                    associations: list.into_iter().map(Into::into).collect(),
                    log,
                })
            }
            Err(err) => Err(format!("加载关联列表失败：{err:#}")),
        }
    })
    .await
    .map_err(|err| format!("后台任务异常：{err}"))?;

    busy.store(false, Ordering::SeqCst);
    result
}

/// 批量写入图标（App / Custom / System 三种模式），逐项发 `progress` 事件
#[tauri::command]
async fn apply_icons(
    window: tauri::Window,
    state: State<'_, AppState>,
    targets: Vec<TargetDto>,
    mode: String,
    zed_path: String,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let mode = match mode.as_str() {
        "system" => IconMode::System,
        "app" => IconMode::App,
        "custom" => IconMode::Custom,
        other => return Err(format!("未知图标模式：{other}")),
    };
    if targets.is_empty() {
        return Err("没有可操作的扩展名".to_string());
    }
    if mode == IconMode::App && zed_path.trim().is_empty() {
        return Err("未检测到 Zed 可执行文件，无法使用「Zed 应用图标」模式".to_string());
    }

    let targets: Vec<IconTarget> = targets.into_iter().map(Into::into).collect();
    let busy = state.busy.clone();
    busy.store(true, Ordering::SeqCst);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let zed = PathBuf::from(&zed_path);
        let custom = custom_dir.map(PathBuf::from);
        icon::batch_set_icons(
            &targets,
            mode,
            &zed,
            custom.as_deref(),
            |current, total| {
                let extension = targets
                    .get(current.saturating_sub(1))
                    .map(|t| t.extension.clone())
                    .unwrap_or_default();
                let _ = window.emit(
                    "progress",
                    ProgressPayload {
                        current,
                        total,
                        extension,
                    },
                );
            },
        )
    })
    .await
    .map_err(|err| format!("后台任务异常：{err}"))?;

    busy.store(false, Ordering::SeqCst);
    result.map_err(|err| format!("{err:#}"))
}

/// 批量恢复默认（递归删除 `<ProgID>\DefaultIcon`），逐项发 `progress` 事件
#[tauri::command]
async fn remove_icons(
    window: tauri::Window,
    state: State<'_, AppState>,
    targets: Vec<TargetDto>,
) -> Result<(), String> {
    if targets.is_empty() {
        return Err("没有可操作的扩展名".to_string());
    }
    let targets: Vec<IconTarget> = targets.into_iter().map(Into::into).collect();
    let busy = state.busy.clone();
    busy.store(true, Ordering::SeqCst);

    let result = tauri::async_runtime::spawn_blocking(move || {
        icon::batch_remove_icons(&targets, |current, total| {
            let extension = targets
                .get(current.saturating_sub(1))
                .map(|t| t.extension.clone())
                .unwrap_or_default();
            let _ = window.emit(
                "progress",
                ProgressPayload {
                    current,
                    total,
                    extension,
                },
            );
        })
    })
    .await
    .map_err(|err| format!("后台任务异常：{err}"))?;

    busy.store(false, Ordering::SeqCst);
    result.map_err(|err| format!("{err:#}"))
}

/// 刷新资源管理器：广播变更（必做）→（可选）清缓存 →（可选）重启 explorer
///
/// 返回逐条日志；单步失败不中断后续步骤。
#[tauri::command]
async fn refresh_explorer(
    state: State<'_, AppState>,
    clear_cache: bool,
    restart_explorer: bool,
) -> Result<Vec<LogLineDto>, String> {
    let busy = state.busy.clone();
    busy.store(true, Ordering::SeqCst);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut log = Vec::new();
        match refresh::notify_system() {
            Ok(()) => log.push(ok_line("已广播文件关联变更通知")),
            Err(err) => log.push(err_line(format!("广播关联变更失败：{err:#}"))),
        }
        if clear_cache {
            match refresh::clear_icon_cache() {
                Ok(()) => log.push(ok_line("图标缓存清理完成")),
                Err(err) => log.push(err_line(format!("清理图标缓存失败：{err:#}"))),
            }
        }
        if restart_explorer {
            match refresh::restart_explorer() {
                Ok(()) => log.push(ok_line("Explorer 已重启")),
                Err(err) => log.push(err_line(format!("重启 Explorer 失败：{err:#}"))),
            }
        }
        log
    })
    .await
    .map_err(|err| format!("后台任务异常：{err}"))?;

    busy.store(false, Ordering::SeqCst);
    Ok(result)
}

/// 用户已确认「任务进行中退出」：清 busy 标志并直接销毁窗口
#[tauri::command]
fn confirm_quit(window: tauri::Window, state: State<'_, AppState>) {
    state.busy.store(false, Ordering::SeqCst);
    let _ = window.destroy();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            busy: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            initial_channel,
            scan_ico_count,
            load_state,
            apply_icons,
            remove_icons,
            refresh_explorer,
            confirm_quit
        ])
        .on_window_event(|window, event| {
            // 任务进行中拦截关闭，让前端弹确认框；确认后走 confirm_quit
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if state.busy.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
