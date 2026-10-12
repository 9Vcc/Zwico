//! 文件关联管理：枚举当前关联到 Zed 的文件扩展名及其图标状态
//!
//! 关联的两条路径（均在 HKCU，无需管理员权限）：
//!
//! 1. **安装器注册**（官方 Zed）：`Software\Classes\.py` 默认值指向
//!    ProgID `Zed.py`，每个扩展名一个独立 ProgID
//! 2. **「打开方式」设置**（常见于 scoop 等便携安装）：
//!    `Explorer\FileExts\.md\UserChoice` 的 ProgId 可能是
//!    `Applications\ZedG.exe` 或 `md_auto_file` 这类系统命名 ProgID
//!
//! 本模块按「扩展名 → 实际生效 ProgID」枚举（UserChoice 优先，覆盖各种
//! ProgID 形态），并补充枚举通道自有前缀的 ProgID 键，按扩展名去重合并。

use std::collections::HashSet;

use anyhow::Result;
use windows_registry::CURRENT_USER;

use crate::registry;
use crate::zed::Channel;

/// HKCU 下 Explorer 文件扩展名配置的根路径（UserChoice 所在）
const FILE_EXTS_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

/// 单个文件关联的描述信息
#[derive(Debug, Clone)]
pub struct FileAssociation {
    /// 扩展名（不带点，如 "md"）
    pub extension: String,
    /// 实际生效的 ProgID（如 "ZedG.md"、"Applications\ZedG.exe"、"md_auto_file"）
    pub prog_id: String,
    /// ProgID 是否为跨扩展名共享（`Applications\*` 形态：
    /// 所有通过「打开方式」关联到同一程序的扩展名共用图标）
    pub shared_prog_id: bool,
    /// 是否存在 DefaultIcon 子键
    pub has_default_icon: bool,
    /// DefaultIcon 的当前值（None 表示键不存在或未设置默认值）
    pub current_icon: Option<String>,
}

/// 列出当前关联到指定通道 Zed 的全部文件扩展名
pub fn list_associations(channel: Channel) -> Result<Vec<FileAssociation>> {
    // 源 A：从扩展名键出发，解析实际生效的关联（覆盖各种 ProgID 形态）
    let mut associations = list_effective_associations(channel)?;
    let known: HashSet<String> = associations.iter().map(|a| a.extension.clone()).collect();

    // 源 B：通道自有前缀的 ProgID 键（可能存在但尚未设为默认打开方式）补充
    let prefix = channel.prog_id_prefix();
    for prog_id in registry::list_subkeys("")? {
        let Some(extension) = prog_id.strip_prefix(prefix) else {
            continue;
        };
        // 跳过空扩展名与 "ZedG.py.1" 这类带版本号的 COM 风格 ProgID
        if extension.is_empty() || extension.contains('.') {
            continue;
        }
        if known.contains(extension) {
            continue; // 源 A 已收录（实际生效），跳过
        }
        associations.push(build_association(extension, &prog_id));
    }

    // 按扩展名排序，保证列表顺序稳定
    associations.sort_by(|a, b| a.extension.cmp(&b.extension));
    println!(
        "[关联] 通道 {}（前缀 {prefix}）共发现 {} 个关联",
        channel.display_name(),
        associations.len()
    );
    Ok(associations)
}

/// 源 A：遍历扩展名键，解析实际生效的 ProgID 并筛选出属于本通道的关联
fn list_effective_associations(channel: Channel) -> Result<Vec<FileAssociation>> {
    let mut result = Vec::new();

    for key_name in registry::list_subkeys("")? {
        // 只处理扩展名键（"." 开头），如 ".md"
        let Some(extension) = key_name.strip_prefix('.') else {
            continue;
        };
        if extension.is_empty() || extension.contains('.') {
            continue; // 跳过异常扩展名
        }

        // 解析实际生效的 ProgID（UserChoice 优先，扩展名键默认值后备）
        let Some(prog_id) = effective_prog_id(&key_name) else {
            continue;
        };
        if !channel.owns_prog_id(&prog_id) {
            continue;
        }

        result.push(build_association(extension, &prog_id));
    }

    Ok(result)
}

/// 解析扩展名的实际生效 ProgID
///
/// 优先级：`FileExts\<ext>\UserChoice`（Explorer 双击实际使用，含签名校验，
/// 程序只能读取）→ `Software\Classes\<ext>` 默认值（传统关联方式）。
fn effective_prog_id(ext_key: &str) -> Option<String> {
    // 1. UserChoice
    let user_choice = format!(r"{FILE_EXTS_ROOT}\{ext_key}\UserChoice");
    if let Ok(key) = CURRENT_USER.open(&user_choice) {
        if let Ok(prog_id) = key.get_string("ProgId") {
            return Some(prog_id);
        }
    }
    // 2. Classes\<ext> 默认值
    registry::get_default_value(ext_key).ok().flatten()
}

/// 构造关联条目：读取 ProgID 的 DefaultIcon 状态（尽力而为，失败按未设置处理）
fn build_association(extension: &str, prog_id: &str) -> FileAssociation {
    let icon_key = format!("{prog_id}\\DefaultIcon");
    FileAssociation {
        extension: extension.to_string(),
        shared_prog_id: prog_id.starts_with("Applications\\"),
        has_default_icon: registry::key_exists(&icon_key).unwrap_or(false),
        current_icon: registry::get_default_value(&icon_key).ok().flatten(),
        prog_id: prog_id.to_string(),
    }
}
