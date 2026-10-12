// 设置页：把低频配置从主界面各卡片集中到这里
//
// 迁入的分组：
//   1. 外观与布局 —— 主题、日志默认折叠、面板尺寸重置
//   2. Zed 安装   —— 原「图标设置」卡里的路径检测区
//   3. 刷新行为   —— 原「刷新与修复」卡里的两个开关
//   4. 配置与数据 —— 原「预设」卡
// 主界面只保留高频操作（来源模式、应用、撤销、刷新、修复、SVG 工具）。

import { APP_VERSION, CHANNELS, type ZedInstallation } from "../api";
import { baseName } from "../lib/iconInfo";
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

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl + A", action: "选中列表中的全部扩展名" },
  { keys: "Ctrl + Z", action: "撤销上次操作" },
  { keys: "Ctrl + R", action: "重新加载关联列表" },
  { keys: "Enter", action: "应用到选中项" },
  { keys: "Esc", action: "清空选择 / 关闭对话框" },
];

export function SettingsPage({
  theme,
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
        <button type="button" className="btn btn--mini" data-tip="返回主界面" onClick={onBack}>
          <IconBack size={13} />
          返回
        </button>
        <h2 className="settings__title">设置</h2>
        <span className="counter counter--weak">v{APP_VERSION}</span>
      </div>

      <div className="settings__grid">
        <div className="settings__col">
          <Card title="外观与布局" hint="只影响界面显示，不改变图标写入结果">
            <div className="settings__row">
              <span className="field__label">主题</span>
              <div className="seg">
                <button
                  type="button"
                  className={`btn btn--mini${theme === "dark" ? " btn--on" : ""}`}
                  data-tip="深色主题"
                  onClick={() => onThemeChange("dark")}
                >
                  深色
                </button>
                <button
                  type="button"
                  className={`btn btn--mini${theme === "light" ? " btn--on" : ""}`}
                  data-tip="浅色主题"
                  onClick={() => onThemeChange("light")}
                >
                  浅色
                </button>
              </div>
            </div>

            <Switch
              checked={logCollapsed}
              onChange={() => onToggleLogCollapsed()}
              label="默认折叠操作日志"
              title="折叠后只保留日志标题栏，可随时点开"
            />

            <div className="settings__row">
              <span className="field__label">面板尺寸</span>
              <div className="seg">
                <button
                  type="button"
                  className="btn btn--mini"
                  data-tip={`当前列表宽度 ${sidebarWidth}px，点击恢复默认（288px）`}
                  onClick={onResetSidebar}
                >
                  重置列表宽度
                </button>
                <button
                  type="button"
                  className="btn btn--mini"
                  data-tip={`当前日志高度 ${logHeight}px，点击恢复默认（150px）`}
                  onClick={onResetLogHeight}
                >
                  重置日志高度
                </button>
              </div>
            </div>
          </Card>

          <Card
            title="Zed 安装"
            hint="决定「Zed 应用图标」模式可用与否；自动检测会跨通道扫描卸载注册表、常见目录、scoop 与 PATH"
          >
            <div className={`path${zedPath ? "" : " path--warn"}`} title={zedPath ?? undefined}>
              <span className={`dot ${zedPath ? "dot--ok" : "dot--warn"}`} aria-hidden />
              <span className="path__text">{zedPath ? baseName(zedPath) : "未检测到 Zed"}</span>
              <span className="path__sub">{zedPath ?? "可自动检测或手动指定"}</span>
            </div>

            <div className="row-btns">
              <button
                type="button"
                className="btn btn--mini"
                disabled={scanning}
                data-tip="扫描本机所有 Zed 安装（跨通道）"
                onClick={onScan}
              >
                {scanning ? <Spinner size={11} /> : <IconSearch size={11} />}
                自动检测
              </button>
              <button
                type="button"
                className="btn btn--mini"
                data-tip="手动指定 Zed / ZedG 可执行文件"
                onClick={onPickZed}
              >
                <IconFolder size={11} />
                手动选择…
              </button>
            </div>

            {installations.length > 0 ? (
              <ul className="install-list" aria-label="扫描到的 Zed 安装">
                {installations.map((item) => {
                  const label = CHANNELS.find((c) => c.key === item.channel)?.label ?? item.channel;
                  const active = zedPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        className={`install-item${active ? " install-item--on" : ""}`}
                        title={`${item.path}\n来源：${item.source}`}
                        onClick={() => onUseInstallation(item.path)}
                      >
                        <span className="install-item__channel">{label}</span>
                        <span className="install-item__path">{item.path}</span>
                        <span className="install-item__source">{item.source}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>

          <Card
            title="刷新行为"
            hint="点「立即刷新资源管理器」时执行的附加动作；广播变更通知始终会执行"
          >
            <Switch
              checked={clearCache}
              onChange={onClearCacheChange}
              label="清除图标缓存"
              title="删除 IconCache.db 与 thumbcache_*.db，强制资源管理器重建图标缓存"
            />
            <Switch
              checked={restartExplorer}
              onChange={onRestartExplorerChange}
              label="重启 Explorer"
              title="刷新最彻底，但桌面与任务栏会短暂消失（约 2–3 秒），执行前会二次确认"
            />
          </Card>

        </div>

        <div className="settings__col">
          <Card title="配置与数据" hint="预设只包含图标来源与逐项图标，不含注册表结果">
            <div className="preset__meta">
              {perExtensionCount > 0 ? <Pill tone="ok">{perExtensionCount} 项专属图标</Pill> : null}
              {customDir !== "" ? (
                <Pill tone="muted" title={customDir}>
                  已设图标目录
                </Pill>
              ) : null}
              {perExtensionCount === 0 && customDir === "" ? (
                <Pill tone="muted">当前没有可导出的自定义配置</Pill>
              ) : null}
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                data-tip="把图标来源与逐项图标导出为 .json 文件"
                onClick={onExportPreset}
              >
                <IconDownload size={13} />
                导出预设
              </button>
              <button
                type="button"
                className="btn"
                data-tip="从 .json 预设导入（导入后需在主界面点「应用」才写入注册表）"
                onClick={onImportPreset}
              >
                <IconUpload size={13} />
                导入预设
              </button>
            </div>
          </Card>

          <Card title="快捷键">
            <dl className="shortcuts">
              {SHORTCUTS.map((item) => (
                <div className="shortcuts__row" key={item.keys}>
                  <dt>
                    <kbd>{item.keys}</kbd>
                  </dt>
                  <dd>{item.action}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="关于">
            <div className="about">
              <div className="about__row">
                <span>版本</span>
                <span>v{APP_VERSION}</span>
              </div>
              <div className="about__row">
                <span>界面尺寸</span>
                <span>
                  窗口 {viewport.width}×{viewport.height} · 列表 {sidebarWidth}px · 日志 {logHeight}px
                </span>
              </div>
              <div className="about__row">
                <span>注册表范围</span>
                <span>HKCU\Software\Classes（仅当前用户，无需管理员）</span>
              </div>
              <div className="about__row">
                <span>配置存储</span>
                <span>本机 WebView 存储（主题、来源模式、图标目录、逐项图标、面板尺寸）</span>
              </div>
              <div className="about__row">
                <span>撤销记录</span>
                <span>应用数据目录下的 undo.json，最多撤销一次</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
