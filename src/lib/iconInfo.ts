// 展示层推断：把 DefaultIcon 原始值翻译成用户看得懂的「图标来源」
//
// 解析规则与后端 src-tauri/src/icon.rs::parse_icon_value 保持一致，
// 但这里只做**展示推断**，不回写任何数据。

import type { Association, ChannelKey, LogLine } from "../api";
import { CHANNELS } from "../api";

export type Tone = "ok" | "info" | "warn" | "danger" | "muted";

export interface IconDescription {
  /** 徽标文案 */
  label: string;
  tone: Tone;
  /** 悬停说明（含原始路径或资源编号） */
  detail: string;
}

/** 解析 `"<路径>",<索引>` / `imageres.dll,-102` / 裸路径 */
export function parseIconValue(raw: string): { file: string; index: number | null } {
  const value = raw.trim();
  if (value === "") return { file: "", index: null };

  // 带引号：取第一对引号之间的内容
  if (value.startsWith('"')) {
    const rest = value.slice(1);
    const end = rest.indexOf('"');
    if (end === -1) return { file: rest, index: null };
    const index = Number.parseInt(rest.slice(end + 1).replace(/^,\s*/, ""), 10);
    return { file: rest.slice(0, end), index: Number.isNaN(index) ? null : index };
  }

  // 不带引号：最后一个逗号后必须是整数索引
  const comma = value.lastIndexOf(",");
  if (comma > 0) {
    const index = Number.parseInt(value.slice(comma + 1).trim(), 10);
    if (!Number.isNaN(index)) {
      return { file: value.slice(0, comma).trim(), index };
    }
  }
  return { file: value, index: null };
}

/** 取路径中的文件名 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** 通道对应的可执行文件名（用于判断是否为「Zed 应用图标」） */
export function channelExeName(channel: ChannelKey): string {
  return CHANNELS.find((c) => c.key === channel)?.exeName ?? "zed.exe";
}

/** 推断某个关联当前使用的图标来源 */
export function describeIcon(assoc: Association, exeName: string): IconDescription {
  const raw = assoc.currentIcon ?? "";
  const { file, index } = parseIconValue(raw);

  if (!assoc.hasDefaultIcon || raw === "") {
    return {
      label: "系统默认",
      tone: "muted",
      detail: "未设置 DefaultIcon，由资源管理器自行决定图标",
    };
  }

  if (assoc.iconState === "missing") {
    return {
      label: "图标失效",
      tone: "danger",
      detail: `指向的图标文件已不存在：${file}`,
    };
  }

  const name = baseName(file).toLowerCase();
  if (name === "imageres.dll") {
    return {
      label: "系统图标",
      tone: "info",
      detail: `Windows 内置图标资源 imageres.dll${index === null ? "" : `,${index}`}`,
    };
  }
  if (name === exeName.toLowerCase()) {
    return { label: "Zed 应用图标", tone: "ok", detail: file };
  }
  if (name.endsWith(".ico")) {
    return { label: name, tone: "ok", detail: file };
  }
  return { label: baseName(file) || "未知来源", tone: "warn", detail: raw };
}

/** Unix 秒 → 本地时间字符串 */
export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

/** 日志行 → 纯文本（复制用） */
export function logToText(lines: LogLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

/** 生成文件名用的时间戳后缀（YYYYMMDD-HHmm） */
export function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}
