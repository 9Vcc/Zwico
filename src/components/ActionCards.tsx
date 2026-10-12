// 操作卡片：图标应用 / 恢复、撤销、SVG 转 ICO 工具
//
// 按「主操作 → 次操作 → 工具」三层排列；撤销与工具入口都收在本卡内。

import type { UndoStatus } from "../api";
import { formatTimestamp } from "../lib/iconInfo";
import { t } from "../lib/i18n";
import {
  Card,
  IconAlert,
  IconRefresh,
  IconShapes,
  IconUndo,
  IconWand,
  Pill,
  Spinner,
} from "./ui";

const ACTION_LABEL: Record<string, string> = {
  apply: "actionLabel.apply",
  remove: "actionLabel.remove",
};

export function ActionsCard({
  selectedCount,
  total,
  modeLabel,
  busy,
  undoStatus,
  onApplySelected,
  onApplyAll,
  onReset,
  onUndo,
  onOpenSvgIco,
}: {
  selectedCount: number;
  total: number;
  modeLabel: string;
  busy: boolean;
  undoStatus: UndoStatus;
  onApplySelected: () => void;
  onApplyAll: () => void;
  onReset: () => void;
  onUndo: () => void;
  onOpenSvgIco: () => void;
}) {
  const canApply = !busy && selectedCount > 0;
  const undoLabel = undoStatus.action
    ? t(ACTION_LABEL[undoStatus.action] ?? "actionLabel.other")
    : "";
  const undoNote = undoStatus.available
    ? t("action.undo.note", [
        undoLabel,
        undoStatus.count,
        formatTimestamp(undoStatus.timestamp ?? 0),
      ])
    : t("action.undo.idle");

  return (
    <Card title={t("card.actions")} hint={t("card.actions.hint", [modeLabel])}>
      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={!canApply}
        data-tip={
          selectedCount > 0
            ? t("action.applySelected.tip", [modeLabel, selectedCount])
            : t("action.applySelected.none")
        }
        onClick={onApplySelected}
      >
        {busy ? <Spinner size={13} /> : null}
        {t("action.applySelected")}
        {selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={busy || total === 0}
          data-tip={t("action.applyAll.tip")}
          onClick={onApplyAll}
        >
          {t("action.applyAll")}
          {total > 0 ? ` (${total})` : ""}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || selectedCount === 0}
          data-tip={t("action.reset.tip")}
          onClick={onReset}
        >
          {t("action.reset")}
        </button>
      </div>

      <div className="card__divider" />

      <div className="undo-block">
        <button
          type="button"
          className="btn btn--wide"
          disabled={busy || !undoStatus.available}
          data-tip={
            undoStatus.available ? t("action.undo.tip") : t("action.undo.unavailable")
          }
          onClick={onUndo}
        >
          <IconUndo size={14} />
          {t("action.undo")}
        </button>
        <p className="card__note">{undoNote}</p>
      </div>

      <div className="card__divider" />

      <button
        type="button"
        className="btn btn--wide btn--tool"
        disabled={busy}
        data-tip={t("action.svgIco.tip")}
        onClick={onOpenSvgIco}
      >
        <IconShapes size={14} />
        {t("action.svgIco")}
      </button>
    </Card>
  );
}

export function MaintenanceCard({
  busy,
  clearCache,
  restartExplorer,
  invalidCount,
  onRefresh,
  onRepair,
  onOpenSettings,
}: {
  busy: boolean;
  clearCache: boolean;
  restartExplorer: boolean;
  invalidCount: number;
  onRefresh: () => void;
  onRepair: () => void;
  onOpenSettings: () => void;
}) {
  const extras = [
    clearCache ? t("refresh.clearCache") : "",
    restartExplorer ? t("refresh.restartExplorer") : "",
  ].filter(Boolean);

  return (
    <Card
      title={t("card.maintenance")}
      hint={t("card.maintenance.hint")}
      action={
        invalidCount > 0 ? <Pill tone="danger">{t("maintenance.invalid", [invalidCount])}</Pill> : undefined
      }
    >
      {invalidCount > 0 ? (
        <button
          type="button"
          className="btn btn--wide btn--attention"
          disabled={busy}
          data-tip={t("repair.tip")}
          onClick={onRepair}
        >
          <IconWand size={14} />
          {t("repair", [invalidCount])}
        </button>
      ) : null}

      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={busy}
        data-tip={t("refresh.tip")}
        onClick={onRefresh}
      >
        <IconRefresh size={14} />
        {t("refresh")}
      </button>

      {/* 附加动作的开关已移到设置页，这里给出当前会执行什么 */}
      <p className="card__note">
        {extras.length > 0 ? t("refresh.extras", [extras.join(" + ")]) : t("refresh.extras.none")}
        <button
          type="button"
          className="link-btn"
          data-tip={t("refresh.adjust.tip")}
          onClick={onOpenSettings}
        >
          {t("refresh.adjust")}
        </button>
      </p>

      {restartExplorer ? (
        <p className="inline-warn">
          <IconAlert size={13} />
          {t("refresh.restart.warn")}
        </p>
      ) : null}
    </Card>
  );
}
