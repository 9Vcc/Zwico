// 图标设置卡片：Zed 路径（含自动扫描）、图标来源、自定义目录、图标工具

import { useEffect, useState } from "react";
import {
  CHANNELS,
  MODES,
  type IconMode,
  type ZedInstallation,
} from "../api";
import { baseName } from "../lib/iconInfo";
import { Card, IconFolder, IconSearch, Pill, Spinner } from "./ui";

export function IconSettingsCard({
  zedPath,
  mode,
  customDir,
  icoCount,
  perExtensionCount,
  disabled,
  installations,
  scanning,
  onPickZed,
  onScan,
  onUseInstallation,
  onModeChange,
  onCustomDirChange,
  onPickCustomDir,
}: {
  zedPath: string | null;
  mode: IconMode;
  customDir: string;
  icoCount: number | null;
  perExtensionCount: number;
  disabled: boolean;
  installations: ZedInstallation[];
  scanning: boolean;
  onPickZed: () => void;
  onScan: () => void;
  onUseInstallation: (path: string) => void;
  onModeChange: (mode: IconMode) => void;
  onCustomDirChange: (value: string) => void;
  onPickCustomDir: () => void;
}) {
  const [showList, setShowList] = useState(false);

  // 扫描出多个候选时自动展开列表，便于立刻挑选
  useEffect(() => {
    setShowList(installations.length > 1);
  }, [installations]);

  return (
    <Card title="图标设置" hint="先选图标来源，再到「操作」中应用到左侧勾选的扩展名">
      <div className="field">
        <div className="field__head">
          <span className="field__label">Zed 可执行文件</span>
          <div className="row-btns">
            <button
              type="button"
              className="btn btn--mini"
              disabled={disabled || scanning}
              data-tip="自动扫描本机所有 Zed 安装（卸载注册表 / 常见安装目录 / scoop / PATH），跨通道查找"
              onClick={onScan}
            >
              {scanning ? <Spinner size={11} /> : <IconSearch size={11} />}
              自动检测
            </button>
            <button
              type="button"
              className="btn btn--mini"
              data-tip="手动指定 Zed / ZedG 可执行文件（适用于任何安装方式）"
              onClick={onPickZed}
            >
              选择…
            </button>
          </div>
        </div>

        <div className={`path${zedPath ? "" : " path--warn"}`} data-tip={zedPath ?? undefined}>
          <span className={`dot ${zedPath ? "dot--ok" : "dot--warn"}`} aria-hidden />
          <span className="path__text">{zedPath ? baseName(zedPath) : "未检测到 Zed"}</span>
          <span className="path__sub">
            {zedPath ?? "「Zed 应用图标」模式不可用，可自动检测或手动指定"}
          </span>
        </div>

        {showList && installations.length > 0 ? (
          <ul className="install-list" aria-label="扫描到的 Zed 安装">
            {installations.map((item) => {
              const label = CHANNELS.find((c) => c.key === item.channel)?.label ?? item.channel;
              const active = zedPath === item.path;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    className={`install-item${active ? " install-item--on" : ""}`}
                    data-tip={`${item.path}\n来源：${item.source}`}
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
                data-tip={needsZed ? "需要先指定 Zed 可执行文件" : item.hint}
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
              data-tip="选择包含 <扩展名>.ico 文件的文件夹"
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
