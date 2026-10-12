// 图标设置卡片：只保留高频项（图标来源模式、自定义目录）
//
// Zed 可执行文件的检测与更换属于低频配置，已迁到设置页；
// 这里只显示一行状态并提供跳转，因为「Zed 应用图标」模式的可用性依赖它。

import { MODES, type IconMode } from "../api";
import { baseName } from "../lib/iconInfo";
import { t } from "../lib/i18n";
import { Card, IconFolder, Pill } from "./ui";

export function IconSettingsCard({
  zedPath,
  mode,
  customDir,
  icoCount,
  perExtensionCount,
  disabled,
  onModeChange,
  onCustomDirChange,
  onPickCustomDir,
  onUseDefaultDir,
  defaultIconDir,
  onOpenSettings,
}: {
  zedPath: string | null;
  mode: IconMode;
  customDir: string;
  icoCount: number | null;
  perExtensionCount: number;
  disabled: boolean;
  onModeChange: (mode: IconMode) => void;
  onCustomDirChange: (value: string) => void;
  onPickCustomDir: () => void;
  onUseDefaultDir: () => void;
  /** 默认自定义图标目录（后端探测；input 留空时生效） */
  defaultIconDir: string;
  onOpenSettings: () => void;
}) {
  return (
    <Card title={t("card.icons")} hint={t("card.icons.hint")}>
      <div className={`path${zedPath ? "" : " path--warn"}`} title={zedPath ?? undefined}>
        <span className={`dot ${zedPath ? "dot--ok" : "dot--warn"}`} aria-hidden />
        <span className="path__text">{zedPath ? baseName(zedPath) : t("zed.notFound")}</span>
        <button
          type="button"
          className="path__link"
          data-tip={t("zed.manage.tip")}
          onClick={onOpenSettings}
        >
          {t("zed.manage")}
        </button>
      </div>

      <div className="field">
        <span className="field__label">{t("field.iconSource")}</span>
        <div className="options">
          {MODES.map((item) => {
            const needsZed = item === "app" && !zedPath;
            return (
              <button
                key={item}
                type="button"
                className={`option${mode === item ? " option--on" : ""}`}
                title={needsZed ? t("mode.needsZed") : t(`mode.${item}.hint`)}
                disabled={disabled || needsZed}
                aria-pressed={mode === item}
                onClick={() => onModeChange(item)}
              >
                <span className="option__radio" aria-hidden />
                <span className="option__text">
                  <span className="option__label">{t(`mode.${item}`)}</span>
                  <span className="option__hint">{t(`mode.${item}.hint`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "custom" ? (
        <div className="field field--sub">
          <div className="field__head">
            <span className="field__label">{t("field.iconDir")}</span>
            <button
              type="button"
              className="btn btn--mini"
              data-tip="清空自定义路径，改用应用目录下的 icon 文件夹"
              disabled={customDir.trim() === ""}
              onClick={onUseDefaultDir}
            >
              {t("iconDir.useDefault")}
            </button>
            <button
              type="button"
              className="btn btn--mini"
              data-tip={t("iconDir.browse.tip")}
              onClick={onPickCustomDir}
            >
              <IconFolder size={12} />
              {t("iconDir.browse")}
            </button>
          </div>
          <input
            className="input"
            placeholder={defaultIconDir || t("iconDir.placeholder")}
            value={customDir}
            onChange={(e) => onCustomDirChange(e.target.value)}
          />
          <div className="field__status">
            {icoCount === null ? (
              customDir.trim() === "" ? (
                <Pill tone="muted">{t("iconDir.none")}</Pill>
              ) : (
                <Pill tone="danger" title={t("iconDir.unreadable.tip")}>
                  {t("iconDir.unreadable")}
                </Pill>
              )
            ) : icoCount > 0 ? (
              <Pill tone="ok">{t("iconDir.count", [icoCount])}</Pill>
            ) : (
              <Pill tone="warn">{t("iconDir.empty")}</Pill>
            )}
            {perExtensionCount > 0 ? (
              <Pill tone="info" title={t("iconDir.perItem.tip")}>
                {t("iconDir.perItem", [perExtensionCount])}
              </Pill>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
