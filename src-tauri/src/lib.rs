//! RsIcon（Tauri 版）后端入口：把「Zed 文件关联图标管理」暴露为 Tauri commands
//!
//! 与原 egui 版的分工保持一致，只替换通信层：
//! - `registry` / `zed` / `association` / `icon` / `refresh` 五个逻辑模块为纯 Rust
//! - 原来的「后台线程 + mpsc GuiMessage」改为「async command + spawn_blocking + progress 事件」
//! - 窗口关闭拦截：任务进行中时 `prevent_close` 并广播 `close-requested`，由前端弹确认框
//!
//! 前后端协议（camelCase）：
//! - `bootstrap()` → { channel, autoSelected, zedPath, associations[], log[] }（启动一次到位）
//! - `load_state(channel)` → { zedPath, associations[], log[] }
//! - `apply_icons(targets, mode, zedPath, customDir)` / `remove_icons(targets)` → log[]
//! - `refresh_explorer(clearCache, restartExplorer)` → log[]
//! - `undo_status()` → { available, timestamp, action, count }；`undo_last()` → log[]
//! - `scan_ico_count(dir)` / `set_autostart(enable)` / `is_autostart_enabled()`
//!
//! 设计约定（详见 DESIGN.md D6/D7/D8/D19）：
//! - **busy 由 RAII 守卫持有**，任何返回路径（含 `?` 提前返回、panic 展开）都会复位
//! - **只读命令不置 busy**（读取不该阻塞关窗）
//! - 写操作的**回退/失败明细经返回值交给前端**，不依赖控制台

mod association;
mod icon;
mod iconrender;
mod refresh;
mod register;
mod registry;
mod text;
mod zed;

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use association::FileAssociation;
use text::encoded;
use icon::{IconMode, IconState, IconTarget};
use zed::Channel;

/// 跨 command 共享的状态
struct AppState {
    /// 是否有写操作进行中（决定关闭窗口是否需要二次确认）
    busy: Arc<AtomicBool>,
}

/// busy 标志的 RAII 守卫
///
/// 早期实现把 `busy.store(false)` 写在 `spawn_blocking(...).await?` **之后**，
/// 一旦 join 失败（任务 panic）就会提前返回、标志永久停留在 true，
/// 此后每次关窗都会被 `prevent_close` 拦截。改用 Drop 复位后不再有该问题。
struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    /// 置忙并返回守卫；守卫析构时自动复位
    fn acquire(flag: Arc<AtomicBool>) -> Self {
        flag.store(true, Ordering::SeqCst);
        Self(flag)
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// 日志级别（前端据此着色：info 常规 / warn 注意 / error 失败）
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum LogLevel {
    Info,
    Warn,
    Error,
}

/// 日志行：只传 key（+ 可选参数），由前端按当前语言渲染
#[derive(Serialize, Clone)]
struct LogLineDto {
    key: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    params: Vec<String>,
    level: LogLevel,
}

fn log_line(key: &str, params: Vec<String>, level: LogLevel) -> LogLineDto {
    LogLineDto {
        key: key.to_string(),
        params,
        level,
    }
}

fn info(key: &str) -> LogLineDto {
    log_line(key, Vec::new(), LogLevel::Info)
}

fn info_p(key: &str, params: Vec<String>) -> LogLineDto {
    log_line(key, params, LogLevel::Info)
}

fn warn_p(key: &str, params: Vec<String>) -> LogLineDto {
    log_line(key, params, LogLevel::Warn)
}

fn error_p(key: &str, params: Vec<String>) -> LogLineDto {
    log_line(key, params, LogLevel::Error)
}

/// 文件关联（前端 DTO）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssociationDto {
    extension: String,
    prog_id: String,
    /// "userChoice" | "classesDefault" | "progIdOnly"
    prog_id_source: association::ProgIdSource,
    shared_prog_id: bool,
    /// 同一 ProgID 还被哪些扩展名共用（影响面量化）
    shared_with: Vec<String>,
    has_default_icon: bool,
    current_icon: Option<String>,
    /// "none" | "valid" | "missing"
    icon_state: IconState,
}

impl From<FileAssociation> for AssociationDto {
    fn from(a: FileAssociation) -> Self {
        Self {
            extension: a.extension,
            prog_id: a.prog_id,
            prog_id_source: a.prog_id_source,
            shared_prog_id: a.shared_prog_id,
            shared_with: a.shared_with,
            has_default_icon: a.has_default_icon,
            current_icon: a.current_icon,
            icon_state: a.icon_state,
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

/// 启动引导结果：通道选择 + 首次加载一次返回（省掉一次 IPC 往返）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapDto {
    channel: String,
    /// 是否由工具自动选择了非默认通道（前端据此决定是否提示）
    auto_selected: bool,
    zed_path: Option<String>,
    associations: Vec<AssociationDto>,
    log: Vec<LogLineDto>,
}

/// 批量操作进度事件负载（扩展名标签由后端带上）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    /// 当前正在处理的序号（从 1 开始）
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
    /// 逐项指定的自定义图标（绝对路径，可空）
    #[serde(default)]
    custom_icon: Option<String>,
}

impl From<TargetDto> for IconTarget {
    fn from(t: TargetDto) -> Self {
        Self {
            extension: t.extension,
            prog_id: t.prog_id,
            custom_icon: t.custom_icon,
        }
    }
}

/// 单个扩展名的关联状态（设置页诊断用）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtStatusDto {
    extension: String,
    effective_prog_id: Option<String>,
    effective_is_zed: bool,
    has_user_choice: bool,
    classes_registered: bool,
}

/// 应用注册状态（设置页用）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppRegistrationDto {
    registered: bool,
    covered: usize,
}

/// 自动扫描到的 Zed 安装（前端列表用）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallationDto {
    path: String,
    /// 通道 key
    channel: String,
    /// 来源说明（卸载注册表 / 常见安装目录 / scoop / PATH）
    source: String,
}

/// 撤销快照：写入前记录的 DefaultIcon 原值
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UndoSnapshot {
    /// Unix 秒
    timestamp: u64,
    /// "apply" | "remove"
    action: String,
    entries: Vec<UndoEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UndoEntry {
    prog_id: String,
    extension: String,
    /// 写入前的 DefaultIcon 值（None 表示原本没有）
    previous: Option<String>,
}

/// 撤销可用性（前端启动时查询，用于决定按钮是否可点）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoStatusDto {
    available: bool,
    timestamp: Option<u64>,
    action: Option<String>,
    count: usize,
}

/// 子进程创建标志：不弹出控制台窗口
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 撤销快照文件名（保存在应用数据目录）
const UNDO_FILE: &str = "undo.json";/// 在阻塞池执行闭包，统一处理 join 失败
///
/// 注册表与文件系统操作一律经此进入后台线程（Tauri 主线程同步执行会冻结窗口）。
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|err| encoded("back.taskFailed", &[err.to_string()]))?
}

/// 选择启动通道：① 注册表里已有该通道 ProgID ② 检测到 exe ③ 兜底稳定版
fn select_channel(classes: &[String]) -> Channel {
    Channel::ALL
        .iter()
        .copied()
        .find(|c| {
            let prefix = c.prog_id_prefix().to_ascii_lowercase();
            classes
                .iter()
                .any(|key| key.to_ascii_lowercase().starts_with(&prefix))
        })
        .or_else(|| {
            Channel::ALL
                .iter()
                .copied()
                .find(|c| zed::detect_zed_path(*c).is_some())
        })
        .unwrap_or(Channel::Stable)
}

/// 同步加载结果：检测到的 Zed 路径、关联列表、日志
struct Loaded {
    zed_path: Option<String>,
    associations: Vec<FileAssociation>,
    log: Vec<LogLineDto>,
}

/// 同步加载：检测 Zed 路径 + 枚举关联（在阻塞池中调用）
fn load_sync(channel: Channel) -> Result<Loaded, String> {
    let mut log = Vec::new();

    let zed_path = match zed::detect_zed_path(channel) {
        Some(path) => {
            log.push(info_p("back.zedDetected", vec![path.display().to_string()]));
            Some(path.display().to_string())
        }
        None => {
            log.push(warn_p(
                "back.zedMissing",
                vec![channel.name_key().to_string()],
            ));
            None
        }
    };

    let list =
        association::list_associations(channel).map_err(|err| encoded("back.loadFailed", &[format!("{err:#}")]))?;
    log.push(info_p("back.assocLoaded", vec![list.len().to_string()]));

    let invalid = list
        .iter()
        .filter(|a| a.icon_state == IconState::Missing)
        .count();
    if invalid > 0 {
        log.push(warn_p("back.assocInvalid", vec![invalid.to_string()]));
    }

    Ok(Loaded {
        zed_path,
        associations: list,
        log,
    })
}

/// 启动引导：一次调用完成「选通道 + 检测 Zed + 枚举关联」
#[tauri::command]
async fn bootstrap() -> Result<BootstrapDto, String> {
    blocking(move || {
        // 全量枚举一次供通道判定；随后 list_associations 内部再枚举一次（约 3 ms）
        let classes = registry::list_subkeys("").unwrap_or_default();
        let channel = select_channel(&classes);
        let auto_selected = channel != Channel::Stable;

        let Loaded {
            mut zed_path,
            associations,
            mut log,
        } = load_sync(channel)?;

        // 当前通道探测不到时，全量扫描一次并自动选用第一个可用安装
        if zed_path.is_none() {
            if let Some(found) = zed::scan_installations().into_iter().next() {
                log.push(warn_p(
                    "back.autoUseZed",
                    vec![found.path.display().to_string(), found.source.to_string()],
                ));
                zed_path = Some(found.path.display().to_string());
            }
        }

        if auto_selected {
            log.insert(
                0,
                info_p("back.autoChannel", vec![channel.name_key().to_string()]),
            );
        }

        Ok(BootstrapDto {
            channel: channel.as_key().to_string(),
            auto_selected,
            zed_path,
            associations: associations.into_iter().map(Into::into).collect(),
            log,
        })
    })
    .await
}

/// 加载指定通道：检测 Zed 路径 + 枚举关联列表（只读，不置 busy）
#[tauri::command]
async fn load_state(channel: String) -> Result<LoadState, String> {
    let channel = Channel::from_key(&channel).ok_or_else(|| encoded("back.unknownChannel", std::slice::from_ref(&channel)))?;

    blocking(move || {
        let Loaded {
            zed_path,
            associations,
            log,
        } = load_sync(channel)?;
        Ok(LoadState {
            zed_path,
            associations: associations.into_iter().map(Into::into).collect(),
            log,
        })
    })
    .await
}

/// 扫描目录中的 .ico 文件数量（单层；目录未设置 / 不存在 / 读不到返回 None）
#[tauri::command]
async fn scan_ico_count(dir: String) -> Result<Option<usize>, String> {
    blocking(move || {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        let path = PathBuf::from(trimmed);
        if !path.is_dir() {
            return Ok(None);
        }
        let entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => return Ok(None),
        };
        let count = entries
            .flatten()
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("ico"))
                    .unwrap_or(false)
            })
            .count();
        Ok(Some(count))
    })
    .await
}

/// 应用数据目录下的撤销快照路径（必要时创建目录）
fn undo_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| encoded("back.appDataDir", &[err.to_string()]))?;
    std::fs::create_dir_all(&dir).map_err(|err| encoded("back.createDirFailed", &[err.to_string()]))?;
    Ok(dir.join(UNDO_FILE))
}

/// 写入撤销快照（覆盖上一次）
fn save_undo(app: &AppHandle, snapshot: &UndoSnapshot) -> Result<(), String> {
    let path = undo_path(app)?;
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|err| encoded("back.serializeFailed", &[err.to_string()]))?;
    std::fs::write(&path, json).map_err(|err| encoded("back.writeUndoFailed", &[err.to_string()]))
}

/// 读取撤销快照（不存在 / 损坏时返回 None）
fn read_undo(app: &AppHandle) -> Option<UndoSnapshot> {
    let path = undo_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 删除撤销快照（撤销成功后调用，保证只能用一次）
fn clear_undo(app: &AppHandle) {
    if let Ok(path) = undo_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// 写前快照：记录每个目标当前的 DefaultIcon 原值
fn capture_snapshot(targets: &[IconTarget], action: &str) -> UndoSnapshot {
    let entries = targets
        .iter()
        .map(|target| {
            let previous = registry::get_default_value(&format!("{}\\DefaultIcon", target.prog_id))
                .ok()
                .flatten();
            UndoEntry {
                prog_id: target.prog_id.clone(),
                extension: target.extension.clone(),
                previous,
            }
        })
        .collect();

    UndoSnapshot {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        action: action.to_string(),
        entries,
    }
}

/// 操作名 → i18n key（日志渲染用）
fn action_label(action: &str) -> &'static str {
    match action {
        "apply" => "actionLabel.apply",
        "remove" => "actionLabel.remove",
        _ => "actionLabel.other",
    }
}

/// 提取适合展示的错误摘要（不经 `{:#}`，避免把调用链写进日志）
fn short_reason(err: &anyhow::Error) -> String {
    err.chain()
        .next()
        .map(|e| e.to_string())
        .unwrap_or_else(|| "未知错误".to_string())
}

/// 把失败明细包成一条 error 日志
fn failure_log(total: usize, failures: &[(String, String)]) -> Option<LogLineDto> {
    if failures.is_empty() {
        return None;
    }
    let detail = failures
        .iter()
        .map(|(ext, reason)| format!("{ext}: {reason}"))
        .collect::<Vec<_>>()
        .join("; ");
    Some(error_p(
        "back.failed",
        vec![total.to_string(), failures.len().to_string(), detail],
    ))
}

/// 广播系统刷新并把结果转成日志行（无副作用，写完必做）
fn notify_log() -> LogLineDto {
    match refresh::notify_system() {
        Ok(()) => info("back.notified"),
        Err(err) => warn_p("back.notifyFailed", vec![format!("{err:#}")]),
    }
}

/// 批量写入图标（System / App / Custom，或逐项指定），逐项发 `progress` 事件
#[tauri::command]
async fn apply_icons(
    window: tauri::Window,
    state: State<'_, AppState>,
    targets: Vec<TargetDto>,
    mode: String,
    zed_path: String,
    custom_dir: Option<String>,
) -> Result<Vec<LogLineDto>, String> {
    let mode = match mode.as_str() {
        "system" => IconMode::System,
        "app" => IconMode::App,
        "custom" => IconMode::Custom,
        other => return Err(encoded("back.unknownMode", &[other.to_string()])),
    };
    if targets.is_empty() {
        return Err("back.noTargets".to_string());
    }
    if mode == IconMode::App && zed_path.trim().is_empty() {
        return Err("back.appNeedsZed".to_string());
    }

    let targets: Vec<IconTarget> = targets.into_iter().map(Into::into).collect();
    let app = window.app_handle().clone();
    let _guard = BusyGuard::acquire(state.busy.clone());

    blocking(move || {
        // 1. 写前快照（供「撤销上次操作」）
        let snapshot = capture_snapshot(&targets, "apply");

        // 2. 批量写入
        let zed = PathBuf::from(zed_path.trim());
        let custom = custom_dir.map(PathBuf::from);
        let report = icon::batch_set_icons(
            &targets,
            mode,
            &zed,
            custom.as_deref(),
            |target, done, total| {
                if let Err(err) = window.emit(
                    "progress",
                    ProgressPayload {
                        current: done + 1,
                        total,
                        extension: target.extension.clone(),
                    },
                ) {
                    eprintln!("[警告] 发送进度事件失败：{err}");
                }
            },
        );

        // 3. 组织日志（回退与失败明细必须让用户看到）
        let mut log = vec![info_p("back.applied", vec![report.applied.to_string()])];
        if !report.fell_back.is_empty() {
            log.push(warn_p(
                "back.fallback",
                vec![
                    report.fell_back.len().to_string(),
                    report.fell_back.join(", "),
                ],
            ));
        }
        if let Some(line) = failure_log(report.total, &report.failed) {
            log.push(line);
        }

        // 4. 仅有成功项时更新撤销快照
        if report.applied > 0 {
            if let Err(err) = save_undo(&app, &snapshot) {
                log.push(warn_p("back.undoSavedFailed", vec![err]));
            }
        }

        // 5. 自动通知 Shell 刷新（清缓存 / 重启 Explorer 仍由用户显式触发）
        log.push(notify_log());
        Ok(log)
    })
    .await
}

/// 批量恢复默认（递归删除 `<ProgID>\DefaultIcon`），逐项发 `progress` 事件
#[tauri::command]
async fn remove_icons(
    window: tauri::Window,
    state: State<'_, AppState>,
    targets: Vec<TargetDto>,
) -> Result<Vec<LogLineDto>, String> {
    if targets.is_empty() {
        return Err("back.noTargets".to_string());
    }

    let targets: Vec<IconTarget> = targets.into_iter().map(Into::into).collect();
    let app = window.app_handle().clone();
    let _guard = BusyGuard::acquire(state.busy.clone());

    blocking(move || {
        let snapshot = capture_snapshot(&targets, "remove");

        let report = icon::batch_remove_icons(&targets, |target, done, total| {
            if let Err(err) = window.emit(
                "progress",
                ProgressPayload {
                    current: done + 1,
                    total,
                    extension: target.extension.clone(),
                },
            ) {
                eprintln!("[警告] 发送进度事件失败：{err}");
            }
        });

        let mut log = vec![info_p("back.removed", vec![report.applied.to_string()])];
        if let Some(line) = failure_log(report.total, &report.failed) {
            log.push(line);
        }

        if report.applied > 0 {
            if let Err(err) = save_undo(&app, &snapshot) {
                log.push(warn_p("back.undoSavedFailed", vec![err]));
            }
        }

        log.push(notify_log());
        Ok(log)
    })
    .await
}

/// 刷新资源管理器：通知 →〔清缓存〕→〔重启〕；单步失败不中断后续步骤
#[tauri::command]
async fn refresh_explorer(
    state: State<'_, AppState>,
    clear_cache: bool,
    restart_explorer: bool,
) -> Result<Vec<LogLineDto>, String> {
    let _guard = BusyGuard::acquire(state.busy.clone());

    blocking(move || {
        let mut log = Vec::new();
        match refresh::notify_system() {
            Ok(()) => log.push(info("back.notifyBroadcast")),
            Err(err) => log.push(error_p("back.notifyBroadcastFailed", vec![format!("{err:#}")])),
        }
        if clear_cache {
            match refresh::clear_icon_cache() {
                Ok(()) => log.push(info("back.cacheCleared")),
                Err(err) => log.push(error_p("back.cacheClearFailed", vec![format!("{err:#}")])),
            }
        }
        if restart_explorer {
            match refresh::restart_explorer() {
                Ok(()) => log.push(info("back.explorerRestarted")),
                Err(err) => log.push(error_p("back.explorerRestartFailed", vec![format!("{err:#}")])),
            }
        }
        Ok(log)
    })
    .await
}

/// 查询是否存在可撤销的快照
#[tauri::command]
async fn undo_status(app: AppHandle) -> Result<UndoStatusDto, String> {
    blocking(move || {
        Ok(match read_undo(&app) {
            Some(snapshot) => UndoStatusDto {
                available: !snapshot.entries.is_empty(),
                timestamp: Some(snapshot.timestamp),
                action: Some(snapshot.action),
                count: snapshot.entries.len(),
            },
            None => UndoStatusDto {
                available: false,
                timestamp: None,
                action: None,
                count: 0,
            },
        })
    })
    .await
}

/// 撤销上一次写入：按快照恢复 DefaultIcon（快照只能使用一次）
#[tauri::command]
async fn undo_last(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<LogLineDto>, String> {
    let _guard = BusyGuard::acquire(state.busy.clone());

    blocking(move || {
        let snapshot = read_undo(&app).ok_or_else(|| "没有可撤销的操作".to_string())?;
        if snapshot.entries.is_empty() {
            clear_undo(&app);
            return Err("back.noUndo".to_string());
        }

        let mut restored = 0usize;
        let mut failures: Vec<(String, String)> = Vec::new();
        for entry in &snapshot.entries {
            let key = format!("{}\\DefaultIcon", entry.prog_id);
            let result = match &entry.previous {
                Some(value) => registry::set_default_value(&key, value),
                None => registry::delete_key(&key),
            };
            match result {
                Ok(()) => restored += 1,
                Err(err) => failures.push((entry.extension.clone(), short_reason(&err))),
            }
        }

        clear_undo(&app);

        let mut log = vec![info_p(
            "back.undoDone",
            vec![
                action_label(&snapshot.action).to_string(),
                restored.to_string(),
            ],
        )];
        if let Some(line) = failure_log(snapshot.entries.len(), &failures) {
            log.push(line);
        }
        log.push(notify_log());
        Ok(log)
    })
    .await
}

/// 扫描本机所有可用的 Zed 安装（跨通道、多来源），供界面挑选或自动兜底
#[tauri::command]
async fn scan_zed_installations() -> Result<Vec<InstallationDto>, String> {
    blocking(move || {
        Ok(zed::scan_installations()
            .into_iter()
            .map(|item| InstallationDto {
                path: item.path.display().to_string(),
                channel: item.channel.as_key().to_string(),
                source: item.source.to_string(),
            })
            .collect())
    })
    .await
}

/// 把 DefaultIcon 值渲染成 PNG data URL（列表内图标预览）
///
/// 失败返回 `None`，前端回退到文字标签；结果在后端按「值 + 尺寸」缓存。
#[tauri::command]
async fn preview_icon(value: String, size: Option<u32>) -> Result<Option<String>, String> {
    blocking(move || {
        let size = size.unwrap_or(16).clamp(8, 256);
        Ok(iconrender::render_data_url(&value, size))
    })
    .await
}

// ---------- 窗口控制（自定义标题栏；均为瞬时 UI 操作，无 IO，可同步执行） ----------

/// 最小化窗口
#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

/// 最大化 / 还原窗口
#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

/// 关闭窗口
///
/// 必须走 `close()` 而不是 `destroy()`：前者会触发 `CloseRequested`，
/// 从而在任务进行中仍被关窗拦截逻辑挡住（D8）。
#[tauri::command]
fn window_close(window: tauri::Window) {
    // 关闭按钮 = 隐藏到托盘（与 CloseRequested 拦截保持一致），不退出进程
    let _ = window.hide();
}

/// 显示并聚焦主窗口（托盘点击 / 菜单共用）
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 设置开机自启动
#[tauri::command]
async fn set_autostart(app: AppHandle, enable: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    let result = if enable {
        autostart.enable()
    } else {
        autostart.disable()
    };
    result.map_err(|err| encoded("back.autostartFailed", &[err.to_string()]))
}

/// 查询开机自启动是否已启用
#[tauri::command]
async fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|err| encoded("back.autostartFailed", &[err.to_string()]))
}

/// 开始拖动窗口（自定义标题栏的拖拽区）
#[tauri::command]
fn start_window_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

/// 查询窗口是否处于最大化（前端初始化时同步按钮状态）
#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

// ---------- SVG / ICO 文件（SVG 转 ICO 工具用） ----------

/// SVG / ICO 文件大小上限（4 MiB）
const IMAGE_FILE_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 读取 SVG 文本（限 `.svg`，用于前端光栅化）
#[tauri::command]
async fn read_svg_file(path: String) -> Result<String, String> {
    blocking(move || {
        let path = PathBuf::from(path.trim());
        let is_svg = path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("svg"))
            .unwrap_or(false);
        if !is_svg {
            return Err("back.svgOnly".to_string());
        }
        let meta = std::fs::metadata(&path).map_err(|err| encoded("back.svgReadFailed", &[err.to_string()]))?;
        if meta.len() > IMAGE_FILE_MAX_BYTES {
            return Err(encoded("back.svgTooLarge", &[(meta.len() / 1024).to_string()]));
        }
        std::fs::read_to_string(&path).map_err(|err| encoded("back.svgLoadFailed", &[err.to_string()]))
    })
    .await
}

/// 保存生成的 ICO（限 `.ico`；数据由前端光栅化 SVG 后打包而成）
#[tauri::command]
async fn save_ico_file(path: String, data: Vec<u8>) -> Result<(), String> {
    blocking(move || {
        let path = PathBuf::from(path.trim());
        let is_ico = path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("ico"))
            .unwrap_or(false);
        if !is_ico {
            return Err("back.icoOnly".to_string());
        }
        if data.is_empty() {
            return Err("back.icoEmpty".to_string());
        }
        if data.len() as u64 > IMAGE_FILE_MAX_BYTES {
            return Err("back.icoTooLarge".to_string());
        }
        std::fs::write(&path, data).map_err(|err| encoded("back.icoWriteFailed", &[err.to_string()]))
    })
    .await
}

/// 为一批扩展名建立文件关联（创建 ProgID + 写扩展名键默认值）
///
/// **这是改变打开方式的操作**，只能由用户在设置页显式触发（前置确认对话框）。
/// 不覆盖其他程序的既有关联：遇到已指向别的 ProgID 的扩展名会跳过并报告。
#[tauri::command]
async fn register_extensions(
    window: tauri::Window,
    state: State<'_, AppState>,
    channel: String,
    extensions: Vec<String>,
    zed_path: String,
) -> Result<Vec<LogLineDto>, String> {
    let channel = Channel::from_key(&channel)
        .ok_or_else(|| encoded("back.unknownChannel", std::slice::from_ref(&channel)))?;
    if extensions.is_empty() {
        return Err("back.noTargets".to_string());
    }
    let zed = PathBuf::from(zed_path.trim());
    if zed_path.trim().is_empty() || !zed.is_file() {
        return Err("back.appNeedsZed".to_string());
    }

    let _guard = BusyGuard::acquire(state.busy.clone());

    blocking(move || {
        let total = extensions.len();
        let mut created = 0usize;
        let mut already: Vec<String> = Vec::new();
        let mut taken: Vec<(String, String)> = Vec::new();
        let mut failed: Vec<(String, String)> = Vec::new();

        for (index, ext) in extensions.iter().enumerate() {
            if let Err(err) = window.emit(
                "progress",
                ProgressPayload {
                    current: index + 1,
                    total,
                    extension: ext.clone(),
                },
            ) {
                eprintln!("[警告] 发送进度事件失败：{err}");
            }

            match register::register_extension(channel, ext, &zed) {
                Ok(outcome) => match outcome.state {
                    register::RegisterState::Created => created += 1,
                    register::RegisterState::AlreadyZed => already.push(outcome.extension),
                    register::RegisterState::TakenByOther => taken.push((
                        outcome.extension,
                        outcome.owner.unwrap_or_else(|| "?".to_string()),
                    )),
                },
                Err(err) => failed.push((ext.clone(), short_reason(&err))),
            }
        }

        let mut log = Vec::new();
        if created > 0 {
            log.push(info_p("back.regCreated", vec![created.to_string()]));
        }
        if !already.is_empty() {
            log.push(info_p(
                "back.regAlready",
                vec![already.len().to_string(), already.join(", ")],
            ));
        }
        if !taken.is_empty() {
            let detail = taken
                .iter()
                .map(|(ext, owner)| format!("{ext} → {owner}"))
                .collect::<Vec<_>>()
                .join("; ");
            log.push(warn_p(
                "back.regTaken",
                vec![taken.len().to_string(), detail],
            ));
        }
        if let Some(line) = failure_log(total, &failed) {
            log.push(line);
        }
        if log.is_empty() {
            log.push(info("back.regNothing"));
        }
        Ok(log)
    })
    .await
}

/// 检查一批扩展名的关联状态（只读）
///
/// 用于回答「为什么注册了关联却没生效」：`UserChoice` 存在且指向其他程序时，
/// 写入 `Classes\<ext>` 的关联不会生效。
#[tauri::command]
async fn inspect_extensions(
    channel: String,
    extensions: Vec<String>,
) -> Result<Vec<ExtStatusDto>, String> {
    let channel = Channel::from_key(&channel)
        .ok_or_else(|| encoded("back.unknownChannel", std::slice::from_ref(&channel)))?;
    blocking(move || {
        Ok(extensions
            .iter()
            .map(|ext| {
                let status = association::inspect_extension(channel, ext);
                ExtStatusDto {
                    extension: status.extension,
                    effective_prog_id: status.effective_prog_id,
                    effective_is_zed: status.effective_is_zed,
                    has_user_choice: status.has_user_choice,
                    classes_registered: status.classes_registered,
                }
            })
            .collect())
    })
    .await
}

/// 打开 Windows 的「默认应用」设置页
///
/// 为什么不直接写 `UserChoice`：该键带 Hash 完整性保护，写错会被系统忽略甚至重置，
/// 系统设置页是唯一官方支持、且能真正改变默认打开方式的途径。
#[tauri::command]
async fn open_default_apps_settings() -> Result<(), String> {
    blocking(move || {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|err| encoded("back.openSettingsFailed", &[err.to_string()]))
    })
    .await
}

/// 完整注册 ZedG 为系统可见应用（仅 zedg 通道）
///
/// 只做候选注册：ProgID、OpenWithProgids、Applications、
/// RegisteredApplications + Capabilities；不写 UserChoice、不改扩展名默认值。
#[tauri::command]
async fn register_application(
    state: State<'_, AppState>,
    channel: String,
    extensions: Vec<String>,
    zed_path: String,
) -> Result<Vec<LogLineDto>, String> {
    let channel = Channel::from_key(&channel)
        .ok_or_else(|| encoded("back.unknownChannel", std::slice::from_ref(&channel)))?;
    let zed = PathBuf::from(zed_path.trim());
    if zed_path.trim().is_empty() || !zed.is_file() {
        return Err("back.appNeedsZed".to_string());
    }
    let _guard = BusyGuard::acquire(state.busy.clone());
    blocking(move || {
        let (covered, skipped) = register::register_application(channel, &extensions, &zed)
            .map_err(|err| short_reason(&err))?;
        let mut log = vec![info_p("back.appRegistered", vec![covered.to_string()])];
        if !skipped.is_empty() {
            let detail = skipped
                .iter()
                .map(|(ext, reason)| format!("{ext}: {reason}"))
                .collect::<Vec<_>>()
                .join("; ");
            log.push(warn_p(
                "back.appRegSkipped",
                vec![skipped.len().to_string(), detail],
            ));
        }
        Ok(log)
    })
    .await
}

/// 移除 ZedG 的应用注册（仅 zedg 通道）
#[tauri::command]
async fn unregister_application(
    state: State<'_, AppState>,
    channel: String,
) -> Result<Vec<LogLineDto>, String> {
    let channel = Channel::from_key(&channel)
        .ok_or_else(|| encoded("back.unknownChannel", std::slice::from_ref(&channel)))?;
    let _guard = BusyGuard::acquire(state.busy.clone());
    blocking(move || {
        register::unregister_application(channel).map_err(|err| short_reason(&err))?;
        Ok(vec![info("back.appUnregistered")])
    })
    .await
}

/// 查询应用注册状态（只读）
#[tauri::command]
async fn inspect_application_registration() -> Result<AppRegistrationDto, String> {
    blocking(move || {
        let status = register::application_registration_status().map_err(|err| short_reason(&err))?;
        Ok(AppRegistrationDto {
            registered: status.registered,
            covered: status.covered,
        })
    })
    .await
}

/// 预设文件大小上限（1 MiB）：预设是纯文本配置，不该更大
const PRESET_MAX_BYTES: u64 = 1024 * 1024;

/// 校验预设文件路径（限定 .json，避免被当作任意文件读写通道）
fn preset_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("back.noFileChosen".to_string());
    }
    let path = PathBuf::from(trimmed);
    let is_json = path
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if !is_json {
        return Err("back.presetNotJson".to_string());
    }
    Ok(path)
}

/// 保存预设文件（路径由前端文件对话框选定，仅接受 .json）
#[tauri::command]
async fn save_preset_file(path: String, content: String) -> Result<(), String> {
    blocking(move || {
        let path = preset_path(&path)?;
        std::fs::write(&path, content).map_err(|err| encoded("back.presetWriteFailed", &[err.to_string()]))
    })
    .await
}

/// 读取预设文件（仅接受 .json，且限制大小）
#[tauri::command]
async fn load_preset_file(path: String) -> Result<String, String> {
    blocking(move || {
        let path = preset_path(&path)?;
        let meta = std::fs::metadata(&path).map_err(|err| encoded("back.presetReadFailed", &[err.to_string()]))?;
        if meta.len() > PRESET_MAX_BYTES {
            return Err(encoded("back.presetTooLarge", &[(meta.len() / 1024).to_string()]));
        }
        std::fs::read_to_string(&path).map_err(|err| encoded("back.presetLoadFailed", &[err.to_string()]))
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(AppState {
            busy: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            // 系统托盘：关闭窗口后常驻后台。
            // 左键点击托盘图标 = 显示主窗口；右键菜单 = 显示主窗口 / 退出。
            // 菜单文案硬编码中文：托盘属系统级 UI，跟随前端语言需要跨层同步，暂缓。
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("缺少应用图标").clone())
                .tooltip("Zed 文件关联图标管理器")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        // 有任务进行中时不退出，拉回主窗口让用户看到进度
                        let state = app.state::<AppState>();
                        if state.busy.load(Ordering::SeqCst) {
                            show_main_window(app);
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            load_state,
            scan_ico_count,
            scan_zed_installations,
            preview_icon,
            apply_icons,
            remove_icons,
            register_extensions,
            register_application,
            unregister_application,
            inspect_application_registration,
            set_autostart,
            is_autostart_enabled,
            inspect_extensions,
            open_default_apps_settings,
            refresh_explorer,
            undo_status,
            undo_last,
            save_preset_file,
            load_preset_file,
            read_svg_file,
            save_ico_file,
            window_minimize,
            window_toggle_maximize,
            window_close,
            start_window_drag,
            window_is_maximized,
            set_autostart,
            is_autostart_enabled
        ])
        .on_window_event(|window, event| match event {
            // 关闭 = 隐藏到托盘（常驻后台，任务继续跑）；退出只能通过托盘菜单。
            // Alt+F4 等系统级关闭同样被拦截。
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // 自定义标题栏的按钮图标要跟随最大化状态变化
            tauri::WindowEvent::Resized(_) => {
                let _ = window.emit("window-maximized", window.is_maximized().unwrap_or(false));
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 通道选择：注册表里已有 ProgID 的通道优先
    #[test]
    fn channel_selection_prefers_existing_prog_id() {
        let classes = vec![
            "ZedG.md".to_string(),
            "ZedG.rs".to_string(),
            ".py".to_string(),
        ];
        assert_eq!(select_channel(&classes), Channel::Zedg);

        let stable = vec!["Zed.py".to_string(), "ZedG.md".to_string()];
        assert_eq!(select_channel(&stable), Channel::Stable);

        // 空注册表：退化为「检测到 exe」或兜底，不应 panic
        let empty: Vec<String> = Vec::new();
        let _ = select_channel(&empty);
    }

    /// 大小写不敏感：大写 ProgID 也能命中通道前缀
    #[test]
    fn channel_selection_case_insensitive() {
        let classes = vec!["ZEDG.MD".to_string()];
        assert_eq!(select_channel(&classes), Channel::Zedg);
    }

    /// 操作名到中文标签
    #[test]
    fn action_labels() {
        assert_eq!(action_label("apply"), "actionLabel.apply");
        assert_eq!(action_label("remove"), "actionLabel.remove");
        assert_eq!(action_label("whatever"), "actionLabel.other");
    }

    /// 失败明细汇总成单条日志
    #[test]
    fn failure_logging() {
        assert!(failure_log(0, &[]).is_none());

        let line = failure_log(5, &[("rs".to_string(), "key is gone".to_string())]).unwrap();
        assert_eq!(line.key, "back.failed");
        assert_eq!(line.params.len(), 3);
        assert_eq!(line.params[0], "5");
        assert!(line.params[2].contains("rs"));
        assert!(matches!(line.level, LogLevel::Error));
    }
}
