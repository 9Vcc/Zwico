// 浏览器预览用的最小 mock（仅 `pnpm dev` 直接开浏览器时生效）
//
// 目的：调整布局与样式时不必每次都构建桌面壳。main.tsx 只在 DEV 且
// 检测不到 Tauri 运行时时动态引入本模块，生产构建不会包含这段代码。
//
// 这里返回**假数据**，不触碰任何真实注册表。

import { api, type Association, type LogLine } from "./api";

const now = Math.floor(Date.now() / 1000);

const ASSOCIATIONS: Association[] = [
  {
    extension: "js",
    progId: "ZedG.js",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: "imageres.dll,-102",
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "ts",
    progId: "ZedG.ts",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: "imageres.dll,-102",
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "tsx",
    progId: "ZedG.tsx",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: false,
    currentIcon: null,
    iconState: "none",
    progIdSource: "classesDefault",
  },
  {
    extension: "md",
    progId: "Applications\\ZedG.exe",
    sharedProgId: true,
    sharedWith: ["json", "css"],
    hasDefaultIcon: true,
    currentIcon: '"D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",0',
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "json",
    progId: "Applications\\ZedG.exe",
    sharedProgId: true,
    sharedWith: ["md", "css"],
    hasDefaultIcon: true,
    currentIcon: '"D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",0',
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "css",
    progId: "Applications\\ZedG.exe",
    sharedProgId: true,
    sharedWith: ["md", "json"],
    hasDefaultIcon: true,
    currentIcon: '"D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",0',
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "py",
    progId: "ZedG.py",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: '"D:\\icons\\py.ico",0',
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "rs",
    progId: "ZedG.rs",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: '"D:\\icons\\rs.ico",0',
    iconState: "missing",
    progIdSource: "classesDefault",
  },
  {
    extension: "go",
    progId: "ZedG.go",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: '"D:\\old-zed\\zed.exe",0',
    iconState: "missing",
    progIdSource: "classesDefault",
  },
  {
    extension: "sh",
    progId: "ZedG.sh",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: "imageres.dll,-74",
    iconState: "valid",
    progIdSource: "classesDefault",
  },
  {
    extension: "toml",
    progId: "ZedG.toml",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: false,
    currentIcon: null,
    iconState: "none",
    progIdSource: "classesDefault",
  },
  {
    extension: "yaml",
    progId: "ZedG.yaml",
    sharedProgId: false,
    sharedWith: [],
    hasDefaultIcon: true,
    currentIcon: "imageres.dll,-102",
    iconState: "valid",
    progIdSource: "classesDefault",
  },
];

const LOG: LogLine[] = [
  { key: "back.autoChannel", params: ["ZedG"], level: "info" },
  { key: "back.zedDetected", params: ["D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe"], level: "info" },
  { key: "back.assocLoaded", params: ["12"], level: "info" },
  { key: "back.assocInvalid", params: ["2"], level: "warn" },
  { key: "back.applied", params: ["12"], level: "info" },
  { key: "back.fallback", params: ["3", "md, json, css"], level: "warn" },
  { key: "back.failed", params: ["12", "2", "sh, yaml"], level: "error" },
  { key: "back.notified", level: "info" },
];

/** 允许用 URL 参数覆盖界面形态，便于截图与演示：
 *  ?theme=light|dark  ?log=collapsed  ?sidebar=360  */
function applyViewParams() {
  const params = new URLSearchParams(window.location.search);
  const patch: Record<string, unknown> = {};
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") patch.theme = theme;
  if (params.get("log") === "collapsed") patch.logCollapsed = true;
  const sidebar = Number.parseInt(params.get("sidebar") ?? "", 10);
  if (!Number.isNaN(sidebar)) patch.sidebarWidth = sidebar;
  if (Object.keys(patch).length === 0) return;

  try {
    const raw = localStorage.getItem("rsicon-config-v1");
    const config = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem("rsicon-config-v1", JSON.stringify({ ...config, ...patch }));
  } catch {
    localStorage.setItem("rsicon-config-v1", JSON.stringify(patch));
  }
}

/** 安装 mock；返回是否真正接管（Tauri 环境下返回 false） */
export function installDevMock(): boolean {
  const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (globalWindow.__TAURI_INTERNALS__) return false;

  applyViewParams();

  Object.assign(api, {
    bootstrap: async () => ({
      channel: "zedg" as const,
      autoSelected: true,
      zedPath: "D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",
      associations: ASSOCIATIONS,
      log: LOG,
    }),
    loadState: async () => ({
      zedPath: "D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",
      associations: ASSOCIATIONS,
      log: [{ key: "log.reloaded", params: ["12"], level: "info" }],
    }),
    scanIcoCount: async () => 4,
    // 模拟三种状态：已生效 / 被系统默认程序覆盖
    inspectExtensions: async (_channel: string, extensions: string[]) =>
      extensions.map((ext, index) => ({
        extension: ext,
        effectiveProgId: index % 3 === 0 ? `ZedG.${ext}` : "Python.File",
        effectiveIsZed: index % 3 === 0,
        hasUserChoice: index % 3 !== 0,
        classesRegistered: true,
      })),
    openDefaultAppsSettings: async () => undefined,
    setDefaultExtensions: async () => [
      { key: "back.defaultSet", params: ["3", "py (← Python.File); rs; go"], level: "info" },
      { key: "back.notified", level: "info" },
    ],
    scanZedInstallations: async () => [
      {
        path: "D:\\Scoop\\apps\\zedg\\current\\bin\\ZedG.exe",
        channel: "zedg" as const,
        source: "scoop shim",
      },
      {
        path: "C:\\Users\\9Vcc\\AppData\\Local\\Programs\\Zed\\zed.exe",
        channel: "stable" as const,
        source: "常见安装目录",
      },
    ],
    // 用彩色方块模拟真实图标预览（真实实现走 GDI 渲染 PNG）
    previewIcon: async (value: string) => {
      const palette = ["#4a86f7", "#3fae6e", "#d99a3c", "#e05a4f", "#7f77dd", "#4aa8c8"];
      let hash = 0;
      for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
      const color = palette[hash % palette.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="1" y="1" width="14" height="14" rx="3" fill="${color}"/></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
    applyIcons: async () => [
      { key: "back.applied", params: ["3"], level: "info" },
      { key: "back.notified", level: "info" },
    ],
    removeIcons: async () => [{ key: "back.removed", params: ["3"], level: "info" }],
    refreshExplorer: async () => [
      { key: "back.notifyBroadcast", level: "info" },
      { key: "back.cacheCleared", level: "info" },
    ],
    undoStatus: async () => ({
      available: true,
      timestamp: now - 120,
      action: "apply",
      count: 12,
    }),
    undoLast: async () => [
      { key: "back.undoDone", params: ["actionLabel.apply", "12"], level: "info" },
    ],
    // 窗口操作在浏览器里没有意义，直接忽略
    windowMinimize: async () => undefined,
    windowToggleMaximize: async () => undefined,
    windowClose: async () => undefined,
    startWindowDrag: async () => undefined,
    windowIsMaximized: async () => false,
    readSvgFile: async () => {
      throw new Error("浏览器预览模式不支持读取本地文件");
    },
    saveIcoFile: async () => {
      throw new Error("浏览器预览模式不支持写入本地文件");
    },
    confirmQuit: async () => undefined,
  });

  return true;
}
