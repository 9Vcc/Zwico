//! Zed 发布通道配置与安装检测
//!
//! 职责：
//! - 定义 Zed 的发布通道（稳定版 / 预览版 / 每夜版 / 汉化版）及其注册表命名约定
//! - 探测指定通道的 Zed 可执行文件位置：
//!   卸载注册表 → 常见安装目录 → scoop（含自定义根目录的 shim 解析）

use std::path::{Path, PathBuf};

use windows_registry::CURRENT_USER;

use crate::registry;

/// Zed 发布通道
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// 稳定版：正式发布通道
    Stable,
    /// 预览版：Beta 通道，领先稳定版
    Preview,
    /// 每夜版：每日构建，最不稳定
    Nightly,
    /// 汉化版：ZedG（中文社区版，常见于 scoop 安装）
    Zedg,
}

impl Channel {
    /// 全部通道（界面遍历用）
    pub const ALL: [Channel; 4] = [
        Channel::Stable,
        Channel::Preview,
        Channel::Nightly,
        Channel::Zedg,
    ];

    /// 界面显示的中文名称
    pub fn display_name(&self) -> &'static str {
        match self {
            Channel::Stable => "稳定版",
            Channel::Preview => "预览版",
            Channel::Nightly => "每夜版",
            Channel::Zedg => "汉化版（ZedG）",
        }
    }

    /// ProgID 前缀：写入 HKCU\Software\Classes 的程序标识符前缀
    ///
    /// 例如稳定版关联 `.rs` 时使用的 ProgID 为 `Zed.rs`。
    /// 说明：ZedG 汉化版默认按 `ZedG.` 处理，若其实际注册前缀不同，可在此调整。
    pub fn prog_id_prefix(&self) -> &'static str {
        match self {
            Channel::Stable => "Zed.",
            Channel::Preview => "ZedPreview.",
            Channel::Nightly => "ZedNightly.",
            Channel::Zedg => "ZedG.",
        }
    }

    /// 应用显示名称：对应卸载注册表中的 `DisplayName` 值
    pub fn app_name(&self) -> &'static str {
        match self {
            Channel::Stable => "Zed",
            Channel::Preview => "Zed Preview",
            Channel::Nightly => "Zed Nightly",
            Channel::Zedg => "ZedG",
        }
    }

    /// 可执行文件名
    pub fn exe_name(&self) -> &'static str {
        match self {
            Channel::Stable => "zed.exe",
            Channel::Preview => "Zed Preview.exe",
            Channel::Nightly => "Zed Nightly.exe",
            Channel::Zedg => "ZedG.exe",
        }
    }

    /// 前后端通信用的稳定 ascii key（显示名只在前端用）
    pub fn as_key(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Preview => "preview",
            Channel::Nightly => "nightly",
            Channel::Zedg => "zedg",
        }
    }

    /// 由稳定 key 反解通道（未知 key 返回 None）
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_key() == key)
    }

    /// scoop 包名（无官方 scoop 包的通道返回 None）
    pub fn scoop_app_name(&self) -> Option<&'static str> {
        match self {
            Channel::Stable => Some("zed"),
            Channel::Zedg => Some("zedg"),
            Channel::Preview | Channel::Nightly => None,
        }
    }

    /// 判断指定 ProgID 是否将文件的打开操作交给了本通道的 Zed
    ///
    /// 匹配规则（满足其一即视为属于本通道）：
    /// 1. ProgID 使用本通道的自有前缀（如 `ZedG.md`，安装器注册形态）
    /// 2. ProgID 是「打开方式」注册的 Applications 形态（如 `Applications\ZedG.exe`）
    /// 3. ProgID 的 `shell\open\command` 指向本通道的可执行文件
    ///    （覆盖 `md_auto_file` 这类由系统命名的任意 ProgID）
    ///
    /// 注册表键名**大小写不敏感**，因此三条规则一律按小写形式比较
    /// （实测 Windows 上存在 `.TS`、`.WPL` 这类大写键名，早期版本按区分大小写比较会漏项）。
    pub fn owns_prog_id(&self, prog_id: &str) -> bool {
        let lower = prog_id.to_ascii_lowercase();
        // 规则 1：自有前缀
        if lower.starts_with(&self.prog_id_prefix().to_ascii_lowercase()) {
            return true;
        }
        // 规则 2：Applications\<exe 名>
        let applications_key = format!("Applications\\{}", self.exe_name()).to_ascii_lowercase();
        if lower == applications_key {
            return true;
        }
        // 规则 3：打开命令包含本通道 exe 文件名
        let command_key = format!("{prog_id}\\shell\\open\\command");
        if let Ok(Some(command)) = registry::get_default_value(&command_key) {
            return command
                .to_ascii_lowercase()
                .contains(&self.exe_name().to_ascii_lowercase());
        }
        false
    }
}

/// HKCU 下的「卸载程序」注册表路径（用户级安装的应用会写入这里）
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// 探测指定通道 Zed 的可执行文件完整路径
///
/// 探测顺序：
/// 1. 卸载注册表：按 `DisplayName` 匹配通道，读取 `InstallLocation`
/// 2. 常见安装目录：`%LOCALAPPDATA%\Programs`、`%ProgramFiles%` 等固定位置
/// 3. scoop：解析 PATH 中的 shim（支持自定义 scoop 根目录），再探测默认根目录
///
/// 返回 `Some(exe 完整路径)` 表示找到；`None` 表示未找到。
pub fn detect_zed_path(channel: Channel) -> Option<PathBuf> {
    // 1. 卸载注册表（可覆盖自定义安装路径）
    if let Some(path) = find_from_uninstall_registry(channel) {
        return Some(path);
    }
    // 2. 常见安装目录
    if let Some(path) = find_from_common_paths(channel) {
        return Some(path);
    }
    // 3. scoop 安装（官方 zed 包 / 汉化版 zedg 包）
    find_from_scoop(channel)
}

/// 从卸载注册表查找：遍历子键，按 `DisplayName` 匹配通道的应用名称
fn find_from_uninstall_registry(channel: Channel) -> Option<PathBuf> {
    // 打开卸载信息根键（Windows 系统键，正常必然存在）
    let uninstall = CURRENT_USER.open(UNINSTALL_KEY).ok()?;

    // keys() 创建迭代器也可能失败，失败时直接放弃注册表探测；
    // KeyIterator 直接产出 String（不含 Result 包装）
    let subkeys = uninstall.keys().ok()?;

    // 遍历所有已安装程序的子键
    for subkey_name in subkeys {
        let Ok(subkey) = uninstall.open(&subkey_name) else {
            continue; // 跳过无法打开的子键
        };

        // DisplayName 与通道应用名称一致时视为匹配
        if subkey.get_string("DisplayName").ok().as_deref() != Some(channel.app_name()) {
            continue;
        }

        // InstallLocation 为安装目录，拼接可执行文件名并验证存在
        if let Ok(install_dir) = subkey.get_string("InstallLocation") {
            let exe = PathBuf::from(&install_dir).join(channel.exe_name());
            if exe.is_file() {
                return Some(exe);
            }
        }
    }

    None
}

/// 探测常见安装目录下的 Zed 可执行文件
fn find_from_common_paths(channel: Channel) -> Option<PathBuf> {
    let app_name = channel.app_name();
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 用户级安装默认位置：%LOCALAPPDATA%\Programs\<应用名>
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let programs = PathBuf::from(local_appdata).join("Programs");
        candidates.push(programs.join(app_name));
        // Zed 安装器也可能统一安装在固定目录 "Zed" 下（不同通道共用）
        candidates.push(programs.join("Zed"));
    }

    // 系统级安装位置：%ProgramFiles%\<应用名>
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join(app_name));
    }

    // 逐个候选目录验证可执行文件是否存在
    for dir in candidates {
        let exe = dir.join(channel.exe_name());
        if exe.is_file() {
            return Some(exe);
        }
    }

    None
}

/// 从 scoop 安装中查找（官方 zed 包 / 汉化版 zedg 包）
///
/// scoop 可安装在任意根目录（如 `D:\Scoop`），其 `shims` 目录会加入 PATH；
/// shim 文件（如 `zedg.shim`）内容为 `path = "真实 exe 路径"`，
/// 据此可解析出任意自定义根目录下的真实可执行文件位置。
fn find_from_scoop(channel: Channel) -> Option<PathBuf> {
    let app = channel.scoop_app_name()?;

    // 1. 解析 PATH 中的 scoop shim（支持自定义根目录，如 D:\Scoop）
    if let Some(path) = find_from_scoop_shim(app) {
        return Some(path);
    }

    // 2. 默认根目录：%USERPROFILE%\scoop\apps\<包名>\current\[bin\]<exe>
    if let Ok(home) = std::env::var("USERPROFILE") {
        let current = PathBuf::from(home)
            .join("scoop")
            .join("apps")
            .join(app)
            .join("current");
        // 有些包的可执行文件在 current 根，有些在 current\bin（如 ZedG）
        for base in [current.join("bin"), current] {
            let exe = base.join(channel.exe_name());
            if exe.is_file() {
                return Some(exe);
            }
        }
    }

    None
}

/// 在 PATH 的各目录中查找 scoop shim 文件（`<包名>.shim`）并解析真实 exe 路径
///
/// shim 文件内容示例：
///
/// ```text
/// path = "D:\Scoop\apps\zedg\current\bin\ZedG.exe"
/// ```
fn find_from_scoop_shim(scoop_app: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    let shim_name = format!("{scoop_app}.shim");

    for dir in path_var.split(';') {
        // 仅检查以 shims 结尾的目录（scoop 特征），避免无关扫描
        let dir = dir.trim().trim_end_matches('\\');
        if !dir.to_ascii_lowercase().ends_with("shims") {
            continue;
        }

        let shim_file = Path::new(dir).join(&shim_name);
        let Ok(content) = std::fs::read_to_string(&shim_file) else {
            continue;
        };

        // 解析 path = "..." 行，提取引号内的可执行文件路径
        for line in content.lines() {
            let line = line.trim();
            if let Some(rest) = line
                .strip_prefix("path")
                .and_then(|r| r.trim_start().strip_prefix('='))
            {
                let target = rest.trim().trim_matches('"');
                let path = PathBuf::from(target);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 通道配置：ProgID 前缀与应用命名
    #[test]
    fn channel_config() {
        assert_eq!(Channel::Stable.prog_id_prefix(), "Zed.");
        assert_eq!(Channel::Preview.prog_id_prefix(), "ZedPreview.");
        assert_eq!(Channel::Nightly.prog_id_prefix(), "ZedNightly.");
        assert_eq!(Channel::Zedg.prog_id_prefix(), "ZedG.");
        // 全部通道都有非空应用名与可执行文件名
        for channel in Channel::ALL {
            assert!(!channel.app_name().is_empty());
            assert!(channel.exe_name().ends_with(".exe"));
        }
        // 稳定版 ProgID 前缀不匹配其他通道键名（避免枚举时串通道）
        assert_eq!("Zed.py".strip_prefix("Zed."), Some("py"));
        assert!("ZedPreview.py".strip_prefix("Zed.").is_none());
        assert!("ZedG.py".strip_prefix("Zed.").is_none());
    }

    /// 通道 key 往返：前后端以 key 通信，必须一一对应且唯一
    #[test]
    fn channel_key_roundtrip() {
        let mut keys: Vec<&str> = Channel::ALL.iter().map(|c| c.as_key()).collect();
        assert_eq!(keys.len(), Channel::ALL.len());
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), Channel::ALL.len(), "通道 key 必须唯一");
        for channel in Channel::ALL {
            assert_eq!(Channel::from_key(channel.as_key()), Some(channel));
        }
        assert_eq!(Channel::from_key("unknown"), None);
    }

    /// 归属判定大小写不敏感：注册表键名不区分大小写，大写键名同样归属本通道
    #[test]
    fn owns_prog_id_case_insensitive() {
        let zedg = Channel::Zedg;
        // 规则 1：自有前缀
        assert!(zedg.owns_prog_id("ZedG.md"));
        assert!(zedg.owns_prog_id("zedg.MD"));
        assert!(zedg.owns_prog_id("ZEDG.RS"));
        // 规则 2：Applications 形态
        assert!(zedg.owns_prog_id(r"applications\ZEDG.EXE"));
        // 前缀不串通道（字符串判定）
        assert!(!Channel::Stable.owns_prog_id("ZedG.md"));
        assert!(!Channel::Preview.owns_prog_id("ZedNightly.md"));
    }

    /// 本机 scoop shim 解析（依赖实际安装，仅在存在时通过）
    #[test]
    fn scoop_shim_resolution() {
        // 无论是否安装，都不应 panic；安装了 zedg 时应能解析出真实路径
        if let Some(path) = find_from_scoop_shim("zedg") {
            assert!(path.is_file(), "shim 指向的文件应存在：{}", path.display());
            assert!(path.to_string_lossy().to_lowercase().ends_with(".exe"));
        }
    }
}
