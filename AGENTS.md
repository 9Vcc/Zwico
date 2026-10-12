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
cd src-tauri && cargo test        # 4 个用例：zed::tests(2) + icon::tests(2)，当前全绿
cd src-tauri && cargo clippy --all-targets
```

截图回归工具：`target/ui-preview/shot.ps1`——未入库，删 `target/` 或 `cargo clean` 会丢；要点（窗口句柄枚举取最大、激活预点击、剪贴板代替键盘输入、WebView 下半区按钮合成点击打不中需改启动探针）记在项目记忆里，可几分钟重建。

---

## 3. 硬约束（违反即错误）

1. **只写 `HKCU\Software\Classes`**。禁 HKLM / HKCR / 提权（不要加 manifest、不要 `requestedExecutionLevel`）。
2. **绝不写 `FileExts\<扩展名>\UserChoice`**（只读，`association.rs:107`）。Windows 对该键有保护，写了要么失败要么破坏用户的默认应用设置。
3. **注册表路径一律相对路径**，拼 `Software\Classes` 前缀只能发生在 `registry.rs:39`。已批准的例外只有 `zed.rs:143`（卸载表）与 `association.rs:107`（`FileExts`），新增例外要记入 DESIGN.md。
4. **注册表/耗时操作必须 async + `spawn_blocking`**（`lib.rs` 各命令的固定模式）。同步命令跑在 Tauri 主线程会冻结窗口；前端 `invoke` 本身是异步的，不会阻塞渲染。
5. **`restart_explorer` 与 `delete_key` 是破坏性/可见副作用操作**：只能由用户显式触发且必须经过确认对话框（`App.tsx:765` `DIALOG_TEXT`）。禁止出现在任何"自动流程""启动即执行""测试用例"里。
6. **不按单一安装形态收窄逻辑**：安装器（`Zed.py`）/「打开方式」（`Applications\ZedG.exe`）/ 系统命名（`md_auto_file`）都要覆盖；自定义图标缺失要**回退并说明**，不要静默跳过或整批失败。
7. **新增系统能力要改三处**：`src-tauri/Cargo.toml` 依赖、`lib.rs` builder 插件注册、`capabilities/default.json` 权限——少一处只在运行时才报错。
8. **改前端后必须重新 `pnpm tauri build`**（dist 在编译期嵌入 exe）；`pnpm tauri dev` 不受影响。

---

## 4. 代码风格

**Rust 侧（沿用 egui 版约定）：**

- 中文注释、模块 `//!` 头说明职责与系统机制；`unsafe` 只应出现在 `refresh.rs`（SHChangeNotify，配 `// SAFETY：`）。
- `anyhow::Result`；底层错误用 `reg_error`（`registry.rs:48`）带完整键路径；批量"失败不中断 + 末尾汇总"（`icon.rs:204`）。
- 模块层 `println!` 带前缀 `[关联]` `[图标]` `[批量]` `[刷新]` `[警告]`；**用户可见日志走命令返回值或 `progress` 事件**，由前端渲染。别在前端不可见的地方静默吞错。
- 纯函数测试放被测文件底部；依赖本机注册表的用例写成"存在则验证、不存在不失败"（`zed.rs:299`）。
- DTO 一律 `#[serde(rename_all = "camelCase")]`，前端 `api.ts` 类型与之逐字段对应。

**前端侧：**

- 颜色一律走 CSS 变量（`styles.css:2` 深 / `:26` 浅），**禁止内联硬编码颜色**；禁用态给显式实色（见 DESIGN D14 的两次踩坑）。
- 所有可交互控件配 `title` 悬停说明（对齐旧版行为）。
- 组件保持"纯展示"（props 进、回调出），状态与副作用集中在 `App.tsx:30` 顶部。
- 协议改动同步三处：`api.ts` 的类型与封装、`lib.rs` 的 command、DESIGN/PROJECT_MAP 的相关条目。

---

## 5. 改动放哪里

| 需求 | 落点 |
|---|---|
| 新增 Zed 通道 | `zed.rs:16` 枚举 + 五个属性方法 + `zed.rs:275` 用例 + `api.ts:14` CHANNELS |
| 新注册表操作语义 | `registry.rs` 加函数，别在调用方直接 `CURRENT_USER` |
| 关联枚举规则调整 | `association.rs:42`（双源合并）与 `zed.rs:95`（归属三规则） |
| 新图标模式 / 改映射表 | `icon.rs:32` 枚举 + `icon.rs:166` 取值 + `api.ts:23` MODES + `IconSettingsCard`（`App.tsx:555`） |
| 新系统图标映射 | `icon.rs:51` match 分支 + `icon.rs:222` 断言 |
| 新的刷新强度/缓存路径 | `refresh.rs` + `RefreshCard`（`App.tsx:679`）+ `refresh_explorer` 的返回日志行 |
| 新命令 / 新事件 | `lib.rs`（模式：async + spawn_blocking + camelCase DTO），`api.ts` 加封装；涉及新插件先看 §3.7 |
| 界面样式 | `styles.css`（变量优先）+ 对应组件 |
| 界面结构 / 状态 / 流程 | `App.tsx`（状态在 30 行起，组件在 476 行起） |

---

## 6. 验证清单（改完必做）

1. `pnpm build` 类型检查通过；`cd src-tauri && cargo test` 全绿；`cargo clippy --all-targets` 无新增告警。
2. `pnpm tauri build --debug` 后运行 exe（或 `pnpm tauri dev`）。
3. **文档行号核验**：三份文档里的 `文件:NNN` 引用逐条对回代码（改前端/后端后行号必漂移；PROJECT_MAP 的裸行号表要单独重排）。可写个一次性核对脚本，别靠眼睛。
4. 真机回归（截图脚本 `target/ui-preview/shot.ps1`）：
   - 自动可拍：深浅主题、悬停、整行选中、确认对话框、自定义目录 + `.ico` 计数徽标。
   - **需人工点一次**：日志面板"复制/清空"（自动化合成点击在该区域打不中，剪贴板链路已用启动探针证明）。
   - **需人工点一次**：任意一次"应用到选中"覆盖忙碌态（进度条/全禁用/完成后自动重扫）；勾选"重启 Explorer"可顺带验证关窗确认链路（桌面会短暂消失，需用户同意）。
5. 若动了写入逻辑，用 `reg query` 读回（`<ProgID>\DefaultIcon`、扩展名键、`UserChoice` 的 `ProgId`）确认值与预期格式一致。

---

## 7. 已知不一致 —— 先问，别自作主张

| 现象 | 说明 |
|---|---|
| `productName`（`zed-file-assoc-gui`）≠ 目录名（`RsIcon-tauri`）≠ 包名（`rsicon-tauri`）≠ 窗口标题 | 统一要动 `tauri.conf.json:3`、`Cargo.toml`、`package.json`、README 四处，先问 |
| exe 图标是占位 | `app-icon.png` 是生成的占位图；换真图后 `pnpm tauri icon app-icon.png` 重生成 |
| 旧仓库（`E:\1Qoder\RsIcon`）仍在 | 五个逻辑模块是逐字节复制关系：改一边要同步另一边，或择机定"单一来源"（DESIGN §6 待决 2） |
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
