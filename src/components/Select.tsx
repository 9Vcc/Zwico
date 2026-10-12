// 自绘下拉：原生 `<select>` 的弹层由系统绘制，无法与深色界面统一，
// 因此改用「按钮 + 浮层列表」（支持点击外部关闭、Esc、方向键、Enter 选中）。

import { useEffect, useRef, useState } from "react";
import { IconChevron } from "./ui";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** 选项的补充说明（第二行小字） */
  hint?: string;
}

export function Select<T extends string>({
  value,
  options,
  disabled,
  onChange,
  ariaLabel,
  dataTip,
}: {
  value: T;
  options: SelectOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
  ariaLabel?: string;
  dataTip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((option) => option.value === value);

  // 打开时把键盘高亮对齐到当前值
  useEffect(() => {
    if (open) {
      setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    }
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => Math.min(index + 1, options.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const option = options[active];
        if (option) {
          onChange(option.value);
          setOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, onChange, open, options]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        className="dropdown__button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={dataTip}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dropdown__value">{current?.label ?? value}</span>
        <IconChevron size={12} open={open} />
      </button>

      {open ? (
        <ul className="dropdown__menu" role="listbox">
          {options.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`dropdown__option${option.value === value ? " dropdown__option--on" : ""}${
                  index === active ? " dropdown__option--active" : ""
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="dropdown__label">{option.label}</span>
                {option.hint ? <span className="dropdown__hint">{option.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
