// 前后端协议层：类型定义 + invoke 封装 + 事件订阅
//
// 与 src-tauri/src/lib.rs 的 commands / events 一一对应；
// Tauri 默认会把 JS 的 camelCase 参数名转成 Rust 的 snake_case。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 与 package.json / Cargo.toml / tauri.conf.json 的版本保持一致 */
export const APP_VERSION = "0.1.0";

export type ChannelKey = "stable" | "preview" | "nightly" | "zedg";

export const CHANNELS: { key: ChannelKey; label: string }[] = [
  { key: "stable", label: "稳定版" },
  { key: "preview", label: "预览版" },
  { key: "nightly", label: "每夜版" },
  { key: "zedg", label: "汉化版（ZedG）" },
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
    hint: "统一使用 Zed 主程序自带的图标（zed.exe 的第一个图标）",
  },
  {
    key: "custom",
    label: "自定义图标",
    hint: "在图标目录中查找 <扩展名>.ico（如 py.ico），缺失时回退系统内置图标",
  },
];

export interface Association {
  extension: string;
  progId: string;
  sharedProgId: boolean;
  hasDefaultIcon: boolean;
  currentIcon: string | null;
}

export interface LogLine {
  text: string;
  error: boolean;
}

export interface LoadState {
  zedPath: string | null;
  associations: Association[];
  log: LogLine[];
}

export interface ProgressPayload {
  current: number;
  total: number;
  extension: string;
}

export interface Target {
  extension: string;
  progId: string;
}

export const api = {
  initialChannel: () => invoke<string>("initial_channel"),
  loadState: (channel: ChannelKey) => invoke<LoadState>("load_state", { channel }),
  scanIcoCount: (dir: string) => invoke<number | null>("scan_ico_count", { dir }),
  applyIcons: (targets: Target[], mode: IconMode, zedPath: string, customDir: string | null) =>
    invoke<void>("apply_icons", { targets, mode, zedPath, customDir }),
  removeIcons: (targets: Target[]) => invoke<void>("remove_icons", { targets }),
  refreshExplorer: (clearCache: boolean, restartExplorer: boolean) =>
    invoke<LogLine[]>("refresh_explorer", { clearCache, restartExplorer }),
  confirmQuit: () => invoke<void>("confirm_quit"),
};

/** 订阅批量写入进度；返回取消订阅函数 */
export const onProgress = (
  cb: (payload: ProgressPayload) => void,
): Promise<UnlistenFn> => listen<ProgressPayload>("progress", (event) => cb(event.payload));

/** 订阅「任务进行中请求关闭窗口」事件 */
export const onCloseRequested = (cb: () => void): Promise<UnlistenFn> =>
  listen("close-requested", () => cb());
