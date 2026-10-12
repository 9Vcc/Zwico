//! 注册表操作封装（仅操作 HKCU\Software\Classes，无需管理员权限）
//!
//! 统一封装文件关联相关的注册表键操作：
//! - **路径拼接**：调用方传入相对 `Software\Classes` 的路径（如 `.rs`、
//!   `Zed.rs\DefaultIcon`），模块内部拼接完整路径
//! - **错误转换**：将 windows-registry 的底层错误统一转换为带中文上下文的
//!   `anyhow::Error`
//!
//! 对外五个函数：`get_default_value` / `set_default_value` / `delete_key` /
//! `key_exists` / `list_subkeys`（原 `create_key` 无调用方，已移除）。
//!
//! 文件关联在注册表中的典型结构（路径均相对 `HKCU\Software\Classes`）：
//!
//! ```text
//! .rs                          默认值 = ProgID（如 "Zed.rs"）
//! Zed.rs                       ProgID 键
//! Zed.rs\DefaultIcon           默认值 = 图标来源（如 "C:\...\zed.exe,0"）
//! Zed.rs\shell\open\command    默认值 = 打开命令（如 "\"C:\...\zed.exe\" \"%1\""）
//! ```

use anyhow::{anyhow, Result};
use windows_registry::CURRENT_USER;
use windows_result::HRESULT;

use crate::text::encoded_str;

/// HKCU 下文件关联配置的根路径
const CLASSES_ROOT: &str = r"Software\Classes";

/// Win32 错误码：路径不存在（对应注册表的键或值不存在）
const ERROR_FILE_NOT_FOUND: u32 = 2;

/// 判断底层注册表错误是否为「键或值不存在」
///
/// windows-registry 0.2 未提供现成判断，这里按 HRESULT 错误码识别
/// （`HRESULT::from_win32(2)` 即 0x80070002，直接比较 i32 裸值）。
fn is_not_found(err: &windows_result::Error) -> bool {
    err.code().0 == HRESULT::from_win32(ERROR_FILE_NOT_FOUND).0
}

/// 将相对 `Software\Classes` 的路径拼接为完整注册表路径
///
/// 传空字符串时表示根路径本身。
fn full_path(path: &str) -> String {
    if path.is_empty() {
        CLASSES_ROOT.to_owned()
    } else {
        format!("{CLASSES_ROOT}\\{path}")
    }
}

/// 将底层注册表错误转换为带键路径上下文的 anyhow 错误
fn reg_error(path: &str, err: windows_result::Error) -> anyhow::Error {
    anyhow!("{}", encoded_str("back.regError", &[&full_path(path), &err.to_string()]))
}

/// 读取指定键的默认值（注册表中的「(默认)」值）
///
/// - `Ok(Some(值))`：键与默认值均存在
/// - `Ok(None)`：键不存在，或键存在但未设置默认值
/// - `Err`：其他错误（如权限不足、值非字符串）
pub fn get_default_value(path: &str) -> Result<Option<String>> {
    // 打开键；键不存在视作「无默认值」
    let key = match CURRENT_USER.open(full_path(path)) {
        Ok(key) => key,
        Err(err) if is_not_found(&err) => return Ok(None),
        Err(err) => return Err(reg_error(path, err)),
    };

    // 空名称 "" 即默认值
    match key.get_string("") {
        Ok(value) => Ok(Some(value)),
        Err(err) if is_not_found(&err) => Ok(None),
        Err(err) => Err(reg_error(path, err)),
    }
}

/// 设置指定键的默认值（键不存在时自动创建，含所有中间层级）
pub fn set_default_value(path: &str, value: &str) -> Result<()> {
    // create：打开或创建指定键
    let key = CURRENT_USER
        .create(full_path(path))
        .map_err(|err| reg_error(path, err))?;

    // 空名称 "" 即默认值
    key.set_string("", value)
        .map_err(|err| reg_error(path, err))
}

/// 删除指定键及其全部子键（递归删除，用于清理 ProgID 整棵键树）
///
/// 幂等操作：键不存在时同样返回成功。
pub fn delete_key(path: &str) -> Result<()> {
    match CURRENT_USER.remove_tree(full_path(path)) {
        Ok(()) => Ok(()),
        // 键已不存在：视为删除成功（幂等）
        Err(err) if is_not_found(&err) => Ok(()),
        Err(err) => Err(reg_error(path, err)),
    }
}

/// 判断指定键是否存在
pub fn key_exists(path: &str) -> Result<bool> {
    match CURRENT_USER.open(full_path(path)) {
        Ok(_) => Ok(true),
        Err(err) if is_not_found(&err) => Ok(false),
        Err(err) => Err(reg_error(path, err)),
    }
}

/// 列出指定键下的所有子键名（注册表天然按字母序返回）
pub fn list_subkeys(path: &str) -> Result<Vec<String>> {
    let key = CURRENT_USER
        .open(full_path(path))
        .map_err(|err| reg_error(path, err))?;

    // keys() 创建迭代器本身也可能失败（如权限不足），需先解包 Result；
    // KeyIterator 直接产出 String（不含 Result 包装），收集即可
    let iter = key.keys().map_err(|err| reg_error(path, err))?;
    Ok(iter.collect())
}

// ---------- 通用命名值操作（HKCU 根相对路径） ----------
//
// 下面这些函数的 `path` 参数是 **相对 HKCU 根** 的路径（如
// `Software\RegisteredApplications`），不拼接 `Software\Classes` 前缀 ——
// 用于「应用注册」（Capabilities / RegisteredApplications）等非 Classes 场景。
// 路径拼接本身仍只发生在本模块内。

/// 写入命名值（REG_SZ）
pub fn set_named_value(path: &str, name: &str, value: &str) -> Result<()> {
    let key = CURRENT_USER.create(path).map_err(|err| reg_error(path, err))?;
    key.set_string(name, value)
        .map_err(|err| reg_error(path, err))
}

/// 读取命名值（REG_SZ；键或值不存在时返回 None）
pub fn get_named_value(path: &str, name: &str) -> Result<Option<String>> {
    let key = match CURRENT_USER.open(path) {
        Ok(key) => key,
        Err(err) if is_not_found(&err) => return Ok(None),
        Err(err) => return Err(reg_error(path, err)),
    };
    match key.get_string(name) {
        Ok(value) => Ok(Some(value)),
        Err(err) if is_not_found(&err) => Ok(None),
        Err(err) => Err(reg_error(path, err)),
    }
}

/// 删除命名值（幂等：值不存在时同样成功）
///
/// 注意必须用 `create`（自带写权限）打开 —— `open` 默认只给读权限，
/// 在只读句柄上删值会得到 ERROR_ACCESS_DENIED（实测踩坑）。
pub fn remove_named_value(path: &str, name: &str) -> Result<()> {
    let key = match CURRENT_USER.create(path) {
        Ok(key) => key,
        Err(err) => return Err(reg_error(path, err)),
    };
    match key.remove_value(name) {
        Ok(()) => Ok(()),
        Err(err) if is_not_found(&err) => Ok(()),
        Err(err) => Err(reg_error(path, err)),
    }
}

/// 枚举指定键下的全部值名
pub fn value_names(path: &str) -> Result<Vec<String>> {
    let key = CURRENT_USER.open(path).map_err(|err| reg_error(path, err))?;
    let iter = key.values().map_err(|err| reg_error(path, err))?;
    Ok(iter.map(|(name, _)| name).collect())
}

/// 删除 HKCU 根相对路径的键树（幂等）。仅供 `Software\ZedG`（Capabilities）这类
/// 不在 `Software\Classes` 下的键使用
pub fn delete_key_tree(path: &str) -> Result<()> {
    match CURRENT_USER.remove_tree(path) {
        Ok(()) => Ok(()),
        Err(err) if is_not_found(&err) => Ok(()),
        Err(err) => Err(reg_error(path, err)),
    }
}
