# PROJECT_MAP.md — 结构与调用地图

`rsicon-tauri` · Tauri 2 + React 19 + TS · 平台限定 Windows。
五个纯逻辑模块（`registry`/`zed`/`association`/`icon`/`refresh`）与 egui 版（`E:\1Qoder\RsIcon`）逐字节相同，因此指向这些模块的行号两边都有效；其余引用以本仓库为准。

---

## 1. 目录树

```text
RsIcon-tauri/
├── package.json / pnpm-lock.yaml    前端依赖与脚本（dev / build / tauri）
├── vite.config.ts                   固定 1420 端口、忽略 src-tauri 监听
├── tsconfig.json / tsconfig.node.json / index.html / .gitignore
├── app-icon.png                     图标源图（1024，`pnpm tauri icon` 重生成）
├── README.md
├── DESIGN.md / AGENTS.md / PROJECT_MAP.md   三件套（本仓库）
├── src/                             前端
│   ├── main.tsx                     React 挂载（StrictMode）
│   ├── api.ts                       协议层：类型 + invoke 封装 + 事件订阅
│   ├── App.tsx                      全部状态/流程 + 组件（列表/卡片/日志/对话框）
│   ├── styles.css                   两套 CSS 变量 + 全部样式
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml                   依赖与体积优先 profile
│   ├── build.rs                     tauri_build::build()
│   ├── tauri.conf.json              窗口 960×720、devUrl 1420、bundle.active=false
│   ├── capabilities/default.json    core:default + dialog + clipboard-manager
│   ├── icons/                       tauri icon 生成（含 icon.ico，供 Windows 资源）
│   └── src/
│       ├── main.rs                  入口（release 隐藏控制台）
│       ├── lib.rs                   命令/事件/DTO/关窗拦截（前端唯一系统入口）
│       ├── registry.rs  (124 行)    HKCU\Software\Classes 封装〔与旧仓库相同〕
│       ├── zed.rs       (306 行)    通道定义 + Zed 安装探测〔相同〕
│       ├── association.rs(126 行)   文件关联双源枚举〔相同〕
│       ├── icon.rs      (251 行)    图标模式取值 / 批量设置删除〔相同〕
│       └── refresh.rs   (155 行)    通知 Shell / 清缓存 / 重启 explorer〔相同〕
└── target/                          cargo 产物 + ui-preview 截图脚本（gitignore）
```

依赖方向（无环）：

```text
App.tsx — api.ts —(invoke / event)— lib.rs —┬— association.rs —┐
                                            ├— icon.rs ————————┼— registry.rs —► windows-registry
                                            └— zed.rs —————————┘
                                            refresh.rs —► windows (Win32 Shell)
                                            tauri-plugin-dialog / clipboard-manager（前端直接调）
```

---

## 2. 符号索引

### `src-tauri/src/lib.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 16 | `#![allow(dead_code)]` | `create_key` / `refresh_full` 等未接线项仍在 |
| 36 | `struct AppState` | 唯一共享状态：`busy: Arc<AtomicBool>` |
| 43 / 65 / 88 / 97 / 106 | DTO | `LogLineDto` / `AssociationDto` / `LoadState` / `ProgressPayload` / `TargetDto`（均 camelCase） |
| 121 / 130 | `channel_key` / `channel_from_key` | 前后端以稳定 ascii key 通信 |
| 142 | `initial_channel()` | 启动选通道：有 ProgID > 有 exe > stable |
| 169 | `scan_ico_count(dir)` | 目录 `.ico` 计数（自定义模式徽标） |
| 195 | `load_state(channel)` | 检测 Zed + 枚举关联，返回 zedPath / associations / log |
| 236 | `apply_icons(targets, mode, zedPath, customDir)` | 批量写 `DefaultIcon`；逐项发 progress |
| 294 | `remove_icons(targets)` | 批量删 `DefaultIcon`；逐项发 progress |
| 333 | `refresh_explorer(clearCache, restartExplorer)` | 通知 →〔清缓存〕→〔重启〕；返回日志行 |
| 370 | `confirm_quit()` | 忙碌中退出确认后清标志 + destroy 窗口 |
| 376 | `run()` | plugin 注册 / manage(AppState) / invoke_handler / on_window_event（关窗拦截） |

### `src/App.tsx`

| 位置 | 符号 | 作用 |
|---|---|---|
| 28 | THEME_KEY | localStorage 主题键 |
| 30 | App() | 状态总装：theme / channel / zedPath / associations / search / selected / mode / customDir / icoCount / busy / progress / log / clearCache / restartExplorer / dialog |
| 82 | load(ch) | invoke load_state，刷新 zedPath 与 associations 与 log |
| 155 | startApply | 校验 + busy/progress + 完成后重扫 |
| 189 | startRemove | 同上（删除路径） |
| 209 | startRefresh | 调 refresh_explorer，日志行回填 |
| 222 | confirmDialog | 按 dialog 类型分派：remove / refresh / quit |
| 476 | Row | 整行可点 + 自绘勾选框 + 已设置/默认/共享徽标 |
| 528 | EmptyState | 空列表引导 |
| 546 | Card | 卡片容器 |
| 555 | IconSettingsCard | 图标设置卡片（Zed 路径 / 模式单选 / 自定义目录） |
| 634 | ActionsCard | 操作卡片（主按钮 / 应用到全部 / 恢复默认） |
| 679 | RefreshCard | 刷新卡片（立即刷新 + 两个复选框） |
| 723 | LogPanel | 条数 / 复制 / 清空 + 自动吸底 + 右键复制本条 |
| 765 | DIALOG_TEXT | 三种确认文案表 |
| 780 | ConfirmDialog | 模态（Esc 取消 / Enter 确定） |

### `src/api.ts`

| 位置 | 符号 | 作用 |
|---|---|---|
| 10 | APP_VERSION | 版本号（与 package.json / Cargo.toml 手动同步） |
| 14 / 23 | CHANNELS / MODES | 通道与图标模式表（label + 悬停 hint） |
| 41 | Association 等类型 | 与 lib.rs DTO 逐字段对应 |
| 71 | api | 7 个 invoke 封装（initialChannel / loadState / scanIcoCount / applyIcons / removeIcons / refreshExplorer / confirmQuit） |
| 84 / 89 | onProgress / onCloseRequested | 事件订阅，返回取消函数 |

### `src/styles.css`

| 位置 | 段 | 作用 |
|---|---|---|
| 2 / 26 | 主题变量 | 深 / 浅两套（层级与色阶见 DESIGN D14） |
| 84 / 90 / 282 / 586 / 629 | 布局 | .app 三行 grid / .topbar / .sidebar / .logpanel / .overlay |
| 306 / 328 / 355 | 列表行 | .row 悬停与 .row--sel（左 3px 强调条、勾选框变蓝） |
| 441 / 505 / 513 | 卡片 | .card / .custom-dir / 徽标不被拉伸的修正 |
| 166 / 176 / 181 / 191 | 按钮 | 主按钮与禁用实色 / 危险描边与禁用灰 |
| 545 / 638 | 进度与对话框 | .progress（含 indeterminate 动画）/ .dialog |

### `src-tauri/tauri.conf.json`

| 位置 | 键 | 说明 |
|---|---|---|
| 3 / 5 | productName / identifier | zed-file-assoc-gui / dev.qoder.rsicon |
| 7–10 | build | beforeDevCommand pnpm dev / devUrl :1420 / frontendDist ../dist |
| 16–17 | 窗口 | 标题「Zed 文件关联图标管理器」、960×720（最小 760×540） |
| 29 | bundle.active=false | 不出安装包 |

---

## 3. 运行时调用链

```text
启动   main.rs → lib.rs:376 run() → 前端挂载 App.tsx:30
       → invoke initial_channel() → load(ch) → invoke load_state（后端 spawn_blocking）
         detect_zed_path + list_associations → 返回 zedPath / associations / log
       → 前端渲染列表与日志；订阅 progress 与 close-requested 两个事件

应用   ActionsCard → startApply（前端校验）→ invoke apply_icons
       → spawn_blocking → icon::batch_set_icons → set_icon → resolve_icon_value
                        → registry::set_default_value（HKCU\Software\Classes\<ProgID>\DefaultIcon）
       → 每项 emit progress{current,total,extension} → 完成后前端 load(ch) 重扫

恢复   恢复默认按钮 → ConfirmDialog(remove) → invoke remove_icons
       → icon::batch_remove_icons → registry::delete_key（递归删 <ProgID>\DefaultIcon）

刷新   立即刷新（勾选重启则先 ConfirmDialog）→ invoke refresh_explorer
       → refresh::notify_system →〔clear_icon_cache〕→〔restart_explorer〕
       → 返回日志行数组，前端追加

关窗   用户点 × → lib.rs 的 on_window_event(CloseRequested)
       → busy？→ prevent_close + emit close-requested → ConfirmDialog(quit)
       → 确定 → invoke confirm_quit → busy=false + window.destroy()（进程退出）
```

---

## 4. 注册表键位图

相对 `HKCU\Software\Classes`（`registry.rs:23`），★ = 绕过 registry 直连 `CURRENT_USER` 的已批准例外。

| 键 / 值 | 操作 | 位置 |
|---|---|---|
| `<扩展名>` 默认值 | 读（传统 ProgID） | `association.rs:113` |
| ★ `…FileExts\<扩展名>\UserChoice` → `ProgId` | 读（实际生效关联，禁写） | `association.rs:107` |
| `<ProgID>\shell\open\command` 默认值 | 读（归属规则 3） | `zed.rs:106` |
| `<ProgID>\DefaultIcon` 键 | 建 / 判存在 / **递归删** | `registry.rs:86/106/96`，`icon.rs:113` |
| `<ProgID>\DefaultIcon` 默认值 | 读 / 写（三种模式） | `association.rs:123`，`icon.rs:107` |
| `Classes` 子键列表 | 读（源 A 扩展名键、源 B 通道 ProgID） | `association.rs:49/77` |
| ★ `…\Uninstall\<子键>` 的 DisplayName / InstallLocation | 读（安装路径探测） | `zed.rs:143` |

文件系统侧（仅 `refresh.rs`）：删 `%LOCALAPPDATA%\IconCache.db` 与 `…\Explorer\thumbcache_*.db`；起停 `explorer.exe`。

---

## 5. 依赖

**npm**：react / react-dom 19.3 · @tauri-apps/api 2 · plugin-dialog 2 · plugin-clipboard-manager 2.4 · vite 8 · typescript 7 · @tauri-apps/cli 2.12（dev）
**cargo**：tauri 2.12 · tauri-plugin-dialog 2 · tauri-plugin-clipboard-manager 2 · serde / serde_json · anyhow 1 · windows-registry 0.2 · windows-result 0.2 · windows 0.58（Win32_UI_Shell / Foundation / System_Threading）；build-dep tauri-build 2

---

## 6. 已知不一致（改动前先确认意图）

1. **命名三处不一**：productName（zed-file-assoc-gui）、目录（RsIcon-tauri）、cargo 包（rsicon-tauri）、窗口标题，四者不统一。
2. **exe 图标是占位**：app-icon.png 为生成的占位图，换图后需 `pnpm tauri icon app-icon.png` 重生成 src-tauri/icons/。
3. **五个逻辑模块是旧仓库的复制品**：两仓库逐字节相同（含行号），改一边要同步另一边；单一来源归属未定（DESIGN 第 6 节待决 2）。
4. `lib.rs:16` 的 allow(dead_code) 仍掩盖 create_key / refresh_full / FileAssociation::current_icon 等未用项。
5. 侧栏固定 35%，拖拽调宽未实现（旧 egui 版支持 240–560px）。
