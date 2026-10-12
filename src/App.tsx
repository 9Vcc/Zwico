// 应用外壳：把 store 的状态与动作分发给纯展示组件，
// 并集中处理布局交互（侧栏拖拽）、快捷键与全局状态提示。

import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { MODES } from "./api";
import { ActionsCard, MaintenanceCard, UndoCard } from "./components/ActionCards";
import { AssociationList } from "./components/AssociationList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { IconSettingsCard } from "./components/IconSettingsCard";
import { LogPanel } from "./components/LogPanel";
import { PresetCard } from "./components/PresetCard";
import { TopBar } from "./components/TopBar";
import { IconAlert, IconWand } from "./components/ui";
import { useAppStore } from "./hooks/useAppStore";
import { ToastStack } from "./hooks/useToast";
import { channelExeName } from "./lib/iconInfo";

export default function App() {
  const store = useAppStore();
  const modeLabel = MODES.find((m) => m.key === store.mode)?.label ?? store.mode;

  // ---------- 快捷键 ----------
  // store 每轮渲染都是新对象，用 ref 持有以避免反复重绑监听
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = storeRef.current;
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "a" && !typing) {
          event.preventDefault();
          current.selectAllVisible();
        } else if (key === "z" && !typing && current.undoStatus.available) {
          event.preventDefault();
          current.undo();
        } else if (key === "r") {
          event.preventDefault();
          current.reload();
        }
        return;
      }

      if (current.dialog !== null) return; // 对话框自己处理 Esc / Enter
      if (event.key === "Escape" && !typing) {
        current.clearSelection();
      } else if (event.key === "Enter" && !typing && current.stats.selected > 0) {
        current.applySelected();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- 侧栏宽度拖拽 ----------
  const dragging = useRef(false);
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    store.setSidebarWidth(event.clientX);
  };
  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // ---------- 进度 ----------
  const progress = store.progress;
  const determinate = progress !== null && progress.total > 0;
  const percent = determinate && progress ? Math.round((progress.current / progress.total) * 100) : 0;

  const style = { "--sidebar-w": `${store.sidebarWidth}px` } as CSSProperties;

  return (
    <div className="app" style={style}>
      <TopBar
        channel={store.channel}
        busy={store.busy}
        theme={store.theme}
        onChannelChange={store.changeChannel}
        onToggleTheme={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
      />

      <div className="main">
        <AssociationList
          items={store.visible}
          total={store.associations.length}
          selected={store.selected}
          search={store.search}
          busy={store.busy}
          loaded={store.loaded}
          exeName={channelExeName(store.channel)}
          perExtension={store.perExtension}
          onSearch={store.setSearch}
          onToggle={store.toggle}
          onSelectAll={store.selectAllVisible}
          onInvert={store.invertVisible}
          onClear={store.clearSelection}
          onPickIcon={(ext) => void store.pickIconFor(ext)}
          onClearIcon={store.clearIconFor}
        />

        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整列表宽度"
          title="拖动调整列表宽度（双击恢复默认）"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onDoubleClick={() => store.setSidebarWidth(288)}
        />

        <section className="content">
          {store.busy ? (
            <div className={`progress${determinate ? "" : " progress--indet"}`}>
              {determinate ? (
                <div className="progress__fill" style={{ width: `${percent}%` }} />
              ) : null}
              <span className="progress__text">{store.progressText}</span>
            </div>
          ) : null}

          {store.stats.invalid > 0 ? (
            <div className="banner">
              <span className="banner__icon" aria-hidden>
                <IconAlert size={14} />
              </span>
              <span className="banner__text">
                检测到 <b>{store.stats.invalid}</b> 个扩展名的图标已失效（图标文件不存在）
              </span>
              <button
                type="button"
                className="btn btn--mini btn--attention"
                disabled={store.busy}
                title="按当前图标来源重设这些关联，使其重新可用"
                onClick={store.repairInvalid}
              >
                <IconWand size={12} />
                一键修复
              </button>
            </div>
          ) : null}

          <IconSettingsCard
            zedPath={store.zedPath}
            mode={store.mode}
            customDir={store.customDir}
            icoCount={store.icoCount}
            perExtensionCount={Object.keys(store.perExtension).length}
            disabled={store.busy}
            onPickZed={() => void store.pickZed()}
            onModeChange={store.setMode}
            onCustomDirChange={store.setCustomDir}
            onPickCustomDir={() => void store.pickCustomDir()}
          />

          <ActionsCard
            selectedCount={store.stats.selected}
            total={store.stats.total}
            modeLabel={modeLabel}
            busy={store.busy}
            onApplySelected={store.applySelected}
            onApplyAll={store.applyAll}
            onReset={() => store.setDialog("remove")}
          />

          <UndoCard status={store.undoStatus} busy={store.busy} onUndo={store.undo} />

          <MaintenanceCard
            busy={store.busy}
            clearCache={store.clearCache}
            restartExplorer={store.restartExplorer}
            invalidCount={store.stats.invalid}
            onClearCache={store.setClearCache}
            onRestartExplorer={store.setRestartExplorer}
            onRefresh={store.requestRefresh}
            onRepair={store.repairInvalid}
          />

          <PresetCard
            busy={store.busy}
            modeLabel={modeLabel}
            perExtensionCount={Object.keys(store.perExtension).length}
            customDir={store.customDir}
            onExport={() => void store.exportPreset()}
            onImport={() => void store.importPreset()}
          />
        </section>
      </div>

      <LogPanel
        log={store.log}
        collapsed={store.logCollapsed}
        onToggleCollapse={store.toggleLogCollapsed}
        onClear={store.clearLogs}
      />

      {store.dialog !== null ? (
        <ConfirmDialog
          kind={store.dialog}
          onConfirm={store.confirmDialog}
          onCancel={() => store.setDialog(null)}
        />
      ) : null}

      <ToastStack toasts={store.toasts} onDismiss={store.dismissToast} />
    </div>
  );
}
