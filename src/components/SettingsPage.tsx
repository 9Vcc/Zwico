// 设置页：把低频配置从主界面各卡片集中到这里
//
// 分组：外观与布局（含语言）/ Zed 安装 / 刷新行为 / 配置与数据 / 快捷键 / 关于
// 全部文案走 i18n（t()），语言切换后随 store.lang 变化重渲染。

import { useState } from "react";

import { APP_VERSION, CHANNELS, type AppRegistration, type ExtStatus, type ZedInstallation } from "../api";
import { baseName } from "../lib/iconInfo";
import { allPresetExtensions, EXT_PATTERN } from "../lib/presets";
import { t, type LangPref } from "../lib/i18n";
import type { ChannelKey } from "../api";
import { Select } from "./Select";
import {
  Card,
  IconBack,
  IconDownload,
  IconCheck,
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
  watched,
  extStatus,
  appReg,
  channel,
  autostart,
  startupApply,
  startupRefreshCache,
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
  onToggleWatched,
  onAddWatched,
  onRegisterApp,
  onUnregisterApp,
  onToggleAutostart,
  onStartupApplyChange,
  onStartupRefreshCacheChange,
  onOpenDefaultApps,
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
  /** 关注列表：常用扩展名 */
  watched: string[];
  /** 应用注册状态（仅 zedg 通道使用） */
  appReg: AppRegistration;
  /** 当前通道（应用注册仅 zedg 通道提供） */
  channel: ChannelKey;
  /** 开机自启动（系统实际状态） */
  autostart: boolean;
  /** 启动时自动应用图标（默认关闭） */
  startupApply: boolean;
  /** 启动时刷新系统图标缓存（默认关闭） */
  startupRefreshCache: boolean;
  /** 关注项的关联状态（诊断"为什么注册了没生效"） */
  extStatus: Record<string, ExtStatus>;
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
  onToggleWatched: (ext: string) => void;
  onAddWatched: (exts: string[]) => void;
  onRegisterApp: () => void;
  onUnregisterApp: () => void;
  onToggleAutostart: () => void;
  onStartupApplyChange: (value: boolean) => void;
  onStartupRefreshCacheChange: (value: boolean) => void;
  onOpenDefaultApps: () => void;
}) {
  const [customInput, setCustomInput] = useState("");
  const [customHint, setCustomHint] = useState("");

  /** 添加自定义扩展名：支持逗号/空格分隔，非法项单独提示 */
  const addCustom = () => {
    const parts = customInput
      .split(/[\s,，;；]+/)
      .map((item) => item.trim().replace(/^\./, "").toLowerCase())
      .filter((item) => item !== "");
    const valid = [...new Set(parts.filter((item) => EXT_PATTERN.test(item)))];
    const invalid = parts.filter((item) => !EXT_PATTERN.test(item));
    if (valid.length > 0) onAddWatched(valid);
    setCustomHint(
      invalid.length > 0 ? t("watch.invalid", [invalid.length, invalid.join(", ")]) : "",
    );
    setCustomInput("");
  };

  /** 手动添加的扩展名（不在预置组里的关注项） */
  const presetSet = new Set(allPresetExtensions());
  const customWatched = watched.filter((ext) => !presetSet.has(ext));

  /** 关注项的状态统计：已生效 / 被系统默认程序覆盖 / 未关联 */
  const statusCounts = watched.reduce(
    (acc, ext) => {
      const status = extStatus[ext];
      if (status?.effectiveIsZed) acc.active += 1;
      else if (status?.classesRegistered) acc.blocked += 1;
      else acc.none += 1;
      return acc;
    },
    { active: 0, blocked: 0, none: 0 },
  );

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

          <Card title={t("settings.startup")} hint={t("settings.startup.hint")}>
            <Switch
              checked={autostart}
              onChange={() => onToggleAutostart()}
              label={t("settings.autostart")}
              title={t("settings.autostart.tip")}
            />
            <Switch
              checked={startupApply}
              onChange={() => onStartupApplyChange(!startupApply)}
              label={t("settings.startupApply")}
              title={t("settings.startupApply.tip")}
            />
            <Switch
              checked={startupRefreshCache}
              onChange={() => onStartupRefreshCacheChange(!startupRefreshCache)}
              label={t("settings.startupRefreshCache")}
              title={t("settings.startupRefreshCache.tip")}
            />
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

          {/* 应用注册：仅汉化版通道提供（官方安装器自带，Scoop 版没有） */}
          {channel === "zedg" ? (
            <Card title={t("settings.appReg")} hint={t("settings.appReg.hint")}>
              <div className="settings__row">
                <Pill tone={appReg.registered ? "ok" : "muted"}>
                  {appReg.registered
                    ? t("appReg.registered", [appReg.covered])
                    : t("appReg.notRegistered")}
                </Pill>
                <div className="seg">
                  <button
                    type="button"
                    className="btn btn--mini"
                    disabled={!appReg.registered}
                    data-tip={t("appReg.unregister.tip")}
                    onClick={onUnregisterApp}
                  >
                    {t("appReg.unregister")}
                  </button>
                </div>
              </div>

              {/* 手动添加扩展名：补充预置之外的类型（进关注列表，注册时一并覆盖） */}
              <div className="field field--sub">
                <div className="field__head">
                  <span className="field__label">{t("watch.custom.label")}</span>
                </div>
                <div className="row-btns">
                  <input
                    className="input"
                    placeholder={t("watch.custom.placeholder")}
                    value={customInput}
                    onChange={(event) => setCustomInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addCustom();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--mini"
                    disabled={customInput.trim() === ""}
                    onClick={addCustom}
                  >
                    {t("watch.add")}
                  </button>
                </div>
                {customHint !== "" ? <p className="card__note">{customHint}</p> : null}
                {customWatched.length > 0 ? (
                  <div className="ext-grid">
                    {customWatched.map((ext) => (
                      <button
                        key={ext}
                        type="button"
                        className="ext-chip ext-chip--on"
                        data-tip={t("watch.remove.tip")}
                        onClick={() => onToggleWatched(ext)}
                      >
                        {ext}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 状态诊断：解释"为什么注册了却没生效" */}
              {watched.length > 0 ? (
                <div className="watch-status">
                  <div className="watch-status__row">
                    <Pill tone="ok">
                      {t("watch.status.active")} {statusCounts.active}
                    </Pill>
                    {statusCounts.blocked > 0 ? (
                      <Pill tone="warn">
                        {t("watch.status.blocked")} {statusCounts.blocked}
                      </Pill>
                    ) : null}
                    {statusCounts.none > 0 ? (
                      <Pill tone="muted">
                        {t("watch.status.none")} {statusCounts.none}
                      </Pill>
                    ) : null}
                  </div>
                  <p className="card__note">{t("watch.explain")}</p>
                  <button
                    type="button"
                    className="btn btn--wide"
                    data-tip={t("watch.openSettings.tip")}
                    onClick={onOpenDefaultApps}
                  >
                    <IconFolder size={13} />
                    {t("watch.openSettings")}
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                className="btn btn--primary btn--wide"
                data-tip={t("appReg.register.tip")}
                onClick={onRegisterApp}
              >
                <IconCheck size={14} />
                {t("appReg.register")}
              </button>
              <p className="card__note">{t("appReg.coverage", [watched.length])}</p>
            </Card>
          ) : null}
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
