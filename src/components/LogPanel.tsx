// 日志面板：分级着色、自动吸底、右键复制单条、可折叠
//
// 这里直接调用剪贴板插件（纯输出动作），是「组件保持纯展示」的唯一例外。

import { useEffect, useRef } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LogLine } from "../api";
import { IconChevron, IconCopy, IconTrash } from "./ui";

export function LogPanel({
  log,
  collapsed,
  onToggleCollapse,
  onClear,
}: {
  log: LogLine[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClear: () => void;
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
          title={collapsed ? "展开日志面板" : "折叠日志面板"}
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
            title="复制全部日志到剪贴板"
            onClick={copyAll}
          >
            <IconCopy size={12} />
            复制
          </button>
          <button type="button" className="btn btn--mini" title="清空日志区" onClick={onClear}>
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
                title="右键复制本条日志"
                onContextMenu={(event) => {
                  event.preventDefault();
                  void writeText(line.text);
                }}
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
