// 确认对话框：Esc 取消 / Enter 确认，点击遮罩取消

import { useEffect } from "react";
import type { DialogKind } from "../hooks/useAppStore";
import { t } from "../lib/i18n";
import { IconAlert } from "./ui";

const DIALOG_TEXT: Record<
  DialogKind,
  { title: string; message: string; confirm: string; danger: boolean }
> = {
  remove: {
    title: "dialog.remove.title",
    message: "dialog.remove.message",
    confirm: "dialog.remove.confirm",
    danger: true,
  },
  refresh: {
    title: "dialog.refresh.title",
    message: "dialog.refresh.message",
    confirm: "dialog.refresh.confirm",
    danger: false,
  },
  undo: {
    title: "dialog.undo.title",
    message: "dialog.undo.message",
    confirm: "dialog.undo.confirm",
    danger: false,
  },
  register: {
    title: "dialog.register.title",
    message: "dialog.register.message",
    confirm: "dialog.register.confirm",
    danger: true,
  },
  quit: {
    title: "dialog.quit.title",
    message: "dialog.quit.message",
    confirm: "dialog.quit.confirm",
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
        aria-label={t(text.title)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          {text.danger ? (
            <span className="dialog__icon" aria-hidden>
              <IconAlert size={16} />
            </span>
          ) : null}
          <h2 className="dialog__title">{t(text.title)}</h2>
        </div>
        <p className="dialog__message">{t(text.message)}</p>
        <div className="dialog__buttons">
          <button type="button" className="btn btn--dialog" onClick={onCancel}>
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            className={`btn ${text.danger ? "btn--danger-solid" : "btn--primary"} btn--dialog`}
            onClick={onConfirm}
          >
            {t(text.confirm)}
          </button>
        </div>
      </div>
    </div>
  );
}
