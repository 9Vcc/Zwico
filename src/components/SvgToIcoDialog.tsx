// SVG 转 ICO 对话框：选择 SVG → 勾选输出尺寸 → 转换 → 保存为 .ico

import { useEffect } from "react";
import type { SvgIcoState } from "../hooks/useSvgIco";
import { baseName } from "../lib/iconInfo";
import { svgDataUrl } from "../lib/ico";
import { IconDownload, IconShapes, Spinner } from "./ui";

export function SvgToIcoDialog({
  state,
  availableSizes,
  onClose,
  onPickSvg,
  onToggleSize,
  onConvert,
  onSave,
}: {
  state: SvgIcoState;
  availableSizes: readonly number[];
  onClose: () => void;
  onPickSvg: () => void;
  onToggleSize: (size: number) => void;
  onConvert: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label="SVG 转 ICO"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <span className="dialog__icon dialog__icon--accent">
            <IconShapes size={16} />
          </span>
          <h2 className="dialog__title">SVG 转 ICO</h2>
        </div>
        <p className="dialog__message">
          把 SVG 矢量图光栅化成多尺寸 .ico，生成的文件可直接用于「自定义图标」或「专属图标」。
        </p>

        <div className="svg-ico">
          <div className="svg-ico__preview">
            {state.svgText ? (
              <img src={svgDataUrl(state.svgText)} alt="SVG 预览" />
            ) : (
              <span className="svg-ico__placeholder">未选择文件</span>
            )}
          </div>

          <div className="svg-ico__side">
            <div className="row-btns">
              <button type="button" className="btn btn--mini" onClick={onPickSvg}>
                选择 SVG…
              </button>
              {state.svgPath ? (
                <span className="svg-ico__file" data-tip={state.svgPath}>
                  {baseName(state.svgPath)}
                </span>
              ) : null}
            </div>

            <span className="field__label">输出尺寸（可多选，像素）</span>
            <div className="size-grid">
              {availableSizes.map((size) => {
                const on = state.sizes.includes(size);
                return (
                  <label
                    key={size}
                    className={`size-chip${on ? " size-chip--on" : ""}`}
                    data-tip={`输出 ${size}×${size} 像素`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleSize(size)}
                    />
                    <span>{size}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {state.error !== "" ? <p className="inline-error">{state.error}</p> : null}
        {state.message !== "" ? <p className="inline-ok">{state.message}</p> : null}

        <div className="dialog__buttons">
          <button type="button" className="btn btn--dialog" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--dialog"
            disabled={state.converting || state.sizes.length === 0 || state.svgText === ""}
            data-tip="按所选尺寸生成图标数据"
            onClick={onConvert}
          >
            {state.converting ? <Spinner size={12} /> : null}
            转换
          </button>
          <button
            type="button"
            className="btn btn--primary btn--dialog"
            disabled={state.bytes === null}
            data-tip={state.bytes ? "保存为 .ico 文件" : "请先执行转换"}
            onClick={onSave}
          >
            <IconDownload size={13} />
            保存 .ico
          </button>
        </div>
      </div>
    </div>
  );
}
