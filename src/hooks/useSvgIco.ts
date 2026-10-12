// SVG → ICO 工具的状态与动作
//
// 逻辑集中在这里，对话框组件只负责渲染（保持「props 进、回调出」的约定）。
// 转换本身完全在前端完成：SVG → Canvas 光栅化 → PNG → ICO 容器（见 lib/ico.ts）。

import { useCallback, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { baseName } from "../lib/iconInfo";
import { t } from "../lib/i18n";
import { buildIco, formatBytes, ICO_SIZES } from "../lib/ico";
import type { ToastTone } from "./useToast";

export interface SvgIcoState {
  open: boolean;
  /** 已选择的 SVG 路径 */
  svgPath: string;
  svgText: string;
  /** 勾选的输出尺寸 */
  sizes: number[];
  converting: boolean;
  /** 转换结果（null 表示尚未转换或已失效） */
  bytes: Uint8Array | null;
  message: string;
  error: string;
}

const INITIAL: SvgIcoState = {
  open: false,
  svgPath: "",
  svgText: "",
  sizes: [16, 32, 48, 256],
  converting: false,
  bytes: null,
  message: "",
  error: "",
};

export function useSvgIco(push: (tone: ToastTone, text: string, ttl?: number) => void) {
  const [state, setState] = useState<SvgIcoState>(INITIAL);

  const patch = useCallback((part: Partial<SvgIcoState>) => {
    setState((prev) => ({ ...prev, ...part }));
  }, []);

  const openDialog = useCallback(() => {
    patch({ open: true, error: "", message: "" });
  }, [patch]);

  const closeDialog = useCallback(() => {
    patch({ open: false });
  }, [patch]);

  /** 选择 SVG 文件并读取文本 */
  const pickSvg = useCallback(async () => {
    try {
      const path = await open({
        multiple: false,
        title: t("dialog.pickSvg"),
        filters: [{ name: t("dialog.svgFilter"), extensions: ["svg"] }],
      });
      if (typeof path !== "string") return;
      const text = await api.readSvgFile(path);
      patch({ svgPath: path, svgText: text, bytes: null, message: "", error: "" });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    }
  }, [patch]);

  /** 勾选 / 取消输出尺寸（改动后需重新转换） */
  const toggleSize = useCallback((size: number) => {
    setState((prev) => {
      const has = prev.sizes.includes(size);
      const sizes = has
        ? prev.sizes.filter((item) => item !== size)
        : [...prev.sizes, size].sort((a, b) => a - b);
      return { ...prev, sizes, bytes: null, message: "" };
    });
  }, []);

  /** 执行转换 */
  const convert = useCallback(async () => {
    if (state.svgText.trim() === "") {
      patch({ error: t("svg.error.needFile") });
      return;
    }
    if (state.sizes.length === 0) {
      patch({ error: t("svg.error.needSize") });
      return;
    }
    patch({ converting: true, error: "", message: "" });
    try {
      const bytes = await buildIco(state.svgText, state.sizes);
      patch({
        bytes,
        message: t("svg.message.done", [state.sizes.length, formatBytes(bytes.length)]),
      });
    } catch (err) {
      patch({
        bytes: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      patch({ converting: false });
    }
  }, [patch, state.sizes, state.svgText]);

  /** 保存为 .ico */
  const saveIco = useCallback(async () => {
    if (!state.bytes) {
      patch({ error: t("svg.error.save") });
      return;
    }
    try {
      const suggested = state.svgPath
        ? `${baseName(state.svgPath).replace(/\.svg$/i, "")}.ico`
        : "icon.ico";
      const path = await save({
        title: t("dialog.saveIco"),
        defaultPath: suggested,
        filters: [{ name: t("dialog.icoFilterName"), extensions: ["ico"] }],
      });
      if (typeof path !== "string") return;
      await api.saveIcoFile(path, state.bytes);
      push("ok", `图标已保存：${baseName(path)}`);
      patch({ open: false });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    }
  }, [patch, push, state.bytes, state.svgPath]);

  return {
    svgIco: state,
    availableSizes: ICO_SIZES,
    openSvgIco: openDialog,
    closeSvgIco: closeDialog,
    pickSvg,
    toggleIcoSize: toggleSize,
    convertSvg: convert,
    saveIco,
  };
}
