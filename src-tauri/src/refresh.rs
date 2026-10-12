//! 系统刷新：让资源管理器感知文件关联与图标的变化
//!
//! 修改 HKCU 下的关联注册表后，资源管理器不会立即生效，需要：
//! 1. 广播「关联已变更」通知（SHChangeNotify）
//! 2. 清理图标缓存数据库（IconCache.db / thumbcache_*.db）
//! 3. 必要时重启 explorer.exe 强制重建图标缓存

use std::os::windows::process::CommandExt; // 为 Command 附加 creation_flags
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result};
use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

/// 子进程创建标志：不弹出控制台窗口（GUI 程序拉起命令行工具时必需）
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 通知系统「文件关联已变更」
///
/// 调用 SHChangeNotify 广播 SHCNE_ASSOCCHANGED 事件，
/// Shell 收到后会重新加载文件关联与图标信息。
pub fn notify_system() -> Result<()> {
    // SAFETY：SHChangeNotify 仅广播通知，两个指针参数均传 NULL
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
    println!("[刷新] 已广播文件关联变更通知（SHCNE_ASSOCCHANGED）");
    Ok(())
}

/// 清理图标缓存（尽力而为：被占用的文件跳过，不影响整体结果）
///
/// 删除目标：
/// - `%LOCALAPPDATA%\IconCache.db`（图标缓存数据库）
/// - `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db`（图标/缩略图缓存）
pub fn clear_icon_cache() -> Result<()> {
    let local_appdata =
        std::env::var("LOCALAPPDATA").context("无法读取 %LOCALAPPDATA% 环境变量")?;

    let mut deleted = 0usize;
    let mut skipped = 0usize;

    // 1. 图标缓存数据库
    let icon_cache = PathBuf::from(&local_appdata).join("IconCache.db");
    match try_delete(&icon_cache) {
        Ok(true) => deleted += 1,
        Ok(false) => {}
        Err(err) => {
            skipped += 1;
            println!("[刷新] 跳过 {}（{err}）", icon_cache.display());
        }
    }

    // 2. Explorer 图标 / 缩略图缓存（thumbcache_*.db）
    let explorer_dir = PathBuf::from(&local_appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Explorer");
    match std::fs::read_dir(&explorer_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                // 仅匹配 thumbcache_*.db 文件名
                let is_target = entry
                    .file_name()
                    .to_str()
                    .map(|name| name.starts_with("thumbcache_") && name.ends_with(".db"))
                    .unwrap_or(false);
                if !is_target {
                    continue;
                }

                let path = entry.path();
                match try_delete(&path) {
                    Ok(true) => deleted += 1,
                    Ok(false) => {}
                    Err(err) => {
                        skipped += 1;
                        println!("[刷新] 跳过 {}（{err}）", path.display());
                    }
                }
            }
        }
        Err(err) => {
            // 目录不存在（如全新系统）不算错误，仅记录
            println!("[刷新] 无法读取缓存目录 {}（{err}）", explorer_dir.display());
        }
    }

    println!("[刷新] 图标缓存清理完成：删除 {deleted} 个，跳过 {skipped} 个");
    Ok(())
}

/// 重启资源管理器：结束全部 explorer.exe → 等待 2 秒 → 重新启动
///
/// 说明：taskkill 在没有 explorer 进程时返回非零退出码，属正常情况，不视为错误。
pub fn restart_explorer() -> Result<()> {
    println!("[刷新] 正在结束所有 explorer.exe 进程…");

    // 1. 结束所有 explorer.exe（/F 强制结束，/IM 按映像名匹配）
    let status = Command::new("taskkill")
        .args(["/F", "/IM", "explorer.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .context("执行 taskkill 失败")?;
    if !status.success() {
        println!("[刷新] taskkill 未成功结束进程（可能当前没有运行中的 explorer.exe）");
    }

    // 2. 等待 2 秒，让系统完成进程清理
    sleep(Duration::from_secs(2));

    // 3. 重新启动 explorer.exe，桌面与任务栏随之恢复
    Command::new("explorer.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .context("重新启动 explorer.exe 失败")?;

    println!("[刷新] explorer.exe 已重新启动");
    Ok(())
}

/// 尝试删除单个文件
///
/// - `Ok(true)`：删除成功
/// - `Ok(false)`：文件本就不存在
/// - `Err`：删除失败（典型原因：文件正被 explorer.exe 占用）
fn try_delete(path: &Path) -> std::io::Result<bool> {
    match std::fs::remove_file(path) {
        Ok(()) => {
            println!("[刷新] 已删除 {}", path.display());
            Ok(true)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}
