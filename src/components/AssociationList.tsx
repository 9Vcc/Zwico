// 左侧关联列表：搜索、整行多选、图标来源标签、逐项图标入口、空状态

import type { Association } from "../api";
import { describeIcon } from "../lib/iconInfo";
import { IconCheck, IconClose, IconImage, IconSearch, IconShare, Spinner } from "./ui";

export function AssociationList({
  items,
  total,
  selected,
  search,
  busy,
  loaded,
  exeName,
  perExtension,
  onSearch,
  onToggle,
  onSelectAll,
  onInvert,
  onClear,
  onPickIcon,
  onClearIcon,
}: {
  items: Association[];
  total: number;
  selected: Set<string>;
  search: string;
  busy: boolean;
  loaded: boolean;
  exeName: string;
  perExtension: Record<string, string>;
  onSearch: (value: string) => void;
  onToggle: (ext: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onClear: () => void;
  onPickIcon: (ext: string) => void;
  onClearIcon: (ext: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="search">
        <IconSearch size={14} />
        <input
          className="search__input"
          placeholder="搜索扩展名…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search !== "" ? (
          <button
            type="button"
            className="search__clear"
            title="清除搜索"
            onClick={() => onSearch("")}
          >
            <IconClose size={12} />
          </button>
        ) : null}
      </div>

      <div className="list" role="listbox" aria-multiselectable aria-label="文件关联列表">
        {items.length > 0 ? (
          items.map((assoc) => (
            <Row
              key={assoc.extension}
              assoc={assoc}
              selected={selected.has(assoc.extension)}
              exeName={exeName}
              perIcon={perExtension[assoc.extension]}
              onToggle={onToggle}
              onPickIcon={onPickIcon}
              onClearIcon={onClearIcon}
            />
          ))
        ) : !loaded || busy ? (
          <div className="list__hint">
            <Spinner size={13} />
            正在加载关联列表…
          </div>
        ) : (
          <EmptyState hasAny={total > 0} />
        )}
      </div>

      <div className="sidebar__foot">
        <div className="seg">
          <button
            type="button"
            className="btn btn--mini"
            title="选中列表中的全部扩展名"
            onClick={onSelectAll}
          >
            全选
          </button>
          <button
            type="button"
            className="btn btn--mini"
            title="翻转列表中各项的选中状态"
            onClick={onInvert}
          >
            反选
          </button>
          <button type="button" className="btn btn--mini" title="取消全部选中" onClick={onClear}>
            清空
          </button>
        </div>
        <span className="counter">
          已选 <b>{selected.size}</b> / 共 {total}
        </span>
      </div>
    </aside>
  );
}

function Row({
  assoc,
  selected,
  exeName,
  perIcon,
  onToggle,
  onPickIcon,
  onClearIcon,
}: {
  assoc: Association;
  selected: boolean;
  exeName: string;
  perIcon?: string;
  onToggle: (ext: string) => void;
  onPickIcon: (ext: string) => void;
  onClearIcon: (ext: string) => void;
}) {
  const desc = describeIcon(assoc, exeName);
  const sharedCount = assoc.sharedWith.length;

  const tip = [
    `ProgID：${assoc.progId}`,
    `图标来源：${desc.detail}`,
    sharedCount > 0
      ? `共享 ProgID：修改图标会同时影响 ${assoc.sharedWith.join("、")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className={`row${selected ? " row--sel" : ""}`}>
      <button
        type="button"
        className="row__main"
        title={tip}
        role="option"
        aria-selected={selected}
        onClick={() => onToggle(assoc.extension)}
      >
        <span className="row__check" aria-hidden>
          {selected ? <IconCheck size={11} /> : null}
        </span>        <span className="row__ext">.{assoc.extension}</span>
        <span className="row__tags">
          {assoc.iconState === "missing" ? (
            <span className="tag tag--danger" title={desc.detail}>
              失效
            </span>
          ) : null}
          <span className={`tag tag--${desc.tone}`} title={desc.detail}>
            {desc.label}
          </span>
          {sharedCount > 0 ? (
            <span
              className="tag tag--warn"
              title={`该 ProgID 被 ${sharedCount + 1} 个扩展名共用，改图标会同时影响：${assoc.sharedWith.join("、")}`}
            >
              <IconShare size={10} />
              共享 {sharedCount}
            </span>
          ) : null}
        </span>
      </button>

      <div className="row__actions">
        <button
          type="button"
          className="btn btn--icon btn--tiny"
          title={perIcon ? `专属图标：${perIcon}（点击更换）` : "为该项单独指定 .ico 图标"}
          onClick={() => onPickIcon(assoc.extension)}
        >
          <IconImage size={13} />
        </button>
        {perIcon ? (
          <button
            type="button"
            className="btn btn--icon btn--tiny"
            title="清除该项的专属图标"
            onClick={() => onClearIcon(assoc.extension)}
          >
            <IconClose size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  if (hasAny) {
    return (
      <div className="empty">
        <div className="empty__title">没有匹配的扩展名</div>
        <div className="empty__sub">换个关键词，或清空搜索框看看全部关联</div>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="empty__title">未找到任何文件关联</div>
      <div className="empty__sub">当前通道下的 Zed 尚未注册文件关联</div>
      <ol className="empty__steps">
        <li>确认右上角通道与实际安装的 Zed 版本一致</li>
        <li>重新运行 Zed 安装器并勾选「注册文件关联」</li>
        <li>或在 Zed 命令面板搜索 file associations 相关命令</li>
      </ol>
      <div className="empty__foot">注册完成后，切换通道或重启本工具即可管理图标</div>
    </div>
  );
}
