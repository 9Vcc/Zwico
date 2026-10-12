# AGENTS.md — 协作与操作规范（Tauri 版）

给在这个仓库里干活的 AI / 开发者。设计**为什么**见 `DESIGN.md`，**东西在哪**见 `PROJECT_MAP.md`，用法见 `README.md`。

---

## 1. 项目速览

`rsicon-tauri`：Zed 文件关联图标管理工具的 Tauri 版。前端 React 19 + TS + Vite；后端 Tauri 2 + 从 egui 版原样复用的五个纯逻辑模块（`registry`/`zed`/`association`/`icon`/`refresh`）。只动 HKCU，无需管理员，产物单 exe（`bundle.active=false`，不出安装包）。

环境（本机实测）：rustc/cargo 1.98 · node v26 · pnpm 12 · Tauri CLI 2.12 · WebView2 154（Win11 自带）。
**平台限定 Windows**：注册表调用与 `refresh.rs` 的 windows crate 无法在 Linux/macOS 编译验证。

---

## 2. 命令（均已跑通）

```bash
pnpm install
pnpm build                        # tsc 类型检查 + vite 构建（改前端先跑这个）
pnpm tauri dev                    # 开发窗口（vite 热重载；注意可能残留孤儿进程）
pnpm tauri build --debug          # 可独立运行的 debug exe
pnpm tauri build                  # release exe（体积优先 profile）
cd src-tauri && cargo test        # 17 个用例（zed / icon / association / lib），当前全绿
cd src-tauri && cargo clippy --all-targets
```

界面调试：`pnpm dev` 后直接用浏览器打开 `http://localhost:1420` 就能看到带假数据的界面（`src/dev-mock.ts` 仅在 DEV 且检测不到 Tauri 运行时时生效），支持 `?theme=light`、`?log=collapsed`、`?sidebar=360` 切换形态。真实行为仍需 `pnpm tauri dev`。

自查脚本（放在 `target/` 下，未入库、`cargo clean` 会丢，需要时几分钟重写）：
- `target/ui-check/check-classes.mjs`——比对「组件用到的类名 ↔ `styles.css` 定义」与 CSS 变量，能查出类名拼写错误。
- 旧的 `target/ui-preview/shot.ps1` 截图脚本已随 UI 重构弃用（依赖旧版 DOM 结构）。

---

## 3. 硬约束（违反即错误）

1. **只写 `HKCU\Software\Classes`**。禁 HKLM / HKCR / 提权（不要加 manifest、不要 `requestedExecutionLevel`）。
2. **绝不写 `FileExts\<扩展名>\UserChoice`**（只读，`association.rs:107`）。Windows 对该键有保护，写了要么失败要么破坏用户的默认应用设置。
3. **注册表路径一律相对路径**，拼 `Software\Classes` 前缀只能发生在 `registry.rs:39`。已批准的例外只有 `zed.rs:143`（卸载表）与 `association.rs:107`（`FileExts`），新增例外要记入 DESIGN.md。
4. **注册表/耗时操作必须 async + `spawn_blocking`**：统一走 `lib.rs::blocking()`，它同时统一处理 join 失败。同步命令跑在 Tauri 主线程会冻结窗口；前端 `invoke` 本身是异步的，不会阻塞渲染。
5. **`restart_explorer` 与 `delete_key` 是破坏性/可见副作用操作**：只能由用户显式触发且必须经过确认对话框（`App.tsx:765` `DIALOG_TEXT`）。禁止出现在任何"自动流程""启动即执行""测试用例"里。
6. **不按单一安装形态收窄逻辑**：安装器（`Zed.py`）/「打开方式」（`Applications\ZedG.exe`）/ 系统命名（`md_auto_file`）都要覆盖；自定义图标缺失要**回退并说明**，不要静默跳过或整批失败。
7. **新增系统能力要改三处**：`src-tauri/Cargo.toml` 依赖、`lib.rs` builder 插件注册、`capabilities/default.json` 权限——少一处只在运行时才报错。
8. **改前端后必须重新 `pnpm tauri build`**（dist 在编译期嵌入 exe）；`pnpm tauri dev` 不受影响。
9. **busy 只能经 `BusyGuard` 置位**（RAII，`Drop` 时复位）。不要手写 `store(true/false)`——异常路径（`?` 提前返回、任务 panic）会漏掉复位，此后窗口将永远关不掉。只读命令不置 busy。
10. **用户可见的信息必须经返回值或事件送到前端**：release 隐藏控制台，`println!` 只是 debug 手段。回退、跳过、失败明细都要出现在日志面板里（`LogLineDto` 的 `level` 分 info/warn/error）。
11. **一切用户可见文案必须走 i18n**：前端用 `t("key", [参数])`，字典在 `src/lib/i18n.ts`（中英各一份，条目数必须一致）；后端**只返回 key**（`LogLineDto{key,params,level}` 或 `text::encoded(key, &[参数])`），不得再返回中文。改完跑 `target/ui-check/check-i18n.py` 校验引用与字典一致。

---

## 4. 代码风格

**Rust 侧（沿用 egui 版约定）：**

- 中文注释、模块 `//!` 头说明职责与系统机制；**`unsafe` 只允许出现在两处**：`refresh.rs`（SHChangeNotify）与 `iconrender.rs`（GDI/Shell 取图标），每处调用点都要配 `// SAFETY：` 说明。
- `anyhow::Result`；底层错误用 `reg_error`（`registry.rs:48`）带完整键路径；批量"失败不中断 + 末尾汇总"（`icon.rs:204`）。
- 模块层 `println!` 带前缀 `[关联]` `[图标]` `[批量]` `[刷新]` `[警告]`；**用户可见日志走命令返回值或 `progress` 事件**，由前端渲染。别在前端不可见的地方静默吞错。
- 纯函数测试放被测文件底部；依赖本机注册表的用例写成"存在则验证、不存在不失败"（`zed.rs:299`）。
- DTO 一律 `#[serde(rename_all = "camelCase")]`，前端 `api.ts` 类型与之逐字段对应。

**前端侧（分层见 DESIGN D21）：**

- **状态只存在于 `hooks/useAppStore.ts` 一处**；组件一律"props 进、回调出"，不在组件里 `invoke`、读注册表或碰文件系统。
- 纯函数（解析、格式化、校验）放 `src/lib/`，便于复用与测试；不要塞进组件。
- 颜色一律走 CSS 变量（`styles.css` 深 / 浅两套），**禁止内联硬编码颜色**；语义色按 `-soft` / `-border` 成对使用；禁用态给显式实色（DESIGN D14 的两次踩坑）。
- 所有可交互控件配 `title` 悬停说明；异步动作必须有"忙碌 + 结果"反馈，失败一律经 `fail()`（浮层提示 + 错误日志同时落地）。
- 新增界面文案用中文；时间格式化统一走 `lib/iconInfo.ts`。
- 协议改动同步三处：`api.ts` 的类型与封装、`lib.rs` 的 command、DESIGN/PROJECT_MAP 的相关条目。

---

## 5. 改动放哪里

| 需求 | 落点 |
|---|---|
| 新增 Zed 通道 | `zed.rs` 的 `Channel` 枚举 + 五个属性方法 + `as_key`/`from_key` + `tests::channel_key_roundtrip` + `api.ts` 的 `CHANNELS` |
| 新注册表操作语义 | `registry.rs` 加函数，别在调用方直接 `CURRENT_USER` |
| 关联枚举规则调整 | `association.rs::list_associations`（双源合并）与 `zed.rs::owns_prog_id`（归属三规则） |
| 新图标模式 / 改映射表 | `icon.rs` 的 `IconMode` + `resolve_icon_value` + `api.ts` 的 `MODES` + `components/IconSettingsCard.tsx` |
| 新系统图标映射 | `icon.rs::system_icon_for` 的 match 分支 + `tests::system_icon_mapping` 断言 |
| 新的图标状态判定 | `icon.rs::inspect_icon_value` + `components/AssociationList.tsx` 的标签渲染 |
| 新的刷新强度 / 缓存路径 | `refresh.rs` + `components/ActionCards.tsx::MaintenanceCard` + `refresh_explorer` 返回的日志行 |
| 图标预览的渲染细节 | `iconrender.rs`（GDI 链 + PNG 编码）；PNG/zlib/base64 都是纯函数，改完跑 `cargo test iconrender` |
| SVG → ICO 相关 | `lib/ico.ts`（光栅化与容器打包）+ `hooks/useSvgIco.ts`；改容器结构后**必须**跑 `ico_container_is_readable_by_system` |
| 窗口控制 / 标题栏 | `lib.rs` 的 `window_*` 命令 + `components/TitleBar.tsx`；关闭务必用 `window_close`（保留关窗拦截） |
| 面板尺寸与拖拽边界 | `lib/layout.ts`（所有拖拽与窗口 resize 都要经过 clamp） |
| 新命令 / 新事件 | `lib.rs`（模式：async + `blocking()` + camelCase DTO），`api.ts` 加封装；涉及新插件先看 §3.7 |
| 界面样式 | `styles.css`（变量优先）+ 对应组件 |
| 界面结构 / 状态 / 流程 | 状态与流程改 `hooks/useAppStore.ts`；纯展示改 `components/*`；布局与快捷键改 `App.tsx` |
| 新的可撤销写操作 | 参考 `apply_icons`：写前 `capture_snapshot` → 写 → `save_undo`（新写入路径要自己接上） |

---

## 6. 验证清单（改完必做）

1. `pnpm build` 类型检查通过；`cd src-tauri && cargo test` 全绿；`cargo clippy --all-targets` 无新增告警。
2. `pnpm tauri build --debug` 后运行 exe（或 `pnpm tauri dev`）。
3. **文档一致性**：`PROJECT_MAP.md` 的符号索引要能对上代码（已全部改用符号名，新增模块记得登记）；DESIGN 的新决策要有编号。
4. 界面自查：`pnpm dev` + 浏览器打开，借助 `dev-mock` 快速核对布局与配色（深浅两套、窄窗口 <900px）；类名一致性可跑 `target/ui-check/check-classes.mjs`。
   - `dev-mock` 里的 `previewIcon` 返回彩色方块，只用于确认布局；**真实图标渲染必须在真机验证**。
5. 真机回归（**必须**，浏览器 mock 覆盖不到 Tauri 行为）：
   - 需人工点一次：日志"复制/清空"、侧栏拖拽、日志高度拖拽、日志折叠、快捷键（Ctrl+A / Ctrl+Z / Ctrl+R、Esc、Enter）。
   - 需人工点一次：标题栏拖动窗口、双击最大化、最大化/还原按钮、窗口边缘缩放、关闭按钮（忙碌时应弹确认）。
   - 需人工点一次：列表行的图标预览是否显示真实图标（而非占位方块）；「自动检测」是否能扫出本机 Zed。
   - 需人工点一次：SVG 转 ICO 全流程（选文件 → 预览 → 勾尺寸 → 转换 → 保存 → 用生成的 .ico 设为图标）。
   - 需人工点一次：任意一次"应用到选中"覆盖忙碌态（进度条 / 全禁用 / 完成后自动重扫 / 撤销按钮变可用）。
   - 需人工点一次：勾选"重启 Explorer"验证二次确认与关窗拦截链路（桌面会短暂消失，需用户同意）。
6. 若动了写入逻辑，用 `reg query` 读回（`<ProgID>\DefaultIcon`、扩展名键、`UserChoice` 的 `ProgId`）确认值与预期格式一致；**执行撤销后同样读回**，验证恢复正确。

---

## 7. 已知不一致 —— 先问，别自作主张

| 现象 | 说明 |
|---|---|
| `productName`（`zed-file-assoc-gui`）≠ 目录名（`RsIcon-tauri`）≠ 包名（`rsicon-tauri`）≠ 窗口标题 | 统一要动 `tauri.conf.json:3`、`Cargo.toml`、`package.json`、README 四处，先问 |
| 五个逻辑模块已与 egui 版分叉 | 不再是"逐字节复用"关系；§6 待决 2 已升级为「必须做」（抽 core crate） |
| exe 图标是占位 | `app-icon.png` 是生成的占位图；换真图后 `pnpm tauri icon app-icon.png` 重生成 |
| `lib.rs:16` `#![allow(dead_code)]` | 掩盖 `create_key`/`refresh_full` 等未接线项 |
| `bundle.active=false` | 没有安装包产物；如需 NSIS/MSI 改 `tauri.conf.json:29` |

---

## 8. 不要做的事

- 不引入 UI 组件库 / CSS 框架（手写样式 + 变量驱动是刻意选择，样式可控性就是迁移目的）。
- 不把注册表逻辑搬进 `lib.rs` 或前端，保持五个模块的边界。
- 不在前端直连文件系统 / 注册表（一切经 commands）。
- 不新增 npm / cargo 依赖不问。
- 不提交 `target/`、`dist/`、截图与日志产物（`.gitignore` 已覆盖）。
- 不顺手改旧仓库（除非任务明确是"双仓同步"）。
