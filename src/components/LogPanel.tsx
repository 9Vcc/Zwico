// 日志面板：分级着色、自动吸底、右键菜单、可折叠
//
// 右键菜单由外部（App）构造，这里只上报事件。

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LogLine } from "../api";
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

  const copyAll = () => void writeText(log.map((line) => line.text).join("\n"));

  return (
    <footer className={`logpanel${collapsed ? " logpanel--collapsed" : ""}`}>
      <div className="logpanel__head">
        <button
          type="button"
          className="logpanel__toggle"
          data-tip={collapsed ? "展开日志面板" : "折叠日志面板"}
          onClick={onToggleCollapse}
        >
          <IconChevron size={13} open={!collapsed} />
          <span className="logpanel__title">操作日志</span>
        </button>
        <div className="logpanel__tools">
          <span className="counter counter--weak">{log.length} 条</span>
          <button
            type="button"
            className="btn btn--mini"
            data-tip="复制全部日志到剪贴板"
            onClick={copyAll}
          >
            <IconCopy size={12} />
            复制
          </button>
          <button type="button" className="btn btn--mini" data-tip="清空日志区" onClick={onClear}>
            <IconTrash size={12} />
            清空
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="logpanel__body" ref={bodyRef}>
          {log.length === 0 ? (
            <div className="logline logline--muted">暂无日志</div>
          ) : (
            log.map((line, index) => (
              <div
                key={index}
                className={`logline logline--${line.level}`}
                data-tip="右键查看更多操作"
                onContextMenu={(event) => onLineMenu(line, event)}
              >
                {line.text}
              </div>
            ))
          )}
        </div>
      )}
    </footer>
  );
}
