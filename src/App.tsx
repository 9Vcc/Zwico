// 应用外壳：把 store 的状态与动作分发给纯展示组件，
// 并集中处理布局交互（侧栏/日志拖拽、边界夹紧）、快捷键与全局状态提示。

import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { MODES } from "./api";
import { ActionsCard, MaintenanceCard } from "./components/ActionCards";
import { AssociationList } from "./components/AssociationList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { IconSettingsCard } from "./components/IconSettingsCard";
import { LogPanel } from "./components/LogPanel";
import { PresetCard } from "./components/PresetCard";
import { SvgToIcoDialog } from "./components/SvgToIcoDialog";
import { TitleBar } from "./components/TitleBar";
import { TooltipLayer } from "./components/Tooltip";
import { IconAlert, IconWand } from "./components/ui";
import { useAppStore } from "./hooks/useAppStore";
import { ToastStack } from "./hooks/useToast";
import { channelExeName } from "./lib/iconInfo";

export default function App() {
  const store = useAppStore();
  const modeLabel = MODES.find((m) => m.key === store.mode)?.label ?? store.mode;

  // store 每轮渲染都是新对象，用 ref 持有以避免反复重绑监听
  const storeRef = useRef(store);
  storeRef.current = store;

  // ---------- 快捷键 ----------
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

      if (current.dialog !== null || current.svgIco.open) return; // 对话框自己处理 Esc / Enter
      if (event.key === "Escape" && !typing) {
        current.clearSelection();
      } else if (event.key === "Enter" && !typing && current.stats.selected > 0) {
        current.applySelected();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- 窗口尺寸变化：重新夹紧面板尺寸 ----------
  // 无边框窗口由系统提供边缘缩放；缩小窗口后必须重新夹紧，
  // 否则侧栏/日志会把内容区压到不可用（clamp 内部对未变化的值会跳过更新）
  useEffect(() => {
    const onResize = () => {
      const current = storeRef.current;
      current.setSidebarWidth(current.sidebarWidth);
      current.setLogHeight(current.logHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---------- 侧栏宽度拖拽 ----------
  const sidebarDragging = useRef(false);
  const onSidebarStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    sidebarDragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onSidebarMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarDragging.current) return;
    store.setSidebarWidth(event.clientX);
  };
  const onSidebarEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarDragging.current) return;
    sidebarDragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // ---------- 日志高度拖拽（向上变大） ----------
  const logDrag = useRef<{ startY: number; startHeight: number } | null>(null);
  const onLogStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    logDrag.current = { startY: event.clientY, startHeight: store.logHeight };
  };
  const onLogMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = logDrag.current;
    if (!drag) return;
    store.setLogHeight(drag.startHeight - (event.clientY - drag.startY));
  };
  const onLogEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!logDrag.current) return;
    logDrag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // ---------- 进度 ----------
  const progress = store.progress;
  const determinate = progress !== null && progress.total > 0;
  const percent =
    determinate && progress ? Math.round((progress.current / progress.total) * 100) : 0;

  const style = {
    "--sidebar-w": `${store.sidebarWidth}px`,
    "--log-h": `${store.logHeight}px`,
  } as CSSProperties;

  return (
    <div className="app" style={style}>
      <TitleBar
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
          previews={store.iconPreviews}
          onSearch={store.setSearch}
          onToggle={store.toggle}
          onSelectAll={store.selectAllVisible}
          onInvert={store.invertVisible}
          onClear={store.clearSelection}
          onPickIcon={(ext) => void store.pickIconFor(ext)}
          onClearIcon={store.clearIconFor}
        />

        <div
          className="resizer resizer--v"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整列表宽度"
          data-tip="拖动调整列表宽度（双击恢复默认）"
          onPointerDown={onSidebarStart}
          onPointerMove={onSidebarMove}
          onPointerUp={onSidebarEnd}
          onDoubleClick={() => store.setSidebarWidth(288)}
        />

        <section className="content-area">
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
                data-tip="按当前图标来源重设这些关联，使其重新可用"
                onClick={store.repairInvalid}
              >
                <IconWand size={12} />
                一键修复
              </button>
            </div>
          ) : null}

          {/* 滚动由外层承担：多列容器必须高度自适应，否则内容超限会横向新增列 */}
          <div className="content-scroll">
            <section className="content">
              <IconSettingsCard
                zedPath={store.zedPath}
                mode={store.mode}
                customDir={store.customDir}
                icoCount={store.icoCount}
                perExtensionCount={Object.keys(store.perExtension).length}
                disabled={store.busy}
                installations={store.installations}
                scanning={store.scanning}
                onPickZed={() => void store.pickZed()}
                onScan={() => void store.scanZed()}
                onUseInstallation={store.useInstallation}
                onModeChange={store.setMode}
                onCustomDirChange={store.setCustomDir}
                onPickCustomDir={() => void store.pickCustomDir()}
              />

              <ActionsCard
                selectedCount={store.stats.selected}
                total={store.stats.total}
                modeLabel={modeLabel}
                busy={store.busy}
                undoStatus={store.undoStatus}
                onApplySelected={store.applySelected}
                onApplyAll={store.applyAll}
                onReset={() => store.setDialog("remove")}
                onUndo={store.undo}
                onOpenSvgIco={store.openSvgIco}
              />

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
        </section>
      </div>

      {store.logCollapsed ? null : (
        <div
          className="resizer resizer--h"
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖动调整日志高度"
          data-tip="拖动调整日志高度（双击恢复默认）"
          onPointerDown={onLogStart}
          onPointerMove={onLogMove}
          onPointerUp={onLogEnd}
          onDoubleClick={() => store.setLogHeight(150)}
        />
      )}

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

      {store.svgIco.open ? (
        <SvgToIcoDialog
          state={store.svgIco}
          availableSizes={store.availableSizes}
          onClose={store.closeSvgIco}
          onPickSvg={() => void store.pickSvg()}
          onToggleSize={store.toggleIcoSize}
          onConvert={() => void store.convertSvg()}
          onSave={() => void store.saveIco()}
        />
      ) : null}

      <ToastStack toasts={store.toasts} onDismiss={store.dismissToast} />

      {/* 统一的自绘提示层（data-tip / data-tip-icon） */}
      <TooltipLayer />
    </div>
  );
}
