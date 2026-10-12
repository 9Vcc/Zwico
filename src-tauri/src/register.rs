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

/// 「设为默认打开方式」的结果
#[derive(Debug, Clone)]
pub struct DefaultOutcome {
    pub extension: String,
    /// 原来的默认程序（UserChoice 的 ProgId），仅用于日志告知
    pub previous: Option<String>,
    /// Classes 关联是否已就绪（被其他程序占用时为 false，此时不动 UserChoice）
    pub registered: bool,
    /// 是否删除了 UserChoice
    pub cleared: bool,
}

/// 把扩展名设为 Zed 的默认打开方式
///
/// 原理：Windows 双击时优先使用 `FileExts\<ext>\UserChoice`；**删除该键**后，
/// 解析回退到 `Classes\<ext>` 默认值（本工具写入的 Zed）。相比改写 UserChoice，
/// 不需要计算 Hash，也不使用未文档化的 `NtSetInformationKey`。
///
/// **不可逆**：删除的原值无法还原（重写需要 Hash），因此只能由用户显式确认后执行，
/// 且本函数会把原默认程序写进日志供用户知晓。
///
/// 安全前提：只在 `Classes\<ext>` 已指向本通道时才删除 UserChoice —— 否则删掉它
/// 等于把该扩展名从"用户选定的程序"变成"无关联"，属于越权。
pub fn set_as_default(
    channel: Channel,
    extension: &str,
    zed_exe: &Path,
) -> Result<DefaultOutcome> {
    let ext = normalize_extension(extension);
    if !is_valid_extension(&ext) {
        return Err(anyhow::anyhow!(
            "{}",
            encoded_str("back.extInvalid", &[extension])
        ));
    }
    let extension_key = format!(".{ext}");

    // 1. 先确保 Classes 关联就绪（含"被其他程序占用"的判定）
    let outcome = register_extension(channel, extension, zed_exe)?;
    let registered = matches!(
        outcome.state,
        RegisterState::Created | RegisterState::AlreadyZed
    );
    if !registered {
        return Ok(DefaultOutcome {
            extension: ext,
            previous: outcome.owner,
            registered: false,
            cleared: false,
        });
    }

    // 2. 记录原默认程序（供日志告知；删除后无法还原）
    let previous = crate::association::read_user_choice(&extension_key);

    // 3. 删除 UserChoice，让解析回退到 Classes 默认值
    let cleared = crate::association::clear_user_choice(&extension_key)?;

    println!("[关联] .{ext} 已设为 Zed 默认打开方式（清除 UserChoice：{cleared}）");
    Ok(DefaultOutcome {
        extension: ext,
        previous,
        registered: true,
        cleared,
    })
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
}
