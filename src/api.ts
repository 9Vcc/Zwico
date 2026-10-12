// 前后端协议层：类型定义 + invoke 封装 + 事件订阅
//
// 与 src-tauri/src/lib.rs 的 commands / events 一一对应；
// Tauri 默认会把 JS 的 camelCase 参数名转成 Rust 的 snake_case。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 与 package.json / Cargo.toml / tauri.conf.json 的版本保持一致 */
export const APP_VERSION = "0.1.0";

export type ChannelKey = "stable" | "preview" | "nightly" | "zedg";

/** 通道表（label 用于展示，exeName 用于在客户端推断「Zed 应用图标」来源） */
export const CHANNELS: { key: ChannelKey; label: string; hint: string; exeName: string }[] = [
  { key: "stable", label: "稳定版", hint: "Zed 正式发布通道", exeName: "zed.exe" },
  { key: "preview", label: "预览版", hint: "Zed Preview 通道", exeName: "Zed Preview.exe" },
  { key: "nightly", label: "每夜版", hint: "Zed Nightly 每日构建", exeName: "Zed Nightly.exe" },
  {
    key: "zedg",
    label: "汉化版（ZedG）",
    hint: "Zed 中文社区版，常见于 scoop 安装",
    exeName: "ZedG.exe",
  },
];

export type IconMode = "system" | "app" | "custom";

export const MODES: { key: IconMode; label: string; hint: string }[] = [
  {
    key: "system",
    label: "系统内置图标",
    hint: "按扩展名类型映射到 Windows 内置图标：代码 / 文本、HTML、XML、图片、批处理等（推荐）",
  },
  {
    key: "app",
    label: "Zed 应用图标",
    hint: "统一使用 Zed 主程序自带的图标（可执行文件的第一个图标）",
  },
  {
    key: "custom",
    label: "自定义图标目录",
    hint: "在图标目录中查找 <扩展名>.ico（如 py.ico），缺失的扩展名回退系统图标并列出提示",
  },
];

/** DefaultIcon 的可达性：none=未设置 / valid=可达 / missing=指向的文件已不存在 */
export type IconState = "none" | "valid" | "missing";

export interface Association {
  extension: string;
  progId: string;
  /** Applications\* 形态：所有通过「打开方式」关联到同一程序的扩展名共用图标 */
  sharedProgId: boolean;
  /** 同一 ProgID 还被哪些扩展名共用（影响面） */
  sharedWith: string[];
  hasDefaultIcon: boolean;
  currentIcon: string | null;
  iconState: IconState;
}

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  text: string;
  level: LogLevel;
}

export interface LoadState {
  zedPath: string | null;
  associations: Association[];
  log: LogLine[];
}

export interface BootstrapState extends LoadState {
  channel: ChannelKey;
  /** 是否由工具自动选择了非默认通道 */
  autoSelected: boolean;
}

export interface ProgressPayload {
  /** 当前正在处理的序号（从 1 开始） */
  current: number;
  total: number;
  extension: string;
}

export interface Target {
  extension: string;
  progId: string;
  /** 逐项指定的自定义图标（绝对路径） */
  customIcon?: string | null;
}

export interface UndoStatus {
  available: boolean;
  /** Unix 秒 */
  timestamp: number | null;
  action: string | null;
  count: number;
}

/** 自动扫描到的 Zed 安装 */
export interface ZedInstallation {
  path: string;
  channel: ChannelKey;
  /** 来源说明：卸载注册表 / 常见安装目录 / scoop / PATH */
  source: string;
}

export const api = {
  /** 启动引导：选通道 + 检测 Zed + 枚举关联，一次返回 */
  bootstrap: () => invoke<BootstrapState>("bootstrap"),
  loadState: (channel: ChannelKey) => invoke<LoadState>("load_state", { channel }),
  scanIcoCount: (dir: string) => invoke<number | null>("scan_ico_count", { dir }),
  scanZedInstallations: () => invoke<ZedInstallation[]>("scan_zed_installations"),
  /** 把 DefaultIcon 值渲染成 PNG data URL（失败为 null） */
  previewIcon: (value: string, size = 16) =>
    invoke<string | null>("preview_icon", { value, size }),
  applyIcons: (targets: Target[], mode: IconMode, zedPath: string, customDir: string | null) =>
    invoke<LogLine[]>("apply_icons", { targets, mode, zedPath, customDir }),
  removeIcons: (targets: Target[]) => invoke<LogLine[]>("remove_icons", { targets }),
  refreshExplorer: (clearCache: boolean, restartExplorer: boolean) =>
    invoke<LogLine[]>("refresh_explorer", { clearCache, restartExplorer }),
  undoStatus: () => invoke<UndoStatus>("undo_status"),
  undoLast: () => invoke<LogLine[]>("undo_last"),
  savePresetFile: (path: string, content: string) =>
    invoke<void>("save_preset_file", { path, content }),
  loadPresetFile: (path: string) => invoke<string>("load_preset_file", { path }),
  readSvgFile: (path: string) => invoke<string>("read_svg_file", { path }),
  saveIcoFile: (path: string, data: Uint8Array) =>
    invoke<void>("save_ico_file", { path, data: Array.from(data) }),
  // 自定义标题栏（无边框窗口）需要的窗口操作
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  startWindowDrag: () => invoke<void>("start_window_drag"),
  windowIsMaximized: () => invoke<boolean>("window_is_maximized"),
  confirmQuit: () => invoke<void>("confirm_quit"),
};

/** 订阅批量写入进度；返回取消订阅函数 */
export const onProgress = (
  cb: (payload: ProgressPayload) => void,
): Promise<UnlistenFn> => listen<ProgressPayload>("progress", (event) => cb(event.payload));

/** 订阅「任务进行中请求关闭窗口」事件 */
export const onCloseRequested = (cb: () => void): Promise<UnlistenFn> =>
  listen("close-requested", () => cb());

/** 订阅窗口最大化状态变化（自定义标题栏的按钮图标跟随） */
export const onWindowMaximized = (cb: (maximized: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("window-maximized", (event) => cb(event.payload));
