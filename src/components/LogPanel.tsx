// 日志面板：分级着色、自动吸底、右键菜单、可折叠
//
// 右键菜单由外部（App）构造，这里只上报事件。

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LogLine } from "../api";
import { t } from "../lib/i18n";
import { IconChevron, IconCopy, IconTrash } from "./ui";

export function LogPanel({
  log,
  collapsed,
  onToggleCollapse,
  onClear,
  onLineMenu,
}: {
  log: LogLine[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClear: () => void;
  onLineMenu: (line: LogLine, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // 新日志自动吸底（折叠时不滚动，避免无谓布局）
  useEffect(() => {
    const el = bodyRef.current;
    if (el && !collapsed) el.scrollTop = el.scrollHeight;
  }, [log, collapsed]);

  const copyAll = () =>
    void writeText(log.map((line) => t(line.key, line.params)).join("\n"));

  return (
    <footer className={`logpanel${collapsed ? " logpanel--collapsed" : ""}`}>
      <div className="logpanel__head">
        <button
          type="button"
          className="logpanel__toggle"
          data-tip={collapsed ? t("log.expand") : t("log.collapse")}
          onClick={onToggleCollapse}
        >
          <IconChevron size={13} open={!collapsed} />
          <span className="logpanel__title">{t("log.title")}</span>
        </button>
        <div className="logpanel__tools">
          <span className="counter counter--weak">{t("log.count", [log.length])}</span>
          <button
            type="button"
            className="btn btn--mini"
            data-tip={t("log.copy.tip")}
            onClick={copyAll}
          >
            <IconCopy size={12} />
            {t("log.copy")}
          </button>
          <button type="button" className="btn btn--mini" data-tip={t("log.clear.tip")} onClick={onClear}>
            <IconTrash size={12} />
            {t("log.clear")}
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="logpanel__body" ref={bodyRef}>
          {log.length === 0 ? (
            <div className="logline logline--muted">{t("log.empty")}</div>
          ) : (
            log.map((line, index) => (
              <div
                key={index}
                className={`logline logline--${line.level}`}
                data-tip={t("log.line.tip")}
                onContextMenu={(event) => onLineMenu(line, event)}
              >
                {t(line.key, line.params)}
              </div>
            ))
          )}
        </div>
      )}
    </footer>
  );
}
