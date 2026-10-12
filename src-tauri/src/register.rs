//! 关联注册：为扩展名建立指向本通道 Zed 的文件关联
//!
//! **与其他模块的边界不同**：`icon.rs` 只改已有关联的图标，本模块会**创建 ProgID
//! 并写入扩展名键的默认值**，从而改变系统的打开方式。因此：
//! - 只能由用户在设置页显式触发（带确认对话框），不进任何自动流程；
//! - 只写 `HKCU\Software\Classes`；**绝不触碰 `FileExts\<ext>\UserChoice`**
//!   （Windows 有完整性保护，且那是用户自己的默认程序选择）；
//! - 扩展名已指向**其他程序**时一律跳过并报告，不覆盖用户既有选择。
//!
//! 注册写入的结构（相对 `HKCU\Software\Classes`）：
//!
//! ```text
//! .py                          默认值 = ZedG.py      ← 建立关联
//! ZedG.py                      默认值 = ZedG.py      ← 类型描述（"类型"列显示）
//! ZedG.py\shell\open\command   默认值 = "<zed.exe>" "%1"
//! ```

use std::path::Path;

use anyhow::Result;

use crate::registry;
use crate::text::encoded_str;
use crate::zed::Channel;

/// 单个扩展名的注册结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegisterState {
    /// 本次新建了关联
    Created,
    /// 该扩展名原本就关联到本通道（无需处理）
    AlreadyZed,
    /// 已关联到其它程序，按约定跳过
    TakenByOther,
}

/// 注册结果明细
#[derive(Debug, Clone)]
pub struct RegisterOutcome {
    pub extension: String,
    pub state: RegisterState,
    /// 被其它程序占用时，占用者的 ProgID（供日志展示）
    pub owner: Option<String>,
}

/// 扩展名归一化：去前导点、去空白、转小写
pub fn normalize_extension(extension: &str) -> String {
    extension.trim().trim_start_matches('.').to_ascii_lowercase()
}

/// 校验扩展名合法性：非空、只含字母数字与少量字符、不含点与路径分隔符
pub fn is_valid_extension(extension: &str) -> bool {
    let ext = normalize_extension(extension);
    !ext.is_empty()
        && ext.len() <= 32
        && ext
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '+')
}

/// 本通道下该扩展名应使用的 ProgID
pub fn prog_id_for(channel: Channel, extension: &str) -> String {
    format!("{}{}", channel.prog_id_prefix(), normalize_extension(extension))
}

/// 为单个扩展名建立关联
///
/// 不覆盖其他程序的关联：若 `.<ext>` 的默认值指向别的 ProgID，返回 `TakenByOther`。
pub fn register_extension(
    channel: Channel,
    extension: &str,
    zed_exe: &Path,
) -> Result<RegisterOutcome> {
    let ext = normalize_extension(extension);
    if !is_valid_extension(&ext) {
        return Err(anyhow::anyhow!(
            "{}",
            encoded_str("back.extInvalid", &[extension])
        ));
    }
    let prog_id = prog_id_for(channel, &ext);
    let extension_key = format!(".{ext}");

    // 已有默认值：指向本通道 → 视为已关联；指向别人 → 跳过，不越权改写
    if let Some(current) = registry::get_default_value(&extension_key)? {
        let current = current.trim().to_string();
        if channel.owns_prog_id(&current) {
            return Ok(RegisterOutcome {
                extension: ext,
                state: RegisterState::AlreadyZed,
                owner: None,
            });
        }
        return Ok(RegisterOutcome {
            extension: ext,
            state: RegisterState::TakenByOther,
            owner: Some(current),
        });
    }

    // 1. 打开命令：`"<exe>" "%1"`
    let command = format!("\"{}\" \"%1\"", zed_exe.display());
    registry::set_default_value(&format!("{prog_id}\\shell\\open\\command"), &command)?;

    // 2. 类型描述（资源管理器"类型"列显示的内容；用 ProgID 本身，避免引入文案）
    registry::set_default_value(&prog_id, &prog_id)?;

    // 3. 建立关联：扩展名键的默认值指向本通道 ProgID
    registry::set_default_value(&extension_key, &prog_id)?;

    println!("[关联] 已为 .{ext} 建立关联 → {prog_id}");
    Ok(RegisterOutcome {
        extension: ext,
        state: RegisterState::Created,
        owner: None,
    })
}

// ---------- 应用注册（仅 zedg 通道）----------
//
// 让 ZedG 出现在系统「默认应用」列表与右键「打开方式」中。
// **仅对汉化版（zedg）通道开放** —— 官方安装器自带此注册，Scoop 安装没有。
// 只做候选注册：ProgID、OpenWithProgids、Applications、RegisteredApplications
// + Capabilities；不写 UserChoice、不改 `Classes\<ext>` 默认值 ——
// 不改变任何扩展名的打开方式（DESIGN D35 边界）。

/// RegisteredApplications 里的应用名
pub const APP_NAME: &str = "ZedG";
/// Capabilities 键（HKCU 根相对路径）
pub const APP_CAPABILITIES: &str = r"Software\ZedG\Capabilities";
/// 通用应用键（Classes 相对路径）：让 exe 出现在任意文件的「打开方式」列表
pub const APP_APPLICATIONS: &str = r"Applications\ZedG.exe";

/// 应用注册状态
#[derive(Debug, Clone)]
pub struct AppRegistration {
    /// RegisteredApplications 里是否有指向本应用 Capabilities 的条目
    pub registered: bool,
    /// Capabilities\FileAssociations 声明的扩展名数
    pub covered: usize,
}

/// 查询应用注册状态（只读）
pub fn application_registration_status() -> Result<AppRegistration> {
    let registered = registry::get_named_value(r"Software\RegisteredApplications", APP_NAME)?
        .is_some_and(|value| value.eq_ignore_ascii_case(APP_CAPABILITIES));
    let covered = if registered {
        registry
            ::value_names(&format!(r"{APP_CAPABILITIES}\FileAssociations"))?
            .iter()
            .filter(|name| name.starts_with('.'))
            .count()
    } else {
        0
    };
    Ok(AppRegistration { registered, covered })
}

/// 完整注册：ProgID + OpenWithProgids + Applications + RegisteredApplications/Capabilities
///
/// 返回（覆盖数，跳过明细）。
pub fn register_application(
    channel: Channel,
    extensions: &[String],
    zed_exe: &Path,
) -> Result<(usize, Vec<(String, String)>)> {
    if channel != Channel::Zedg {
        return Err(anyhow::anyhow!(
            "{}",
            encoded_str("back.appRegOnlyZedg", &[])
        ));
    }

    let command = format!("\"{}\" \"%1\"", zed_exe.display());
    let icon = format!("{},0", zed_exe.display());

    // 1. RegisteredApplications：系统「默认应用」列表的数据源
    registry::set_named_value(r"Software\RegisteredApplications", APP_NAME, APP_CAPABILITIES)?;

    // 2. Capabilities：应用名与支持的扩展名清单
    registry::set_named_value(APP_CAPABILITIES, "ApplicationName", APP_NAME)?;
    registry::set_named_value(APP_CAPABILITIES, "ApplicationDescription", "Zed Editor (ZedG)")?;

    let mut covered = 0usize;
    let mut skipped: Vec<(String, String)> = Vec::new();
    for extension in extensions {
        let ext = normalize_extension(extension);
        if !is_valid_extension(&ext) {
            skipped.push((extension.to_string(), "invalid".into()));
            continue;
        }
        let prog_id = prog_id_for(channel, &ext);

        // 2a. Capabilities\FileAssociations
        registry::set_named_value(
            &format!(r"{APP_CAPABILITIES}\FileAssociations"),
            &format!(".{ext}"),
            &prog_id,
        )?;

        // 2b. ProgID（图标与打开命令）
        registry::set_default_value(&prog_id, &prog_id)?;
        registry::set_default_value(&format!("{prog_id}\\DefaultIcon"), &icon)?;
        registry::set_default_value(&format!("{prog_id}\\shell\\open\\command"), &command)?;

        // 2c. 挂到扩展名的候选列表（保留其他程序的既有条目）
        registry::set_named_value(
            &format!(r"Software\Classes\.{ext}\OpenWithProgids"),
            &prog_id,
            "",
        )?;

        covered += 1;
    }

    // 3. 通用应用键：任意文件的「打开方式」里都能选 ZedG
    registry::set_default_value(&format!("{APP_APPLICATIONS}\\DefaultIcon"), &icon)?;
    registry::set_default_value(&format!("{APP_APPLICATIONS}\\shell\\open\\command"), &command)?;

    println!("[应用注册] ZedG 已完整注册，覆盖 {covered} 个扩展名");
    Ok((covered, skipped))
}

/// 大小写不敏感的前缀比较（char-boundary 安全）
///
/// 不能用字节切片 `name[..prefix.len()]`：注册表键名可能以非 ASCII 字符开头
/// （实测用户系统存在中文开头的键名），切片落在 UTF-8 多字节字符中间会 panic。
/// `str::get` 在越界或非 char boundary 时返回 None，安全跳过。
fn starts_with_ignore_case(name: &str, prefix: &str) -> bool {
    name.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

/// 移除应用注册：清除本应用写入的全部候选条目，不影响其他程序
pub fn unregister_application(channel: Channel) -> Result<()> {
    if channel != Channel::Zedg {
        return Err(anyhow::anyhow!(
            "{}",
            encoded_str("back.appRegOnlyZedg", &[])
        ));
    }

    // 1. RegisteredApplications 条目
    registry::remove_named_value(r"Software\RegisteredApplications", APP_NAME)?;

    // 2. Capabilities 整键
    registry::delete_key_tree(APP_CAPABILITIES)?;

    // 3. 通用应用键
    registry::delete_key(APP_APPLICATIONS)?;

    // 4. 本应用创建的全部 ProgID 键（ZedG.*）
    for name in registry::list_subkeys("")? {
        if starts_with_ignore_case(&name, APP_NAME) {
            registry::delete_key(&name)?;
        }
    }

    // 5. 各扩展名候选列表里挂的 ZedG 条目
    for key in registry::list_subkeys("")? {
        if !key.starts_with('.') {
            continue;
        }
        let open_with = format!(r"Software\Classes\{key}\OpenWithProgids");
        for name in registry::value_names(&open_with)? {
            if starts_with_ignore_case(&name, APP_NAME) {
                registry::remove_named_value(&open_with, &name)?;
            }
        }
    }

    println!("[应用注册] ZedG 的应用注册已移除");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 扩展名归一化与合法性（纯函数，不触注册表）
    #[test]
    fn extension_rules() {
        assert_eq!(normalize_extension(".PY"), "py");
        assert_eq!(normalize_extension("  .Rs "), "rs");
        assert_eq!(normalize_extension("md"), "md");

        for ok in ["py", ".rs", "TSX", "c++", "my_ext", "x-y"] {
            assert!(is_valid_extension(ok), "应接受：{ok}");
        }
        for bad in ["", ".", "a.b", "a/b", "a\\b", "with space", "路径"] {
            assert!(!is_valid_extension(bad), "应拒绝：{bad}");
        }
    }

    /// ProgID 拼接沿用各通道前缀
    #[test]
    fn prog_id_shape() {
        assert_eq!(prog_id_for(Channel::Stable, "py"), "Zed.py");
        assert_eq!(prog_id_for(Channel::Zedg, ".MD"), "ZedG.md");
        assert_eq!(prog_id_for(Channel::Preview, "rs"), "ZedPreview.rs");
    }

    /// 前缀比较对非 ASCII 键名安全（回归：曾因字节切片 panic）
    #[test]
    fn prefix_match_is_char_boundary_safe() {
        assert!(starts_with_ignore_case("ZedG.md", "ZedG"));
        assert!(starts_with_ignore_case("zedg.py", "ZedG"));
        assert!(starts_with_ignore_case("ZEDG.rs", "ZedG"));
        // 前缀本身不完整匹配
        assert!(!starts_with_ignore_case("Zed", "ZedG"));
        assert!(!starts_with_ignore_case("ZedG2.md", "ZedG.md"));
        // 非 ASCII 开头的键名（曾是 panic 源）
        assert!(!starts_with_ignore_case("銋", "ZedG"));
        assert!(!starts_with_ignore_case("中文键名", "ZedG"));
    }
}
