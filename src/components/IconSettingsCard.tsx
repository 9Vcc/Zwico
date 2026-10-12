// 图标设置卡片：只保留高频项（图标来源模式、自定义目录）
//
// Zed 可执行文件的检测与更换属于低频配置，已迁到设置页；
// 这里只显示一行状态并提供跳转，因为「Zed 应用图标」模式的可用性依赖它。

import { MODES, type IconMode } from "../api";
import { baseName } from "../lib/iconInfo";
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
  onOpenSettings: () => void;
}) {
  return (
    <Card title="图标设置" hint="先选图标来源，再到「操作」中应用到左侧勾选的扩展名">
      <div className={`path${zedPath ? "" : " path--warn"}`} title={zedPath ?? undefined}>
        <span className={`dot ${zedPath ? "dot--ok" : "dot--warn"}`} aria-hidden />
        <span className="path__text">{zedPath ? baseName(zedPath) : "未检测到 Zed"}</span>
        <button
          type="button"
          className="path__link"
          data-tip="在设置页中重新检测或手动指定可执行文件"
          onClick={onOpenSettings}
        >
          管理
        </button>
      </div>

      <div className="field">
        <span className="field__label">图标来源</span>
        <div className="options">
          {MODES.map((item) => {
            const needsZed = item.key === "app" && !zedPath;
            return (
              <button
                key={item.key}
                type="button"
                className={`option${mode === item.key ? " option--on" : ""}`}
                title={needsZed ? "需要先在设置中指定 Zed 可执行文件" : item.hint}
                disabled={disabled || needsZed}
                aria-pressed={mode === item.key}
                onClick={() => onModeChange(item.key)}
              >
                <span className="option__radio" aria-hidden />
                <span className="option__text">
                  <span className="option__label">{item.label}</span>
                  <span className="option__hint">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "custom" ? (
        <div className="field field--sub">
          <div className="field__head">
            <span className="field__label">图标目录</span>
            <button
              type="button"
              className="btn btn--mini"
              title="选择包含 <扩展名>.ico 文件的文件夹"
              onClick={onPickCustomDir}
            >
              <IconFolder size={12} />
              浏览…
            </button>
          </div>
          <input
            className="input"
            placeholder="包含 <扩展名>.ico 文件的目录"
            value={customDir}
            onChange={(e) => onCustomDirChange(e.target.value)}
          />
          <div className="field__status">
            {icoCount === null ? (
              customDir.trim() === "" ? (
                <Pill tone="muted">未设置目录，将回退系统图标</Pill>
              ) : (
                <Pill tone="danger" title="目录不存在或无法读取">
                  目录不可读
                </Pill>
              )
            ) : icoCount > 0 ? (
              <Pill tone="ok">{icoCount} 个 .ico 可用</Pill>
            ) : (
              <Pill tone="warn">目录中没有 .ico 文件</Pill>
            )}
            {perExtensionCount > 0 ? (
              <Pill tone="info" title="这些扩展名使用单独指定的图标，不受上面的目录影响">
                {perExtensionCount} 项专属图标
              </Pill>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
