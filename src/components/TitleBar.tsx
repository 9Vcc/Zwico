// 自定义标题栏（窗口已 `decorations: false`）
//
// 结构与职责：
//   - 左侧：品牌 + 版本 + 忙碌指示，整块既是标题也是**窗口拖拽区**
//   - 右侧：通道选择、主题切换、窗口按钮（最小化/最大化/关闭）
//   - 窗口边缘缩放由系统保留的 WS_SIZEBOX 提供（Tauri 的 resizable 窗口即使无装饰也保留该样式），
//     因此这里不需要自绘缩放热区

import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { APP_VERSION, api, CHANNELS, onWindowMaximized, type ChannelKey } from "../api";
import { t } from "../lib/i18n";
import { Select } from "./Select";
import {
  IconClose,
  IconGear,
  IconMaximize,
  IconMinimize,
  IconPalette,
  IconRestore,
  Spinner,
} from "./ui";

export function TitleBar({
  channel,
  busy,
  theme,
  view,
  onChannelChange,
  onToggleTheme,
  onToggleView,
}: {
  channel: ChannelKey;
  busy: boolean;
  theme: "dark" | "light";
  view: "main" | "settings";
  onChannelChange: (value: ChannelKey) => void;
  onToggleTheme: () => void;
  onToggleView: () => void;
}) {
  const [maximized, setMaximized] = useState(false);

  // 初始化 + 订阅最大化状态（后端在窗口 Resized 时广播）
  useEffect(() => {
    void api
      .windowIsMaximized()
      .then(setMaximized)
      .catch(() => undefined);

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onWindowMaximized(setMaximized).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    void api.startWindowDrag();
  };

  return (
    <header className="titlebar">
      <div
        className="titlebar__drag"
        onPointerDown={startDrag}
        onDoubleClick={() => void api.windowToggleMaximize()}
        data-tip={t("titlebar.drag")}
      >
        <span className="brand__mark" aria-hidden>
          Z
        </span>
        <div className="brand__text">
          <h1 className="brand__title">{t("app.title")}</h1>
          <p className="brand__sub">{t("app.subtitle", [APP_VERSION])}</p>
        </div>
        {busy ? (
          <span className="busy-chip" data-tip={t("titlebar.busy.tip")}>
            <Spinner size={12} />
            处理中
          </span>
        ) : null}
      </div>

      <div className="titlebar__tools">
        <Select
          value={channel}
          options={CHANNELS.map((item) => ({
            value: item.key,
            label: t(`channel.${item.key}`),
            hint: t(`channel.${item.key}.hint`),
          }))}
          disabled={busy}
          ariaLabel={t("titlebar.channel")}
          dataTip={t("titlebar.channel")}
          onChange={onChannelChange}
        />

        <button
          type="button"
          className="btn btn--icon"
          data-tip={theme === "dark" ? t("titlebar.theme.toLight") : t("titlebar.theme.toDark")}
          aria-label={t("titlebar.theme.label")}
          onClick={onToggleTheme}
        >
          <IconPalette size={15} />
        </button>

        <button
          type="button"
          className={`btn btn--icon${view === "settings" ? " btn--on" : ""}`}
          data-tip={view === "settings" ? t("titlebar.settings.back") : t("titlebar.settings.open")}
          aria-label={view === "settings" ? t("titlebar.settings.back") : t("titlebar.settings.open")}
          aria-pressed={view === "settings"}
          onClick={onToggleView}
        >
          <IconGear size={15} />
        </button>

        <div className="win-controls">
          <button
            type="button"
            className="win-btn"
            data-tip={t("win.minimize")}
            aria-label="最小化"
            onClick={() => void api.windowMinimize()}
          >
            <IconMinimize size={14} />
          </button>
          <button
            type="button"
            className="win-btn"
            data-tip={maximized ? t("win.restore") : t("win.maximize")}
            aria-label={maximized ? "还原" : "最大化"}
            onClick={() => void api.windowToggleMaximize()}
          >
            {maximized ? <IconRestore size={13} /> : <IconMaximize size={13} />}
          </button>
          <button
            type="button"
            className="win-btn win-btn--close"
            data-tip={t("win.close")}
            aria-label="关闭"
            onClick={() => void api.windowClose()}
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
