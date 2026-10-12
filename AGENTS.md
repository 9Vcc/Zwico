# AGENTS.md — 协作与操作规范

给在这个仓库里干活的 AI / 开发者。设计**为什么**这样见 `DESIGN.md`，**东西在哪**见 `PROJECT_MAP.md`，功能与用法见 `README.md`。

---

## 1. 项目速览

`zed-file-assoc-gui`：Windows 纯 GUI 工具，给 Zed 注册的文件关联写 `DefaultIcon`，让 `.py` / `.md` / `.rs` 显示不同图标。只动 HKCU，无需管理员，产物单 exe。

Rust 2021 · 声明 MSRV 1.75 · 本机实测工具链 `rustc 1.98.0` / `cargo 1.98.0` / `rustfmt 1.9.0` / `clippy 0.1.98`。
**平台限定 Windows**：`refresh.rs` 与注册表调用无法在 Linux/macOS 编译验证。

---

## 2. 命令（均已在本机跑通）

```bash
cargo test                    # 4 个用例：zed::tests(2) + icon::tests(2)，当前全绿
cargo clippy --all-targets    # 无 lint（只有一条 build.rs 的 assets/icon.ico 缺失 cargo:warning）
cargo fmt --check             # ⚠ 当前不干净（exit 1）：icon.rs:105、main.rs:13、refresh.rs:84
cargo build --release         # target/release/zed-file-assoc-gui.exe ≈ 3.9 MB
cargo run                     # debug：保留控制台看 println! 日志
```

改完至少跑 `cargo test` + `cargo clippy --all-targets`；上面三处**存量**未格式化差异不属于你的改动范围时不要顺手改（会产生无关 diff）。`src/app.rs` 当前是 fmt-clean 的，改完 UI 记得单独 `rustfmt src/app.rs`。

---

## 3. 硬约束（违反即错误）

1. **只写 `HKCU\Software\Classes`**。禁止动 HKLM、禁止动 `HKCR`、禁止请求管理员（不要加 `requestedExecutionLevel`、不要写 manifest 提权）。
2. **绝不写 `FileExts\<扩展名>\UserChoice`**。Windows 对该键有保护（父键 ACL + 签名校验），写了要么失败要么破坏用户的默认应用设置。本工具只**读**它（`association.rs:107`），只改图标、不改"打开方式"。
3. **注册表路径一律传相对路径**（`".rs"`、`"Zed.rs\DefaultIcon"`），拼 `Software\Classes` 前缀只能发生在 `registry.rs:39`。读卸载表和 `FileExts` 这类 Classes 之外的键是已批准的例外，见 `zed.rs:143`、`association.rs:107`，新增例外要在 DESIGN.md 记一笔。
4. **不要阻塞 UI 线程**。注册表遍历、批量写入、清缓存、重启 explorer 都必须在 `std::thread` 里跑，结果用 `GuiMessage` 回传；UI 是唯一状态所有者，后台不共享可变状态。
5. **`restart_explorer` 和 `delete_key` 是破坏性/可见副作用操作**，只能由用户显式触发且必须经过确认对话框（`app.rs:1287`）。禁止在任何"自动流程""启动即执行""测试用例"里调用它们——它们会杀掉用户桌面、递归删键树。
6. **不要为了省事按单一安装形态收窄逻辑**。关联枚举必须同时覆盖安装器形态（`Zed.py`）和便携/打开方式形态（`Applications\ZedG.exe`、`md_auto_file`）；自定义图标缺失要**回退并说明**，不要静默跳过或整批失败。

---

## 4. 代码风格（从现有代码归纳，保持一致）

- **注释密度高、用中文**。每个模块顶部 `//!` 块说明职责与涉及的注册表/系统机制；不明显的 Windows 行为要解释（为什么负索引、为什么加引号、为什么 `taskkill` 非零退出码不算错）。写"为什么"，别写"这行赋值给变量"。
- **unsafe 只出现在 `refresh.rs:26`** 这一处，配 `// SAFETY：` 说明。新增 unsafe 必须同样标注。
- **错误处理**：`anyhow::Result`；底层错误用 `reg_error`（`registry.rs:48`）带上完整键路径；跨边界用 `.context("中文说明")`；批量操作"单项失败不中断 + 末尾汇总"（`icon.rs:204`）。
- **日志双轨**：模块层 `println!` 且带前缀 `[关联]` `[图标]` `[批量]` `[刷新]` `[警告]`；GUI 层用 `self.log()` / `self.log_error()`。别在 UI 线程外调用 UI 状态方法。
- **egui 写法**：主题改动只能走 `apply_theme`（`app.rs:134`），禁止直接 `ctx.set_visuals(Visuals::dark())` 或在控件上硬编码颜色——配色常量在 `app.rs:72-80`，卡片/徽标用 `card`/`pill` 助手（见 DESIGN.md D14）；禁用态不要用 `Color32::gamma_multiply` 调色（会连 alpha 一起乘，浅色下会整块透明），显式颜色的按钮一律走 `primary_button_colors` / `danger_button_colors`（`app.rs:104`、`app.rs:117`）取实色，因为显式 `.fill()/.stroke()` 会屏蔽 egui 的自动变灰；面板声明顺序敏感（底部面板必须先于 `CentralPanel`，`app.rs:1370`）；`ComboBox` 切换要靠比较前后值而非 response（`app.rs:796`）；遍历列表同时改 `selected` 用 `std::mem::take` + 末尾归还（`app.rs:899`、`app.rs:933`）；新增控件记得配 `on_hover_text`，列表行/按钮的交互都走 `association_row`、`mode_radio` 这类现成构件。
- **测试**：`#[cfg(test)] mod tests` 放被测文件底部，只测纯函数（映射表、归一化、配置常量、命名约定不串通道）。依赖本机注册表的用例写成"存在则验证、不存在不失败"（`zed.rs:299`）。

---

## 5. 改动放哪里

| 需求 | 落点 |
|---|---|
| 新增 Zed 通道 / 改命名约定 | `zed.rs:16` 枚举 + 五个属性方法 + `zed.rs:275` 用例 |
| 新注册表操作语义 | `registry.rs` 加函数，别在调用方直接 `CURRENT_USER` |
| 关联枚举规则调整 | `association.rs:42`（源 A/B 合并）与 `zed.rs:95`（归属三规则） |
| 新图标模式 / 改映射表 | `icon.rs:32` 枚举 + `icon.rs:166` 取值 + `app.rs:1011` 附近三个 `mode_radio` 调用（说明文案是它的 hint 参数） |
| 新系统图标映射 | `icon.rs:51` match 分支 + `icon.rs:222` 断言 |
| 新的刷新强度/缓存路径 | `refresh.rs`，并在 `app.rs:714` 决定其是否可选、`draw_operation_panel` 的刷新卡片里加复选框 |
| 界面、交互、消息 | `app.rs`（唯一入口：`update` 的顺序，`app.rs:1357`） |

---

## 6. 验证清单（改完必做）

类型正确 ≠ 功能正确。注册表类改动要真机压一遍：

1. `cargo test` 全绿，`cargo clippy --all-targets` 无新增告警。
2. `cargo build --release` 后跑 exe（debug 用 `cargo run` 看 println 流）。
3. **读回**你改过的键，确认值符合预期格式（路径带引号、索引带负号）：

   ```bash
   reg query "HKCU\Software\Classes\Zed.md\DefaultIcon"
   reg query "HKCU\Software\Classes\.md"
   reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice" /v ProgId
   ```
4. 界面回归四项：通道切换后列表是否重扫、搜索/全选/反选是否只作用于可见项、进度条文案与"正在处理"扩展名是否对得上、空列表引导文案是否出现。
5. 若碰到刷新链路：先测**只勾"清除图标缓存"**的路径；`重启 Explorer` 会杀用户桌面，除非用户同意，不要代跑。
6. 拿一个不存在的扩展名/空目录试 Custom 模式，确认是回退系统图标并打印提示，而不是失败。

---

## 7. 当前已知不一致 —— 先问，别自作主张

| 现象 | 说明 |
|---|---|
| `assets/icon.ico` 不存在，实际是 `icon/md.ico` | `build.rs:26` 只认前者，所以现在 exe 无图标。改成哪种用途取决于意图（exe 图标 vs Custom 模式样例目录），二者互斥，**先确认再动** |
| 目录名 `RsIcon` ≠ 包名 `zed-file-assoc-gui` | 改名要同步 `Cargo.toml`、`build.rs:19-20`、README、窗口标题四处 |
| `main.rs:19` `#![allow(dead_code)]` 已过期 | 删掉会暴露 `refresh_full`、`create_key`、`current_icon` 等未使用项，需逐个决定删除或接线 |
| 仓库已有本地 git（基线 `ecb2240`、界面改版 `8694b72`），无远程 | 逐项提交、别攒大提交；`.gitignore` 只忽略 `/target` 与 `*.log`，提交前 `git status` 确认没有把截图/日志带进去 |

---

## 8. 不要做的事

- 不新增依赖（`egui_extras`、`Win32_System_Threading` 目前闲置，但移除也要问过）。
- 不做超出"只改图标"范围的事：不接管默认程序、不创建 per-extension ProgID 来"解决"共享图标问题、不清理别人的关联。
- 不顺手重构与当前任务无关的模块；不改 `README.md` 里已发布段落的措辞。
- 不把日志改成写文件 / 引 `tracing`，除非用户提。
- 不为了"能测"在测试里调 `delete_key` / `restart_explorer` / 真实写入用户注册表。
