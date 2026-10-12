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
//!
//! 实现要点：
//! - `Software\Classes` 的**全量子键只枚举一次**，两个来源共用（原实现枚举两次）
//! - 注册表键名**大小写不敏感**，因此所有比较、去重、前缀匹配统一按小写进行
//!   （实测 Windows 上确实存在 `.WPL`、`.TS` 这类大写键名）
//! - 展示用扩展名统一归一化为小写，注册表访问仍使用原始键名

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use serde::Serialize;
use windows_registry::CURRENT_USER;

use crate::icon::{self, IconState};
use crate::registry;
use crate::zed::Channel;

/// HKCU 下 Explorer 文件扩展名配置的根路径（UserChoice 所在）
const FILE_EXTS_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

/// 生效 ProgID 的来源 —— 决定「关联是否真的生效」
///
/// Windows 双击文件时的优先级：`UserChoice` → `Classes\<ext>` 默认值，
/// 其中 `UserChoice` 受完整性保护（含 Hash），程序不能可靠改写，
/// 因此本工具写下的关联在它存在时不生效。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgIdSource {
    /// 来自 `FileExts\<ext>\UserChoice`：Explorer 实际使用，程序无法改写
    UserChoice,
    /// 来自 `Classes\<ext>` 默认值：本工具可写
    ClassesDefault,
    /// 来自通道自有 ProgID 键（该扩展名尚未设为默认打开方式）
    ProgIdOnly,
}

/// 单个文件关联的描述信息
#[derive(Debug, Clone)]
pub struct FileAssociation {
    /// 扩展名（不带点、已转小写，如 "md"）
    pub extension: String,
    /// 实际生效的 ProgID（如 "ZedG.md"、"Applications\ZedG.exe"、"md_auto_file"）
    pub prog_id: String,
    /// 该 ProgID 的来源（UserChoice / Classes 默认值 / 仅 ProgID 键）
    pub prog_id_source: ProgIdSource,
    /// ProgID 是否为跨扩展名共享（`Applications\*` 形态：
    /// 所有通过「打开方式」关联到同一程序的扩展名共用图标）
    pub shared_prog_id: bool,
    /// 同一 ProgID 还被**哪些其他扩展名**共用（用于量化「本次修改会影响谁」）
    pub shared_with: Vec<String>,
    /// 是否存在 DefaultIcon 子键
    pub has_default_icon: bool,
    /// DefaultIcon 的当前值（None 表示键不存在或未设置默认值）
    pub current_icon: Option<String>,
    /// 当前图标的可达性（已设置但文件不存在 → Missing，前端标「失效」）
    pub icon_state: IconState,
}

/// 列出当前关联到指定通道 Zed 的全部文件扩展名
pub fn list_associations(channel: Channel) -> Result<Vec<FileAssociation>> {
    // `Software\Classes` 全量子键只读一次，供两个来源共用
    let classes = registry::list_subkeys("")?;

    // 源 A：从扩展名键出发，解析实际生效的关联（覆盖各种 ProgID 形态）
    let mut associations = list_effective_associations(channel, &classes);

    // 源 B：通道自有前缀的 ProgID 键（可能存在但尚未设为默认打开方式）补充
    let prefix = channel.prog_id_prefix().to_ascii_lowercase();
    let mut known: HashSet<String> = associations.iter().map(|a| a.extension.clone()).collect();
    for prog_id in &classes {
        let Some(extension) = prog_id
            .to_ascii_lowercase()
            .strip_prefix(&prefix)
            .map(str::to_owned)
        else {
            continue;
        };
        // 跳过空扩展名与 "ZedG.py.1" 这类带版本号的 COM 风格 ProgID
        if extension.is_empty() || extension.contains('.') {
            continue;
        }
        if !known.insert(extension.clone()) {
            continue; // 源 A 已收录（实际生效），跳过
        }
        associations.push(build_association(&extension, prog_id, ProgIdSource::ProgIdOnly));
    }

    // 按扩展名排序，保证列表顺序稳定
    associations.sort_by(|a, b| a.extension.cmp(&b.extension));

    // 影响面：统计每个 ProgID 实际被哪些扩展名共用
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for assoc in &associations {
        groups
            .entry(assoc.prog_id.to_ascii_lowercase())
            .or_default()
            .push(assoc.extension.clone());
    }
    for assoc in &mut associations {
        let mut others = groups
            .get(&assoc.prog_id.to_ascii_lowercase())
            .cloned()
            .unwrap_or_default();
        others.retain(|ext| ext != &assoc.extension);
        assoc.shared_with = others;
    }

    let invalid = associations
        .iter()
        .filter(|a| a.icon_state == IconState::Missing)
        .count();
    println!(
        "[关联] 通道 {}（前缀 {prefix}）共发现 {} 个关联{}",
        channel.name_key(),
        associations.len(),
        if invalid > 0 {
            format!("，其中 {invalid} 个图标已失效")
        } else {
            String::new()
        }
    );
    Ok(associations)
}

/// 源 A：遍历扩展名键，解析实际生效的 ProgID 并筛选出属于本通道的关联
///
/// 注册表访问本身不会失败（`effective_prog_id` 逐项容错），因此返回 Vec 而非 Result。
fn list_effective_associations(channel: Channel, classes: &[String]) -> Vec<FileAssociation> {
    let mut result = Vec::new();

    for key_name in classes {
        // 只处理扩展名键（"." 开头），如 ".md"
        let Some(raw_extension) = key_name.strip_prefix('.') else {
            continue;
        };
        if raw_extension.is_empty() || raw_extension.contains('.') {
            continue; // 跳过异常扩展名
        }
        let extension = raw_extension.to_ascii_lowercase();

        // 解析实际生效的 ProgID（UserChoice 优先，扩展名键默认值后备）
        let Some((prog_id, source)) = effective_prog_id(key_name) else {
            continue;
        };
        if !channel.owns_prog_id(&prog_id) {
            continue;
        }

        result.push(build_association(&extension, &prog_id, source));
    }

    result
}

/// 解析扩展名的实际生效 ProgID
///
/// 优先级：`FileExts\<ext>\UserChoice`（Explorer 双击实际使用，含签名校验，
/// 程序只能读取）→ `Software\Classes\<ext>` 默认值（传统关联方式）。
///
/// 注意：注册表路径大小写不敏感，`ext_key` 使用原始键名即可命中
/// `FileExts` 下大小写不同名的子键。
fn effective_prog_id(ext_key: &str) -> Option<(String, ProgIdSource)> {
    // 1. UserChoice：Explorer 双击时实际使用，且受完整性保护（只读）
    if let Some(prog_id) = read_user_choice(ext_key) {
        return Some((prog_id, ProgIdSource::UserChoice));
    }
    // 2. Classes\<ext> 默认值：仅在 UserChoice 不存在时生效
    registry::get_default_value(ext_key)
        .ok()
        .flatten()
        .map(|prog_id| (prog_id, ProgIdSource::ClassesDefault))
}

/// 读取 `FileExts\<ext>\UserChoice` 的 ProgId（只读；该键受保护不能改写）
fn read_user_choice(ext_key: &str) -> Option<String> {
    let path = format!(r"{FILE_EXTS_ROOT}\{ext_key}\UserChoice");
    CURRENT_USER.open(path).ok()?.get_string("ProgId").ok()
}

/// 单个扩展名的关联状态（供设置页诊断「为什么关联没生效」）
#[derive(Debug, Clone)]
pub struct ExtStatus {
    pub extension: String,
    /// 实际生效的 ProgID（UserChoice 优先，其次 Classes 默认值）
    pub effective_prog_id: Option<String>,
    /// 实际生效的关联是否指向本通道 Zed
    pub effective_is_zed: bool,
    /// `UserChoice` 是否存在 —— 存在即表示系统已指定默认程序，本工具写入的关联不会生效
    pub has_user_choice: bool,
    /// `Classes\<ext>` 默认值是否已指向本通道
    pub classes_registered: bool,
}

/// 检查单个扩展名：谁在实际生效、注册的关联是否被 UserChoice 挡住
pub fn inspect_extension(channel: Channel, extension: &str) -> ExtStatus {
    let ext = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    let ext_key = format!(".{ext}");

    let user_choice = read_user_choice(&ext_key);
    let classes_default = registry::get_default_value(&ext_key).ok().flatten();
    let effective = user_choice.clone().or_else(|| classes_default.clone());

    ExtStatus {
        effective_is_zed: effective
            .as_deref()
            .map(|prog_id| channel.owns_prog_id(prog_id))
            .unwrap_or(false),
        classes_registered: classes_default
            .as_deref()
            .map(|prog_id| channel.owns_prog_id(prog_id))
            .unwrap_or(false),
        has_user_choice: user_choice.is_some(),
        effective_prog_id: effective,
        extension: ext,
    }
}

/// 构造关联条目：读取 ProgID 的 DefaultIcon 状态（尽力而为，失败按未设置处理）
fn build_association(extension: &str, prog_id: &str, source: ProgIdSource) -> FileAssociation {
    let icon_key = format!("{prog_id}\\DefaultIcon");
    let has_default_icon = registry::key_exists(&icon_key).unwrap_or(false);
    let current_icon = registry::get_default_value(&icon_key).ok().flatten();
    let icon_state = current_icon
        .as_deref()
        .map(icon::inspect_icon_value)
        .unwrap_or(IconState::None);

    FileAssociation {
        extension: extension.to_string(),
        prog_id: prog_id.to_string(),
        prog_id_source: source,
        shared_prog_id: prog_id.starts_with("Applications\\"),
        shared_with: Vec::new(), // 由 list_associations 统一回填
        has_default_icon,
        current_icon,
        icon_state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 关联条目构造：共享形态识别与失效判定
    #[test]
    fn association_shape() {
        let shared = build_association("md", r"Applications\ZedG.exe", ProgIdSource::UserChoice);
        assert!(shared.shared_prog_id);
        assert!(!shared.has_default_icon || shared.current_icon.is_some());

        let per_ext = build_association("rs", "Zed.rs", ProgIdSource::ClassesDefault);
        assert!(!per_ext.shared_prog_id);
        assert_eq!(per_ext.extension, "rs");
    }

    /// 大小写归一化：大写键名产出的扩展名必须是小写，避免与源 B 去重失配
    #[test]
    fn extension_key_normalization() {
        // 模拟 classes 列表中的大写键
        let classes = [".TS".to_string(), ".WPL".to_string()];
        let normalized: Vec<String> = classes
            .iter()
            .filter_map(|k| k.strip_prefix('.'))
            .map(|e| e.to_ascii_lowercase())
            .collect();
        assert_eq!(normalized, vec!["ts".to_string(), "wpl".to_string()]);
    }

    /// 源自检：本机枚举不应 panic，且扩展名全部为小写、无前导点
    #[test]
    fn listed_associations_are_normalized() {
        for channel in Channel::ALL {
            if let Ok(list) = list_associations(channel) {
                for assoc in &list {
                    assert!(!assoc.extension.starts_with('.'), "{}", assoc.extension);
                    assert_eq!(assoc.extension, assoc.extension.to_ascii_lowercase());
                    // shared_with 不应包含自身
                    assert!(!assoc.shared_with.contains(&assoc.extension));
                }
            }
        }
    }
}
