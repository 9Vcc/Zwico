//! 图标管理：设置 / 删除 ProgID 的 DefaultIcon
//!
//! 三种图标模式：
//! - [`IconMode::System`]：按扩展名映射到 Windows 系统内置图标（imageres.dll）
//! - [`IconMode::App`]：使用 Zed 可执行文件自带的图标
//! - [`IconMode::Custom`]：使用用户自定义图标目录中的 `<扩展名>.ico`
//!
//! 另有**逐项图标**：`IconTarget::custom_icon` 指定的 `.ico` 优先于上述模式，
//! 用于给个别扩展名单独指定图标。
//!
//! DefaultIcon 值的格式：`<图标文件路径>,<图标索引>`，
//! 例如 `"C:\...\zed.exe",0` 或 `imageres.dll,-102`（负数表示资源 ID）。
//!
//! 自定义图标缺失时优先回退目录内的 `default.ico`（用户放置的统一兜底图标），
//! 仍缺失才回退系统图标，并把最终的回退项收进 [`BatchReport::fell_back`]
//! 交给上层展示（release 下没有控制台，不能用 `println!` 代替用户可见反馈）。

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::Serialize;

use crate::registry;
use crate::text::encoded_str;

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
    /// 逐项指定的自定义图标文件（绝对路径）。优先级高于全局模式；
    /// 文件不存在时回退系统图标并记入回退清单。
    pub custom_icon: Option<String>,
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

/// DefaultIcon 当前的状态（供前端显示「已设置 / 失效 / 默认」）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IconState {
    /// 未设置 DefaultIcon 子键或默认值
    None,
    /// 已设置，且图标来源可达
    Valid,
    /// 已设置，但图标文件不存在（程序换目录、自定义目录被删、资源被卸载）
    Missing,
}

/// 单项设置的结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconOutcome {
    /// 最终写入 DefaultIcon 的值
    pub value: String,
    /// 是否因自定义图标缺失而回退系统图标
    pub fell_back: bool,
    /// 回退原因（仅 fell_back 时有值，供前端日志展示）
    pub note: Option<String>,
}

/// 批量操作的汇报：成功数、回退明细、失败明细
///
/// 设计意图：批量「失败不中断」，但结束时必须让调用方拿到**可展示**的明细，
/// 而不是只写进控制台（release 下控制台不可见）。
/// 文案由 `lib.rs` 组装成 i18n key（见 `back.applied` / `back.fallback` / `back.failedItems`）。
#[derive(Debug, Default, Clone)]
pub struct BatchReport {
    /// 本次请求处理的总项数
    pub total: usize,
    /// 实际写入成功的项数
    pub applied: usize,
    /// 回退到系统图标的扩展名（自定义图标缺失）
    pub fell_back: Vec<String>,
    /// 失败项：扩展名 + 原因
    pub failed: Vec<(String, String)>,
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

/// 解析 DefaultIcon 值，拆出图标文件与索引
///
/// 支持两种书写形式：
/// - 带引号：`"C:\Program Files\Zed\zed.exe",0`
/// - 不带引号：`imageres.dll,-102`、`C:\icons\py.ico`
///
/// 解析不出索引时返回 `None`（值本身可能只是裸文件名）。
pub fn parse_icon_value(value: &str) -> (String, Option<i32>) {
    let raw = value.trim();
    if raw.is_empty() {
        return (String::new(), None);
    }

    // 带引号形式：取第一对引号之间的内容
    if let Some(rest) = raw.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            let file = rest[..end].to_string();
            let index = rest[end + 1..]
                .trim_start_matches(',')
                .trim()
                .parse::<i32>()
                .ok();
            return (file, index);
        }
        // 引号不配对：退化为整段路径
        return (rest.to_string(), None);
    }

    // 不带引号：按最后一个逗号拆，且逗号后必须是整数索引
    match raw.rsplit_once(',') {
        Some((file, index)) if index.trim().parse::<i32>().is_ok() => {
            (file.trim().to_string(), index.trim().parse::<i32>().ok())
        }
        _ => (raw.to_string(), None),
    }
}

/// 系统目录（`%SystemRoot%\System32`），用于解析 `imageres.dll` 这类裸文件名
fn system_dir() -> Option<PathBuf> {
    std::env::var("SystemRoot")
        .ok()
        .map(|root| PathBuf::from(root).join("System32"))
}

/// 判断已写入的 DefaultIcon 值是否仍然可达
///
/// - 空值 → [`IconState::None`]
/// - 绝对路径（或相对文件名，按 System32 解析）存在 → [`IconState::Valid`]
/// - 不存在 → [`IconState::Missing`]（前端据此显示「失效」并提示一键修复）
pub fn inspect_icon_value(value: &str) -> IconState {
    let (file, _) = parse_icon_value(value);
    if file.is_empty() {
        return IconState::None;
    }
    let path = Path::new(&file);
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        match system_dir() {
            Some(dir) => dir.join(path),
            // 取不到系统目录时不误报失效
            None => return IconState::Valid,
        }
    };
    if resolved.exists() {
        IconState::Valid
    } else {
        IconState::Missing
    }
}

/// 构造带引号的图标值：`"<路径>",0`
///
/// 加引号以兼容含空格的路径。
fn quoted_icon(path: &Path) -> String {
    format!("\"{}\",0", path.display())
}

/// 根据模式（或逐项指定）计算扩展名应使用的 DefaultIcon 值
///
/// 优先级：逐项 `custom_icon` > 图标模式。任何自定义图标缺失都会回退系统图标，
/// 并通过 [`IconOutcome::note`] 带回原因。
pub fn resolve_icon_value(
    extension: &str,
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
    per_item_icon: Option<&str>,
    generated_dir: Option<&Path>,
) -> IconOutcome {
    let system = || IconOutcome {
        value: system_icon_for(extension),
        fell_back: true,
        note: None,
    };

    // 1. 逐项指定的图标优先
    if let Some(icon) = per_item_icon.map(str::trim).filter(|s| !s.is_empty()) {
        let path = Path::new(icon);
        if path.is_file() {
            return IconOutcome {
                value: quoted_icon(path),
                fell_back: false,
                note: None,
            };
        }
        let mut outcome = system();
        outcome.note = Some(format!("指定的图标不存在：{icon}"));
        return outcome;
    }

    match mode {
        IconMode::System => IconOutcome {
            value: system_icon_for(extension),
            fell_back: false,
            note: None,
        },

        IconMode::App => IconOutcome {
            // Zed 可执行文件的第一个图标
            value: quoted_icon(zed_path),
            fell_back: false,
            note: None,
        },

        IconMode::Custom => {
            // 解析顺序：`<扩展名>.ico` → `<扩展名>.png`（自动包装为 ICO）→
            // `default.ico` → `default.png` → 系统图标。
            // default 命中视为正常生效（不记回退）—— 它是用户主动放置的统一兜底。
            let Some(dir) = custom_dir else {
                let mut outcome = system();
                outcome.note = Some("未设置图标目录".to_string());
                return outcome;
            };

            // 在目录中按顺序查找：<name>.ico → <name>.png（包装为 ICO 写入缓存目录）
            let find_icon = |name: &str| -> Option<String> {
                let ico = dir.join(format!("{name}.ico"));
                if ico.is_file() {
                    return Some(ico.display().to_string());
                }
                let png = dir.join(format!("{name}.png"));
                if !png.is_file() {
                    return None;
                }
                // DefaultIcon 不认 PNG：包装为 ICO 条目后落到缓存目录
                let Some(gen_dir) = generated_dir else {
                    println!("[图标] {name}.png 缺少缓存目录配置，无法使用（忽略）");
                    return None;
                };
                let data = match std::fs::read(&png) {
                    Ok(data) => data,
                    Err(err) => {
                        println!("[图标] 读取 {name}.png 失败：{err}");
                        return None;
                    }
                };
                match crate::iconrender::png_to_ico(&data) {
                    Ok(ico_data) => {
                        let target = gen_dir.join(format!("{name}.ico"));
                        match std::fs::write(&target, &ico_data) {
                            Ok(()) => Some(target.display().to_string()),
                            Err(err) => {
                                println!("[图标] 写入 {name}.ico 缓存失败：{err}");
                                None
                            }
                        }
                    }
                    Err(err) => {
                        println!("[图标] {name}.png 转换失败：{err}");
                        None
                    }
                }
            };

            if let Some(icon_path) = find_icon(extension) {
                return IconOutcome {
                    value: quoted_icon(Path::new(&icon_path)),
                    fell_back: false,
                    note: None,
                };
            }
            if let Some(icon_path) = find_icon("default") {
                return IconOutcome {
                    value: quoted_icon(Path::new(&icon_path)),
                    fell_back: false,
                    note: None,
                };
            }
            let mut outcome = system();
            outcome.note = Some(format!("图标目录中没有 {extension}.ico"));
            outcome
        }
    }
}

/// 设置指定关联的 DefaultIcon
///
/// 写前会校验 ProgID 键仍然存在——`set_default_value` 底层用的是 `create`，
/// 若键已被删除会**凭空创建**没有 `shell\open\command` 的孤儿 ProgID 键，
/// 因此这里主动拦截（保持「只改图标、不改关联结构」的边界）。
///
/// 写入位置：`HKCU\Software\Classes\<ProgID>\DefaultIcon` 的默认值。
pub fn set_icon(
    target: &IconTarget,
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
    generated_dir: Option<&Path>,
) -> Result<IconOutcome> {
    if !registry::key_exists(&target.prog_id)? {
        return Err(anyhow!("{}", encoded_str("back.progIdGone", &[&target.prog_id])));
    }

    let extension = normalize_extension(&target.extension);
    let outcome = resolve_icon_value(
        &extension,
        mode,
        zed_path,
        custom_dir,
        target.custom_icon.as_deref(),
        generated_dir,
    );

    registry::set_default_value(&format!("{}\\DefaultIcon", target.prog_id), &outcome.value)?;
    println!(
        "[图标] 已设置 {}\\DefaultIcon = {}{}",
        target.prog_id,
        outcome.value,
        outcome
            .note
            .as_deref()
            .map(|n| format!("（{n}）"))
            .unwrap_or_default()
    );
    Ok(outcome)
}

/// 删除指定关联的 DefaultIcon 子键（键不存在时同样返回成功）
pub fn remove_icon(target: &IconTarget) -> Result<()> {
    if !registry::key_exists(&target.prog_id)? {
        return Err(anyhow!("{}", encoded_str("back.progIdGone", &[&target.prog_id])));
    }
    registry::delete_key(&format!("{}\\DefaultIcon", target.prog_id))?;
    println!("[图标] 已删除 {}\\DefaultIcon", target.prog_id);
    Ok(())
}

/// 批量设置图标
///
/// `progress_cb(目标, 已完成数, 总数)` 在**开始处理每一项之前**回调一次，
/// 因此 `已完成数 + 1` 就是当前正在处理的项，UI 文案不会滞后一项。
/// 单项失败不会中断批次；结束后由 [`BatchReport`] 汇总回退与失败明细。
pub fn batch_set_icons(
    targets: &[IconTarget],
    mode: IconMode,
    zed_path: &Path,
    custom_dir: Option<&Path>,
    generated_dir: Option<&Path>,
    progress_cb: impl Fn(&IconTarget, usize, usize),
) -> BatchReport {
    let total = targets.len();
    let mut report = BatchReport {
        total,
        ..Default::default()
    };

    for (index, target) in targets.iter().enumerate() {
        progress_cb(target, index, total);
        match set_icon(target, mode, zed_path, custom_dir, generated_dir) {
            Ok(outcome) => {
                report.applied += 1;
                if outcome.fell_back {
                    println!(
                        "[批量] {} 回退系统图标：{}",
                        target.extension,
                        outcome.note.as_deref().unwrap_or("自定义图标缺失")
                    );
                    report.fell_back.push(target.extension.clone());
                }
            }
            Err(err) => {
                println!("[批量] 设置 {} 失败：{err:#}", target.extension);
                report.failed.push((target.extension.clone(), short_reason(&err)));
            }
        }
    }

    println!(
        "[批量] 设置完成：共 {total} 项，成功 {}，回退 {}，失败 {}",
        report.applied,
        report.fell_back.len(),
        report.failed.len()
    );
    report
}

/// 批量删除图标
pub fn batch_remove_icons(
    targets: &[IconTarget],
    progress_cb: impl Fn(&IconTarget, usize, usize),
) -> BatchReport {
    let total = targets.len();
    let mut report = BatchReport {
        total,
        ..Default::default()
    };

    for (index, target) in targets.iter().enumerate() {
        progress_cb(target, index, total);
        match remove_icon(target) {
            Ok(()) => report.applied += 1,
            Err(err) => {
                println!("[批量] 删除 {} 失败：{err:#}", target.extension);
                report.failed.push((target.extension.clone(), short_reason(&err)));
            }
        }
    }

    println!(
        "[批量] 删除完成：共 {total} 项，成功 {}，失败 {}",
        report.applied,
        report.failed.len()
    );
    report
}

/// 提取适合展示的错误摘要（anyhow 的 `{:#}` 会带上调用链，日志里太长）
fn short_reason(err: &anyhow::Error) -> String {
    err.chain()
        .next()
        .map(|e| e.to_string())
        .unwrap_or_else(|| "未知错误".to_string())
}

/// 扩展名归一化：去除前导点、转小写
fn normalize_extension(extension: &str) -> String {
    extension.trim_start_matches('.').to_ascii_lowercase()
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

    /// DefaultIcon 值解析：带引号 / 不带引号 / 裸路径 / 资源 ID
    #[test]
    fn icon_value_parsing() {
        // 资源 ID 形式（负数）
        assert_eq!(
            parse_icon_value("imageres.dll,-102"),
            ("imageres.dll".to_string(), Some(-102))
        );
        // 带引号的含空格路径
        assert_eq!(
            parse_icon_value(r#""C:\Program Files\Zed\zed.exe",0"#),
            (r"C:\Program Files\Zed\zed.exe".to_string(), Some(0))
        );
        // 不带引号的普通路径
        assert_eq!(
            parse_icon_value(r"C:\icons\py.ico,3"),
            (r"C:\icons\py.ico".to_string(), Some(3))
        );
        // 只有路径、没有索引
        assert_eq!(
            parse_icon_value(r"C:\icons\py.ico"),
            (r"C:\icons\py.ico".to_string(), None)
        );
        // 路径自身含逗号但不带索引：整体视作路径
        assert_eq!(
            parse_icon_value(r"C:\weird,name.ico"),
            (r"C:\weird,name.ico".to_string(), None)
        );
        // 空值
        assert_eq!(parse_icon_value("   "), (String::new(), None));
    }

    /// 图标可达性判定：不存在的路径应报 Missing
    #[test]
    fn icon_state_detection() {
        assert_eq!(inspect_icon_value(""), IconState::None);
        assert_eq!(
            inspect_icon_value(r#""C:\__no_such_dir__\nope.ico",0"#),
            IconState::Missing
        );
        // 系统目录下的 imageres.dll 在 Windows 上必然存在
        if system_dir().map(|d| d.join("imageres.dll").exists()) == Some(true) {
            assert_eq!(inspect_icon_value("imageres.dll,-102"), IconState::Valid);
        }
    }

    /// 自定义模式：`<扩展名>.ico` 缺失时回退目录内 `default.ico`，再缺失才回退系统
    #[test]
    fn custom_mode_falls_back_to_default_ico() {
        let dir = std::env::temp_dir().join(format!("rsicon-default-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let default = dir.join("default.ico");
        std::fs::write(&default, b"dummy-default").unwrap();

        // py.ico 不存在 → 使用 default.ico（正常生效，不算回退）
        let outcome =
            resolve_icon_value("py", IconMode::Custom, Path::new("zed.exe"), Some(&dir), None, None);
        assert_eq!(outcome.value, quoted_icon(&default));
        assert!(!outcome.fell_back);

        // 有专属图标时优先专属
        std::fs::write(dir.join("py.ico"), b"dummy-py").unwrap();
        let outcome =
            resolve_icon_value("py", IconMode::Custom, Path::new("zed.exe"), Some(&dir), None, None);
        assert_eq!(outcome.value, quoted_icon(&dir.join("py.ico")));

        // 连 default.ico 都没有 → 回退系统图标
        std::fs::remove_file(&default).unwrap();
        let outcome =
            resolve_icon_value("js", IconMode::Custom, Path::new("zed.exe"), Some(&dir), None, None);
        assert!(outcome.fell_back);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 模式解析：System / App 不产生回退，Custom 缺图标必须回退并给出原因
    #[test]
    fn resolve_modes_and_fallback() {
        let zed = Path::new(r"C:\fake\zed.exe");

        let sys = resolve_icon_value("py", IconMode::System, zed, None, None, None);
        assert_eq!(sys.value, "imageres.dll,-102");
        assert!(!sys.fell_back);

        let app = resolve_icon_value("py", IconMode::App, zed, None, None, None);
        assert_eq!(app.value, r#""C:\fake\zed.exe",0"#);
        assert!(!app.fell_back);

        // Custom 未给目录 → 回退 + 原因
        let custom = resolve_icon_value("py", IconMode::Custom, zed, None, None, None);
        assert_eq!(custom.value, "imageres.dll,-102");
        assert!(custom.fell_back);
        assert!(custom.note.is_some());

        // 逐项图标不存在 → 回退 + 原因
        let per_item = resolve_icon_value(
            "py",
            IconMode::Custom,
            zed,
            None,
            Some(r"C:\__no_such_dir__\py.ico"),
            None,
        );
        assert!(per_item.fell_back);
        assert!(per_item.note.unwrap().contains(r"C:\__no_such_dir__"));
    }

    /// 批量汇报：回退与失败明细必须可展示
    #[test]
    fn batch_report_fields() {
        let report = BatchReport {
            total: 5,
            applied: 2,
            fell_back: vec!["py".into(), "ts".into()],
            failed: vec![("rs".into(), "ProgID key is gone".into())],
        };
        assert_eq!(report.applied, 2);
        assert_eq!(report.fell_back.len(), 2);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].0, "rs");

        let clean = BatchReport {
            total: 1,
            applied: 1,
            ..Default::default()
        };
        assert!(clean.fell_back.is_empty());
        assert!(clean.failed.is_empty());
    }
}
