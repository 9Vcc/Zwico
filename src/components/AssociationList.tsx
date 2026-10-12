// 左侧关联列表：搜索、整行多选、图标来源标签、逐项图标入口、空状态

import type { MouseEvent as ReactMouseEvent } from "react";
import type { Association } from "../api";
import { describeIcon, renderIconDescription } from "../lib/iconInfo";
import { t } from "../lib/i18n";
import { IconCheck, IconClose, IconPlus, IconSearch, IconShare, IconStar, Spinner } from "./ui";

export function AssociationList({
  items,
  total,
  selected,
  search,
  busy,
  loaded,
  exeName,
  perExtension,
  previews,
  watched,
  watchedOnly,
  onSearch,
  onToggle,
  onSelectAll,
  onInvert,
  onClear,
  onPickIcon,
  onClearIcon,
  onRowMenu,
  onToggleWatchedOnly,
}: {
  items: Association[];
  total: number;
  selected: Set<string>;
  search: string;
  busy: boolean;
  loaded: boolean;
  exeName: string;
  perExtension: Record<string, string>;
  /** DefaultIcon 值 → PNG data URL（未加载为 undefined，渲染失败为 null） */
  previews: Record<string, string | null>;
  /** 关注列表（设置页维护） */
  watched: string[];
  watchedOnly: boolean;
  onSearch: (value: string) => void;
  onToggle: (ext: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onClear: () => void;
  onPickIcon: (ext: string) => void;
  onClearIcon: (ext: string) => void;
  onRowMenu: (assoc: Association, event: ReactMouseEvent<HTMLDivElement>) => void;
  onToggleWatchedOnly: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="search">
        <IconSearch size={14} />
        <input
          className="search__input"
          placeholder={t("list.search")}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search !== "" ? (
          <button
            type="button"
            className="search__clear"
            data-tip={t("list.search.clear")}
            onClick={() => onSearch("")}
          >
            <IconClose size={12} />
          </button>
        ) : null}
      </div>

      {/* 关注项筛选：只看关注列表里的扩展名 */}
      <div className="list-filter">
        <button
          type="button"
          className={`filter-chip${watchedOnly ? " filter-chip--on" : ""}`}
          data-tip={t("watch.only")}
          aria-pressed={watchedOnly}
          onClick={onToggleWatchedOnly}
        >
          <IconStar size={11} />
          {t("watch.mark")}
        </button>
        {watched.length > 0 ? (
          <span className="counter counter--weak">{watched.length}</span>
        ) : null}
      </div>

      <div className="list" role="listbox" aria-multiselectable aria-label={t("list.aria")}>
        {items.length > 0 ? (
          items.map((assoc) => (
            <Row
              key={assoc.extension}
              assoc={assoc}
              selected={selected.has(assoc.extension)}
              exeName={exeName}
              perIcon={perExtension[assoc.extension]}
              preview={assoc.currentIcon ? previews[assoc.currentIcon] : null}
              watched={watched.includes(assoc.extension)}
              onToggle={onToggle}
              onPickIcon={onPickIcon}
              onClearIcon={onClearIcon}
              onRowMenu={onRowMenu}
            />
          ))
        ) : !loaded || busy ? (
          <div className="list__hint">
            <Spinner size={13} />
            {t("list.loading")}
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
            data-tip={t("list.selectAll.tip")}
            onClick={onSelectAll}
          >
            {t("list.selectAll")}
          </button>
          <button
            type="button"
            className="btn btn--mini"
            data-tip={t("list.invert.tip")}
            onClick={onInvert}
          >
            {t("list.invert")}
          </button>
          <button type="button" className="btn btn--mini" data-tip={t("list.clear.tip")} onClick={onClear}>
            {t("list.clear")}
          </button>
        </div>
        <span className="counter">{t("list.counter", [selected.size, total])}</span>
      </div>
    </aside>
  );
}

function Row({
  assoc,
  selected,
  exeName,
  perIcon,
  preview,
  watched,
  onToggle,
  onPickIcon,
  onClearIcon,
  onRowMenu,
}: {
  assoc: Association;
  selected: boolean;
  exeName: string;
  perIcon?: string;
  /** PNG data URL；undefined = 未加载，null = 渲染失败 */
  preview?: string | null;
  /** 是否在关注列表中（设置页维护） */
  watched: boolean;
  onToggle: (ext: string) => void;
  onPickIcon: (ext: string) => void;
  onClearIcon: (ext: string) => void;
  onRowMenu: (assoc: Association, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const desc = describeIcon(assoc, exeName);
  const { label, detail } = renderIconDescription(desc, t);
  const sharedCount = assoc.sharedWith.length;

  const tip = [
    t("row.tip", [assoc.progId]),
    t("row.tip.icon", [detail]),
    t("row.tip.source", [t(`sourceKind.${assoc.progIdSource}`)]),
    sharedCount > 0 ? t("row.tip.shared", [assoc.sharedWith.join(", ")]) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={`row${selected ? " row--sel" : ""}`}
      onContextMenu={(event) => onRowMenu(assoc, event)}
    >
      <button
        type="button"
        className="row__main"
        data-tip={tip}
        role="option"
        aria-selected={selected}
        onClick={() => onToggle(assoc.extension)}
      >
        <span className="row__check" aria-hidden>
          {selected ? <IconCheck size={11} /> : null}
        </span>

        {/* 图标预览：悬停在图标上会放大显示（data-tip-icon 由 TooltipLayer 渲染） */}
        <span
          className="row__icon"
          data-tip={detail}
          data-tip-icon={preview ?? undefined}
          data-tip-title={`.${assoc.extension}`}
        >
          {preview ? (
            <img src={preview} alt="" width={16} height={16} draggable={false} />
          ) : (
            <span className="row__icon-empty" />
          )}
        </span>

        <span className="row__ext">.{assoc.extension}</span>
        <span className="row__tags">
          {watched ? (
            <span className="tag tag--info" title={t("watch.mark.tip")}>
              <IconStar size={9} />
            </span>
          ) : null}
          {assoc.iconState === "missing" ? (
            <span className="tag tag--danger" data-tip={detail}>
              {t("row.tag.missing")}
            </span>
          ) : null}
          <span className={`tag tag--${desc.tone}`} data-tip={detail}>
            {label}
          </span>
          {sharedCount > 0 ? (
            <span
              className="tag tag--warn"
              data-tip={t("row.tag.shared.tip", [sharedCount + 1, assoc.sharedWith.join(", ")])}
            >
              <IconShare size={10} />
              {t("row.tag.shared", [sharedCount])}
            </span>
          ) : null}
        </span>
      </button>

      <div className="row__actions">
        <button
          type="button"
          className="btn btn--icon btn--tiny"
          data-tip={
            perIcon
              ? t("row.pickIcon.replace", [perIcon])
              : t("row.pickIcon")
          }
          aria-label={t("row.aria.pick")}
          onClick={() => onPickIcon(assoc.extension)}
        >
          <IconPlus size={13} />
        </button>
        {perIcon ? (
          <button
            type="button"
            className="btn btn--icon btn--tiny"
            data-tip={t("row.clearIcon")}
            aria-label={t("row.aria.clear")}
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
        <div className="empty__title">{t("list.searchEmpty.title")}</div>
        <div className="empty__sub">{t("list.searchEmpty.sub")}</div>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="empty__title">{t("list.empty.title")}</div>
      <div className="empty__sub">{t("list.empty.sub")}</div>
      <ol className="empty__steps">
        <li>{t("list.empty.step1")}</li>
        <li>{t("list.empty.step2")}</li>
        <li>{t("list.empty.step3")}</li>
      </ol>
      <div className="empty__foot">{t("list.empty.foot")}</div>
    </div>
  );
}
