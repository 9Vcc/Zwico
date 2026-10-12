// 设置页：把低频配置从主界面各卡片集中到这里
//
// 分组：外观与布局（含语言）/ Zed 安装 / 刷新行为 / 配置与数据 / 快捷键 / 关于
// 全部文案走 i18n（t()），语言切换后随 store.lang 变化重渲染。

import { APP_VERSION, CHANNELS, type ZedInstallation } from "../api";
import { baseName } from "../lib/iconInfo";
import { t, type LangPref } from "../lib/i18n";
import { Select } from "./Select";
import {
  Card,
  IconBack,
  IconDownload,
  IconFolder,
  IconSearch,
  IconUpload,
  Pill,
  Spinner,
  Switch,
} from "./ui";

const SHORTCUTS: { keys: string; actionKey: string }[] = [
  { keys: "Ctrl + A", actionKey: "shortcut.selectAll" },
  { keys: "Ctrl + Z", actionKey: "shortcut.undo" },
  { keys: "Ctrl + R", actionKey: "shortcut.reload" },
  { keys: "Enter", actionKey: "shortcut.apply" },
  { keys: "Esc", actionKey: "shortcut.escape" },
];

export function SettingsPage({
  theme,
  lang,
  logCollapsed,
  sidebarWidth,
  logHeight,
  clearCache,
  restartExplorer,
  zedPath,
  installations,
  scanning,
  perExtensionCount,
  customDir,
  viewport,
  onBack,
  onThemeChange,
  onLangChange,
  onToggleLogCollapsed,
  onResetSidebar,
  onResetLogHeight,
  onClearCacheChange,
  onRestartExplorerChange,
  onScan,
  onPickZed,
  onUseInstallation,
  onExportPreset,
  onImportPreset,
}: {
  theme: "dark" | "light";
  lang: LangPref;
  logCollapsed: boolean;
  sidebarWidth: number;
  logHeight: number;
  clearCache: boolean;
  restartExplorer: boolean;
  zedPath: string | null;
  installations: ZedInstallation[];
  scanning: boolean;
  perExtensionCount: number;
  customDir: string;
  /** 当前窗口与面板尺寸（排查布局问题时便于核对） */
  viewport: { width: number; height: number };
  onBack: () => void;
  onThemeChange: (theme: "dark" | "light") => void;
  onLangChange: (lang: LangPref) => void;
  onToggleLogCollapsed: () => void;
  onResetSidebar: () => void;
  onResetLogHeight: () => void;
  onClearCacheChange: (value: boolean) => void;
  onRestartExplorerChange: (value: boolean) => void;
  onScan: () => void;
  onPickZed: () => void;
  onUseInstallation: (path: string) => void;
  onExportPreset: () => void;
  onImportPreset: () => void;
}) {
  return (
    <div className="settings">
      <div className="settings__head">
        <button
          type="button"
          className="btn btn--mini"
          data-tip={t("settings.back.tip")}
          onClick={onBack}
        >
          <IconBack size={13} />
          {t("settings.back")}
        </button>
        <h2 className="settings__title">{t("settings.title")}</h2>
        <span className="counter counter--weak">v{APP_VERSION}</span>
      </div>

      <div className="settings__grid">
        <div className="settings__col">
          <Card title={t("settings.appearance")} hint={t("settings.appearance.hint")}>
            <div className="settings__row">
              <span className="field__label">{t("settings.theme")}</span>
              <div className="seg">
                <button
                  type="button"
                  className={`btn btn--mini${theme === "dark" ? " btn--on" : ""}`}
                  data-tip={t("settings.theme.dark.tip")}
                  onClick={() => onThemeChange("dark")}
                >
                  {t("settings.theme.dark")}
                </button>
                <button
                  type="button"
                  className={`btn btn--mini${theme === "light" ? " btn--on" : ""}`}
                  data-tip={t("settings.theme.light.tip")}
                  onClick={() => onThemeChange("light")}
                >
                  {t("settings.theme.light")}
                </button>
              </div>
            </div>

            <div className="settings__row">
              <span className="field__label">{t("settings.language")}</span>
              <Select
                value={lang}
                options={[
                  { value: "auto", label: t("language.auto") },
                  { value: "zh", label: t("language.zh") },
                  { value: "en", label: t("language.en") },
                ]}
                ariaLabel={t("settings.language")}
                dataTip={t("settings.language.hint")}
                onChange={onLangChange}
              />
            </div>

            <Switch
              checked={logCollapsed}
              onChange={() => onToggleLogCollapsed()}
              label={t("settings.logCollapsed")}
              title={t("settings.logCollapsed.tip")}
            />

            <div className="settings__row">
              <span className="field__label">{t("settings.panelSize")}</span>
              <div className="seg">
                <button
                  type="button"
                  className="btn btn--mini"
                  data-tip={t("settings.resetSidebar.tip", [sidebarWidth])}
                  onClick={onResetSidebar}
                >
                  {t("settings.resetSidebar")}
                </button>
                <button
                  type="button"
                  className="btn btn--mini"
                  data-tip={t("settings.resetLogHeight.tip", [logHeight])}
                  onClick={onResetLogHeight}
                >
                  {t("settings.resetLogHeight")}
                </button>
              </div>
            </div>
          </Card>

          <Card title={t("settings.zed")} hint={t("settings.zed.hint")}>
            <div className={`path${zedPath ? "" : " path--warn"}`} title={zedPath ?? undefined}>
              <span className={`dot ${zedPath ? "dot--ok" : "dot--warn"}`} aria-hidden />
              <span className="path__text">
                {zedPath ? baseName(zedPath) : t("zed.notFound")}
              </span>
              <span className="path__sub">{zedPath ?? t("zed.notFound.hint")}</span>
            </div>

            <div className="row-btns">
              <button
                type="button"
                className="btn btn--mini"
                disabled={scanning}
                data-tip={t("settings.zed.detect.tip")}
                onClick={onScan}
              >
                {scanning ? <Spinner size={11} /> : <IconSearch size={11} />}
                {t("settings.zed.detect")}
              </button>
              <button
                type="button"
                className="btn btn--mini"
                data-tip={t("settings.zed.pick.tip")}
                onClick={onPickZed}
              >
                <IconFolder size={11} />
                {t("settings.zed.pick")}
              </button>
            </div>

            {installations.length > 0 ? (
              <ul className="install-list" aria-label={t("settings.zed.scanned")}>
                {installations.map((item) => {
                  const active = zedPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        className={`install-item${active ? " install-item--on" : ""}`}
                        title={`${item.path}\n${t("settings.zed.source", [t(item.source)])}`}
                        onClick={() => onUseInstallation(item.path)}
                      >
                        <span className="install-item__channel">
                          {CHANNELS.some((c) => c.key === item.channel)
                            ? t(`channel.${item.channel}`)
                            : item.channel}
                        </span>
                        <span className="install-item__path">{item.path}</span>
                        <span className="install-item__source">{t(item.source)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>

          <Card title={t("settings.refresh")} hint={t("settings.refresh.hint")}>
            <Switch
              checked={clearCache}
              onChange={onClearCacheChange}
              label={t("settings.clearCache")}
              title={t("settings.clearCache.tip")}
            />
            <Switch
              checked={restartExplorer}
              onChange={onRestartExplorerChange}
              label={t("settings.restartExplorer")}
              title={t("settings.restartExplorer.tip")}
            />
          </Card>
        </div>

        <div className="settings__col">
          <Card title={t("settings.data")} hint={t("settings.data.hint")}>
            <div className="preset__meta">
              {perExtensionCount > 0 ? (
                <Pill tone="ok">{t("iconDir.perItem", [perExtensionCount])}</Pill>
              ) : null}
              {customDir !== "" ? (
                <Pill tone="muted" title={customDir}>
                  {t("settings.customDirSet")}
                </Pill>
              ) : null}
              {perExtensionCount === 0 && customDir === "" ? (
                <Pill tone="muted">{t("settings.noCustom")}</Pill>
              ) : null}
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                data-tip={t("settings.export.tip")}
                onClick={onExportPreset}
              >
                <IconDownload size={13} />
                {t("settings.export")}
              </button>
              <button
                type="button"
                className="btn"
                data-tip={t("settings.import.tip")}
                onClick={onImportPreset}
              >
                <IconUpload size={13} />
                {t("settings.import")}
              </button>
            </div>
          </Card>

          <Card title={t("settings.shortcuts")}>
            <dl className="shortcuts">
              {SHORTCUTS.map((item) => (
                <div className="shortcuts__row" key={item.keys}>
                  <dt>
                    <kbd>{item.keys}</kbd>
                  </dt>
                  <dd>{t(item.actionKey)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title={t("settings.about")}>
            <div className="about">
              <div className="about__row">
                <span>{t("about.version")}</span>
                <span>v{APP_VERSION}</span>
              </div>
              <div className="about__row">
                <span>{t("about.layout")}</span>
                <span>
                  {t("about.layout.value", [
                    viewport.width,
                    viewport.height,
                    sidebarWidth,
                    logHeight,
                  ])}
                </span>
              </div>
              <div className="about__row">
                <span>{t("about.registry")}</span>
                <span>{t("about.registry.value")}</span>
              </div>
              <div className="about__row">
                <span>{t("about.storage")}</span>
                <span>{t("about.storage.value")}</span>
              </div>
              <div className="about__row">
                <span>{t("about.undo")}</span>
                <span>{t("about.undo.value")}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
