// 应用状态与业务动作集中于此，组件保持「props 进、回调出」的纯展示约定。
//
// 分层：
//   api.ts             前后端协议（类型 + invoke + 事件）
//   lib/*              纯函数（图标描述、预设解析、格式化）
//   hooks/useAppStore  状态 + 副作用 + 动作（本文件）
//   components/*       纯展示组件

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  api,
  onCloseRequested,
  onProgress,
  type Association,
  type ChannelKey,
  type IconMode,
  type LoadState,
  type LogLine,
  type ProgressPayload,
  type Target,
  type UndoStatus,
  type ZedInstallation,
} from "../api";
import { baseName } from "../lib/iconInfo";
import { resolveLang, setLang, t, tEncoded, type LangPref } from "../lib/i18n";
import { clampLogHeight, clampSidebarWidth } from "../lib/layout";
import { buildPreset, parsePreset, presetFileName, presetToText } from "../lib/presets";
import { useSvgIco } from "./useSvgIco";
import { useToasts } from "./useToast";

export type Theme = "dark" | "light";
export type DialogKind = "remove" | "refresh" | "quit" | "undo";
/** 主视图：主界面 / 设置页 */
export type AppView = "main" | "settings";

const CONFIG_KEY = "rsicon-config-v1";

interface PersistedConfig {
  theme: Theme;
  mode: IconMode;
  customDir: string;
  clearCache: boolean;
  restartExplorer: boolean;
  /** 扩展名 → 逐项指定的 .ico 路径 */
  perExtension: Record<string, string>;
  sidebarWidth: number;
  logHeight: number;
  logCollapsed: boolean;
  /** 界面语言：auto = 跟随系统 */
  lang: LangPref;
}

const DEFAULT_CONFIG: PersistedConfig = {
  theme: "dark",
  mode: "system",
  customDir: "",
  clearCache: true,
  restartExplorer: false,
  perExtension: {},
  sidebarWidth: 288,
  logHeight: 150,
  logCollapsed: false,
  lang: "auto",
};

/** 读取持久化配置（缺失 / 损坏时回落到默认值）
 *
 *  面板尺寸必须**按当前窗口重新夹紧**：持久化的是上次的窗口尺寸下拖出来的值，
 *  若直接沿用，在小窗口下会把主区（卡片区）挤压到几乎不可见。
 */
function loadConfig(): PersistedConfig {
  let config = DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
      config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        perExtension: parsed.perExtension ?? {},
        sidebarWidth: clampSidebarWidth(
          parsed.sidebarWidth ?? DEFAULT_CONFIG.sidebarWidth,
          window.innerWidth,
        ),
        logHeight: clampLogHeight(parsed.logHeight ?? DEFAULT_CONFIG.logHeight, window.innerHeight),
      };
    }
  } catch {
    config = DEFAULT_CONFIG;
  }
  // 语言必须在首帧渲染前生效：t() 读的是 i18n 模块的当前语言
  setLang(resolveLang(config.lang));
  return config;
}

export function useAppStore() {
  const [config, setConfig] = useState<PersistedConfig>(loadConfig);
  const [view, setView] = useState<AppView>("main");
  const [channel, setChannel] = useState<ChannelKey>("stable");
  const [zedPath, setZedPath] = useState<string | null>(null);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [icoCount, setIcoCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [log, setLog] = useState<LogLine[]>([
    { key: "log.startLoad", level: "info" },
  ]);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [undoStatus, setUndoStatus] = useState<UndoStatus>({
    available: false,
    timestamp: null,
    action: null,
    count: 0,
  });
  /** DefaultIcon 值 → PNG data URL（图标预览；null 表示渲染失败） */
  const [iconPreviews, setIconPreviews] = useState<Record<string, string | null>>({});
  /** 自动扫描到的 Zed 安装列表 */
  const [installations, setInstallations] = useState<ZedInstallation[]>([]);
  const [scanning, setScanning] = useState(false);
  const previewRequested = useRef<Set<string>>(new Set());
  const { toasts, push, dismiss } = useToasts();
  const svgIcoTool = useSvgIco(push);

  const {
    theme,
    mode,
    customDir,
    clearCache,
    restartExplorer,
    perExtension,
    sidebarWidth,
    logHeight,
    logCollapsed,
    lang,
  } = config;

  // 语言：auto 时跟随系统；变化时同步给 i18n 模块并触发整树重渲染
  useEffect(() => {
    setLang(resolveLang(lang));
  }, [lang]);

  const patchConfig = useCallback((patch: Partial<PersistedConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  // 配置持久化 + 主题落到根元素
  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  // 首帧也要夹紧一次：loadConfig 已按窗口夹过，这里兜住"窗口在渲染前变化"的情况
  useEffect(() => {
    setConfig((prev) => {
      const sidebarWidth = clampSidebarWidth(prev.sidebarWidth, window.innerWidth);
      const logHeight = clampLogHeight(prev.logHeight, window.innerHeight);
      if (sidebarWidth === prev.sidebarWidth && logHeight === prev.logHeight) return prev;
      return { ...prev, sidebarWidth, logHeight };
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // ---------- 日志与提示 ----------
  const appendLogs = useCallback((lines: LogLine[]) => {
    if (lines.length === 0) return;
    setLog((prev) => [...prev, ...lines]);
  }, []);

  /** 统一失败出口：同时给出浮层提示与错误日志 */
  const fail = useCallback(
    (titleKey: string, err: unknown) => {
      const detail = tEncoded(err instanceof Error ? err.message : String(err));
      push("danger", t("failFormat", [t(titleKey), detail]));
      setLog((prev) => [
        ...prev,
        { key: "failFormat", params: [t(titleKey), detail], level: "error" },
      ]);
    },
    [push],
  );

  const succeed = useCallback((text: string) => push("ok", text), [push]);

  // ---------- 加载 ----------
  const applyLoaded = useCallback(
    (state: Pick<LoadState, "zedPath" | "associations" | "log">) => {
      setZedPath(state.zedPath);
      setAssociations(state.associations);
      // 重扫后清理已不存在的扩展名，避免「已选 N」与实际不符
      setSelected((prev) => {
        const alive = new Set(state.associations.map((a) => a.extension));
        return new Set([...prev].filter((ext) => alive.has(ext)));
      });
      appendLogs(state.log);
    },
    [appendLogs],
  );

  const load = useCallback(
    async (target: ChannelKey) => {
      setBusy(true);
      setProgress(null);
      try {
        applyLoaded(await api.loadState(target));
      } catch (err) {
        fail("fail.load", err);
      } finally {
        setBusy(false);
      }
    },
    [applyLoaded, fail],
  );

  const refreshUndoStatus = useCallback(async () => {
    try {
      setUndoStatus(await api.undoStatus());
    } catch {
      // 撤销状态查询失败不影响主流程
    }
  }, []);

  // 启动：一次 bootstrap 完成「选通道 + 检测 + 枚举」
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const state = await api.bootstrap();
        setChannel(state.channel);
        applyLoaded(state);
        if (state.autoSelected) {
          const label = t(`channel.${state.channel}`);
          push("info", t("toast.autoChannel", [label]), 5000);
        }
        await refreshUndoStatus();
      } catch (err) {
        fail("fail.startup", err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [applyLoaded, fail, push, refreshUndoStatus]);

  // 事件订阅：进度 / 关闭请求
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void onProgress(setProgress).then((un) => unlisteners.push(un));
    void onCloseRequested(() => setDialog("quit")).then((un) => unlisteners.push(un));
    return () => unlisteners.forEach((un) => un());
  }, []);

  // ---------- 通道 ----------
  const changeChannel = useCallback(
    (next: ChannelKey) => {
      if (next === channel) return;
      const label = t(`channel.${next}`);
      setChannel(next);
      setZedPath(null);
      setAssociations([]);
      setSelected(new Set());
      setLog((prev) => [
        ...prev,
        { key: "log.channelSwitch", params: [label], level: "info" },
      ]);
      void load(next);
    },
    [channel, load],
  );

  // ---------- 列表与选择 ----------
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return associations;
    return associations.filter((a) => a.extension.toLowerCase().includes(needle));
  }, [associations, search]);

  const toggle = useCallback((ext: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(ext)) next.add(ext);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => new Set([...prev, ...visible.map((a) => a.extension)]));
  }, [visible]);

  const invertVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((a) => {
        if (!next.delete(a.extension)) next.add(a.extension);
      });
      return next;
    });
  }, [visible]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedList = useMemo(
    () => associations.filter((a) => selected.has(a.extension)),
    [associations, selected],
  );

  const toTargets = useCallback(
    (list: Association[]): Target[] =>
      list.map((a) => ({
        extension: a.extension,
        progId: a.progId,
        customIcon: perExtension[a.extension] ?? null,
      })),
    [perExtension],
  );

  const stats = useMemo(
    () => ({
      total: associations.length,
      selected: selectedList.length,
      invalid: associations.filter((a) => a.iconState === "missing").length,
      shared: selectedList.filter((a) => a.sharedWith.length > 0).length,
    }),
    [associations, selectedList],
  );

  // ---------- 图标操作 ----------
  const runApply = useCallback(
    async (targets: Target[], successText: string) => {
      if (targets.length === 0) {
        push("warn", t("toast.noExtensions"));
        return;
      }
      if (mode === "app" && !zedPath) {
        fail("fail.applyNoZed.title", new Error(t("fail.applyNoZed")));
        return;
      }
      const modeLabel = t(`mode.${mode}`);
      setBusy(true);
      setProgress({ current: 0, total: targets.length, extension: "" });
      appendLogs([
        { key: "log.startApply", params: [modeLabel, String(targets.length)], level: "info" },
      ]);
      try {
        const lines = await api.applyIcons(
          targets,
          mode,
          zedPath ?? "",
          customDir.trim() === "" ? null : customDir.trim(),
        );
        appendLogs(lines);
        succeed(successText);
      } catch (err) {
        fail("fail.apply", err);
      } finally {
        setBusy(false);
        setProgress(null);
        await load(channel);
        await refreshUndoStatus();
      }
    },
    [appendLogs, channel, customDir, fail, load, mode, push, refreshUndoStatus, succeed, zedPath],
  );

  const applySelected = useCallback(() => {
    void runApply(toTargets(selectedList), t("toast.applied", [selectedList.length]));
  }, [runApply, selectedList, toTargets]);

  const applyAll = useCallback(() => {
    void runApply(toTargets(associations), t("toast.appliedAll", [associations.length]));
  }, [associations, runApply, toTargets]);

  const removeSelected = useCallback(async () => {
    const targets = toTargets(selectedList);
    if (targets.length === 0) {
      push("warn", t("toast.noExtensions"));
      return;
    }
    setBusy(true);
    setProgress({ current: 0, total: targets.length, extension: "" });
    appendLogs([{ key: "log.startRemove", params: [String(targets.length)], level: "info" }]);
    try {
      appendLogs(await api.removeIcons(targets));
      succeed(t("toast.removed"));
    } catch (err) {
      fail("fail.remove", err);
    } finally {
      setBusy(false);
      setProgress(null);
      await load(channel);
      await refreshUndoStatus();
    }
  }, [appendLogs, channel, fail, load, push, refreshUndoStatus, selectedList, succeed, toTargets]);

  /** 一键修复失效图标：按当前模式重设所有 iconState === "missing" 的项 */
  const repairInvalid = useCallback(() => {
    const broken = associations.filter((a) => a.iconState === "missing");
    if (broken.length === 0) {
      push("info", t("toast.repairNone"));
      return;
    }
    void runApply(toTargets(broken), t("toast.repairDone", [broken.length]));
  }, [associations, push, runApply, toTargets]);

  const runRefresh = useCallback(async () => {
    setBusy(true);
    appendLogs([{ key: "log.startRefresh", level: "info" }]);
    try {
      appendLogs(await api.refreshExplorer(clearCache, restartExplorer));
      succeed(t("toast.refreshed"));
    } catch (err) {
      fail("fail.refresh", err);
    } finally {
      setBusy(false);
    }
  }, [appendLogs, clearCache, fail, restartExplorer, succeed]);

  /** 勾选「重启 Explorer」时需要二次确认（桌面会短暂消失） */
  const requestRefresh = useCallback(() => {
    if (restartExplorer) setDialog("refresh");
    else void runRefresh();
  }, [restartExplorer, runRefresh]);

  const runUndo = useCallback(async () => {
    setBusy(true);
    try {
      appendLogs(await api.undoLast());
      succeed(t("toast.undone"));
    } catch (err) {
      fail("fail.undo", err);
    } finally {
      setBusy(false);
      await load(channel);
      await refreshUndoStatus();
    }
  }, [appendLogs, channel, fail, load, refreshUndoStatus, succeed]);

  // ---------- 预设 ----------
  const exportPreset = useCallback(async () => {
    try {
      const preset = buildPreset({ mode, customDir, perExtension });
      const path = await save({
        title: t("dialog.exportPreset"),
        defaultPath: presetFileName(),
        filters: [{ name: t("dialog.presetFilter"), extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      await api.savePresetFile(path, presetToText(preset));
      succeed(t("toast.presetExported", [baseName(path)]));
    } catch (err) {
      fail("fail.exportPreset", err);
    }
  }, [customDir, fail, mode, perExtension, succeed]);

  const importPreset = useCallback(async () => {
    try {
      const path = await open({
        title: t("dialog.importPreset"),
        multiple: false,
        filters: [{ name: t("dialog.presetFilter"), extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const preset = parsePreset(await api.loadPresetFile(path));
      patchConfig({
        mode: preset.mode,
        customDir: preset.customDir,
        perExtension: preset.perExtension,
      });
      const modeLabel = t(`mode.${preset.mode}`);
      push(
        "ok",
        t("toast.presetImported", [modeLabel, Object.keys(preset.perExtension).length]),
        6000,
      );
      setLog((prev) => [
        ...prev,
        { key: "log.presetImported", params: [baseName(path)], level: "info" },
      ]);
    } catch (err) {
      fail("fail.importPreset", err);
    }
  }, [fail, patchConfig, push]);

  // ---------- 路径与图标选择 ----------
  const pickZed = useCallback(async () => {
    try {
      const file = await open({
        multiple: false,
        title: t("dialog.pickZed"),
        filters: [{ name: t("dialog.exeFilter"), extensions: ["exe"] }],
      });
      if (typeof file === "string") {
        setZedPath(file);
        setLog((prev) => [
          ...prev,
          { key: "log.manualZed", params: [file], level: "info" },
        ]);
      }
    } catch (err) {
      fail("fail.pickFile", err);
    }
  }, [fail]);

  const pickCustomDir = useCallback(async () => {
    try {
      const dir = await open({ directory: true, title: t("dialog.pickIconDir") });
      if (typeof dir === "string") {
        patchConfig({ customDir: dir });
        setLog((prev) => [...prev, { key: "log.dirPicked", params: [dir], level: "info" }]);
      }
    } catch (err) {
      fail("fail.pickDir", err);
    }
  }, [fail, patchConfig]);

  /** 为单个扩展名指定专属图标（写入配置，应用时传给后端） */
  const pickIconFor = useCallback(
    async (ext: string) => {
      try {
        const file = await open({
          multiple: false,
          title: t("dialog.pickPerIcon", [ext]),
          filters: [{ name: t("dialog.icoFilter"), extensions: ["ico"] }],
        });
        if (typeof file === "string") {
          patchConfig({ perExtension: { ...perExtension, [ext]: file } });
          push("ok", t("toast.perIconSet", [ext, baseName(file)]));
        }
      } catch (err) {
        fail("fail.pickFile", err);
      }
    },
    [fail, patchConfig, perExtension, push],
  );

  const clearIconFor = useCallback(
    (ext: string) => {
      const next = { ...perExtension };
      delete next[ext];
      patchConfig({ perExtension: next });
      push("info", t("toast.perIconCleared", [ext]));
    },
    [patchConfig, perExtension, push],
  );

  // 自定义目录的 .ico 计数（仅自定义模式需要）
  useEffect(() => {
    if (mode !== "custom") {
      setIcoCount(null);
      return;
    }
    let cancelled = false;
    void api
      .scanIcoCount(customDir)
      .then((count) => {
        if (!cancelled) setIcoCount(count);
      })
      .catch(() => {
        if (!cancelled) setIcoCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, customDir]);

  // 图标预览：把列表里出现的 DefaultIcon 值去重后逐个渲染
  // （同一个值只请求一次，后端还有一层缓存，因此通常只发个位数请求）
  useEffect(() => {
    const pending: string[] = [];
    for (const assoc of visible) {
      const value = assoc.currentIcon;
      if (!value || value in iconPreviews || previewRequested.current.has(value)) continue;
      pending.push(value);
    }
    if (pending.length === 0) return;

    pending.forEach((value) => previewRequested.current.add(value));
    let cancelled = false;
    void (async () => {
      const updates: Record<string, string | null> = {};
      for (const value of pending.slice(0, 80)) {
        try {
          // 取 32px：行内用 CSS 缩到 16 显示，悬停放大时用原始尺寸，避免二次请求
          updates[value] = await api.previewIcon(value, 32);
        } catch {
          updates[value] = null;
        }
      }
      if (!cancelled) setIconPreviews((prev) => ({ ...prev, ...updates }));
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, iconPreviews]);

  // ---------- Zed 安装扫描 ----------
  const scanZed = useCallback(async () => {
    setScanning(true);
    try {
      const list = await api.scanZedInstallations();
      setInstallations(list);
      if (list.length === 0) {
        push("warn", t("toast.scanNone"));
      } else if (list.length === 1) {
        const only = list[0];
        setZedPath(only.path);
        push("ok", t("toast.scanOne", [only.path]), 6000);
        setLog((prev) => [
          ...prev,
          { key: "log.autoDetected", params: [only.path, t(only.source)], level: "info" },
        ]);
      } else {
        push("info", t("toast.scanMany", [list.length]), 6000);
      }
      return list;
    } catch (err) {
      fail("fail.scanZed", err);
      return [];
    } finally {
      setScanning(false);
    }
  }, [fail, push]);

  /** 采用扫描结果中的某一项 */
  const useInstallation = useCallback(
    (path: string) => {
      setZedPath(path);
      push("ok", t("toast.selected", [path]), 5000);
      setLog((prev) => [...prev, { key: "log.useZed", params: [path], level: "info" }]);
    },
    [push],
  );

  // ---------- 对话框与日志 ----------
  const confirmDialog = useCallback(() => {
    const kind = dialog;
    setDialog(null);
    if (kind === "remove") void removeSelected();
    else if (kind === "refresh") void runRefresh();
    else if (kind === "undo") void runUndo();
    else if (kind === "quit") void api.confirmQuit();
  }, [dialog, removeSelected, runRefresh, runUndo]);

  const copyLogs = useCallback(async () => {
    try {
      await writeText(log.map((line) => t(line.key, line.params)).join("\n"));
      push("ok", t("toast.copied"));
    } catch (err) {
      fail("fail.copyLog", err);
    }
  }, [fail, log, push]);

  const progressText = progress
    ? progress.extension === ""
      ? t("progress.preparing", [progress.current, progress.total])
      : t("progress.processing", [progress.extension, progress.current, progress.total])
    : t("progress.loading");

  /** 侧栏宽度：经边界约束，保证内容区不会被压垮（值未变则不触发更新，避免窗口 resize 时的无谓重渲染） */
  const setSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width, window.innerWidth);
    setConfig((prev) => (prev.sidebarWidth === clamped ? prev : { ...prev, sidebarWidth: clamped }));
  }, []);

  /** 日志面板高度：经边界约束，保证主区不会被压垮 */
  const setLogHeight = useCallback((height: number) => {
    const clamped = clampLogHeight(height, window.innerHeight);
    setConfig((prev) => (prev.logHeight === clamped ? prev : { ...prev, logHeight: clamped }));
  }, []);

  const toggleLogCollapsed = useCallback(
    () => patchConfig({ logCollapsed: !logCollapsed }),
    [logCollapsed, patchConfig],
  );

  return {
    // 状态
    view,
    setView,
    theme,
    channel,
    zedPath,
    associations,
    visible,
    search,
    selected,
    selectedList,
    icoCount,
    busy,
    progress,
    progressText,
    loaded,
    log,
    dialog,
    undoStatus,
    stats,
    mode,
    customDir,
    clearCache,
    restartExplorer,
    perExtension,
    sidebarWidth,
    logHeight,
    logCollapsed,
    toasts,
    iconPreviews,
    installations,
    scanning,
    // 动作
    setSearch,
    setDialog,
    setSidebarWidth,
    setLogHeight,
    toggleLogCollapsed,
    setClearCache: (value: boolean) => patchConfig({ clearCache: value }),
    setRestartExplorer: (value: boolean) => patchConfig({ restartExplorer: value }),
    setMode: (value: IconMode) => patchConfig({ mode: value }),
    setCustomDir: (value: string) => patchConfig({ customDir: value }),
    setTheme: (value: Theme) => patchConfig({ theme: value }),
    lang,
    setLangPref: (value: LangPref) => patchConfig({ lang: value }),
    changeChannel,
    reload: () => void load(channel),
    toggle,
    selectAllVisible,
    invertVisible,
    clearSelection,
    applySelected,
    applyAll,
    removeSelected,
    repairInvalid,
    requestRefresh,
    undo: () => setDialog("undo"),
    exportPreset,
    importPreset,
    pickZed,
    pickCustomDir,
    pickIconFor,
    clearIconFor,
    scanZed,
    useInstallation,
    confirmDialog,
    copyLogs,
    clearLogs: () => setLog([]),
    dismissToast: dismiss,
    // SVG → ICO 工具（状态与动作来自 useSvgIco）
    ...svgIcoTool,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
