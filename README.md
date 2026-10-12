# RsIcon（Tauri 版）

Zed 编辑器 Windows 文件关联图标管理工具 —— **Tauri 2 + React 19 + TypeScript** 版本。

只修改当前用户（HKCU）注册表，**不需要管理员权限**。

## 与 egui 版（仓库 ../RsIcon）的关系

- 五个逻辑模块（`registry` / `zed` / `association` / `icon` / `refresh`）为纯 Rust，原样复用
- 仅重写 UI 层：egui → Web 前端 + Tauri commands
- 前后端协议见 `src-tauri/src/lib.rs` 头部注释；前端协议层在 `src/api.ts`
- 原版保留在 `../RsIcon`（git 历史亦可回溯），本目录独立仓库

## 开发

```bash
pnpm install
pnpm tauri dev        # 开发窗口（前端热重载）
pnpm build            # 只构建/类型检查前端
pnpm tauri build      # 打包 exe（bundle.active=false，仅出可执行文件）
```

环境要求：Node ≥ 20、pnpm、Rust ≥ 1.77.2、Windows 10/11（WebView2 运行时）。

## 应用图标

`app-icon.png` 为 1024×1024 源图，`pnpm tauri icon app-icon.png` 可重新生成 `src-tauri/icons/`。
（当前为占位图标，可随时替换源图重生成。）

## License

MIT
