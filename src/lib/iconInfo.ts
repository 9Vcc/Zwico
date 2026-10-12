// 展示层推断：把 DefaultIcon 原始值翻译成用户看得懂的「图标来源」
//
// 解析规则与后端 src-tauri/src/icon.rs::parse_icon_value 保持一致，
// 但这里只做**展示推断**，不回写任何数据。

import type { Association, ChannelKey } from "../api";
import { CHANNELS } from "../api";

export type Tone = "ok" | "info" | "warn" | "danger" | "muted";

/** 图标来源描述（i18n：label/detail 以 key 形式返回，由组件用 t() 渲染） */
export interface IconDescription {
  labelKey: string;
  labelParams?: string[];
  tone: Tone;
  /** 需要翻译的详情 */
  detailKey?: string;
  detailParams?: string[];
  /** 无需翻译的详情（如文件路径，原样显示） */
  detailText?: string;
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
    return { labelKey: "icon.none", tone: "muted", detailKey: "icon.none.detail" };
  }

  if (assoc.iconState === "missing") {
    return {
      labelKey: "icon.missing",
      tone: "danger",
      detailKey: "icon.missing.detail",
      detailParams: [file],
    };
  }

  const name = baseName(file).toLowerCase();
  if (name === "imageres.dll") {
    return {
      labelKey: "icon.system",
      tone: "info",
      detailKey: "icon.system.detail",
      detailParams: [index === null ? "" : `,${index}`],
    };
  }
  if (name === exeName.toLowerCase()) {
    return { labelKey: "icon.app", tone: "ok", detailText: file };
  }
  if (name.endsWith(".ico")) {
    return {
      labelKey: "icon.custom",
      labelParams: [name],
      tone: "ok",
      detailText: file,
    };
  }
  return { labelKey: "icon.unknown", tone: "warn", detailText: raw };
}

/** 把描述渲染成可显示文本（需要 i18n 的 t 函数） */
export function renderIconDescription(
  desc: IconDescription,
  translate: (key: string, params?: (string | number)[]) => string,
): { label: string; detail: string } {
  return {
    label: translate(desc.labelKey, desc.labelParams),
    detail:
      desc.detailKey !== undefined
        ? translate(desc.detailKey, desc.detailParams)
        : (desc.detailText ?? ""),
  };
}

/** Unix 秒 → 本地时间字符串 */
export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

/** 生成文件名用的时间戳后缀（YYYYMMDD-HHmm） */
export function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}
