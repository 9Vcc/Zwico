# CODE_REVIEW.md — 代码审查与优化建议

对象：`rsicon-tauri`（Tauri 2 + React 19 + TS，Windows 专用）  
审查日期：2026-10-12  
范围：`src/`（前端 1579 行）、`src-tauri/src/`（后端 1374 行）、配置与三件套文档  
本机实测探针：Windows 11 · `HKCU\Software\Classes` 1113 个子键（439 个扩展名键）· `FileExts` 397 个子键（162 个含 `UserChoice`）

---

## 0. 结论速览

| 维度   | 评价         | 依据                                                           |
| ---- | ---------- | ------------------------------------------------------------ |
| 结构   | 良好         | 分层单向、依赖无环、注册表访问收口、五模块边界清楚；扣分在"前端单文件 813 行"与"双仓库逐字节复制"        |
| 性能   | 良好，**无瓶颈** | 实测枚举 439 个扩展名约 **10 ms**；真实风险是两处"主线程同步命令"，不是算法               |
| 可维护性 | 中等偏上       | 文档三件套水准远超同类项目；扣分在协议三处手写、无 CI/lint/前端测试、`allow(dead_code)` 掩盖 |
| 正确性  | 有 3 处实锤缺陷  | busy 标志泄漏、release 下"回退说明"丢失、选中计数不一致；另有 4 处稳健性缺口              |

**最该先做的三件事**

1. `busy` 标志用 RAII 复位 —— 现在一次后台任务 panic 就会**永久卡死关窗逻辑**。
2. `initial_channel` / `scan_ico_count` 改 async + `spawn_blocking` —— 它们正违反项目自己在 AGENTS §3.4 定的硬约束。
3. 把"自定义图标缺失回退""单项失败明细"从 `println!` 改走命令返回值 —— release 下控制台被隐藏，这些信息当前**用户完全看不见**，直接违反 DESIGN D4「缺失则回退并说明」。

**最值得做的新功能**：列表内图标来源显示 +「图标失效」检测。用户改完图标必须切到资源管理器自己找文件看效果，这是整条体验链上最大的断点。

---

## 0.2 第二轮改进（2026-10-12 晚）

按用户要求落地的 7 项界面与功能改进：

| # | 需求 | 状态 | 落地与说明 |
|---|---|---|---|
| 1 | 确认并补全「自动扫描并选择 Zed 安装目录」 | ✅ | 原本**已有** `detect_zed_path`（四级回退，但只限当前通道）。本轮补：跨通道全量扫描 `zed::scan_installations`（卸载注册表 → 常见目录 → scoop shim/apps → PATH）、新命令 `scan_zed_installations`、界面「自动检测」按钮 + 候选列表（含通道与来源）；`bootstrap` 探测失败时自动选用第一个候选 |
| 2 | 图标预览改为在扩展名**前面**直接显示 | ✅ | 新增 `iconrender.rs`：`SHDefExtractIconW` → `GetIconInfo` → `GetDIBits` → 面积平均缩放 → 自写 PNG 编码（zlib stored block）。行内显示 16×16 真实图标；任一环节失败降级为虚线占位。实测 4 种来源（系统资源 ID / DLL 索引 / EXE）均产出有效 PNG |
| 3 | 改为自定义标题栏 | ✅ | `decorations: false` + `TitleBar.tsx`（拖拽区、双击最大化、最小化/最大化/关闭）。关闭走 `close()` 以保留关窗拦截；边缘缩放依赖 tao 保留的 `WS_SIZEBOX`（查源码确认，**不需要**自绘热区或新增 `tauri-runtime` 依赖） |
| 4 | 操作卡片尺寸偏大 | ✅ | 卡片 padding/gap、按钮、单选项、字段间距全面收紧；内容区 gap 12→10、padding 14→12；卡片在宽窗口自动两列布局不变 |
| 5 | 操作日志区域支持拉动调整 | ✅ | 新增横向拖拽条（折叠时自动隐藏），高度写入配置持久化 |
| 6 | 拉动需有边界限制 | ✅ | 新增 `lib/layout.ts`：侧栏 200–420px 且保证内容区 ≥380px；日志 72–420px 且保证主区 ≥260px；窗口 `resize` 时重新夹紧（值未变则不触发更新） |
| 7 | 新增 SVG 转 ICO | ✅ | `lib/ico.ts`（Canvas 光栅化 + ICO 的 PNG 内嵌打包）+ `useSvgIco` + `SvgToIcoDialog`。**零新增依赖**；后端只提供受限的 `.svg` / `.ico` 读写命令（≤4 MiB） |

**测试**：26 → 28。新增覆盖：ICO 容器跨端可读性（系统 API 读回前端结构）、PNG/zlib/base64 结构、面积平均缩放、图标路径解析、渲染探针、扫描去重、可执行文件启发式。

**仍未验证**：本轮所有界面改动（标题栏拖拽、图标预览观感、SVG 工具全流程）依旧未做真机点验 —— 环境无法运行浏览器渲染。真机清单见 AGENTS §6.5。

---

## 0.3 第三轮：界面样式与布局优化（2026-10-12 晚）

| # | 需求 | 落地 |
|---|---|---|
| 1 | tooltip 与下拉列表样式与界面统一 | 原生 `title`（系统绘制的浅色提示）全量替换为自绘 `data-tip` + `TooltipLayer`（字符串形式 29 处、表达式形式 15 处）；原生 `<select>` 替换为 `Select` 组件（原生选项弹层是系统白底，无法改样式）。两者都用 fixed 浮层 + 统一变量配色 |
| 2 | 扩展名右侧的点击行为改为悬浮放大预览 | 行内图标按 32px 请求、CSS 缩显为 16（一次请求兼顾两种用途）；**悬停图标即放大到 32px** 并附扩展名与来源；右侧按钮改为 `+` 图标并明确标注「为该扩展名单独指定 .ico 图标」，消除「点开是文件对话框」与「预览」的语义错位 |
| 3 | 操作卡片尺寸适配内容 | 三次迭代：① 加 `align-items: start`（解决卡片被拉伸）→ ② 改 CSS 多列（截图反馈仍留空洞）→ ③ **最终改为显式两列容器**：多列方案在最小窗口下会把卡片压成一条竖线（列宽不可控），且固定高度会横向新增列。现方案宽屏并列、窄屏自动堆叠，顺序不变 |
| 5 | 刷新开关与主按钮的层级 | 「立即刷新」升级为主按钮；开关组加左侧竖线 + 「刷新选项」小标题表达从属；开关选中态由实心强调色改为浅底 + 彩色滑块（原先两个开关比主按钮还抢眼） |
| 4 | SVG 入口醒目 + 撤销移入操作卡 | `ActionsCard` 重排为四层：应用到选中 → 应用到全部/恢复默认 → 撤销上次操作 → SVG 转 ICO。撤销由独立卡合并进来（同为操作语义，且原卡片内容偏少）；工具入口用 `.btn--tool`（强调色描边 + 浅底）并配完整文案「SVG 转 ICO 生成图标」；`IconSettingsCard` 中的临时入口移除 |

**附带清理**：`ui.tsx` 删除不再使用的图标；`styles.css` 移除原生 `select` 样式与 `.select--compact`。

**验证**：`pnpm build` 通过、CSS 括号平衡、类名与变量交叉校验无缺失、后端 28 个测试仍全绿。

---

## 0.4 第四轮：设置页与右键菜单（2026-10-12 晚）

先说明现状：**右键菜单原先只有 1 处** —— 日志行（右键即复制该条）。其余区域右键会弹出 WebView 的默认菜单，含「重新加载 / 另存为 / 打印 / 检查」等浏览器项。

| 项 | 处理 |
|---|---|
| 右键菜单缺口 | 新增统一 `ContextMenu` 组件；**全局拦截 `contextmenu`**（输入框除外）；列表行 6 项菜单（选中/取消选中、指定专属图标、清除专属图标、复制 ProgID、复制当前图标值）；日志行改为「复制本条 / 复制全部 / 清空日志」 |
| 设置页 | 新增应用内设置视图（标题栏齿轮切换，`store.view`），6 个分组：外观与布局 / Zed 安装 / 刷新行为 / 配置与数据 / 快捷键 / 关于 |
| 功能迁移 | 4 组低频配置迁入设置页：Zed 安装（路径+检测+扫描）、刷新行为开关、预设导入导出（`PresetCard` 组件删除）、外观与布局 |
| 迁移后的可用性保障 | 主界面保留两处"尾巴"：Zed 路径的一行只读状态 + 「管理」跳转；刷新按钮下方的「附加动作」摘要 + 「调整」链接 —— 避免选项消失导致用户困惑 |

**结果**：主界面卡片 4 → 3 张（图标设置 / 操作 / 刷新与修复），高频操作更集中，低频配置不再占用主视觉。

---

## 0.5 第五轮：修复窄窗口布局塌陷（2026-10-12 晚）

| 问题 | 根因 | 修复 |
|---|---|---|
| 窗口拉到最小时首页卡片被挤没 | `@media (max-width:900px)` 里把侧栏拖拽条设为 `display:none`，**被移出文档流的元素不再参与 Grid 自动放置** → `.content-area` 落进第二列（拖拽条那列，宽度 0） | `.sidebar` / `.resizer--v` / `.content-area` 全部显式声明 `grid-column` |
| 同类隐患：面板尺寸沿用过大的持久化值 | `loadConfig()` 直接采用存储值，未按当前窗口夹紧 → 日志 420px 在小窗口下把主区压到 93px | 读取时立即 clamp；`clampLogHeight` 公式补上标题栏高度；新增首帧兜底 effect |
| 防御性加固 | — | `.app` 第二行 `minmax(180px, 1fr)` 保底主区；`.logpanel { max-height: 62vh }`；设置页「关于」显示当前窗口与面板尺寸，便于日后排查 |

**教训**：Grid/Flex 里凡有"子项可能被 `display:none` 移出流"的情况，自动放置就不可靠 —— 必须显式定位。另外，任何"持久化的尺寸值"在读取时都要按当前视口重新夹紧。

---

## 0.6 第六轮：国际化与图标修正（2026-10-12 晚）

| 项 | 处理 |
|---|---|
| 设置图标画成了太阳 | 改为真正的齿轮：外圆 + 8 条短齿 + 中心孔（此前是"中心圆 + 长辐射线"） |
| 中英适配 | 新增 `lib/i18n.ts`（353 条中英字典、`t()`、`detectLang()`、`tEncoded()`）；全部组件文案 key 化（11 个文件） |
| 语言设置 | 设置页新增「语言」项：跟随系统 / 简体中文 / English；**首次启动按系统语言自动选择** |
| 后端日志混中文 | `LogLineDto` 改为 `{ key, params, level }`，lib.rs 约 40 处日志点 + 子模块错误（icon/registry/refresh）全部改为 key；新增 `text.rs` 统一编码 |
| 校验手段 | 新增 `target/ui-check/check-i18n.py`：比对代码引用的 key 与字典条目（280 引用全部命中、中英 353 条一致） |

**设计取舍**：后端不做翻译，只返回 key —— 翻译集中在前端一处，避免两套字典漂移；错误文本用 `key\u{1}参数` 编码，既保留了参数信息又不引入协议复杂度。

---

## 0.7 第七轮：扩展名关联配置（2026-10-12 晚）

需求：设置页可预置常用扩展名并一键建立关联，也支持手动添加自定义扩展名，免去逐个设置。

| 项 | 处理 |
|---|---|
| 边界 | 这是本项目**唯一会改变打开方式**的功能，单独立为 DESIGN D35：必须用户显式触发 + 确认对话框；只写 `HKCU\Software\Classes`；不碰 `UserChoice`；已指向其他程序的一律跳过不覆盖 |
| 后端 | 新增 `register.rs`（归一化 / 合法性校验 / ProgID 拼接 / 注册）+ 命令 `register_extensions`（批量、逐项进度、分类汇报 Created / AlreadyZed / TakenByOther / 失败） |
| 前端 | 设置页「关联扩展名」卡片：4 组预置（代码 20 / 配置 8 / 文档 6 / Web 7）+ 自定义输入（逗号空格分隔、非法项提示）+ 一键注册（前置确认） |
| 关注列表 | `watched` 存配置：勾选只影响界面（主界面新增「关注」筛选与星标），只有点"建立关联"才写注册表 |
| 测试 | 只覆盖纯函数（归一化、合法性、ProgID 拼接），**不触碰注册表**（AGENTS 硬约束） |

**验证**：cargo 31 测试全绿、clippy 0 告警、i18n 383 条中英一致且 300 个引用全命中、`pnpm build` 通过。

---

## 0.8 第八轮：关联状态诊断（2026-10-12 晚）

反馈："还无法做到关联及设置 Zed 为默认打开方式"。

| 项 | 结论 |
|---|---|
| 根因 | Windows 优先用 `FileExts\<ext>\UserChoice`（系统「默认应用」的选择，带 Hash 保护），本工具写的 `Classes\<ext>` 关联**在其存在时不生效**；列表也不会收录该扩展名，因为枚举以"实际生效 ProgID"为准 |
| 诊断 | 新增 `inspect_extension`（报告实际生效者 / 是否本通道 / UserChoice 是否挡路）+ 命令 `inspect_extensions`；`FileAssociation` 增加 `progId_source`，列表悬停可见生效来源 |
| 界面 | 设置页关注项按状态着色（绿=已生效 / 黄=被覆盖）+ 状态统计 + 说明段；新增「打开 Windows 默认应用设置」按钮 |
| 未做 | 直接改写 `UserChoice`（需 Hash 算法 + 未文档化 API，风险高且无法在此环境验证）—— 已记录在 DESIGN D36，留待用户决策 |

**验证**：31 测试全绿、clippy 0 告警、i18n 399 条中英一致且 311 引用全命中、`pnpm build` 通过。

---

## 0.10 第十轮：应用注册（2026-10-12 晚）

需求：ZedG（Scoop 安装）不出现在系统「默认应用」与右键「打开方式」，做成工具功能补齐。

| 项 | 处理 |
|---|---|
| 根因 | Scoop 安装不写关联注册表（实测验证注册表零痕迹）；官方安装器自带 |
| 后端 | `register.rs` 新增 `register_application` / `unregister_application` / `application_registration_status`；写四层候选注册（RegisteredApplications + Capabilities + ProgID + OpenWithProgids/Applications）；移除时全部清理且不影响其他程序 |
| 通道限制 | 仅 zedg 通道：前端条件渲染 + 后端 `Channel::Zedg` 校验双保险 |
| 边界 | 候选注册，不写 UserChoice、不改扩展名默认值 —— D35 边界内 |
| 前端 | 设置页新增「应用注册」卡片（仅 zedg 渲染），覆盖范围 = 关注列表，状态徽标自动刷新 |
| 依赖 | registry.rs 新增 HKCU 根相对的通用值操作函数 |

**验证**：31 测试全绿、clippy 0 告警、i18n 417 条中英一致且 327 引用全命中、`pnpm build` 通过。

---

## 1. 结构评估

### 1.1 做得好的部分

- **依赖单向无环**：`App.tsx → api.ts → lib.rs → {association, icon, zed} → registry`，`refresh.rs` 独立。没有"前端直连注册表"的越界。
- **注册表访问收口到 `registry.rs`**，路径拼接与错误上下文只写一遍，两处例外（`zed.rs:143` 卸载表、`association.rs:107` `FileExts`）在文档里显式登记。
- **DTO 一律 camelCase**，前端 `api.ts` 与 `lib.rs` 逐字段对应，没有命名风格撕裂。
- **五模块与 UI 解耦彻底**，这是本次迁移能"零改动复用"的前提，值得继续保持。
- 文档三件套分工清楚（DESIGN 记为什么 / PROJECT_MAP 记在哪 / AGENTS 记怎么干）。**这是本项目最大的非代码资产。**

### 1.2 结构性问题

| #  | 问题                                                                 | 影响                                                                                          | 建议                                                                                                                                                   |
| -- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | 五个逻辑模块与旧 egui 仓库逐字节复制                                              | 改一边必须手改另一边，两仓库必然漂移；DESIGN §6 待决 2 一直悬着                                                      | 抽 `crates/rsicon-core`（cargo workspace），两套前端各自依赖同一份源码。这是消除该债务的唯一彻底解                                                                                  |
| S2 | 前后端协议三处手写：`api.ts` 类型 / `lib.rs` DTO / 命令名                         | 加字段漏改一处 → TS 编译期查不出，运行时才炸                                                                   | 低成本：加 `scripts/check-protocol.mjs`，从 `api.ts` 提取命令名与字段名，比对 `lib.rs` 的 `generate_handler!` 与 DTO 字段，挂进 `pnpm build`。高成本：`tauri-specta` 生成绑定（需新增依赖，先问） |
| S3 | 通道信息两处定义：`zed.rs:27-86` 的 4 个属性方法 + `api.ts:14` 的 `CHANNELS` label | 新增通道要改 6 处（枚举、4 个方法、`channel_key`/`channel_from_key`、`api.ts`）                              | 前端 label 由后端提供（新增 `list_channels()` 命令），或把通道属性表抽成数据表                                                                                                 |
| S4 | `App.tsx` 813 行 = 20 个 `useState` + 6 个内联组件                        | 再加 2–3 个功能就难维护；状态改动要通读全文                                                                    | 拆 `src/hooks/`（`busy`/`progress`/`dialog`/`log` 用 `useReducer` 收敛）+ `src/components/*.tsx`；CSS 保持单文件（这是刻意选择）                                         |
| S5 | `lib.rs:16` `#![allow(dead_code)]`                                 | 掩盖 `create_key`（无调用方）、`refresh_full`（与 `refresh_explorer` 语义重复）、`current_icon`（前端定义了没用）是否该留 | 删 `create_key`；`refresh_full` 删或改造成接收 flags；`current_icon` 转正为 UI 展示（见 F1）；然后删掉该属性                                                                   |
| S6 | 无 lint / format / CI / 前端测试                                        | 全靠人肉执行 AGENTS §6 验证清单                                                                       | 加 `rustfmt.toml` + 一个前端 linter（ESLint 或 biome，后者单依赖）+ GitHub Actions（windows-latest：`cargo test` / `clippy` / `pnpm build`）                          |

---

## 2. 性能评估（含实测）

### 2.1 实测数据（只读探针，本机）

| 指标                                               | 实测值                   | 结论                                 |
| ------------------------------------------------ | --------------------- | ---------------------------------- |
| `HKCU\Software\Classes` 子键总数                     | 1113（其中 439 个点开头扩展名键） | 枚举规模不大                             |
| 全量 `EnumKey` 一次                                  | 2.8 ms                | 可忽略                                |
| 现状模拟：439 个扩展名逐个解析 ProgID（UserChoice→Classes 默认值） | **10 ms**，解析出 211 个   | **不是瓶颈**                           |
| `FileExts` 子键数 / 含 `UserChoice` 的数量              | 397 / 162             | UserChoice 探测多数走"键不存在"失败路径，但失败同样很快 |

**结论：不要为枚举性能做复杂优化。** 缓存索引化的收益 < 1 ms，却会引入"缓存与注册表不一致"的新风险（本项目最忌讳的正是状态不同步）。真正值得改的是启动路径与主线程阻塞：

| #  | 问题                                                                                                                         | 证据                                                              | 修法                                                             |
| -- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| P1 | `initial_channel` 是**同步** command，在 Tauri 主线程执行 `list_subkeys("")` + 最多 4 次 `detect_zed_path`（含卸载表遍历、PATH 扫描并读 `.shim` 文件） | `lib.rs:141`（无 `async`、无 `spawn_blocking`）；与 AGENTS §3.4 自定约束冲突 | 改 `async` + `spawn_blocking`；或与 `load_state` 合并为 `bootstrap()` |
| P2 | `scan_ico_count` 同为同步 command，`read_dir` 跑在主线程                                                                             | `lib.rs:168`                                                    | 同上。网络盘或大目录下会明显冻结 UI                                            |
| P3 | 启动两跳 IPC：`initial_channel` → `load_state`，且 `load_state` 内部又全量枚举一次                                                         | `App.tsx:105-110`                                               | 合并为一次 `bootstrap()`，首帧少一次往返                                    |
| P4 | `list_associations` 内部调了**两次** `list_subkeys("")`（源 A 一次、源 B 一次）                                                           | `association.rs:44` 与 `association.rs:49`                       | 枚举一次传参，省掉 1113 次字符串分配（约 3 ms）                                  |
| P5 | 每次写入后 `load(channel)` 全量重扫                                                                                                 | `App.tsx:185` / `App.tsx:205`                                   | **保留**。正确性优先于 10 ms，这是好设计                                      |

### 2.2 前端

- 产物体积：`dist/assets/index.js` 232 KB（未 gzip）、CSS 7.9 KB。桌面内嵌场景可接受。
- 439 项列表不虚拟化也没有压力（>1000 项再考虑）。
- 无内存泄漏点：事件订阅在 `useEffect` 里正确返回了取消函数（`App.tsx:68-73`）。
- 无长任务：重扫 10 ms 级，不会掉帧。

---

## 3. 正确性缺陷清单

### P0-1 · `busy` 标志会泄漏（4 个命令同型）

```rust
// lib.rs:261-289（apply_icons；remove_icons / refresh_explorer / load_state 同型）
let result = spawn_blocking(...).await.map_err(...)?;  // ← 这里提前返回
busy.store(false, Ordering::SeqCst);                   // ← 永远执行不到
```

`spawn_blocking` 的 join 在任务 panic 时返回 `Err`，`?` 直接跳出函数，`busy` 永久为 `true` → 此后每次点 × 都被 `lib.rs:396` 的 `prevent_close` 拦下，只能靠前端 quit 对话框自救；若前端状态也丢了就彻底关不掉窗口。

**修法（RAII）**

```rust
struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
}
// 命令内：let _guard = BusyGuard(busy.clone()); 之后无论 ? 还是 panic 都会复位
```

**顺带**：`load_state` 是只读命令，不该置 busy —— 它既让启动期间关窗被拦截，也把"读"错当成"任务进行中"。建议 busy 只由写操作与刷新持有，前端的禁用视觉再单独判断。

### P0-2 · release 下"回退说明"完全不可见（违反自家 D4）

- `icon.rs:186-192`：自定义图标不存在 → 回退系统图标，只 `println!`
- `icon.rs:135` / `icon.rs:156`：单项失败只 `println!` 并把扩展名收进 `failures`
- `main.rs:5`：release 隐藏控制台

于是最终用户看到的只有"应用图标完成"。DESIGN D4 明写「缺失则**回退并说明**」——实现只回退、没说明。

**修法**：给批量接口加结构化回报，例如

```rust
pub struct BatchReport { pub total: usize, pub fell_back: Vec<String>, pub failed: Vec<String> }
pub fn batch_set_icons(...) -> Result<BatchReport>
```

`lib.rs` 把 `fell_back` / `failed` 转成 `LogLineDto`（`error=true` 标红）返回或经 `progress` 事件推送；`println!` 降级为 debug 用途。

**同时**：`lib.rs:274` / `lib.rs:312` 的 `let _ = window.emit(...)` 静默吞掉发送失败，至少 `eprintln!` 一行。

### P0-3 · 选中计数与实际不符

`App.tsx:401` 用 `selected.size` 渲染"已选 N"，但 `selectedTargets()`（`App.tsx:146`）是用 `associations` 过滤的。切换通道会清空 selected（`App.tsx:129`），但**重扫**（`App.tsx:185` / `205`）之后若某扩展名从注册表消失，`selected` 里就留了幽灵项 → 界面显示"已选 1 / 共 0"。

**修法**：重扫成功后清掉失效项

```ts
setSelected(prev => new Set([...prev].filter(e => next.some(a => a.extension === e))));
```

或把计数改成 `selectedTargets().length`（更省事，但两处数据仍有短暂不一致）。

### P1 级稳健性缺口

| #  | 问题                                        | 证据                                                                                                                | 修法                                                                                                                      |
| -- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R1 | 前端搜索大小写敏感                                 | `App.tsx:136`：`needle` 已 `toLowerCase()`，`a.extension` 没有                                                         | 两侧都小写化。本机 439 个扩展名键恰好全小写，但实测 `FileExts` 里存在 `.WPL` `.MP2` `.MPE` `.TS` `.TTS` 这类大小写混用键 → Windows 不保证键名小写，属"现在不炸、换台机器就炸" |
| R2 | 后端前缀匹配大小写敏感，且规则间自相矛盾                      | `association.rs:50` `strip_prefix`、`zed.rs:97` `starts_with` 区分大小写，而 `zed.rs:102` 的规则 2 用了 `eq_ignore_ascii_case` | 注册表键名本身大小写不敏感，统一比较小写形式                                                                                                  |
| R3 | 写入前未校验 ProgID 仍存在                         | `registry.rs:74` 用 `create`（会连带创建中间层级）                                                                            | 写前 `key_exists("<ProgID>\\shell\\open\\command")`，不存在则跳过并记警告 —— 符合"只改图标、不改结构"的边界                                        |
| R4 | `progress` 的 `extension` 是"刚完成项"而非"正在处理项" | `lib.rs:270` 取 `targets[current - 1]`，而 `current` 是处理完之后的计数（`icon.rs:138`）                                        | 回调签名改为 `cb(index, total, ext)`，或 UI 文案改成"已完成：xxx"（改文案更省事）                                                               |
| R5 | `busy` 前后端各存一份                            | DESIGN D6 自己列为代价                                                                                                  | 保留这套设计，但按 P0-1 把后端 busy 收窄到写操作，减少不一致窗口                                                                                  |

---

## 4. 可维护性改进

1. **测试覆盖偏薄**：现有 4 个用例全是纯函数型（`zed.rs` 2 个 + `icon.rs` 2 个），其中 `scoop_shim_resolution` 还是"存在则验证"的尽力而为。  
   **最该补的是 `owns_prog_id` 三规则（`zed.rs:95`）与 `effective_prog_id` 优先级（`association.rs:104`）** —— 它们是"列错/列漏关联"的唯一判据，却零测试；`resolve_icon_value` 的 Custom 回退分支（`icon.rs:180-194`）同理。  
   做法：把注册表读取抽成参数（`&dyn Fn(&str) -> Option<String>` 或一个 trait），测试即可注入假数据，纯逻辑可直接断言。
2. **文档行号会持续漂移**：三件套用 `文件:NNN` 引用，而 AGENTS §6.3 要求每次改动人肉复核。行号引用随代码增长必然失效，建议改为「文件 + 符号名」，只在必要处保留行号。
3. **版本号四处手动同步**：`api.ts:10`、`package.json`、`Cargo.toml`、`tauri.conf.json`。建议 UI 显示改为读 Tauri 的 `getVersion()`，删掉硬编码。
4. **`Channel::key_owned`** 定义在 `lib.rs:160`（给别的模块的类型加专门 impl），且同一函数里两种取 key 写法混用（`channel_key()` 与 `.key_owned()`）。建议把 key 映射移回 `zed.rs`，与枚举同处。

---

## 5. 功能建议（结合项目定位）

定位回顾：Windows、只写 HKCU、只改图标、不做通用关联编辑器。以下建议均在此边界内（除 F9 标注为需产品决策）。

### F1 · 列表内图标预览与来源显示 —— P0

- **轻量版（零新增依赖，建议先做）**：把已经传了但前端完全没用上的 `currentIcon` 字段（`api.ts:46` / `lib.rs:70`）语义化展示：
  - `imageres.dll,-102` → 「系统图标 · 通用文本」
  - `"D:\...\ZedG.exe",0` → 「Zed 主程序图标」
  - `"D:\icons\py.ico",0` → 「自定义 py.ico」
  - 路径不存在 → 「失效」
- **完整版**：Rust 侧用 `ExtractIconExW` / `SHDefExtractIconW` 取 HICON → 转 PNG → data URL，在列表行渲染 16×16 真图标（需新增 `Win32_Graphics_Gdi` feature，约 150–250 行）。
- **价值**：这是当前体验链上唯一的断点 —— 改完必须去资源管理器找文件验证。

### F2 · 图标失效检测 + 一键修复 —— P0

解析 `DefaultIcon` 值里的文件路径并 `is_file()` 判断（`imageres.dll,-NNN` 视为有效）。真实场景：Zed 重装换目录、自定义图标目录被删 → 关联仍指向旧路径 → 资源管理器显示白图标，用户完全不知道原因。  
**交付形态**：列表行"失效"红徽标 + 顶部汇总提示 + 一键按当前模式重设。纯函数，易测。

### F3 · 逐项独立图标模式 + 别名映射 —— P1

现在 `mode` 是全局单选（`App.tsx:39`），只能给所有选中项同一种图标。实际需求是 `.rs` 用 Rust 图标、`.md` 用 Markdown 图标。建议 `Custom` 模式支持匹配规则（`rs→rust.ico`、`tsx→ts.ico`、`*→default.ico`），或允许逐行覆盖模式（存 localStorage / 配置文件）。  
**额外收益**：别名映射顺带解决"`.tsx` 找不到 `tsx.ico` 就回退系统图标"的粗糙行为。

### F4 · 配置持久化 —— P1

目前只有主题持久化（D16）。通道、图标模式、自定义目录、两个复选框、窗口尺寸每次回默认。localStorage 即可，零后端成本。

### F5 · 写入前备份 + 撤销上次操作 —— P1

"恢复默认 = 删键"意味着不需要备份**初始状态**（DESIGN §3 的判断是对的），但用户用别的方式设过的自定义图标会被 `set_icon` 覆盖且不可恢复。建议：批量写入前把 `<ProgID>\DefaultIcon` 旧值快照到应用数据目录（带时间戳的 JSON），提供"撤销上次操作"。成本低、风险低。

### F6 · 写入成功后自动通知 Shell —— P1

`apply_icons` / `remove_icons` 成功后自动调 `refresh::notify_system()`（`SHChangeNotify` 无副作用、不需要确认框），把"清缓存 / 重启 Explorer"仍留给手动。  
**理由**：现在点完"应用"列表变了、资源管理器没变，用户极易判断成功能失效。这与 D9 的分档设计一致（通知始终执行）。

### F7 · 图标预设包导入 / 导出 —— P2

把"扩展名 → ico 文件 / 模式"导出成 JSON（或 zip），让社区能分享一整套"代码文件图标包"。契合 Zed 中文社区（ZedG）的调性。成本中等。

### F8 · 共享 ProgID 影响面量化 + 可选隔离 —— P2

`Applications\ZedG.exe` 这类共享 ProgID 现在只提示"共享"（`App.tsx:513`）。可以进一步量化：「此 ProgID 被 12 个扩展名共用，本次修改会同时影响它们」并列出扩展名；再可选提供"为 .md 单独创建 ProgID"（明确警告会改写关联结构，需产品决策，与 D3 的边界相关）。

### F9 · 关联登记引导（越界，需先决策）—— P2

列表为空时目前只给文字引导（`App.tsx:533-539`）。可提供"一键为 Zed 创建 ProgID（`Zed.<ext>` + DefaultIcon + `shell\open\command`），但**不写扩展名默认值、不碰 UserChoice**"。严格说没有改默认打开程序，但它创建了新的关联结构，属于边界扩张 —— 建议单独立项并写进 DESIGN 再动手。

### F10 · 体验类 —— P3

快捷键（Ctrl+A 全选可见项、Esc 取消、Enter 应用到选中）、列表键盘上下导航与 `role="checkbox"` 语义、深浅色跟随系统（`prefers-color-scheme`）、侧栏宽度可拖拽（旧 egui 版支持 240–560 px，本版丢了，DESIGN §5 已登记）、单实例锁（避免多开并发写注册表）、更新检查。

### 不建议做（保持边界）

HKLM / 提权、写 `UserChoice`、扩展成通用文件关联编辑器、引入 UI 组件库或 CSS 框架、把注册表逻辑搬进前端。这些都与项目定位和既有硬约束直接冲突。

---

## 6. 建议路线图

**批次 A · 低风险，可当天完成**

1. `busy` 改 RAII guard；`load_state` 不再置 busy（P0-1）
2. `initial_channel` / `scan_ico_count` 改 async + `spawn_blocking`（P1/P2）
3. 批量接口返回结构化报告，"回退/失败"明细走前端日志（P0-2）
4. 选中计数一致性（P0-3）、搜索大小写（R1）、规则 1 大小写（R2）
5. 删 dead_code 并移除 `#![allow(dead_code)]`（S5）
6. 写入成功后自动 `SHChangeNotify`（F6）
7. 协议一致性核对脚本，挂进 `pnpm build`（S2）

**批次 B · 一周量级**

1. `bootstrap()` 合并启动两跳 + 枚举结果一次传参（P3/P4）


1. `owns_prog_id` / `effective_prog_id` / `resolve_icon_value` 纯函数化 + 测试（含注册表读取注入）
2. F1 轻量版图标来源显示 + F2 失效检测
3. F4 配置持久化 + F5 备份撤销
4. 前端拆 hooks/components + `useReducer`
5. CI（windows-latest）+ rustfmt + 前端 linter

**批次 C · 按需**

1. 抽 `rsicon-core` crate，终结双仓库复制（S1）
2. F1 完整版真图标预览、F3 逐项模式、F7 预设包、F8 影响面量化
3. 打包（`bundle.active=true`，NSIS）、命名统一（DESIGN §6.4）、替换占位图标

---

## 7. 一句话总结

代码质量在个人工具里属上乘，问题不是"写错了"而&#x662F;**"写漏了"**：文档承诺的两条规则（回退要说明、耗时操作不得阻塞主线程）在实现里各漏了一处，而 busy 复位漏在异常路径上。性能没有优化空间，别过度设计；结构上最大的债是双仓库复制与协议手写同步。功能上，把"图标预览 + 失效检测"补上，这个工具才算真正闭环。
