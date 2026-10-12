//! 图标管理：设置 / 删除 ProgID 的 DefaultIcon
//!
//! 三种图标模式：
//! - [`IconMode::System`]：按扩展名映射到 Windows 系统内置图标（imageres.dll）
//! - [`IconMode::App`]：使用 Zed 可执行文件自带的图标
//! - [`IconMode::Custom`]：使用用户自定义图标目录中的 `<扩展名>.ico`
//!
//! DefaultIcon 值的格式：`<图标文件路径>,<图标索引>`，
//! 例如 `"C:\...\zed.exe",0` 或 `imageres.dll,-102`（负数表示资源 ID）。

use std::path::Path;

use anyhow::{anyhow, Result};

use crate::registry;

/// 图标操作目标：扩展名及其关联的 ProgID
///
/// 图标写入位置为 `<ProgID>\DefaultIcon`；ProgID 来自关联枚举结果，
/// 可能是 `ZedG.md`（安装器形态）、`Applications\ZedG.exe`（「打开方式」
/// 形态）或 `md_auto_file`（系统命名形态）等。
#[derive(Debug, Clone)]
pub struct IconTarget {
    /// 扩展名（不带点，用于系统图标映射与进度显示）
    pub extension: String,
    /// 实际关联的 ProgID（相对 Software\Classes 的键名）
    pub prog_id: String,
}

/// 图标模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconMode {
    /// 系统内置图标（按扩展名映射到 imageres.dll 资源）
    System,
    /// Zed 应用图标（zed.exe 内嵌的第一个图标）
    App,
    /// 用户自定义图标目录（查找 `<目录>/<扩展名>.ico`）
    Custom,
}

/// 返回扩展名对应的系统图标值（imageres.dll 资源引用）
///
/// imageres.dll 常用图标资源（负数索引表示资源 ID 而非图标序号）：
/// - `-101`：HTML 文件
/// - `-99` ：XML 文件
/// - `-70` ：图片文件
/// - `-74` ：批处理 / 脚本
/// - `-102`：通用文本（默认兜底）
///
/// 覆盖 40+ 种常见扩展名，未收录的扩展名回退到通用文本图标。
pub fn system_icon_for(extension: &str) -> String {
    let resource = match extension.to_ascii_lowercase().as_str() {
        // ---- HTML 类 ----
        "html" | "htm" => "-101",

        // ---- XML 类 ----
        "xml" => "-99",

        // ---- 图片类 ----
        "svg" => "-70",

        // ---- 批处理 / 脚本类（Windows 原生脚本）----
        "bat" | "cmd" | "ps1" => "-74",

        // ---- 文本类：编程语言源码 ----
        "py" | "js" | "ts" | "tsx" | "jsx" | "rb" | "go" | "rs" | "c" | "h" | "cpp" | "hpp"
        | "cs" | "java" | "php" | "swift" | "kt" => "-102",

        // ---- 文本类：标记 / 配置 ----
        "md" | "css" | "scss" | "json" | "yaml" | "yml" | "toml" | "ini" | "conf" => "-102",

        // ---- 文本类：Shell 脚本（非 Windows 原生，按文本展示）----
        "sh" | "bash" | "zsh" => "-102",

        // ---- 文本类：数据 / 纯文本 ----
        "csv" | "sql" | "txt" | "log" => "-102",

        // ---- 其他 ----
        "dockerfile" | "gitignore" => "-102",

        // 默认 fallback：通用文本图标
        _ => "-102",
    };
    format!("imageres.dll,{resource}")
}

/// 设置指定关联的 DefaultIcon
///
/// - `target`：图标操作目标（扩展名 + 实际 ProgID）
/// - `mode`：图标模式
/// - `zed_path`：Zed 可执行文件路径（App 模式使用）
/// - `custom_dir`：自定义图标目录（Custom 模式使用，查找 `<目录>/<扩展名>.ico`；
///   目录未提供或对应 ico 文件不存在时，回退到系统图标）
///
/// 写入位置：`HKCU\Software\Classes\<ProgID>\DefaultIcon` 的默认值。
pub fn set_icon(
    target: &IconTarget,
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
) -> Result<()> {
    let extension = normalize_extension(&target.extension);
    // 根据模式计算 DefaultIcon 值
    let icon_value = resolve_icon_value(&extension, mode, zed_path, custom_dir);

    // 写入 DefaultIcon 默认值（set_default_value 会自动创建缺失的键）
    registry::set_default_value(&format!("{}\\DefaultIcon", target.prog_id), &icon_value)?;
    println!("[图标] 已设置 {}\\DefaultIcon = {icon_value}", target.prog_id);
    Ok(())
}

/// 删除指定关联的 DefaultIcon 子键（键不存在时同样返回成功）
pub fn remove_icon(target: &IconTarget) -> Result<()> {
    registry::delete_key(&format!("{}\\DefaultIcon", target.prog_id))?;
    println!("[图标] 已删除 {}\\DefaultIcon", target.prog_id);
    Ok(())
}

/// 批量设置图标
///
/// `progress_cb(已完成数, 总数)` 在每处理完一项后回调一次。
/// 单项失败不会中断批次；结束后若存在失败项则返回携带明细的 Err。
pub fn batch_set_icons(
    targets: &[IconTarget],
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
    progress_cb: impl Fn(usize, usize),
) -> Result<()> {
    let total = targets.len();
    let mut failures: Vec<String> = Vec::new();

    for (index, target) in targets.iter().enumerate() {
        if let Err(err) = set_icon(target, mode, zed_path, custom_dir) {
            println!("[批量] 设置 {} 失败：{err:#}", target.extension);
            failures.push(target.extension.clone());
        }
        progress_cb(index + 1, total);
    }

    summarize_failures("批量设置图标", total, &failures)
}

/// 批量删除图标
///
/// `progress_cb(已完成数, 总数)` 在每处理完一项后回调一次。
pub fn batch_remove_icons(
    targets: &[IconTarget],
    progress_cb: impl Fn(usize, usize),
) -> Result<()> {
    let total = targets.len();
    let mut failures: Vec<String> = Vec::new();

    for (index, target) in targets.iter().enumerate() {
        if let Err(err) = remove_icon(target) {
            println!("[批量] 删除 {} 失败：{err:#}", target.extension);
            failures.push(target.extension.clone());
        }
        progress_cb(index + 1, total);
    }

    summarize_failures("批量删除图标", total, &failures)
}

/// 根据模式计算扩展名应使用的 DefaultIcon 值
fn resolve_icon_value(
    extension: &str,
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
) -> String {
    match mode {
        IconMode::System => system_icon_for(extension),

        IconMode::App => {
            // Zed 可执行文件的第一个图标；加引号以兼容含空格的路径
            format!("\"{}\",0", zed_path.display())
        }

        IconMode::Custom => {
            // 查找自定义目录下的 <扩展名>.ico，找不到则回退系统图标
            if let Some(dir) = custom_dir {
                let ico = dir.join(format!("{extension}.ico"));
                if ico.is_file() {
                    format!("\"{}\",0", ico.display())
                } else {
                    println!("[图标] 自定义图标不存在：{}，回退系统图标", ico.display());
                    system_icon_for(extension)
                }
            } else {
                println!("[图标] Custom 模式未提供图标目录，回退系统图标");
                system_icon_for(extension)
            }
        }
    }
}

/// 扩展名归一化：去除前导点、转小写
fn normalize_extension(extension: &str) -> String {
    extension.trim_start_matches('.').to_ascii_lowercase()
}

/// 汇总批量操作的失败情况：无失败返回 Ok，有失败返回携带明细的 Err
fn summarize_failures(action: &str, total: usize, failures: &[String]) -> Result<()> {
    if failures.is_empty() {
        println!("[批量] {action}完成：共 {total} 项全部成功");
        Ok(())
    } else {
        Err(anyhow!(
            "{action}完成：{total} 项中 {} 项失败（{}）",
            failures.len(),
            failures.join("、")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 系统图标映射：各类扩展名应指向正确的 imageres.dll 资源
    #[test]
    fn system_icon_mapping() {
        // 文本类（编程语言 / 配置 / 数据 / 兜底）→ -102
        for ext in ["py", "rs", "md", "json", "sh", "txt", "unknown"] {
            assert_eq!(system_icon_for(ext), "imageres.dll,-102", "扩展名 {ext}");
        }
        // HTML 类 → -101
        for ext in ["html", "htm"] {
            assert_eq!(system_icon_for(ext), "imageres.dll,-101");
        }
        // XML 类 → -99
        assert_eq!(system_icon_for("xml"), "imageres.dll,-99");
        // 图片类 → -70
        assert_eq!(system_icon_for("svg"), "imageres.dll,-70");
        // 批处理类 → -74
        for ext in ["bat", "cmd", "ps1"] {
            assert_eq!(system_icon_for(ext), "imageres.dll,-74");
        }
        // 大小写不敏感
        assert_eq!(system_icon_for("PY"), "imageres.dll,-102");
    }

    /// 扩展名归一化：去前导点、转小写
    #[test]
    fn extension_normalization() {
        assert_eq!(normalize_extension(".PY"), "py");
        assert_eq!(normalize_extension("Rs"), "rs");
        assert_eq!(normalize_extension("md"), "md");
    }
}
