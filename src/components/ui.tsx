// 基础展示件与内联图标：不引入任何 UI 库，样式全部走 CSS 变量

import type { ReactNode } from "react";
import type { Tone } from "../lib/iconInfo";

export function Card({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card__head">
        <h2 className="card__title">{title}</h2>
        {action}
      </header>
      {hint ? <p className="card__hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Pill({
  tone = "muted",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

export function Switch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden>
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

// ---------- 图标（16×16 网格，1.5px 描边，继承 currentColor） ----------

function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const IconCheck = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 8.4 L6.2 11.5 L13 4.5" />
  </Svg>
);

export const IconSearch = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 L14 14" />
  </Svg>
);

export const IconClose = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 4 L12 12 M12 4 L4 12" />
  </Svg>
);

export const IconRefresh = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.6 2.2 V5.4 H10.4" />
  </Svg>
);

export const IconUndo = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.4 2.2 V5.4 H5.6" />
  </Svg>
);

export const IconDownload = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.5 V10" />
    <path d="M5 7 L8 10 L11 7" />
    <path d="M3 12.5 H13" />
  </Svg>
);

export const IconUpload = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 10 V2.5" />
    <path d="M5 5.5 L8 2.5 L11 5.5" />
    <path d="M3 12.5 H13" />
  </Svg>
);

export const IconFolder = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2 4.2 A1.2 1.2 0 0 1 3.2 3 H6.2 L7.6 4.6 H12.8 A1.2 1.2 0 0 1 14 5.8 V11.8 A1.2 1.2 0 0 1 12.8 13 H3.2 A1.2 1.2 0 0 1 2 11.8 Z" />
  </Svg>
);

export const IconImage = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
    <circle cx="6" cy="6.6" r="1.1" />
    <path d="M2.6 11.2 L6.6 8.2 L9.4 10.6 L11.6 8.8 L13.4 10.4" />
  </Svg>
);

export const IconAlert = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.6 L14.2 13 H1.8 Z" />
    <path d="M8 6.6 V9.4" />
    <path d="M8 11.2 V11.3" />
  </Svg>
);

export const IconShare = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="4.2" cy="8" r="2" />
    <circle cx="11.8" cy="4.2" r="2" />
    <circle cx="11.8" cy="11.8" r="2" />
    <path d="M6 7 L10 5.2 M6 9 L10 10.8" />
  </Svg>
);

export const IconChevron = ({ size, open }: IconProps & { open?: boolean }) => (
  <Svg size={size}>
    <path d={open ? "M4 6.2 L8 10.2 L12 6.2" : "M6.2 4 L10.2 8 L6.2 12"} />
  </Svg>
);

export const IconCopy = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="5.4" y="2.6" width="8" height="9.4" rx="1.2" />
    <path d="M10.6 12 H3.6 A1.2 1.2 0 0 1 2.4 10.8 V5.4" />
  </Svg>
);

export const IconTrash = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 4.4 H13" />
    <path d="M6.4 4.4 V3.2 A0.8 0.8 0 0 1 7.2 2.4 H8.8 A0.8 0.8 0 0 1 9.6 3.2 V4.4" />
    <path d="M4.4 4.4 L5 12.6 A1 1 0 0 0 6 13.5 H10 A1 1 0 0 0 11 12.6 L11.6 4.4" />
  </Svg>
);

export const IconWand = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 13 L10.6 5.4" />
    <path d="M9.4 4.2 L11.8 6.6" />
    <path d="M12.6 2.4 V4.4 M13.8 3.4 H11.8" />
    <path d="M4.4 2.6 V4 M5.2 3.3 H3.6" />
  </Svg>
);

export const IconPalette = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.4a5.6 5.6 0 0 0 0 11.2c1 0 1.4-.6 1.4-1.2 0-.9-1-1.1-1-1.9 0-.7.6-1.2 1.4-1.2h1.1A2.7 2.7 0 0 0 13.6 6.6C13.6 4.3 11.1 2.4 8 2.4Z" />
    <path d="M5.4 7.2V7.3 M8 6.2V6.3 M10.4 7.2V7.3" />
  </Svg>
);

// ---------- 窗口控制（自定义标题栏） ----------

export const IconMinimize = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 8 H13" />
  </Svg>
);

export const IconMaximize = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
  </Svg>
);

export const IconRestore = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.8" y="5.6" width="7.6" height="7.6" rx="1" />
    <path d="M5.4 5.6 V4.2 A1.2 1.2 0 0 1 6.6 3 H11.6 A1.2 1.2 0 0 1 12.8 4.2 V9.2 A1.2 1.2 0 0 1 11.6 10.4 H10.4" />
  </Svg>
);

/** 拖拽手柄（横向拖拽条用） */
export const IconGrip = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.5 8 H13.5" />
  </Svg>
);

/** 图形转换（SVG 转 ICO）用 */
export const IconShapes = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.4 L11.2 8 H4.8 Z" />
    <circle cx="5" cy="11" r="2.6" />
    <rect x="8.6" y="8.4" width="5.4" height="5.4" rx="1.2" />
  </Svg>
);
