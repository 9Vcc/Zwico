// SVG 转 ICO 对话框：选择 SVG → 勾选输出尺寸 → 转换 → 保存为 .ico

import { useEffect } from "react";
import type { SvgIcoState } from "../hooks/useSvgIco";
import { baseName } from "../lib/iconInfo";
import { t } from "../lib/i18n";
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
        aria-label={t("svg.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <span className="dialog__icon dialog__icon--accent">
            <IconShapes size={16} />
          </span>
          <h2 className="dialog__title">{t("svg.title")}</h2>
        </div>
        <p className="dialog__message">{t("svg.desc")}</p>

        <div className="svg-ico">
          <div className="svg-ico__preview">
            {state.svgText ? (
              <img src={svgDataUrl(state.svgText)} alt={t("svg.preview.alt")} />
            ) : (
              <span className="svg-ico__placeholder">{t("svg.noFile")}</span>
            )}
          </div>

          <div className="svg-ico__side">
            <div className="row-btns">
              <button type="button" className="btn btn--mini" onClick={onPickSvg}>
                {t("svg.pick")}
              </button>
              {state.svgPath ? (
                <span className="svg-ico__file" data-tip={state.svgPath}>
                  {baseName(state.svgPath)}
                </span>
              ) : null}
            </div>

            <span className="field__label">{t("svg.sizes")}</span>
            <div className="size-grid">
              {availableSizes.map((size) => {
                const on = state.sizes.includes(size);
                return (
                  <label
                    key={size}
                    className={`size-chip${on ? " size-chip--on" : ""}`}
                    data-tip={t("svg.size.tip", [size])}
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
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--dialog"
            disabled={state.converting || state.sizes.length === 0 || state.svgText === ""}
            data-tip={t("svg.convert.tip")}
            onClick={onConvert}
          >
            {state.converting ? <Spinner size={12} /> : null}
            {t("svg.convert")}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--dialog"
            disabled={state.bytes === null}
            data-tip={state.bytes ? t("svg.save.tip") : t("svg.save.needConvert")}
            onClick={onSave}
          >
            <IconDownload size={13} />
            {t("svg.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
