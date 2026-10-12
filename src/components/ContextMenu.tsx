// 自绘右键菜单
//
// 与 tooltip 同理：WebView 的默认右键菜单由系统绘制（含「重新加载 / 另存为 /
// 检查」等应用里不该出现的项），必须拦掉并自绘。
//
// 用法：调用方持有 `MenuState`（位置 + 菜单项），在 onContextMenu 里生成。

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

export interface MenuItem {
  /** 分隔线：只需设 separator，其余字段忽略 */
  separator?: boolean;
  label?: string;
  /** 右侧的补充说明（快捷键或当前值） */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const WIDTH = 236;
const ROW_HEIGHT = 30;

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === null) return;

    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, onClose]);

  if (menu === null) return null;

  // 夹在窗口内，避免菜单被裁掉
  const rows = menu.items.filter((item) => !item.separator).length;
  const separators = menu.items.length - rows;
  const height = rows * ROW_HEIGHT + separators * 9 + 8;
  const style: CSSProperties = {
    left: Math.max(4, Math.min(menu.x, window.innerWidth - WIDTH - 4)),
    top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
    width: WIDTH,
  };

  return (
    <div className="ctxmenu" style={style} role="menu" ref={ref}>
      {menu.items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="ctxmenu__sep" role="separator" />
        ) : (
          <button
            key={item.label ?? index}
            type="button"
            role="menuitem"
            className={`ctxmenu__item${item.danger ? " ctxmenu__item--danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            <span className="ctxmenu__label">{item.label}</span>
            {item.hint ? <span className="ctxmenu__hint">{item.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
