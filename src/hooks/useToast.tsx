// 轻量浮层提示：操作结果反馈（成功 / 注意 / 失败）
// 自动消失、可点击关闭；最多同时保留 4 条，避免遮挡界面。

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "ok" | "info" | "warn" | "danger";

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /** 弹一条提示；ttl 毫秒后自动消失（错误保留更久） */
  const push = useCallback(
    (tone: ToastTone, text: string, ttl = 3600) => {
      const id = seq.current + 1;
      seq.current = id;
      setToasts((prev) => [...prev.slice(-3), { id, tone, text }]);
      const timer = window.setTimeout(
        () => dismiss(id),
        tone === "danger" ? Math.max(ttl, 6000) : ttl,
      );
      timers.current.push(timer);
    },
    [dismiss],
  );

  // 卸载时清理定时器，避免更新已卸载组件
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.tone}`}
          data-tip="点击关闭"
          onClick={() => onDismiss(toast.id)}
        >
          <span className="toast__bar" aria-hidden />
          <span className="toast__text">{toast.text}</span>
        </button>
      ))}
    </div>
  );
}
