// 预设卡片：导出 / 导入「图标来源 + 逐项图标」配置

import { Card, IconDownload, IconUpload, Pill } from "./ui";

export function PresetCard({
  busy,
  modeLabel,
  perExtensionCount,
  customDir,
  onExport,
  onImport,
}: {
  busy: boolean;
  modeLabel: string;
  perExtensionCount: number;
  customDir: string;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <Card
      title="预设"
      hint="把图标来源与逐项图标导出为 JSON，便于备份或分享给同样安装 Zed 的机器"
    >
      <div className="preset__meta">
        <Pill tone="info">{modeLabel}</Pill>
        {perExtensionCount > 0 ? <Pill tone="ok">{perExtensionCount} 项专属图标</Pill> : null}
        {customDir !== "" ? (
          <Pill tone="muted" data-tip={customDir}>
            已设图标目录
          </Pill>
        ) : null}
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--wide"
          disabled={busy}
          data-tip="导出为 .json 预设文件"
          onClick={onExport}
        >
          <IconDownload size={14} />
          导出
        </button>
        <button
          type="button"
          className="btn btn--wide"
          disabled={busy}
          data-tip="从 .json 预设文件导入（导入后需点「应用」才写入注册表）"
          onClick={onImport}
        >
          <IconUpload size={14} />
          导入
        </button>
      </div>
      <p className="card__note">导入只更新界面配置，不会自动写注册表。</p>
    </Card>
  );
}
