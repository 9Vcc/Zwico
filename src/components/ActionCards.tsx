// 操作卡片：图标应用 / 恢复、撤销、SVG 转 ICO 工具
//
// 按「主操作 → 次操作 → 工具」三层排列；撤销与工具入口都收在本卡内。

import type { UndoStatus } from "../api";
import { formatTimestamp } from "../lib/iconInfo";
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
  apply: "应用图标",
  remove: "恢复默认",
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
    ? (ACTION_LABEL[undoStatus.action] ?? undoStatus.action)
    : "";
  const undoNote = undoStatus.available
    ? `可恢复到「${undoLabel}」之前（${undoStatus.count} 项 · ${formatTimestamp(undoStatus.timestamp ?? 0)}）`
    : "每次写入前会自动记录原值，可撤销一次";

  return (
    <Card title="操作" hint={`当前来源：${modeLabel}`}>
      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={!canApply}
        data-tip={
          selectedCount > 0
            ? `把「${modeLabel}」应用到左侧勾选的 ${selectedCount} 个扩展名`
            : "请先在左侧勾选要操作的扩展名"
        }
        onClick={onApplySelected}
      >
        {busy ? <Spinner size={13} /> : null}
        应用到选中{selectedCount > 0 ? `（${selectedCount}）` : ""}
      </button>

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={busy || total === 0}
          data-tip="应用到当前通道下的全部文件关联（忽略勾选状态）"
          onClick={onApplyAll}
        >
          应用到全部{total > 0 ? `（${total}）` : ""}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || selectedCount === 0}
          data-tip="删除选中项的 DefaultIcon 注册表键，恢复系统默认图标（执行前会确认）"
          onClick={onReset}
        >
          恢复默认
        </button>
      </div>

      <div className="card__divider" />

      <div className="undo-block">
        <button
          type="button"
          className="btn btn--wide"
          disabled={busy || !undoStatus.available}
          data-tip={
            undoStatus.available
              ? "把上次写入涉及的 DefaultIcon 恢复为写入前的值（只能撤销一次）"
              : "暂无可撤销的记录：执行一次「应用」或「恢复默认」后即可使用"
          }
          onClick={onUndo}
        >
          <IconUndo size={14} />
          撤销上次操作
        </button>
        <p className="card__note">{undoNote}</p>
      </div>

      <div className="card__divider" />

      <button
        type="button"
        className="btn btn--wide btn--tool"
        disabled={busy}
        data-tip="把 SVG 矢量图转换成多尺寸 .ico（16/24/32/48/64/128/256），可直接用于「自定义图标目录」或逐项专属图标"
        onClick={onOpenSvgIco}
      >
        <IconShapes size={14} />
        SVG 转 ICO 生成图标
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
  const extras = [clearCache ? "清除图标缓存" : "", restartExplorer ? "重启 Explorer" : ""].filter(
    Boolean,
  );

  return (
    <Card
      title="刷新与修复"
      hint="写入图标后会自动通知系统；刷新仍不生效时可用下面的动作"
      action={invalidCount > 0 ? <Pill tone="danger">{invalidCount} 项失效</Pill> : undefined}
    >
      {invalidCount > 0 ? (
        <button
          type="button"
          className="btn btn--wide btn--attention"
          disabled={busy}
          data-tip="按当前图标来源重设所有指向已不存在文件的关联"
          onClick={onRepair}
        >
          <IconWand size={14} />
          一键修复失效图标（{invalidCount}）
        </button>
      ) : null}

      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={busy}
        data-tip="广播关联变更通知；附加动作按设置页的「刷新行为」执行"
        onClick={onRefresh}
      >
        <IconRefresh size={14} />
        立即刷新资源管理器
      </button>

      {/* 附加动作的开关已移到设置页，这里给出当前会执行什么 */}
      <p className="card__note">
        {extras.length > 0 ? `附加动作：${extras.join(" + ")}` : "附加动作：仅广播变更通知"}
        <button
          type="button"
          className="link-btn"
          data-tip="在设置页调整刷新行为"
          onClick={onOpenSettings}
        >
          调整
        </button>
      </p>

      {restartExplorer ? (
        <p className="inline-warn">
          <IconAlert size={13} />
          重启 Explorer 会让桌面与任务栏短暂消失
        </p>
      ) : null}
    </Card>
  );
}
