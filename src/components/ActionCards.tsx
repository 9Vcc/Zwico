// 操作卡片组：应用 / 恢复、撤销、资源管理器维护

import type { UndoStatus } from "../api";
import { formatTimestamp } from "../lib/iconInfo";
import { Card, IconAlert, IconRefresh, IconUndo, IconWand, Pill, Spinner, Switch } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  apply: "应用图标",
  remove: "恢复默认",
};

export function ActionsCard({
  selectedCount,
  total,
  modeLabel,
  busy,
  onApplySelected,
  onApplyAll,
  onReset,
}: {
  selectedCount: number;
  total: number;
  modeLabel: string;
  busy: boolean;
  onApplySelected: () => void;
  onApplyAll: () => void;
  onReset: () => void;
}) {
  const canApply = !busy && selectedCount > 0;
  return (
    <Card title="操作" hint={`当前来源：${modeLabel}`}>
      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={!canApply}
        title={
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
          className="btn btn--wide"
          disabled={busy || total === 0}
          title="应用到当前通道下的全部文件关联（忽略勾选状态）"
          onClick={onApplyAll}
        >
          应用到全部{total > 0 ? `（${total}）` : ""}
        </button>
        <button
          type="button"
          className="btn btn--danger btn--wide"
          disabled={busy || selectedCount === 0}
          title="删除选中项的 DefaultIcon 注册表键，恢复系统默认图标（会先确认）"
          onClick={onReset}
        >
          恢复默认
        </button>
      </div>
    </Card>
  );
}

export function UndoCard({
  status,
  busy,
  onUndo,
}: {
  status: UndoStatus;
  busy: boolean;
  onUndo: () => void;
}) {
  const label = status.action ? (ACTION_LABEL[status.action] ?? status.action) : "";
  const time = status.timestamp ? formatTimestamp(status.timestamp) : "";
  return (
    <Card
      title="撤销"
      hint={
        status.available
          ? `可恢复到上次写入之前的状态（${label} · ${status.count} 项 · ${time}）`
          : "每次写入前会自动记录原值，可随时撤销一次"
      }
    >
      <button
        type="button"
        className="btn btn--wide"
        disabled={busy || !status.available}
        title={
          status.available
            ? "把上次写入涉及的 DefaultIcon 恢复为写入前的值"
            : "暂无可撤销的记录（执行一次应用或恢复后即可用）"
        }
        onClick={onUndo}
      >
        <IconUndo size={14} />
        撤销上次操作
      </button>
    </Card>
  );
}

export function MaintenanceCard({
  busy,
  clearCache,
  restartExplorer,
  invalidCount,
  onClearCache,
  onRestartExplorer,
  onRefresh,
  onRepair,
}: {
  busy: boolean;
  clearCache: boolean;
  restartExplorer: boolean;
  invalidCount: number;
  onClearCache: (value: boolean) => void;
  onRestartExplorer: (value: boolean) => void;
  onRefresh: () => void;
  onRepair: () => void;
}) {
  return (
    <Card
      title="刷新与修复"
      hint="写入图标后会自动通知系统；清缓存与重启 Explorer 用于图标仍未更新的情况"
      action={invalidCount > 0 ? <Pill tone="danger">{invalidCount} 项失效</Pill> : undefined}
    >
      {invalidCount > 0 ? (
        <button
          type="button"
          className="btn btn--wide btn--attention"
          disabled={busy}
          title="按当前图标来源重设所有指向已不存在文件的关联"
          onClick={onRepair}
        >
          <IconWand size={14} />
          一键修复失效图标（{invalidCount}）
        </button>
      ) : null}

      <button
        type="button"
        className="btn btn--wide"
        disabled={busy}
        title="广播关联变更通知；按下方开关决定是否清缓存 / 重启 Explorer"
        onClick={onRefresh}
      >
        <IconRefresh size={14} />
        立即刷新资源管理器
      </button>

      <div className="switch-group">
        <Switch
          checked={clearCache}
          onChange={onClearCache}
          label="清除图标缓存"
          title="删除 IconCache.db 与 thumbcache_*.db，强制 Explorer 重建图标缓存"
        />
        <Switch
          checked={restartExplorer}
          onChange={onRestartExplorer}
          label="重启 Explorer"
          title="刷新最彻底，但桌面与任务栏会短暂消失（约 2–3 秒），执行前会二次确认"
        />
      </div>

      {restartExplorer ? (
        <p className="inline-warn">
          <IconAlert size={13} />
          重启 Explorer 会让桌面与任务栏短暂消失
        </p>
      ) : null}
    </Card>
  );
}
