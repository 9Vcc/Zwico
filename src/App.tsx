// 主界面：布局与状态管理（等价于旧版 app.rs 的角色）
//
// 结构：顶栏 / 左侧列表 / 右侧三卡片（图标设置、操作、刷新）/ 底部日志 / 确认对话框
// 数据流：invoke 命令 → 更新状态；批量写入进度经 `progress` 事件回填

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  api,
  APP_VERSION,
  CHANNELS,
  MODES,
  type Association,
  type ChannelKey,
  type IconMode,
  type LogLine,
  type ProgressPayload,
  type Target,
  onCloseRequested,
  onProgress,
} from "./api";

type Theme = "dark" | "light";
type DialogKind = "remove" | "refresh" | "quit";

const THEME_KEY = "rsicon-theme";

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark",
  );
  const [channel, setChannel] = useState<ChannelKey>("stable");
  const [zedPath, setZedPath] = useState<string | null>(null);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<IconMode>("system");
  const [customDir, setCustomDir] = useState("");
  const [icoCount, setIcoCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [log, setLog] = useState<LogLine[]>([
    { text: "正在检测 Zed 并加载文件关联列表…", error: false },
  ]);
  const [clearCache, setClearCache] = useState(true);
  const [restartExplorer, setRestartExplorer] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // ---------- 基础工具 ----------
  const appendOk = useCallback(
    (text: string) => setLog((prev) => [...prev, { text, error: false }]),
    [],
  );
  const appendErr = useCallback(
    (text: string) => setLog((prev) => [...prev, { text, error: true }]),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // 事件订阅：进度 / 关闭请求
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void onProgress(setProgress).then((un) => unlisteners.push(un));
    void onCloseRequested(() => setDialog("quit")).then((un) => unlisteners.push(un));
    return () => unlisteners.forEach((un) => un());
  }, []);

  // 日志自动吸底
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  // ---------- 加载 ----------
  const load = useCallback(
    async (ch: ChannelKey) => {
      setBusy(true);
      setProgress(null);
      try {
        const state = await api.loadState(ch);
        setZedPath(state.zedPath);
        setAssociations(state.associations);
        setLog((prev) => [...prev, ...state.log]);
      } catch (err) {
        appendErr(String(err));
      } finally {
        setBusy(false);
      }
    },
    [appendErr],
  );

  // 启动：自动选通道（优先已有 ProgID / 已安装），再加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = (await api.initialChannel()) as ChannelKey;
        if (cancelled) return;
        setChannel(initial);
        const label = CHANNELS.find((c) => c.key === initial)?.label ?? initial;
        if (initial !== "stable") appendOk(`已自动选择通道：${label}`);
        await load(initial);
      } catch (err) {
        appendErr(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅启动执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChannelChange = (next: ChannelKey) => {
    if (next === channel) return;
    const label = CHANNELS.find((c) => c.key === next)?.label ?? next;
    appendOk(`已切换到 ${label} 通道，正在重新加载…`);
    setChannel(next);
    setZedPath(null);
    setAssociations([]);
    setSelected(new Set());
    void load(next);
  };

  // ---------- 列表与选择 ----------
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return associations.filter((a) => needle === "" || a.extension.includes(needle));
  }, [associations, search]);

  const toggle = (ext: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(ext)) next.add(ext);
      return next;
    });

  const selectedTargets = (): Target[] =>
    associations
      .filter((a) => selected.has(a.extension))
      .map((a) => ({ extension: a.extension, progId: a.progId }));

  const allTargets = (): Target[] =>
    associations.map((a) => ({ extension: a.extension, progId: a.progId }));

  // ---------- 图标操作 ----------
  const startApply = async (targets: Target[]) => {
    if (targets.length === 0) {
      appendErr("没有可操作的扩展名");
      return;
    }
    if (mode === "app" && !zedPath) {
      appendErr("未检测到 Zed 可执行文件，无法使用「Zed 应用图标」模式");
      return;
    }
    if (mode === "custom" && customDir.trim() === "") {
      appendOk("提示：未设置自定义图标目录，将回退为系统图标");
    }
    const modeLabel = MODES.find((m) => m.key === mode)?.label ?? mode;
    appendOk(`开始应用${modeLabel}（共 ${targets.length} 个扩展名）`);
    setBusy(true);
    setProgress({ current: 0, total: targets.length, extension: "" });
    try {
      await api.applyIcons(
        targets,
        mode,
        zedPath ?? "",
        customDir.trim() === "" ? null : customDir.trim(),
      );
      appendOk("应用图标完成");
    } catch (err) {
      appendErr(`应用图标：${String(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
      // 写完重扫，保证「已设置 / 默认」状态与注册表一致
      void load(channel);
    }
  };

  const startRemove = async (targets: Target[]) => {
    if (targets.length === 0) {
      appendErr("请先在左侧选中要恢复默认图标的扩展名");
      return;
    }
    appendOk(`开始恢复默认图标（共 ${targets.length} 个扩展名）`);
    setBusy(true);
    setProgress({ current: 0, total: targets.length, extension: "" });
    try {
      await api.removeIcons(targets);
      appendOk("恢复默认图标完成");
    } catch (err) {
      appendErr(`恢复默认图标：${String(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
      void load(channel);
    }
  };

  const startRefresh = async () => {
    appendOk("开始刷新资源管理器…");
    setBusy(true);
    try {
      const lines = await api.refreshExplorer(clearCache, restartExplorer);
      setLog((prev) => [...prev, ...lines]);
    } catch (err) {
      appendErr(String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDialog = () => {
    const kind = dialog;
    setDialog(null);
    if (kind === "remove") void startRemove(selectedTargets());
    else if (kind === "refresh") void startRefresh();
    else if (kind === "quit") void api.confirmQuit();
  };

  // ---------- 路径选择与目录校验 ----------
  const pickZed = async () => {
    try {
      const file = await open({
        multiple: false,
        title: "选择 Zed / ZedG 可执行文件",
        filters: [{ name: "可执行文件", extensions: ["exe"] }],
      });
      if (typeof file === "string") {
        setZedPath(file);
        appendOk(`已手动指定 Zed 路径：${file}`);
      }
    } catch (err) {
      appendErr(`打开文件对话框失败：${String(err)}`);
    }
  };

  const pickDir = async () => {
    try {
      const dir = await open({ directory: true, title: "选择包含 <扩展名>.ico 文件的文件夹" });
      if (typeof dir === "string") {
        setCustomDir(dir);
        appendOk(`已选择图标目录：${dir}`);
      }
    } catch (err) {
      appendErr(`打开文件夹对话框失败：${String(err)}`);
    }
  };

  // 自定义目录 .ico 数量校验（切换模式或编辑路径时刷新）
  useEffect(() => {
    if (mode !== "custom") return;
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

  // ---------- 派生展示值 ----------
  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;
  const progressText = progress
    ? progress.extension !== ""
      ? `正在处理：${progress.extension}（${progress.current}/${progress.total}）`
      : `处理中（${progress.current}/${progress.total}）`
    : "正在加载关联列表…";

  const canApply = !busy && selected.size > 0;
  const canApplyAll = !busy && associations.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__logo">Zed</span>
          <span className="brand__title">文件关联图标管理器</span>
          <span className="pill pill--weak">v{APP_VERSION}</span>
        </div>
        <div className="topbar__right">
          {busy && <span className="spinner" title="处理中" />}
          <label className="field-label" htmlFor="channel-select">
            Zed 通道
          </label>
          <select
            id="channel-select"
            className="select"
            value={channel}
            disabled={busy}
            onChange={(e) => onChannelChange(e.target.value as ChannelKey)}
          >
            {CHANNELS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--ghost"
            title="切换浅色 / 深色主题"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "浅色" : "深色"}
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar__search">
            <input
              className="input"
              placeholder="搜索扩展名…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search !== "" && (
              <button
                type="button"
                className="btn btn--mini"
                title="清除搜索"
                onClick={() => setSearch("")}
              >
                ×
              </button>
            )}
          </div>

          <div className="list">
            {associations.length > 0 ? (
              visible.map((a) => (
                <Row
                  key={a.extension}
                  assoc={a}
                  selected={selected.has(a.extension)}
                  onToggle={() => toggle(a.extension)}
                />
              ))
            ) : busy ? (
              <div className="list__hint">正在加载关联列表…</div>
            ) : (
              <EmptyState />
            )}
          </div>

          <div className="sidebar__footer">
            <div className="row-btns">
              <button
                type="button"
                className="btn btn--mini"
                title="选中当前搜索结果中的全部扩展名"
                onClick={() =>
                  setSelected((prev) => new Set([...prev, ...visible.map((a) => a.extension)]))
                }
              >
                全选
              </button>
              <button
                type="button"
                className="btn btn--mini"
                title="翻转当前搜索结果中各扩展名的选中状态"
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    visible.forEach((a) => {
                      if (!next.delete(a.extension)) next.add(a.extension);
                    });
                    return next;
                  })
                }
              >
                反选
              </button>
              <button
                type="button"
                className="btn btn--mini"
                title="取消全部选中"
                onClick={() => setSelected(new Set())}
              >
                清空
              </button>
            </div>
            <span className="counter">
              已选 {selected.size} / 共 {associations.length}
            </span>
          </div>
        </aside>

        <section className="content">
          {busy && (
            <div className={`progress${progressPct === null ? " progress--indet" : ""}`}>
              {progressPct !== null && (
                <div className="progress__fill" style={{ width: `${progressPct}%` }} />
              )}
              <span className="progress__text">{progressText}</span>
            </div>
          )}

          <IconSettingsCard
            zedPath={zedPath}
            onPickZed={() => void pickZed()}
            mode={mode}
            onModeChange={setMode}
            customDir={customDir}
            onCustomDirChange={setCustomDir}
            onPickDir={() => void pickDir()}
            icoCount={icoCount}
          />

          <ActionsCard
            selectedCount={selected.size}
            canApply={canApply}
            canApplyAll={canApplyAll}
            busy={busy}
            onApplySelected={() => void startApply(selectedTargets())}
            onApplyAll={() => void startApply(allTargets())}
            onReset={() => {
              if (selected.size === 0) {
                appendErr("请先在左侧选中要恢复默认图标的扩展名");
              } else {
                setDialog("remove");
              }
            }}
          />

          <RefreshCard
            busy={busy}
            clearCache={clearCache}
            restartExplorer={restartExplorer}
            onClearCacheChange={setClearCache}
            onRestartExplorerChange={setRestartExplorer}
            onRefresh={() => {
              if (restartExplorer) {
                setDialog("refresh");
              } else {
                void startRefresh();
              }
            }}
          />

          <div className="content__spacer" />
        </section>
      </div>

      <LogPanel
        log={log}
        logRef={logRef}
        onClear={() => setLog([])}
        onCopyAll={() => void writeText(log.map((l) => l.text).join("\n"))}
      />

      {dialog && <ConfirmDialog kind={dialog} onConfirm={confirmDialog} onCancel={() => setDialog(null)} />}
    </div>
  );
}

// ================= 列表行 =================

function Row({
  assoc,
  selected,
  onToggle,
}: {
  assoc: Association;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`row${selected ? " row--sel" : ""}`}
      title={`ProgID：${assoc.progId}`}
      onClick={onToggle}
    >
      <span className="row__check" aria-hidden>
        {selected && (
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path
              d="M1.5 6.2 L4.4 9 L10.5 2.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="row__ext">.{assoc.extension}</span>
      <span className="row__pills">
        {assoc.hasDefaultIcon ? (
          <span className="pill pill--ok">已设置</span>
        ) : (
          <span className="pill pill--weak">默认</span>
        )}
        {assoc.sharedProgId && (
          <span
            className="pill pill--warn"
            title={`此关联使用共享 ProgID（${assoc.progId}）：修改图标会同时影响所有通过「打开方式」关联到同一程序的文件类型`}
          >
            共享
          </span>
        )}
      </span>
    </button>
  );
}

// ================= 空状态 =================

function EmptyState() {
  return (
    <div className="empty">
      <div className="empty__title">未找到任何文件关联</div>
      <div className="empty__sub">当前通道下的 Zed 尚未注册文件关联</div>
      <div className="empty__guide">
        <div className="empty__guide-title">如何关联文件</div>
        <div>1. 确认右上角通道与实际安装的 Zed 版本一致</div>
        <div>2. 重新运行 Zed 安装器并勾选「注册文件关联」</div>
        <div>3. 或在 Zed 命令面板搜索 file associations 相关命令</div>
      </div>
      <div className="empty__foot">注册完成后，切换通道或重启本工具即可管理图标</div>
    </div>
  );
}

// ================= 右侧卡片 =================

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card__title">{title}</div>
      {children}
    </section>
  );
}

function IconSettingsCard(props: {
  zedPath: string | null;
  onPickZed: () => void;
  mode: IconMode;
  onModeChange: (m: IconMode) => void;
  customDir: string;
  onCustomDirChange: (v: string) => void;
  onPickDir: () => void;
  icoCount: number | null;
}) {
  const { zedPath, onPickZed, mode, onModeChange, customDir, onCustomDirChange, onPickDir, icoCount } =
    props;
  return (
    <Card title="图标设置">
      <div className="line">
        <span className="field-label field-label--weak">Zed 可执行文件</span>
        <button
          type="button"
          className="btn btn--mini"
          title="手动指定 Zed / ZedG 可执行文件（适用于任何安装方式）"
          onClick={onPickZed}
        >
          选择…
        </button>
      </div>
      <div className={`path${zedPath ? "" : " path--warn"}`} title={zedPath ?? undefined}>
        {zedPath ?? "未检测到，「Zed 应用图标」模式不可用"}
      </div>

      <div className="radio-group">
        {MODES.map((m) => (
          <label key={m.key} className="radio" title={m.hint}>
            <input
              type="radio"
              name="icon-mode"
              checked={mode === m.key}
              onChange={() => onModeChange(m.key)}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      {mode === "custom" && (
        <div className="custom-dir">
          <div className="line">
            <span className="field-label field-label--weak">图标目录</span>
            <div className="line__right">
              <button
                type="button"
                className="btn btn--mini"
                title="选择包含 <扩展名>.ico 文件的文件夹"
                onClick={onPickDir}
              >
                浏览…
              </button>
              <input
                className="input"
                placeholder="包含 <扩展名>.ico 文件的目录"
                value={customDir}
                onChange={(e) => onCustomDirChange(e.target.value)}
              />
            </div>
          </div>
          {icoCount !== null ? (
            icoCount > 0 ? (
              <span className="pill pill--ok">{icoCount} 个 .ico 文件</span>
            ) : (
              <div className="hint hint--warn">目录中没有 .ico 文件，应用时将回退系统图标</div>
            )
          ) : customDir.trim() !== "" ? (
            <div className="hint hint--warn">目录不存在或无法读取</div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ActionsCard(props: {
  selectedCount: number;
  canApply: boolean;
  canApplyAll: boolean;
  busy: boolean;
  onApplySelected: () => void;
  onApplyAll: () => void;
  onReset: () => void;
}) {
  const { selectedCount, canApply, canApplyAll, busy, onApplySelected, onApplyAll, onReset } = props;
  return (
    <Card title="操作">
      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={!canApply}
        title="将当前图标模式应用到左侧勾选的扩展名"
        onClick={onApplySelected}
      >
        应用到选中{selectedCount > 0 ? `（${selectedCount}）` : ""}
      </button>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--wide"
          disabled={!canApplyAll}
          title="应用到当前通道下的全部文件关联（忽略勾选状态）"
          onClick={onApplyAll}
        >
          应用到全部
        </button>
        <button
          type="button"
          className="btn btn--danger btn--wide"
          disabled={busy}
          title="删除选中项的 DefaultIcon 注册表键，恢复系统默认图标"
          onClick={onReset}
        >
          恢复默认
        </button>
      </div>
    </Card>
  );
}

function RefreshCard(props: {
  busy: boolean;
  clearCache: boolean;
  restartExplorer: boolean;
  onClearCacheChange: (v: boolean) => void;
  onRestartExplorerChange: (v: boolean) => void;
  onRefresh: () => void;
}) {
  const { busy, clearCache, restartExplorer, onClearCacheChange, onRestartExplorerChange, onRefresh } =
    props;
  return (
    <Card title="刷新资源管理器">
      <div className="hint">修改注册表后需通知系统刷新，图标才会立即更新</div>
      <button
        type="button"
        className="btn btn--wide"
        disabled={busy}
        title="广播关联变更通知；按下方勾选项决定是否清缓存 / 重启 Explorer"
        onClick={onRefresh}
      >
        立即刷新
      </button>
      <label className="check" title="删除 IconCache.db 与 thumbcache_*.db，强制 Explorer 重建图标缓存">
        <input
          type="checkbox"
          checked={clearCache}
          onChange={(e) => onClearCacheChange(e.target.checked)}
        />
        <span>清除图标缓存</span>
      </label>
      <label className="check" title="重启期间桌面和任务栏会短暂消失（约 2-3 秒），刷新效果最彻底">
        <input
          type="checkbox"
          checked={restartExplorer}
          onChange={(e) => onRestartExplorerChange(e.target.checked)}
        />
        <span>重启 Explorer</span>
      </label>
    </Card>
  );
}

// ================= 日志面板 =================

function LogPanel(props: {
  log: LogLine[];
  logRef: RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onCopyAll: () => void;
}) {
  const { log, logRef, onClear, onCopyAll } = props;
  return (
    <footer className="logpanel">
      <div className="logpanel__head">
        <span className="logpanel__title">操作日志</span>
        <div className="logpanel__tools">
          <span className="counter counter--weak">{log.length} 条</span>
          <button type="button" className="btn btn--mini" title="复制全部日志到剪贴板" onClick={onCopyAll}>
            复制
          </button>
          <button type="button" className="btn btn--mini" title="清空日志区" onClick={onClear}>
            清空
          </button>
        </div>
      </div>
      <div className="logpanel__body" ref={logRef}>
        {log.map((line, index) => (
          <div
            key={index}
            className={`logline${line.error ? " logline--error" : ""}`}
            title="右键复制本条"
            onContextMenu={(e) => {
              e.preventDefault();
              void writeText(line.text);
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
    </footer>
  );
}

// ================= 确认对话框 =================

const DIALOG_TEXT: Record<DialogKind, { title: string; message: string }> = {
  remove: {
    title: "恢复默认图标",
    message: "确定要恢复所有选中文件的默认图标吗？\n将删除选中项的 DefaultIcon 注册表键。",
  },
  refresh: {
    title: "重启资源管理器",
    message: "即将重启 Explorer，桌面和任务栏会短暂消失。\n确定继续吗？",
  },
  quit: {
    title: "退出程序",
    message: "仍有操作正在进行中，确定要退出吗？\n退出可能导致部分图标设置未完成。",
  },
};

function ConfirmDialog(props: {
  kind: DialogKind;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { kind, onConfirm, onCancel } = props;
  const text = DIALOG_TEXT[kind];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__title">{text.title}</div>
        <div className="dialog__message">{text.message}</div>
        <div className="dialog__buttons">
          <button type="button" className="btn btn--dialog" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn--primary btn--dialog" onClick={onConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
