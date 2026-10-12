//! 构建脚本：Tauri 标准入口（生成上下文、嵌入资源）
//!
//! 图标资源未配置（`bundle.icon` 为空）时跳过嵌入，不影响构建与功能。

fn main() {
    tauri_build::build()
}
