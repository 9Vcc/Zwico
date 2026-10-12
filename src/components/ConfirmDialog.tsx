// 确认对话框：Esc 取消 / Enter 确认，点击遮罩取消

import { useEffect } from "react";
import type { DialogKind } from "../hooks/useAppStore";
import { IconAlert } from "./ui";

const DIALOG_TEXT: Record<
  DialogKind,
  { title: string; message: string; confirm: string; danger: boolean }
> = {
  remove: {
    title: "恢复默认图标",
    message: "将删除选中项的 DefaultIcon 注册表键，图标回到系统默认。\n此操作会先记录原值，可在「撤销」中恢复一次。",
    confirm: "恢复默认",
    danger: true,
  },
  refresh: {
    title: "重启资源管理器",
    message: "即将结束并重启 Explorer，桌面与任务栏会短暂消失（约 2–3 秒）。\n确定继续吗？",
    confirm: "重启",
    danger: false,
  },
  undo: {
    title: "撤销上次操作",
    message: "将把上次写入涉及的 DefaultIcon 恢复为写入前的值。\n撤销记录只能使用一次，确定继续吗？",
    confirm: "撤销",
    danger: false,
  },
  quit: {
    title: "退出程序",
    message: "仍有操作正在进行中，现在退出可能导致部分图标未写入。\n确定要退出吗？",
    confirm: "退出",
    danger: true,
  },
};

export function ConfirmDialog({
  kind,
  onConfirm,
  onCancel,
}: {
  kind: DialogKind;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const text = DIALOG_TEXT[kind];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="overlay" onClick={onCancel} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          {text.danger ? (
            <span className="dialog__icon" aria-hidden>
              <IconAlert size={16} />
            </span>
          ) : null}
          <h2 className="dialog__title">{text.title}</h2>
        </div>
        <p className="dialog__message">{text.message}</p>
        <div className="dialog__buttons">
          <button type="button" className="btn btn--dialog" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`btn ${text.danger ? "btn--danger-solid" : "btn--primary"} btn--dialog`}
            onClick={onConfirm}
          >
            {text.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
