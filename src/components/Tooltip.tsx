// 统一的自绘提示浮层（取代原生 title 属性，使其与界面配色一致）
//
// 用法：把原生 `title="说明"` 换成 `data-tip="说明"`；
// 需要「悬浮放大预览」时再加：
//   data-tip-icon="<data url>"  → 显示图片
//   data-tip-title=".md"        → 显示标题行
//
// 实现要点：全局事件委托 + `position: fixed` 浮层。
// 不能用 CSS 伪元素（`:hover::after`）—— 列表容器有 `overflow: auto`，
// 伪元素会被裁剪，而 fixed 浮层不会。

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface TipState {
  text: string;
  title: string;
  icon: string | null;
  x: number;
  y: number;
  placement: "top" | "bottom";
}

/** 估算浮层半宽，用于把气泡夹在窗口内 */
const HALF_WIDTH = 170;

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let timer: number | undefined;

    const show = (target: HTMLElement) => {
      const text = target.dataset.tip ?? "";
      const icon = target.dataset.tipIcon ?? "";
      const title = target.dataset.tipTitle ?? "";
      if (text === "" && icon === "" && title === "") return;

      const rect = target.getBoundingClientRect();
      // 上方空间不足时翻到下方
      const placement: TipState["placement"] = rect.top > 110 ? "top" : "bottom";
      setTip({
        text,
        title,
        icon: icon === "" ? null : icon,
        x: Math.min(Math.max(rect.left + rect.width / 2, HALF_WIDTH + 8), window.innerWidth - HALF_WIDTH - 8),
        y: placement === "top" ? rect.top - 8 : rect.bottom + 8,
        placement,
      });
    };

    const findTarget = (event: Event): HTMLElement | null => {
      const node = event.target as HTMLElement | null;
      if (node === null) return null;
      return node.closest<HTMLElement>("[data-tip], [data-tip-icon], [data-tip-title]");
    };

    const onOver = (event: Event) => {
      const target = findTarget(event);
      if (target === null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => show(target), 110);
    };

    const onOut = (event: Event) => {
      if (findTarget(event) === null) return;
      // 稍作延迟：从图标移到行内其它位置时不会闪一下
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTip(null), 60);
    };

    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };

    // 捕获阶段监听，保证在任意滚动容器内滚动都能收起
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (tip === null) return null;

  const style: CSSProperties = {
    left: tip.x,
    top: tip.y,
    transform: tip.placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  };

  return (
    <div className={`tooltip tooltip--${tip.placement}`} style={style} role="tooltip">
      {tip.icon !== null ? <img className="tooltip__icon" src={tip.icon} alt="" /> : null}
      <div className="tooltip__body">
        {tip.title !== "" ? <div className="tooltip__title">{tip.title}</div> : null}
        {tip.text !== "" ? <div className="tooltip__text">{tip.text}</div> : null}
      </div>
    </div>
  );
}
