# PROJECT_MAP.md — 结构与调用地图

包名 `zed-file-assoc-gui`（目录名 `RsIcon`）· Rust 2021 edition · 7 个源文件 2420 行 · 平台限定 Windows。

---

## 1. 目录树

```text
RsIcon/
├── Cargo.toml            包元信息、依赖、release 体积优化配置
├── Cargo.lock            锁定（eframe 0.26 全家桶，120 KB）
├── build.rs              Windows 资源写入：版本信息始终写，图标仅当 assets/icon.ico 存在
├── README.md             面向使用者的功能说明 + 注册表原理 + 构建方法
├── DESIGN.md             设计决策与取舍（本文的姊妹篇）
├── AGENTS.md             协作规范、命令、不可违反的约束
├── icon/
│   └── md.ico            147 KB，Custom 模式的 .md 图标样例（非 exe 图标，见"已知不一致"）
├── src/
│   ├── main.rs              47   入口：窗口配置（960×720）+ 模块声明 + 子系统属性
│   ├── app.rs             1411   GUI：主题与控件助手、App 状态、消息通道、五块绘制函数、确认框、中文字体
│   ├── zed.rs              306   通道定义 + Zed 安装路径探测（4 级回退）
│   ├── icon.rs             251   三种图标模式、系统图标映射表、批量设置/删除
│   ├── refresh.rs          155   SHChangeNotify / 清图标缓存 / 重启 explorer
│   ├── association.rs      126   文件关联枚举（双源合并）、ProgID 生效解析
│   └── registry.rs         124   HKCU\Software\Classes 读写封装（唯一注册表入口）
└── target/               构建产物；release/zed-file-assoc-gui.exe ≈ 3.8 MB
```

依赖方向（无环）：

```text
main.rs ─► app.rs ─┬─► zed.rs ───────┐
                   ├─► association.rs─┼─► registry.rs ─► windows-registry
                   ├─► icon.rs ───────┤        (Software\Classes 唯一入口)
                   ├─► refresh.rs ─► windows(Win32 Shell)
                   └─► rfd（文件对话框）    egui/eframe/egui_extras（UI）
zed.rs / association.rs 另有一处绕过 registry 直连 CURRENT_USER（读卸载表与 FileExts）
```

---

## 2. 符号索引

### `src/main.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 15 | `windows_subsystem` 属性 | release 隐藏控制台；debug 保留 |
| 19 | `#![allow(dead_code)]` | 遗留自骨架阶段（DESIGN.md 待决 3） |
| 21–26 | `mod` 声明 | app / association / icon / refresh / registry / zed |
| 30 | `main()` | `NativeOptions`：标题「Zed 文件关联图标管理器」、900×650、最小 700×500；`run_native` 阻塞 |

### `src/app.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 36 | `enum GuiMessage` | Log / Progress / AssociationsLoaded / ZedPathFound / Error / Finished |
| 53 | `enum PendingAction` | RemoveIcons / RefreshExplorer / QuitWhileBusy |
| 63 | `struct LogEntry` | `text` + `is_error`（红色日志） |
| 72–80 | 颜色与尺寸常量 | `ACCENT` / `DANGER` / `OK_GREEN` / `WARN_ORANGE` / `ROW_HEIGHT` |
| 83 / 92 | `card_fill` / `card_stroke` | 卡片与描边色（随深浅主题） |
| 104 / 117 | `primary_button_colors` / `danger_button_colors` | 实心主按钮与危险描边按钮的「启用 / 禁用」实色配色（禁用态不做 alpha 派生） |
| 134 | `apply_theme` | 统一调色板、圆角、间距、字号；主题切换唯一入口（禁止直接 `set_visuals`） |
| 198 | `pick_initial_channel` | 启动选通道：优先已有 ProgID 的，其次已检测到 exe 的，兜底 Stable |
| 216 | `card` | 圆角卡片容器（标题 + 内边距 + 描边） |
| 233 | `pill` | 状态徽标（已设置 / 默认 / 共享 / .ico 计数） |
| 244 | `mode_radio` | 图标模式单选行（悬停显示说明），返回是否切换 |
| 259 | `association_row` | 列表行：整行可点、悬停高亮、自绘勾选框与状态徽标，返回是否被点击 |
| 347 | `empty_state` | 无关联时的引导页 |
| 375 | `struct App` | 全部 UI 状态：通道、zed_path、associations、selected、icon_mode、custom_icon_dir、busy、progress、pending_reload、log_lines、刷新两个复选框、confirm_dialog、custom_icon_count、allow_close |
| 431 | `App::new` | 注入中文字体、`apply_theme`、`pick_initial_channel`、初始日志、`spawn_load_task` |
| 482 | `process_messages` | 每帧 `try_recv` 排空；`Finished` 处理 busy/progress 收尾与自动重扫（`pending_reload` 在 503） |
| 512 / 520 | `log` / `log_error` | 追加日志 |
| 530 | `on_channel_changed` | 清 zed_path / associations / selected 后重扫 |
| 542 / 554 | `selected_targets` / `all_targets` | `FileAssociation` → `IconTarget`（扩展名 + 实际 ProgID） |
| 565 | `scan_ico_count` | 统计目录内 .ico 数量（单层，读不到返回 None） |
| 590 | `start_apply` | 前置校验（空目标 / App 模式无 zed_path / Custom 无目录）后 spawn |
| 615 | `start_remove` | 恢复默认入口 |
| 627 | `spawn_load_task` | 后台：`detect_zed_path` + `list_associations` |
| 660 | `spawn_apply_task` | 后台：批量设置或批量删除，进度回调转 `GuiMessage::Progress`（扩展名标签在 665） |
| 714 | `spawn_refresh_task` | 后台：通知 →（可选）清缓存 →（可选）重启 explorer |
| 758 | `draw_top_bar` | 品牌名 + 版本徽标、通道 ComboBox（比较前后值）、主题按钮、忙碌 spinner |
| 822 | `draw_list_panel` | 搜索（带清除）、可拖宽侧栏、整行多选列表、全选/反选/清空 + 计数 |
| 937 | `draw_operation_panel` | 顶部进度条 + 三张卡片：图标设置 / 操作 / 刷新资源管理器（按钮配色走 `*_button_colors`） |
| 1205 | `draw_log_panel` | 日志卡片：条数、复制、清空、自动吸底、右键菜单 |
| 1287 | `draw_confirm_dialog` | 居中弹窗，确定（强调）/ 取消 右对齐，按 `PendingAction` 分派 |
| 1357 | `eframe::App::update` | 顺序：处理消息 → 拦截关闭（1362）→ 顶栏 → 底栏 → 中央（左 35% 可调宽 / 右操作区）→ 确认框 |
| 1412 | `setup_chinese_fonts` | 读 `msyh.ttc` 追加为 Proportional/Monospace 回退字体 |

### `src/zed.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 16 | `enum Channel` | Stable / Preview / Nightly / Zedg |
| 29 | `Channel::ALL` | 界面遍历用 |
| 37 / 50 / 60 / 70 / 80 | `display_name` / `prog_id_prefix` / `app_name` / `exe_name` / `scoop_app_name` | 命名约定表；Preview、Nightly 无 scoop 包返回 None |
| 95 | `owns_prog_id` | 三规则判定 ProgID 是否归属本通道（前缀 / `Applications\<exe>` / `shell\open\command` 含 exe 名） |
| 117 | `UNINSTALL_KEY` | `Software\Microsoft\Windows\CurrentVersion\Uninstall` |
| 127 | `detect_zed_path` | 四级回退总入口 |
| 141 | `find_from_uninstall_registry` | 按 `DisplayName` 匹配 → `InstallLocation` 拼 exe |
| 173 | `find_from_common_paths` | `%LOCALAPPDATA%\Programs\<app|Zed>`、`%ProgramFiles%\<app>` |
| 206 | `find_from_scoop` | shim 优先，再试 `current\bin` 与 `current` |
| 240 | `find_from_scoop_shim` | 扫 PATH 中 `*shims` 目录，解析 `<pkg>.shim` 的 `path = "..."` |
| 275 | `mod tests` | `channel_config`、`scoop_shim_resolution`（后者依赖本机安装，未装则空跑） |

### `src/registry.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 23 | `CLASSES_ROOT` | `Software\Classes`（所有相对路径的基准） |
| 26 / 32 | `ERROR_FILE_NOT_FOUND` / `is_not_found` | 按 HRESULT 0x80070002 裸值比较识别"不存在" |
| 39 | `full_path` | 空串 → 根路径本身 |
| 48 | `reg_error` | 错误带完整键路径 |
| 57 | `get_default_value` | `Ok(Some)` / `Ok(None)`（键或默认值缺失）/ `Err` |
| 74 | `set_default_value` | 打开或创建（含中间层级）后写默认值 |
| 86 | `create_key` | 幂等建键 |
| 96 | `delete_key` | `remove_tree` 递归删子键树，不存在视为成功 |
| 106 | `key_exists` | 只判键 |
| 115 | `list_subkeys` | 子键名列表（注册表天然字母序） |

### `src/association.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 23 | `FILE_EXTS_ROOT` | `…\Explorer\FileExts`（UserChoice 所在） |
| 27 | `struct FileAssociation` | extension / prog_id / shared_prog_id / has_default_icon / current_icon |
| 42 | `list_associations` | 源 A + 源 B 合并，按扩展名排序，打印总数 |
| 74 | `list_effective_associations` | 遍历扩展名键（跳过带点的异常项），过滤归属本通道 |
| 104 | `effective_prog_id` | UserChoice `ProgId` 优先 → `Classes\<ext>` 默认值 |
| 117 | `build_association` | 读 `<ProgID>\DefaultIcon` 状态，失败按未设置处理 |

### `src/icon.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 23 | `struct IconTarget` | extension + prog_id，写入位置为 `<prog_id>\DefaultIcon` |
| 32 | `enum IconMode` | System / App / Custom |
| 51 | `system_icon_for` | 映射表：html/htm `-101`、xml `-99`、svg `-70`、bat/cmd/ps1 `-74`、其余 40+ 文本类与兜底 `-102` |
| 96 | `set_icon` | 归一化扩展名 → 计算值 → 写 DefaultIcon |
| 113 | `remove_icon` | 删 DefaultIcon 子键（= 恢复默认） |
| 123 | `batch_set_icons` | 逐项不中断 + `progress_cb` |
| 147 | `batch_remove_icons` | 同上，删除版 |
| 166 | `resolve_icon_value` | 三模式取值；Custom 缺文件/缺目录回退 System |
| 199 | `normalize_extension` | 去前导点 + 小写 |
| 204 | `summarize_failures` | 汇总失败明细为单条 Err |
| 217 | `mod tests` | `system_icon_mapping`、`extension_normalization` |

### `src/refresh.rs`

| 位置 | 符号 | 作用 |
|---|---|---|
| 18 | `CREATE_NO_WINDOW` | `0x0800_0000`，子进程不弹控制台 |
| 24 | `notify_system` | `SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None)` |
| 38 | `clear_icon_cache` | `%LOCALAPPDATA%\IconCache.db` + `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db`，占用即跳过 |
| 98 | `restart_explorer` | `taskkill /F /IM explorer.exe` → sleep 2s → 启动 explorer |
| 125 | `refresh_full` | 三档全开（当前 UI 未调用） |
| 146 | `try_delete` | `Ok(true)` 删除 / `Ok(false)` 本就不存在 / `Err` 被占用等 |

### `build.rs`

| 位置 | 内容 |
|---|---|
| 10 | 非 Windows 目标直接 return |
| 18–23 | FileDescription / ProductName / OriginalFilename / LegalCopyright / FileVersion / ProductVersion |
| 26–32 | `assets/icon.ico` 存在才 `set_icon`，否则 cargo:warning 跳过 |
| 35 | 资源编译失败只 cargo:warning，不中断构建 |

---

## 3. 运行时调用链

```text
启动  main:30 → eframe::run_native → App::new(app.rs:431)
                                     ├─ setup_chinese_fonts（读 msyh.ttc）+ apply_theme
                                     ├─ pick_initial_channel（比对各通道 ProgID / exe）
                                     └─ spawn_load_task ─┬─ zed::detect_zed_path（后台线程）
                                                         └─ association::list_associations
                                                          → registry::* / Channel::owns_prog_id
                                     每帧 update(app.rs:1357) → process_messages → 绘制五块面板

应用图标  「应用到选中/全部」（draw_operation_panel）→ start_apply(校验) → spawn_apply_task
          → icon::batch_set_icons → set_icon → resolve_icon_value → registry::set_default_value
                                                   （HKCU\Software\Classes\<ProgID>\DefaultIcon）
          → Progress* → Finished → pending_reload → 重新 spawn_load_task

恢复默认  「恢复默认」（draw_operation_panel）→ confirm_dialog(RemoveIcons) → start_remove
          → icon::batch_remove_icons → registry::delete_key（递归删 <ProgID>\DefaultIcon）

刷新      「刷新资源管理器」卡片「立即刷新」→（勾选重启 Explorer 时先 confirm_dialog）
          → spawn_refresh_task
          → refresh::notify_system → [clear_icon_cache] → [restart_explorer]
```

---

## 4. 注册表键位图

相对 `HKCU\Software\Classes`（`registry.rs:23`），标 ★ 表示绕过 registry 直连 `CURRENT_USER`。

| 键 / 值 | 操作 | 位置 |
|---|---|---|
| `<扩展名>` 默认值 | 读（解析传统 ProgID） | `association.rs:113` |
| ★ `…FileExts\<扩展名>\UserChoice` → `ProgId` | 读（实际生效关联，Windows 禁止外部写） | `association.rs:107` |
| `<ProgID>\shell\open\command` 默认值 | 读（归属判定规则 3） | `zed.rs:106` |
| `<ProgID>\DefaultIcon` 键 | 建 / 判存在 / **递归删** | `registry.rs:86/106/96`，`icon.rs:113` |
| `<ProgID>\DefaultIcon` 默认值 | 读（显示当前图标）/ 写（三种模式） | `association.rs:123`，`icon.rs:107` |
| `Classes` 子键列表 | 读（源 A 扩展名键、源 B 通道 ProgID） | `association.rs:49/77` |
| ★ `Software\Microsoft\Windows\CurrentVersion\Uninstall\<子键>` → `DisplayName` / `InstallLocation` | 读（安装路径探测） | `zed.rs:143` |

文件系统侧（仅 `refresh.rs`）：删 `%LOCALAPPDATA%\IconCache.db`、`%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db`；起停 `explorer.exe`。

---

## 5. 外部依赖

| crate | 版本 | 用途 | 使用位置 |
|---|---|---|---|
| `eframe` / `egui` | 0.26 | 原生窗口 + 即时模式 UI（含 `egui_extras` 备用） | `main.rs`、`app.rs` |
| `rfd` | 0.14 | exe / 文件夹选择对话框 | `app.rs:978`、`app.rs:1043` |
| `windows-registry` | 0.2 | HKCU 读写，`CURRENT_USER` | `registry.rs`、`zed.rs`、`association.rs` |
| `windows-result` | 0.2 | `HRESULT` 错误码判定 | `registry.rs:32` |
| `windows` | 0.58 | `Win32_UI_Shell`（SHChangeNotify）、`Win32_Foundation`、`Win32_System_Threading`（当前未实际用到） | `refresh.rs:15` |
| `anyhow` | 1.0 | `Result` + `Context` + 中文错误串 | 除 `main.rs` 外各模块 |
| `winresource` | 0.1（build-dep） | exe 版本信息与图标资源 | `build.rs` |

---

## 6. 已知不一致（改动前先确认意图）

1. **`icon/md.ico` vs `assets/icon.ico`**：`build.rs:26` 只认 `assets/icon.ico`，仓库里没有 `assets/`，因此当前构建会打印 `未找到 assets/icon.ico，跳过 exe 图标` 并产出无图标 exe；而 `icon/md.ico` 的命名（`<扩展名>.ico`）符合 Custom 模式目录约定。两者意图互斥，未定。
2. **目录名与包名**：目录 `RsIcon`、包 `zed-file-assoc-gui`、窗口标题「Zed 文件关联图标管理器」、`build.rs` ProductName 四处命名不一致。
3. **`#![allow(dead_code)]`**（`main.rs:19`）：注释仍称"骨架阶段"，实际模块已全部接入 UI；`refresh_full`、`create_key`、`FileAssociation::current_icon` 等仍无人调用，故该属性目前仍在掩盖告警。
4. **已建本地 git 仓库**（基线 `ecb2240`，界面改版 `8694b72`），无远程；`.gitignore` 只忽略 `/target` 与 `*.log`。
