// 顶栏：品牌标识 + 通道选择 + 主题切换 + 忙碌指示

import { APP_VERSION, CHANNELS, type ChannelKey } from "../api";
import { IconPalette, Spinner } from "./ui";

export function TopBar({
  channel,
  busy,
  theme,
  onChannelChange,
  onToggleTheme,
}: {
  channel: ChannelKey;
  busy: boolean;
  theme: "dark" | "light";
  onChannelChange: (value: ChannelKey) => void;
  onToggleTheme: () => void;
}) {
  const current = CHANNELS.find((c) => c.key === channel);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden>
          Z
        </span>
        <div className="brand__text">
          <h1 className="brand__title">Zed 文件关联图标管理器</h1>
          <p className="brand__sub">v{APP_VERSION} · 仅修改当前用户配置，无需管理员权限</p>
        </div>
      </div>

      <div className="topbar__tools">
        {busy ? (
          <span className="busy-chip" title="有任务正在执行">
            <Spinner size={12} />
            处理中
          </span>
        ) : null}

        <label className="select-field" title={current?.hint ?? "选择实际安装的 Zed 发行通道"}>
          <span className="select-field__label">通道</span>
          <select
            className="select"
            value={channel}
            disabled={busy}
            aria-label="Zed 发行通道"
            onChange={(e) => onChannelChange(e.target.value as ChannelKey)}
          >
            {CHANNELS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn--icon"
          title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          aria-label="切换主题"
          onClick={onToggleTheme}
        >
          <IconPalette size={15} />
        </button>
      </div>
    </header>
  );
}
