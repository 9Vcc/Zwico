# DESIGN.md — 设计说明与决策记录

对象：`zed-file-assoc-gui`（Zed 文件关联图标管理工具）。
本文记录**为什么这样设计**，不复述 README 的使用步骤。代码位置引用格式：`文件:行号`。

---

## 1. 目标与非目标

**目标**

- 让 Zed 在 Windows 上注册的文件关联不再一律显示通用图标，而是按扩展名区分。
- 全程只改当前用户配置，普通权限双击即用。
- 单个 exe 交付，无安装器、无运行时依赖。

**非目标**

- 不做"改变默认打开程序"（只动图标，不写/改 `UserChoice`）。
- 不做系统级（HKLM）关联管理，不做多用户分发。
- 不做通用关联编辑器：管理范围以"确实由本通道 Zed 打开"的扩展名为限。

---

## 2. 关键约束

| 约束 | 出处 | 后果 |
|---|---|---|
| 只写 `HKCU\Software\Classes` | `registry.rs:23` 统一拼接前缀 | 无需 UAC；换用户/换机器需重设 |
| `UserChoice` 只能读不能写 | Windows 对 `FileExts\*\UserChoice` 有父键 ACL + 签名校验，`association.rs:107` 只用 `open`+`get_string` | 关联归属"以实际生效者为准"，工具不越权改写 |
| ProgID 形态不唯一 | 安装器（`Zed.py`）/「打开方式」(`Applications\ZedG.exe`) / 系统命名（`md_auto_file`） | 枚举必须多源合并，见 §4 D2 |
| egui 内置字体无 CJK 字形 | `app.rs:1412` 读 `C:\Windows\Fonts\msyh.ttc` | 不注入则界面中文全是方块 |
| Explorer 有图标缓存 | `refresh.rs:38` 删 `IconCache.db` + `thumbcache_*.db` | 光写注册表看不到变化，需三档刷新（§4 D9） |

---

## 3. Windows 机制基线（本设计依赖的事实）

图标查找链：`HKCU\Software\Classes\<扩展名>` 默认值 → ProgID → `<ProgID>\DefaultIcon` 默认值。

`DefaultIcon` 取值语法：`<图标文件>[,"<索引>"]`

- `imageres.dll,-102` —— 负数是 PE 资源 ID，正数是 .ico/.exe 内图标序号
- `"C:\path\zed.exe",0` —— 含空格路径必须加引号，`icon.rs:177` 统一加了

删除 `<ProgID>\DefaultIcon` 子键即回到"Explorer 自行猜图标"的状态，这就是"恢复默认"的实现（`icon.rs:113`），因此**恢复默认不需要备份原值**。

---

## 4. 设计决策

### D1 · 注册表访问收口到 `registry.rs`

所有键操作走 `get_default_value` / `set_default_value` / `create_key` / `delete_key` / `key_exists` / `list_subkeys` 六个函数，调用方只传相对 `Software\Classes` 的路径。

- **原因**：路径拼接、"键不存在"判定（`is_not_found`，`registry.rs:32`，按 HRESULT 0x80070002 裸值比较，因 windows-registry 0.2 没提供现成判断）、错误上下文（`reg_error` 带上完整键路径）只需写一次。
- **代价**：需要新语义（如枚举值名、`REG_EXPAND_SZ`）时要先扩展本模块，不能就地调 `windows-registry`。`zed.rs:143`/`association.rs:107` 因为要读 `Software\Classes` 之外的键（卸载表、`FileExts`）绕过了一层，直接用 `CURRENT_USER` —— 这是有意允许的例外。

### D2 · 关联枚举用"双源合并"，ProgID 归属用三规则判定

`association.rs:42`：

- 源 A（`list_effective_associations`，`association.rs:74`）遍历所有扩展名键，解析**实际生效**的 ProgID（`effective_prog_id`：`UserChoice` 优先，扩展名键默认值后备），再用 `Channel::owns_prog_id`（`zed.rs:95`）过滤。
- 源 B（`association.rs:49`）遍历通道自有前缀的 ProgID 键，补上"已注册但尚未成为默认打开方式"的扩展名；按扩展名去重，源 A 优先。

`owns_prog_id` 三规则：① 前缀匹配 `Zed.`/`ZedPreview.`/`ZedNightly.`/`ZedG.` ② `Applications\<exe 名>`（大小写不敏感）③ `<ProgID>\shell\open\command` 默认值包含本通道 exe 名。

- **原因**：规则 ③ 是覆盖 `md_auto_file` 这类系统随机命名 ProgID 的**唯一**手段；只看前缀的话，scoop / 「打开方式」装的 ZedG 会一个都列不出来。
- **替代方案与否决**：只枚举 `ZedG.*` ProgID（对官方安装器够用，便携安装直接空列表）；只读 `FileExts`（拿不到"注册了但没设默认"的扩展名）。
- **已知代价**：规则 ③ 是子串匹配，理论上会把 command 里恰好含 `zed.exe` 的非 Zed ProgID 也纳入；实测风险低，且用户看到的列表项悬停即显示真实 ProgID，可自查。

### D3 · 共享 ProgID 不拆分，只做醒目提示

`Applications\ZedG.exe` 这种 ProgID 被所有"用打开方式关联到 Zed"的扩展名共用，改它的 `DefaultIcon` 会同时改变所有类型的图标。

- **选择**：不自动创建 per-extension ProgID 来隔离（那会改写用户的关联结构，超出"只改图标"的边界）；改为 `FileAssociation.shared_prog_id`（`association.rs:34`）标记，列表里显示橙色"共享"徽标 + 悬停说明（`app.rs:336`）。
- **风险由用户承担并事先知情**，这是有意的取舍。

### D4 · 三种图标模式，自定义缺失一律回退系统图标

`resolve_icon_value`（`icon.rs:166`）：

- `System`：查 `system_icon_for` 映射表（`icon.rs:51`，40+ 扩展名 → 5 个 imageres 资源，未收录兜底 `-102`）。
- `App`：`"<zed.exe>",0`，全类型同一个图标。
- `Custom`：找 `<目录>\<扩展名>.ico`，**文件不存在则回退 `System` 并打印提示**（`icon.rs:187`）；目录未填同样回退（`icon.rs:191`）。

- **原因**：图标是可选装饰，缺一个 .ico 不该让整批操作失败；静默跳过会让用户以为"应用了但没效果"。回退是可感知、可解释的。
- **注意**：`Custom` 只查目录**单层**、只认 `<ext>.ico` 命名，不递归、不支持 `Zed.py.ico` 之类变体。

### D5 · Zed 路径检测四级回退 + 手动兜底

`detect_zed_path`（`zed.rs:127`）顺序：卸载注册表 `DisplayName` → 常见安装目录 → PATH 中的 scoop `.shim`（解析 `path = "..."`，支持 `D:\Scoop` 自定义根，`zed.rs:240`）→ `%USERPROFILE%\scoop\apps\<包>\current[\bin]`。

- **原因**：Zed 官方装、Preview/Nightly 共用目录、scoop 默认根、scoop 自定义根是四类真实场景；只查固定路径会让 `App` 模式在最主流的 scoop 场景下不可用。
- **兜底**：界面始终提供"选择…"按钮手动指定 exe（`app.rs:978`），检测失败不封死功能。
- **细节**：`find_from_common_paths` 会额外试 `%LOCALAPPDATA%\Programs\Zed`，因为多通道安装器可能都落到同一个 `Zed` 目录（`zed.rs:182`）。

### D6 · 后台线程 → GUI 线程单向 mpsc，UI 是唯一状态所有者

`app.rs:36` `GuiMessage`（Log / Progress / AssociationsLoaded / ZedPathFound / Error / Finished），`app.rs:482` 每帧 `try_recv` 排空。

- **原因**：全仓唯一一处线程同步就是这条 channel，无 `Mutex`、无共享可变状态；egui 是即时模式，"事件→改状态→下一帧重画"天然契合。
- **细节取舍**：`Progress` 只带 `(current, total)` 序号，"正在处理：md" 的扩展名标签由 GUI 侧 `progress_extensions` 持有（`app.rs:665`、`app.rs:950`），避免让 worker 携带 UI 语义。
- **代价**：后台无法读 UI 状态，所有输入在 spawn 前克隆快照（`app.rs:667-670`）。

### D7 · `busy` 串行化 + 写完自动重扫

任何任务（加载 / 应用 / 恢复 / 刷新）都会置 `busy`（`app.rs:628`、`app.rs:661`、`app.rs:715`），期间通道下拉框、刷新按钮、应用/恢复按钮全部禁用；写操作置 `pending_reload`，`Finished` 到达后自动 `spawn_load_task`（`app.rs:503`）。

- **原因**：注册表是唯一真源，重扫保证左侧"已设置图标/默认"标签与注册表实际状态一致，而不是靠 UI 猜测更新。
- **代价**：一次批量写入后有两轮注册表遍历，列表大时有可感知延迟（有进度条兜住观感）。

### D8 · 三处确认对话框，退出用 `CancelClose` 拦截

`PendingAction`（`app.rs:53`）三种：`RemoveIcons`（删键，不可撤销）、`RefreshExplorer`（桌面/任务栏短暂消失）、`QuitWhileBusy`（任务未完成退出会留下半套状态）。

`app.rs:1362`：`close_requested() && busy && !allow_close` → 发 `CancelClose` 并弹框；确认后 `allow_close = true` 再次请求关闭。

- **原因**：egui 没有模态阻塞，`busy` 时窗口关闭后后台线程随进程一起死，注册表写入会停在批次中间。用标志位二次放行是在 egui 模型下的最小可行做法。

### D9 · 刷新拆成三档，默认"通知 + 清缓存"，重启 Explorer 需勾选并确认

`spawn_refresh_task`（`app.rs:714`）始终执行 `SHChangeNotify`，清缓存与重启 Explorer 各由复选框控制（默认勾选清缓存 `app.rs:468`、默认不勾重启 `app.rs:469`，入口是右侧「刷新资源管理器」卡片）。

- **原因**：三档强度递增、副作用也递增。`SHChangeNotify` 零风险；删 `thumbcache_*.db` 会被运行中的 Explorer 占用而失败，故 `clear_icon_cache` 采取"跳过占用文件、继续清其余、整体不报错"（`refresh.rs:47` 起的 `try_delete` 分支）；`taskkill /F /IM explorer.exe` 对用户可见，必须显式确认。
- **细节**：`taskkill` 退出码非零（当前无 explorer 进程）不当作错误，只打印说明（`refresh.rs:107`）；重启后 `sleep(2s)` 再拉起（`refresh.rs:112`）。
- `refresh_full`（`refresh.rs:125`）是三档全开的完整流程，目前 UI 未直接调用它，留给命令行/自动化入口。

### D10 · 批量操作失败不中断，末尾汇总成一条错误

`batch_set_icons` / `batch_remove_icons`（`icon.rs:123`、`icon.rs:147`）逐项 try，失败扩展名收进 `failures`，全部处理完再由 `summarize_failures`（`icon.rs:204`）产出"X 项中 Y 项失败（md、rs）"。

- **原因**：一个扩展名权限异常不该让剩下 39 个不做；同时进度条不能因为中途 `?` 提前返回而永远不到 100%。

### D11 · 主题、字体与布局约定

- 主题：所有配色、圆角、间距集中在 `apply_theme`（`app.rs:134`），主题切换只调用它（`app.rs:787`）；强调色取常量 `ACCENT`（`app.rs:72`），不再直接用 `selection.bg_fill`。
- 面板声明顺序是硬约束：底部日志面板必须先于 `CentralPanel` 声明（`app.rs:1370` 注释），否则中央面板吃掉整窗高度。
- 左列表默认宽 `available_width() * 0.35`，可拖拽调宽，范围 240–560px（`app.rs:1385-1388`）。
- `draw_list_panel` 里用 `std::mem::take` 临时取走 `self.selected`（`app.rs:899`、`app.rs:933` 归还），是为了绕开"遍历列表的同时改集合"的借用冲突——egui 闭包嵌套下的常见手法，改动时要记得配对归还。

### D12 · 控制台与日志双轨

`main.rs:15` `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`：release 是纯 GUI 无黑框，debug 保留控制台。因此代码里 `println!` 与界面日志区**并存**，模块用 `println!`（带 `[关联]`/`[图标]`/`[刷新]`/`[批量]` 前缀），GUI 用 `log`/`log_error`。

- **原因**：不引 tracing 依赖、不写日志文件；调试期能同时看到两条流。

### D13 · 体积优先的 release 配置

`Cargo.toml:45`：`opt-level = "s"` + `lto` + `strip` + `codegen-units = 1`。当前产物 `target/release/zed-file-assoc-gui.exe` ≈ 3.9 MB（其中大部分是 eframe/winit/glow）。

### D14 · 界面视觉规范（2026-10 改版）

- **层级**：窗口底 → 面板 → 卡片。深色下四级灰阶（17/21/24/30），浅色下白卡片 + #F4F5F8 底，靠 1px 描边（`card_stroke`）区分，不靠阴影堆叠。
- **统一构件**：所有分组用 `card`（标题 + 14/10 内边距 + 10px 圆角），所有状态提示用 `pill`（16% 透明度底色 + 同色文字），列表行用 `association_row`（整行点击、悬停高亮、选中左侧 3px 强调条 + 自绘勾选框）。
- **危险操作**用描边红按钮（`DANGER` + 透明底）而非实心红，主操作才用实心 `ACCENT`。
- **禁用态必须用实色**。踩过两次同类坑：① `Color32::gamma_multiply` 会连 alpha 一起乘，禁用主按钮在浅色主题下整块透明、像"消失"；② 反过来，凡是显式设了 `.fill()/.stroke()` 的按钮，egui 不会自动变灰，"恢复默认"在忙碌时依旧是鲜红、看着能点。现在这两个按钮的「启用 / 禁用」两套实色分别由 `primary_button_colors`（`app.rs:104`）和 `danger_button_colors`（`app.rs:117`）统一给出，调用点不再自己拼颜色。默认样式的按钮（应用到全部、立即刷新、通道下拉）交给 egui 的 disabled 视觉，不用管。
- **布局容量**：窗口默认 960×720、最小 760×540，底部日志固定 132px；右侧三张卡片在此尺寸下无需滚动即可全部露出（这是把刷新入口从日志区迁到右侧卡片时一起调整的）。
- **取舍**：自定义调色板意味着放弃 egui 默认 `Visuals` 的自动适配，新增控件时要到 `apply_theme` 里检查颜色是否仍成立（深浅两套都要看）。

### D15 · 启动自动选择通道

`pick_initial_channel`（`app.rs:198`）：先找"注册表里已存在该通道 ProgID"的通道，再找"能检测到 exe"的，都没有才回退稳定版；自动切换会写一条日志。

- **原因**：本机实测——只装了 ZedG（scoop），旧行为默认停在 Stable，启动即空列表 + "未检测到"两连击，用户得自己去右上角猜该切哪个通道。
- **代价**：通道不再是"稳定版优先"的确定值；但优先级顺序固定（prog_id 存在 > exe 存在 > Stable），且日志里明说了选了哪个。

---

## 5. 已知限制

| 限制 | 影响 | 位置 |
|---|---|---|
| `assets/icon.ico` 不存在，`build.rs:26` 只在这条路径找图标 | exe 无自定义图标（构建时仅打印 warning，其他资源照常写入） | `build.rs`、仓库实际有 `icon/md.ico` |
| 无配置持久化 | 通道、图标目录、模式每次启动回到默认值（通道至少会自动选到"有东西可管"的那个）；目录靠每次手选 | `App::new`，`app.rs:431` |
| 无撤销 / 无原始值备份 | "恢复默认"即删键，回不到"Zed 装完时的原始 DefaultIcon 值" | `icon.rs:113` |
| 卸载清理缺失 | 删掉 ProgID 键树后图标仍留缓存，需手动刷新 | `registry.rs:96`（`remove_tree` 递归） |
| 系统图标映射表是硬编码 | 新扩展名一律落到通用文本图标 `-102` | `icon.rs:51` |
| 注册表读写与刷新路径无自动化测试 | 只有 `zed.rs`/`icon.rs` 的纯函数用例，改动须真机回归 | 见 AGENTS.md 验证清单 |
| 依赖 Zed 自身关联注册 | Zed 更新覆盖注册表后需重新应用一次 | README 常见问题 |

---

## 6. 待决问题

1. `icon/md.ico` 到底该用作 exe 图标（改成 `assets/icon.ico` 或让 `build.rs` 认 `icon/`），还是仅作 Custom 模式示例目录？两种意图互斥，需要定。
2. 是否需要"每个扩展名独立 ProgID"选项来破解 D3 的共享图标限制（属于改关联结构，超出当前非目标）。
3. `#![allow(dead_code)]`（`main.rs:19`，注释仍写"骨架阶段"）现在模块都被调用了，是否删除以恢复死代码告警。
4. 项目目录名 `RsIcon` 与包名 `zed-file-assoc-gui` 不一致，是否统一（会牵动 `Cargo.toml`、`build.rs` 版本字段、README、窗口标题四处）。
