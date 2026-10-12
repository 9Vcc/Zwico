// 预设包：把「图标模式 + 自定义目录 + 逐项图标」导出为 JSON，便于备份与分享
//
// 预设只描述「怎么设置图标」，不含任何注册表结果，因此导入后必须显式点「应用」才生效。

import type { IconMode } from "../api";
import { timestampSlug } from "./iconInfo";

export const PRESET_FORMAT = "rsicon-preset";
export const PRESET_VERSION = 1;

export interface Preset {
  format: typeof PRESET_FORMAT;
  version: number;
  /** 生成时间（Unix 秒） */
  createdAt: number;
  mode: IconMode;
  customDir: string;
  /** 扩展名 → .ico 绝对路径（逐项指定的图标） */
  perExtension: Record<string, string>;
}

const MODE_KEYS: IconMode[] = ["system", "app", "custom"];

/** 由当前配置构造预设 */
export function buildPreset(input: {
  mode: IconMode;
  customDir: string;
  perExtension: Record<string, string>;
}): Preset {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    createdAt: Math.floor(Date.now() / 1000),
    mode: input.mode,
    customDir: input.customDir,
    perExtension: { ...input.perExtension },
  };
}

/** 序列化为带缩进的 JSON 文本 */
export function presetToText(preset: Preset): string {
  return `${JSON.stringify(preset, null, 2)}\n`;
}

/**
 * 解析预设文本，校验失败时抛出可展示的中文错误。
 * 对可疑字段采取「规范化 + 丢弃非法项」而不是整体失败，避免手工编辑的预设直接不可用。
 */
export function parsePreset(text: string): Preset {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("预设文件不是合法的 JSON");
  }

  if (typeof data !== "object" || data === null) {
    throw new Error("预设文件内容为空或格式不正确");
  }

  const record = data as Record<string, unknown>;
  if (record.format !== PRESET_FORMAT) {
    throw new Error("这不是 RsIcon 预设文件（缺少 format 标记）");
  }

  const version = typeof record.version === "number" ? record.version : 0;
  if (version > PRESET_VERSION) {
    throw new Error(`预设版本 v${version} 高于当前支持版本 v${PRESET_VERSION}，请升级工具`);
  }

  const mode = MODE_KEYS.includes(record.mode as IconMode)
    ? (record.mode as IconMode)
    : "system";

  const customDir = typeof record.customDir === "string" ? record.customDir : "";

  const perExtension: Record<string, string> = {};
  const rawMap = record.perExtension;
  if (typeof rawMap === "object" && rawMap !== null) {
    for (const [key, value] of Object.entries(rawMap as Record<string, unknown>)) {
      if (typeof value !== "string" || value.trim() === "") continue;
      const extension = key.trim().replace(/^\./, "").toLowerCase();
      if (extension === "" || extension.includes(".")) continue;
      perExtension[extension] = value;
    }
  }

  return {
    format: PRESET_FORMAT,
    version,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    mode,
    customDir,
    perExtension,
  };
}

/** 预设的默认文件名 */
export function presetFileName(): string {
  return `rsicon-preset-${timestampSlug()}.json`;
}
