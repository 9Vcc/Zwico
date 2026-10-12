// 前后端协议层：类型定义 + invoke 封装 + 事件订阅
//
// 与 src-tauri/src/lib.rs 的 commands / events 一一对应；
// Tauri 默认会把 JS 的 camelCase 参数名转成 Rust 的 snake_case。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 与 package.json / Cargo.toml / tauri.conf.json 的版本保持一致 */
export const APP_VERSION = "0.0.1";

export type ChannelKey = "stable" | "preview" | "nightly" | "zedg";

/** 通道表（label/hint 由 i18n 的 `channel.<key>` / `channel.<key>.hint` 提供） */
export const CHANNELS: { key: ChannelKey; exeName: string }[] = [
  { key: "stable", exeName: "zed.exe" },
  { key: "preview", exeName: "Zed Preview.exe" },
  { key: "nightly", exeName: "Zed Nightly.exe" },
  { key: "zedg", exeName: "ZedG.exe" },
];

export type IconMode = "system" | "app" | "custom";

/** 图标来源模式（label/hint 由 i18n 的 `mode.<key>` / `mode.<key>.hint` 提供） */
export const MODES: IconMode[] = ["system", "app", "custom"];

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
  /** 生效 ProgID 的来源：userChoice（系统默认程序，程序不可改）/ classesDefault / progIdOnly */
  progIdSource: "userChoice" | "classesDefault" | "progIdOnly";
}

export type LogLevel = "info" | "warn" | "error";

/** 日志行：后端只回 key + 参数，由前端按当前语言渲染 */
export interface LogLine {
  key: string;
  params?: string[];
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

/** 应用注册状态（ZedG 是否已在系统「默认应用」中可见） */
export interface AppRegistration {
  registered: boolean;
  /** Capabilities\FileAssociations 声明的扩展名数 */
  covered: number;
}

/** 单个扩展名的关联状态（设置页诊断用） */
export interface ExtStatus {
  extension: string;
  effectiveProgId: string | null;
  /** 实际生效的关联是否指向本通道 Zed */
  effectiveIsZed: boolean;
  /** 系统「默认应用」里是否已指定该扩展名的打开方式（存在时本工具的注册不生效） */
  hasUserChoice: boolean;
  /** Classes\<ext> 默认值是否已指向本通道 */
  classesRegistered: boolean;
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
  applyIcons: (channel: ChannelKey, targets: Target[], mode: IconMode, zedPath: string, customDir: string | null) =>
    invoke<LogLine[]>("apply_icons", { channel, targets, mode, zedPath, customDir }),
  removeIcons: (targets: Target[]) => invoke<LogLine[]>("remove_icons", { targets }),
  /** 完整注册 ZedG 为系统可见应用（仅 zedg 通道；不改变默认打开方式） */
  registerApplication: (channel: ChannelKey, extensions: string[], zedPath: string) =>
    invoke<LogLine[]>("register_application", { channel, extensions, zedPath }),
  /** 移除 ZedG 的应用注册（仅 zedg 通道） */
  unregisterApplication: (channel: ChannelKey) =>
    invoke<LogLine[]>("unregister_application", { channel }),
  /** 查询应用注册状态（只读） */
  inspectApplicationRegistration: () =>
    invoke<AppRegistration>("inspect_application_registration"),
  /** 检查扩展名的关联状态（只读） */
  inspectExtensions: (channel: ChannelKey, extensions: string[]) =>
    invoke<ExtStatus[]>("inspect_extensions", { channel, extensions }),
  /** 打开 Windows 的「默认应用」设置页 */
  openDefaultAppsSettings: () => invoke<void>("open_default_apps_settings"),
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
  setAutostart: (enable: boolean) => invoke<void>("set_autostart", { enable }),
  isAutostartEnabled: () => invoke<boolean>("is_autostart_enabled"),
  /** 默认自定义图标目录（应用目录下的 icon 文件夹，后端探测） */
  defaultIconDir: () => invoke<string>("default_icon_dir"),
  /** 广播关联变更通知（刷新系统图标缓存，轻量） */
  notifyIconRefresh: () => invoke<void>("notify_icon_refresh"),
  /** 移除单个扩展名的应用注册（手动添加的扩展名的独立移除） */
  unregisterExtension: (channel: ChannelKey, extension: string) =>
    invoke<LogLine[]>("unregister_extension", { channel, extension }),
  startWindowDrag: () => invoke<void>("start_window_drag"),
  windowIsMaximized: () => invoke<boolean>("window_is_maximized"),
};

/** 订阅批量写入进度；返回取消订阅函数 */
export const onProgress = (
  cb: (payload: ProgressPayload) => void,
): Promise<UnlistenFn> => listen<ProgressPayload>("progress", (event) => cb(event.payload));

/** 订阅窗口最大化状态变化（自定义标题栏的按钮图标跟随） */
export const onWindowMaximized = (cb: (maximized: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("window-maximized", (event) => cb(event.payload));
