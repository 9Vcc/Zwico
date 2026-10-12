# DESIGN.md — 设计说明与决策记录

对象：`rsicon-tauri`（Zed 文件关联图标管理工具，Tauri 版）。本文记录**为什么这样设计**。
代码位置引用格式 `文件:行号`——行号会漂移，改动后按 AGENTS.md §6 复核。
背景：本仓库由 egui 版（`E:\1Qoder\RsIcon`）迁移而来，五个纯逻辑模块逐字节复用，决策 D1–D5、D9–D10、D14–D15 沿用并重锚定，D6、D11、D16、D17 为 Tauri 版新增/改写。

---

## 1. 目标与非目标

**目标**

- 让 Zed 在 Windows 上注册的文件关联不再一律显示通用图标，而是按扩展名区分。
- 全程只改当前用户配置（HKCU），普通权限双击即用。
- UI 用 Web 前端（React + CSS 变量），样式调整成本低——这是从 egui 版迁移的直接动因。

**非目标**

- 不做"改变默认打开程序"（只动图标，不写/改 `UserChoice`）。
- 不做系统级（HKLM）关联管理；不做通用关联编辑器（范围限定为"确实由本通道 Zed 打开"的扩展名）。

---

## 2. 关键约束

| 约束 | 出处 | 后果 |
|---|---|---|
| 只写 `HKCU\Software\Classes` | `registry.rs:23` 统一拼接前缀 | 无需 UAC；换用户/换机器需重设 |
| `UserChoice` 只能读不能写 | `association.rs:107` 只用 open+get_string | 归属"以实际生效者为准"，工具不越权改写 |
| ProgID 形态不唯一 | 安装器 / `Applications\` / 系统命名（`md_auto_file`） | 枚举必须多源合并，见 D2 |
| Explorer 有图标缓存 | `refresh.rs:38` 删 `IconCache.db` + `thumbcache_*.db` | 光写注册表看不到变化，需三档刷新（D9） |
| 注册表/耗时操作不能在主线程 | `lib.rs` 命令全部 async + `spawn_blocking` | 同步命令跑在 Tauri 主线程会冻结窗口 |
| 前端系统能力要显式授权 | `capabilities/default.json` | 新增 dialog/clipboard 类调用必须加权限，否则运行时被拒 |
| dist 在编译期嵌入 exe | `tauri.conf.json:10` | 改前端后必须重新 `pnpm tauri build`，dev 模式不受影响 |

---

## 3. 机制基线（本设计依赖的事实）

图标查找链：`HKCU\Software\Classes\<扩展名>` 默认值 → ProgID → `<ProgID>\DefaultIcon` 默认值。
`DefaultIcon` 语法 `<图标文件>[,索引]`：`imageres.dll,-102`（负数=资源 ID）、`"C:\path\zed.exe",0`（含空格必须加引号，`icon.rs:177` 统一处理）。
删除 `<ProgID>\DefaultIcon` 子键即回到"Explorer 自行猜图标"，这就是"恢复默认"的实现（`icon.rs:113`），因此**不需要备份原值**。

Tauri 侧基线：窗口是 WebView2（Win11 自带运行时）；关闭窗口 = 进程退出，任务进行中退出会留下半套注册表状态 → 必须拦截（D8）；前端没有直接注册表访问，一切经 `invoke`。

---

## 4. 设计决策

### D1 · 注册表访问收口到 `registry.rs`

六个函数（`get_default_value`/`set_default_value`/`create_key`/`delete_key`/`key_exists`/`list_subkeys`），调用方只传相对 `Software\Classes` 的路径。路径拼接、"不存在"判定（`is_not_found`，`registry.rs:32`，按 HRESULT 0x80070002 比裸值）、错误上下文（`reg_error` 带完整键路径）只写一次。
**代价**：新语义要先扩 `registry.rs`。`zed.rs:143`（卸载表）与 `association.rs:107`（`FileExts`）是已批准的两处例外，新增例外要记入本文。

### D2 · 关联枚举"双源合并"，ProgID 归属三规则

`association.rs:42`：源 A 遍历扩展名键解析**实际生效** ProgID（`effective_prog_id`：`UserChoice` 优先 → 扩展名键默认值）；源 B 补通道自有前缀的 ProgID 键；按扩展名去重。
归属判定 `owns_prog_id`（`zed.rs:95`）三规则：① 自有前缀 ② `Applications\<exe 名>` ③ `<ProgID>\shell\open\command` 含本通道 exe 名——规则 ③ 是覆盖 `md_auto_file` 这类系统命名的唯一手段，没它就列不出便携安装。
**已知代价**：规则 ③ 是子串匹配，理论上误纳 command 里含 `zed.exe` 的非 Zed ProgID；列表项悬停即显示真实 ProgID，可自查。

### D3 · 共享 ProgID 不拆分，只做醒目提示

`Applications\ZedG.exe` 被所有"用打开方式关联到 Zed"的扩展名共用，改其 `DefaultIcon` 会连带影响全部。
**选择**：不自动创建 per-extension ProgID 隔离（会改写用户关联结构，超出"只改图标"边界）；用 `shared_prog_id`（`association.rs:34`）标记，UI（`App.tsx` 的 `Row`，行 476）显示橙色"共享"徽标 + 悬停说明。

### D4 · 三种图标模式，自定义缺失一律回退系统图标

`resolve_icon_value`（`icon.rs:166`）：`System` 走 `system_icon_for` 映射表（`icon.rs:51`，40+ 扩展名 → 5 个 imageres 资源，兜底 `-102`）；`App` 写 `"<zed.exe>",0`；`Custom` 找 `<目录>\<扩展名>.ico`，**缺失则回退 System 并打印提示**（`icon.rs:187`）。
**原因**：图标是可选装饰，不该因缺一个 .ico 整批失败，也不该静默无反馈。
**注意**：`Custom` 只查单层、只认 `<扩展名>.ico`。

### D5 · Zed 路径检测四级回退 + 手动兜底

`detect_zed_path`（`zed.rs:127`）：卸载注册表 → 常见目录 → PATH 中 scoop `.shim` 解析真实 exe（支持自定义根，`zed.rs:240`）→ `%USERPROFILE%\scoop\apps\<包>\current[\bin]`。
**兜底**：界面"选择…"按钮手动指定（走 `plugin-dialog` 的文件选择，`App.tsx` 的 `pickZed`），检测失败不封死功能。

### D6 · 通信模型：invoke + `progress` 事件（取代 egui 版的 mpsc）

- 一次性调用返回结果：`load_state` 返回 `{ zedPath, associations, log[] }`（`lib.rs:88`）；前端把 `log[]` 追加进日志面板。
- 批量写入逐项 `emit("progress", {current,total,extension})`（`lib.rs:97`；发射点在 `lib.rs:236`/`294`），前端进度条直接消费。
- 后端唯一共享状态是 `busy: Arc<AtomicBool>`（`lib.rs:36`），只服务关窗拦截；**UI 状态全在 React**，无锁、无共享可变数据。
- **代价**：busy 在前端与后端各存一份（前端控制禁用视觉、后端决定拦截关窗），必须同进同出；协议变化要同步 `api.ts` 与 `lib.rs` 两处。

### D7 · busy 串行 + 写完自动重扫

前端 `busy` 状态（`App.tsx:42`）禁用通道下拉/操作按钮/刷新；`apply`/`remove`/`refresh` 在 `finally` 里复位，写操作额外 `load(channel)` 重扫（`App.tsx:155`/`189`），保证"已设置/默认"徽标与注册表真实一致，而不是靠前端猜。

### D8 · 三处确认 + 关窗拦截

`DIALOG_TEXT`（`App.tsx:765`）三案：`remove`（删键，不可撤销）、`refresh`（桌面/任务栏短暂消失）、`quit`（任务未完成退出会留下半套状态）。
关窗：`lib.rs:376` 的 `on_window_event(CloseRequested)` —— `busy` 为真则 `api.prevent_close()` + `emit("close-requested")`，前端弹确认框；确认后 `confirm_quit`（`lib.rs:370`）清标志并 `window.destroy()`（destroy 不再触发 `CloseRequested`，不会二次拦截）。

### D9 · 刷新拆三档，默认"通知 + 清缓存"，重启 Explorer 需勾选并确认

`refresh_explorer`（`lib.rs:333`）始终 `SHChangeNotify`；清缓存与重启 Explorer 由 `RefreshCard`（`App.tsx:679`）复选框控制（默认勾清缓存、不勾重启）。清缓存对占用文件"跳过继续"（`refresh.rs:47` 起）；`taskkill` 非零退出码不算错误（`refresh.rs:107`）；重启后 `sleep(2s)` 再拉起（`refresh.rs:112`）。

### D10 · 批量操作失败不中断，末尾汇总成一条错误

`batch_set_icons`/`batch_remove_icons`（`icon.rs:123`/`147`）逐项 try，失败收进 `failures`，全部处理完由 `summarize_failures`（`icon.rs:204`）产出"X 项中 Y 项失败（md、rs）"。原因：单点权限异常不该中断整批，进度条也不会因中途 `?` 提前返回而到不了 100%。

### D11 · 前端布局与样式约定

- 布局：`.app` 三行 grid = 顶栏 / 主区（35% 侧栏 + 内容）/ 132px 日志（`styles.css:84`）。
- 主题：两套 CSS 变量（`styles.css:2` 深色、`:26` 浅色），组件样式只引用变量，不写死颜色。
- 组件分层：`App.tsx:30` 集中状态与流程；`Row`/`Card`/三张卡片/`LogPanel`/`ConfirmDialog` 为纯展示（props 进、回调出）。
- 后端 DTO 一律 camelCase（`#[serde(rename_all)]`），前端 `api.ts` 类型与之一一对应。
- 悬停说明用 `title` 属性（对齐旧版"所有可交互控件有悬停说明"）。

### D12 · 控制台与日志双轨

`main.rs` release 隐藏控制台（`windows_subsystem`）；五个逻辑模块保留 `println!`（debug 可见，带 `[关联]`/`[图标]`/`[批量]`/`[刷新]` 前缀）；**用户可见日志走命令返回值或事件**，由前端日志面板渲染（错误标红）。

### D13 · 体积与运行时的取舍

`Cargo.toml` release 仍体积优先（`opt-level="s"` + lto + strip + codegen-units=1）；Tauri 版多出 WebView2 运行时依赖（Win11 自带）与前端资源，体积/内存高于 egui 版——换取样式生产力，这是有意交换。

### D14 · 视觉规范（egui 版定的，Tauri 版原样沿用）

- **层级**：深色四级灰阶——窗口底 `17/18/21` → 顶栏/日志 `21/22/26` → 侧栏 `24/25/29` → 卡片 `30/32/37`（`styles.css:2` 起）；浅色为白卡片 + `#F4F5F8` 底，靠 1px 描边区分。
- **统一构件**：卡片 `.card`（`styles.css:441`）、徽标 `.pill`、列表行 `.row`（整行点击、悬停高亮、选中左侧 3px 强调条，`styles.css:306`/`328`）、主按钮 `.btn--primary`、危险描边 `.btn--danger`。
- **禁用态必须实色**。踩过两次同类坑：① `gamma_multiply` 会连 alpha 一起乘（主按钮在浅色下整块透明）；② 显式设色的按钮不会被自动变灰（"恢复默认"忙碌时仍鲜红、看着能点）。Tauri 版对应 `.btn--primary:disabled`（`styles.css:176`）与 `.btn--danger:disabled`（`:191`）给实色灰。
- **布局容量**：窗口 960×720、最小 760×540（`tauri.conf.json:16`），底部日志 132px；右侧三张卡片该尺寸下免滚动。

### D15 · 启动自动选择通道

`initial_channel`（`lib.rs:142`）：先找"注册表里已有该通道 ProgID"的通道，再找"检测到 exe"的，否则回退 stable；自动切换写一条日志。
**原因**：本机只装 ZedG（scoop），停在 Stable 会空列表 + "未检测到"两连击。

### D16 · 主题持久化（localStorage）

`App.tsx:28`：主题存 `localStorage`，跨启动记住。
**代价**：WebView 数据目录里多一条记录，清缓存会重置；旧 egui 版没有这个行为，属迁移时顺手加的。

### D17 · 迁移到 Tauri 的取舍（为什么这个仓库存在）

- **动因**：egui 的样式生产力受限——真软阴影、字重、过渡动画都要手搓；"UI 更好调整"是明确的迁移理由。
- **做法**：`registry`/`zed`/`association`/`icon`/`refresh` 五个纯逻辑模块**零改动复用**（逐字节复制），只重写 UI 层；旧 egui 仓库保留为可运行的参考实现，其文档也保留原样（用户 2026-10-12 确认）。
- **代价**：exe 体积/内存上升；依赖 WebView2 运行时；前后端协议成为新维护面（`api.ts` ↔ `lib.rs` 要同步）。
- **被否决的备选**：留在 egui（样式上限低）；GPUI（2026 年仍无稳定 API/文档，迁移面不比 Tauri 小）。

---

## 5. 已知限制

| 限制 | 影响 | 位置 |
|---|---|---|
| `bundle.active = false` | 只产出 exe，不出 msi/nsis 安装包 | `tauri.conf.json:29` |
| exe 图标为占位 | `app-icon.png`（1024 源图）可替换后 `pnpm tauri icon app-icon.png` 重生成 | README |
| 侧栏宽度固定 35% | 旧 egui 版可拖拽（240–560px），本版未实现 | `styles.css:282` |
| 日志面板"复制/清空"未经人工点验 | 自动化合成点击在该区域打不中；剪贴板链路已用启动探针证明可用 | `App.tsx:723` |
| 忙碌态未经真机实测 | 进度条/全禁用/关窗确认需一次真实写入才能触发 | 需用户操作一次 |
| 双仓库逻辑同步 | `src-tauri` 的五个模块是复制品，改一边要手动同步另一边 | 见 §6 待决 2 |
| 除主题外无配置持久化 | 通道自动选、目录/模式每次回默认 | `App.tsx:30` |

---

## 6. 待决问题

1. `icon/md.ico` 的用途（旧仓库遗留：exe 图标 vs Custom 样例目录）——Tauri 版已有自己的占位图标，问题只剩"要不要把旧样例目录迁过来"。
2. **旧仓库（`E:\1Qoder\RsIcon`，egui 版）的去留**：目前保留为参考实现；五个逻辑模块的"单一来源"要不要改为在新仓库维护、旧仓库只读——未定。
3. `lib.rs:16` `#![allow(dead_code)]`：`create_key`/`refresh_full` 等仍未接线，删属性会暴露告警，需逐个决定。
4. 命名统一：`productName = zed-file-assoc-gui`（`tauri.conf.json:3`）≠ 目录名 `RsIcon-tauri` ≠ cargo 包名 `rsicon-tauri` ≠ 窗口标题，要一次定。
