//! 文案编码工具：把 i18n 的「key + 参数」编码成单个字符串
//!
//! 用于命令返回值与错误消息（`anyhow::Error` 只能携带字符串）。
//! 格式：`key` 或 `key\u{1}参数1\u{1}参数2`，前端由 `tEncoded` 还原后翻译
//! （见 src/lib/i18n.ts）。纯英文 key 在英文环境下也能原样显示，不会出现乱码。

/// 与前端约定的分隔符（U+0001，不会出现在正常文案里）
const SEP: char = '\u{1}';

/// 编码 key 与参数
pub fn encoded(key: &str, params: &[String]) -> String {
    if params.is_empty() {
        key.to_string()
    } else {
        format!("{key}{SEP}{}", params.join(&SEP.to_string()))
    }
}

/// 便捷版：参数为 `&str` 切片
pub fn encoded_str(key: &str, params: &[&str]) -> String {
    let owned: Vec<String> = params.iter().map(|p| (*p).to_string()).collect();
    encoded(key, &owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoding_shape() {
        assert_eq!(encoded_str("back.noTargets", &[]), "back.noTargets");
        assert_eq!(encoded_str("back.assocLoaded", &["12"]), "back.assocLoaded\u{1}12");
        assert_eq!(
            encoded_str("back.failed", &["5", "2", "rs, go"]),
            "back.failed\u{1}5\u{1}2\u{1}rs, go"
        );
    }
}
