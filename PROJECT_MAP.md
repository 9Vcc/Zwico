# PROJECT_MAP.md — 结构与调用地图

`rsicon-tauri` · Tauri 2 + React 19 + TS · 平台限定 Windows。
引用格式统一为「**文件 + 符号名**」——行号会随改动漂移，符号名不会（原行号表已废弃）。

---

## 1. 目录树

```text
RsIcon-tauri/
├── package.json / pnpm-lock.yaml     前端依赖与脚本（dev / build / tauri）
├── vite.config.ts                    固定 1420 端口、忽略 src-tauri 监听
├── tsconfig.json / tsconfig.node.json / index.html / .gitignore
├── app-icon.png                      图标源图（1024，`pnpm tauri icon` 重生成）
├── README.md
├── DESIGN.md / AGENTS.md / PROJECT_MAP.md   三件套（本仓库）
├── CODE_REVIEW.md                    代码审查报告 + 修复进展
├── src/                              前端（分层见 DESIGN D21）
│   ├── main.tsx                      React 挂载（DEV 下先装 dev-mock）
│   ├── dev-mock.ts                   浏览器预览假数据（仅 DEV，生产构建移除）
│   ├── api.ts                        协议层：类型 + invoke 封装 + 事件订阅
│   ├── styles.css                    设计系统：变量 / 基础 / 布局 / 组件
│   ├── App.tsx                       外壳：组合 store 与组件 + 快捷键 + 侧栏拖拽
│   ├── hooks/
│   │   ├── useAppStore.ts            全部状态与动作（配置持久化 / bootstrap / 失败出口）
│   │   └── useToast.tsx              浮层提示（useToasts + ToastStack）
│   ├── lib/
│   │   ├── iconInfo.ts               DefaultIcon 解析、图标来源推断、格式化
│   │   └── presets.ts                预设格式、校验与序列化
│   ├── components/
│   │   ├── ui.tsx                    Card / Pill / Spinner / Switch + SVG 图标集
│   │   ├── TopBar.tsx                品牌 + 通道选择 + 主题切换
│   │   ├── AssociationList.tsx       搜索 / 列表 / Row / EmptyState
│   │   ├── IconSettingsCard.tsx      Zed 路径 / 来源模式 / 图标目录
│   │   ├── ActionCards.tsx           ActionsCard / UndoCard / MaintenanceCard
│   │   ├── PresetCard.tsx            预设导出与导入
│   │   ├── LogPanel.tsx              日志（分级 / 吸底 / 折叠 / 右键复制）
│   │   └── ConfirmDialog.tsx         确认框（Esc 取消 / Enter 确定）
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml                    依赖与体积优先 profile
│   ├── build.rs / tauri.conf.json    窗口 960×720、devUrl 1420、bundle.active=false
│   ├── capabilities/default.json     core:default + dialog + clipboard-manager
│   ├── icons/                        tauri icon 生成（含 icon.ico）
│   └── src/
│       ├── main.rs                   入口（release 隐藏控制台）
│       ├── lib.rs                    命令/事件/DTO/BusyGuard/撤销快照（前端唯一系统入口）
│       ├── registry.rs               HKCU\Software\Classes 五函数封装
│       ├── zed.rs                    通道定义（含 key 映射）+ 安装探测 + 归属判定
│       ├── association.rs            双源枚举 + 图标状态 + 共享影响面
│       ├── icon.rs                   图标取值 / 批量设置删除 / 失效判定
│       └── refresh.rs                通知 Shell / 清缓存 / 重启 explorer
└── target/                           cargo 产物 + ui-check（截图与校验脚本，gitignore）
```

依赖方向（无环）：

```text
App.tsx ─ components/* ─ useAppStore ─ lib/*
                   │           │
                   └── api.ts ─┴──(invoke / event)── lib.rs ─┬─ association.rs ─┐
                                                             ├─ icon.rs ────────┼─ registry.rs ─► windows-registry
                                                             └─ zed.rs ─────────┘
                                                             refresh.rs ─► windows (Win32 Shell)
                                                             tauri-plugin-dialog / clipboard-manager（前端直接调）
```

---

## 2. 符号索引

### `src-tauri/src/lib.rs`

| 符号 | 作用 |
|---|---|
| `BusyGuard` | busy 的 RAII 守卫：`acquire()` 置忙，`Drop` 复位（DESIGN D19） |
| `blocking()` | 把闭包丢进阻塞池并统一处理 join 失败（所有耗时命令的公共通道） |
| `info()` / `warn()` / `error()` | 构造 `LogLineDto { text, level }` |
| `select_channel()` | 选启动通道：有 ProgID > 有 exe > stable（大小写不敏感） |
| `load_sync()` | 检测 Zed + 枚举关联 + 组装日志（在阻塞池中调用） |
| `bootstrap()` | **启动命令**：选通道 + 检测 + 枚举，一次返回 |
| `load_state(channel)` | 重新加载指定通道（只读，不置 busy） |
| `scan_ico_count(dir)` | 目录 `.ico` 计数（async） |
| `apply_icons(...)` | 批量写入（支持逐项 `customIcon`）；返回日志行；末尾自动通知 Shell |
| `remove_icons(targets)` | 批量恢复默认；返回日志行 |
| `refresh_explorer(clearCache, restartExplorer)` | 通知 →〔清缓存〕→〔重启〕，单步失败不中断 |
| `undo_status()` / `undo_last()` | 撤销快照查询 / 执行（快照一次性） |
| `save_preset_file` / `load_preset_file` | 预设文件读写（限 `.json`、≤1 MiB） |
| `confirm_quit()` | 忙碌中退出确认后清标志 + destroy |
| DTO | `LogLineDto` / `AssociationDto`（含 `sharedWith`、`iconState`）/ `LoadState` / `BootstrapDto` / `ProgressPayload` / `TargetDto`（含 `customIcon`）/ `UndoSnapshot` / `UndoStatusDto` |
| `run()` | plugin 注册 / manage(AppState) / invoke_handler / on_window_event（关窗拦截） |

### `src/hooks/useAppStore.ts`

| 符号 | 作用 |
|---|---|
| `PersistedConfig` / `CONFIG_KEY` | localStorage 配置：主题、来源模式、图标目录、逐项图标、两个开关、侧栏宽度、日志折叠 |
| 状态 | `channel` `zedPath` `associations` `search` `selected` `icoCount` `busy` `progress` `loaded` `log` `dialog` `undoStatus` `toasts` |
| `applyLoaded()` / `load()` | 应用加载结果（顺带清理已消失的选中项）/ 重新加载 |
| `runApply()` / `applySelected()` / `applyAll()` | 应用图标（含逐项图标），完成后自动重扫并刷新撤销状态 |
| `removeSelected()` / `repairInvalid()` | 恢复默认 / 一键修复失效图标（复用 `apply_icons`） |
| `runRefresh()` / `requestRefresh()` | 刷新资源管理器（勾选重启时先弹确认） |
| `runUndo()` | 撤销上次写入 |
| `exportPreset()` / `importPreset()` | 预设导出 / 导入 |
| `pickZed()` / `pickCustomDir()` / `pickIconFor()` / `clearIconFor()` | 路径与逐项图标选择 |
| `toggle()` / `selectAllVisible()` / `invertVisible()` / `clearSelection()` | 选择操作 |
| `stats` | 派生统计：`total` / `selected` / `invalid` / `shared` |
| `confirmDialog()` | 按 `dialog` 类型分派 remove / refresh / undo / quit |
| `fail()` / `succeed()` | 统一失败出口（浮层 + 错误日志）/ 成功提示 |

### `src/components/`

| 文件 | 导出 | 说明 |
|---|---|---|
| `ui.tsx` | `Card` `Pill` `Spinner` `Switch` + 图标集 | 基础件与 SVG 图标（16×16、1.5px、currentColor） |
| `TopBar.tsx` | `TopBar` | 品牌、通道选择、主题切换、忙碌指示 |
| `AssociationList.tsx` | `AssociationList` | 搜索、列表、`Row`（标签 + 行内图标按钮）、`EmptyState` |
| `IconSettingsCard.tsx` | `IconSettingsCard` | Zed 路径、来源模式（卡片式单选）、图标目录与状态 |
| `ActionCards.tsx` | `ActionsCard` `UndoCard` `MaintenanceCard` | 应用/恢复、撤销、刷新与修复 |
| `PresetCard.tsx` | `PresetCard` | 预设导出导入 + 当前配置摘要 |
| `LogPanel.tsx` | `LogPanel` | 分级日志、自动吸底、折叠、右键复制单条 |
| `ConfirmDialog.tsx` | `ConfirmDialog` | 四类确认文案（remove / refresh / undo / quit） |

### `src/api.ts`

| 符号 | 作用 |
|---|---|
| `APP_VERSION` | 版本号（与 package.json / Cargo.toml / tauri.conf.json 手动同步） |
| `CHANNELS` / `MODES` | 通道表（含 `exeName`，供图标来源推断）/ 图标来源表 |
| 类型 | `Association`（含 `sharedWith` `iconState`）/ `LogLine`(level) / `LoadState` / `BootstrapState` / `ProgressPayload` / `Target`(customIcon) / `UndoStatus` |
| `api` | 11 个 invoke 封装：`bootstrap` `loadState` `scanIcoCount` `applyIcons` `removeIcons` `refreshExplorer` `undoStatus` `undoLast` `savePresetFile` `loadPresetFile` `confirmQuit` |
| `onProgress` / `onCloseRequested` | 事件订阅，返回取消函数 |

### `src/styles.css` 段落

| 段 | 内容 |
|---|---|
| 变量 | 深 / 浅两套：背景四级、描边两级、语义色（含 `-soft` / `-border`）、字体、圆角、`--sidebar-w` / `--log-h` |
| 基础 | reset、滚动条、`@keyframes`（spin / fade-in / slide-in / progress-slide）、`prefers-reduced-motion` |
| 布局 | `.app` 三行 grid、`.main` 三列、`.content` auto-fit 卡片网格、`.resizer` |
| 组件 | topbar / brand / 表单 / 按钮（primary·danger·attention·icon·mini·tiny）/ card / field / path / option / switch / pill·tag / sidebar·row / empty / progress·banner / preset / logpanel / dialog / toasts / spinner |
| 响应式 | `≤1080px` 收紧卡片；`≤900px` 单列 + 侧栏收窄 + 隐藏拖拽条；高度 `≤620px` 日志再收 |

---

## 3. 运行时调用链

```text
启动   main.rs → lib.rs::run() → 前端挂载 App.tsx
       →（DEV 且非 Tauri 环境时先装 dev-mock）
       → useAppStore 启动 effect → invoke bootstrap()
         → 阻塞池：select_channel + detect_zed_path + list_associations
       → 一次拿到 { channel, autoSelected, zedPath, associations, log }
       → 订阅 progress / close-requested；查询 undo_status

应用   ActionsCard → applySelected → invoke apply_icons(targets, mode, zedPath, customDir)
       → 阻塞池：capture_snapshot → icon::batch_set_icons
                 → set_icon（校验 ProgID → resolve_icon_value → registry::set_default_value）
       → 每项处理前 emit progress{current,total,extension}
       → 汇总 BatchReport → 日志行（info/warn/error）+ 保存撤销快照 + notify_system
       → 前端追加日志、弹提示、重扫 load_state、刷新撤销状态

恢复   恢复默认 → ConfirmDialog(remove) → invoke remove_icons
       → 快照 + batch_remove_icons（递归删 <ProgID>\DefaultIcon）→ 日志 + 自动通知

修复   顶部提示条 / MaintenanceCard → repairInvalid
       → 前端筛出 iconState === "missing" 的项 → 复用 apply_icons

撤销   UndoCard → ConfirmDialog(undo) → invoke undo_last
       → 读应用数据目录 undo.json → 逐项 set/delete DefaultIcon → 删除快照 → 通知

刷新   立即刷新（勾选重启则先 ConfirmDialog(refresh)）→ invoke refresh_explorer
       → notify_system →〔clear_icon_cache〕→〔restart_explorer〕→ 返回日志行

预设   导出：dialog.save → invoke save_preset_file(path, json)
       导入：dialog.open → invoke load_preset_file(path) → parsePreset 校验
             → 写入界面配置（不写注册表，需用户再点「应用」）

关窗   用户点 × → lib.rs 的 on_window_event(CloseRequested)
       → BusyGuard 持有中？→ prevent_close + emit close-requested → ConfirmDialog(quit)
       → 确定 → invoke confirm_quit → busy=false + window.destroy()
```

---

## 4. 注册表键位图

相对 `HKCU\Software\Classes`（拼接发生在 `registry.rs::full_path`），★ = 绕过 registry 直连 `CURRENT_USER` 的已批准例外。

| 键 / 值 | 操作 | 位置 |
|---|---|---|
| `<扩展名>` 默认值 | 读（传统 ProgID） | `association.rs::effective_prog_id` |
| ★ `…FileExts\<扩展名>\UserChoice` → `ProgId` | 读（实际生效关联，**禁写**） | `association.rs::effective_prog_id` |
| `<ProgID>\shell\open\command` 默认值 | 读（归属规则 3） | `zed.rs::owns_prog_id` |
| `<ProgID>` 键 | 判存在（写前校验，避免造孤儿键） | `icon.rs::set_icon` / `icon.rs::remove_icon` |
| `<ProgID>\DefaultIcon` 键 | 建 / 判存在 / **递归删** | `registry.rs` / `icon.rs::remove_icon` |
| `<ProgID>\DefaultIcon` 默认值 | 读 / 写（三种来源 + 逐项图标） | `association.rs::build_association`、`icon.rs::set_icon` |
| `<ProgID>\DefaultIcon` 原值 | 读（写前快照，供撤销） | `lib.rs::capture_snapshot` |
| `Classes` 子键列表 | 读（源 A 扩展名键、源 B 通道 ProgID，**只枚举一次**） | `association.rs::list_associations` |
| ★ `…\Uninstall\<子键>` 的 DisplayName / InstallLocation | 读（安装路径探测） | `zed.rs::find_from_uninstall_registry` |

文件系统侧（`refresh.rs`）：删 `%LOCALAPPDATA%\IconCache.db` 与 `…\Explorer\thumbcache_*.db`；起停 `explorer.exe`。
应用数据侧（`lib.rs`）：`<app_data_dir>\undo.json`（撤销快照，一次性）。

---

## 5. 依赖

**npm**：react / react-dom 19.3 · @tauri-apps/api 2 · plugin-dialog 2 · plugin-clipboard-manager 2.4 · vite 8 · typescript 7 · @tauri-apps/cli 2.12（dev）
**cargo**：tauri 2.12 · tauri-plugin-dialog 2 · tauri-plugin-clipboard-manager 2 · serde / serde_json · anyhow 1 · windows-registry 0.2 · windows-result 0.2 · windows 0.58（Win32_UI_Shell / Foundation / System_Threading）；build-dep tauri-build 2

---

## 6. 已知不一致（改动前先确认意图）

1. **命名四处不一**：productName（zed-file-assoc-gui）、目录（RsIcon-tauri）、cargo 包（rsicon-tauri）、窗口标题。
2. **exe 图标是占位**：换图后需 `pnpm tauri icon app-icon.png` 重生成 `src-tauri/icons/`。
3. **五个逻辑模块已与旧仓库分叉**：不再是复制品关系，改一边不会再自动对应另一边（DESIGN D18）。
4. `csp` 仍为 `null`（见 DESIGN §5 与 §6 待决 5）。
