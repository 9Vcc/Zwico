// 布局尺寸的边界约束
//
// 所有拖拽（侧栏宽度、日志高度）都必须经过这里，目的是：
// 1. 面板不会被拖到窗口外
// 2. 内容区/主区永远保留可用空间，不会把布局压垮

/** 侧栏宽度范围 */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 288;

/** 内容区至少要留出的宽度 */
const CONTENT_MIN = 380;

/** 日志高度范围 */
export const LOG_MIN = 72;
export const LOG_MAX = 420;
export const LOG_DEFAULT = 150;

/** 主区（列表 + 内容）至少要留出的高度 */
const MAIN_MIN = 260;

/** 把期望的侧栏宽度夹到「合法区间 ∩ 窗口宽度允许的上限」 */
export function clampSidebarWidth(desired: number, viewportWidth: number): number {
  const safeViewport = Number.isFinite(viewportWidth) ? viewportWidth : SIDEBAR_MAX + CONTENT_MIN;
  const upper = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, safeViewport - CONTENT_MIN));
  const value = Number.isFinite(desired) ? desired : SIDEBAR_DEFAULT;
  return Math.round(Math.min(Math.max(value, SIDEBAR_MIN), upper));
}

/** 把期望的日志高度夹到「合法区间 ∩ 窗口高度允许的上限」 */
export function clampLogHeight(desired: number, viewportHeight: number): number {
  const safeViewport = Number.isFinite(viewportHeight) ? viewportHeight : LOG_MAX + MAIN_MIN;
  const upper = Math.max(LOG_MIN, Math.min(LOG_MAX, safeViewport - MAIN_MIN));
  const value = Number.isFinite(desired) ? desired : LOG_DEFAULT;
  return Math.round(Math.min(Math.max(value, LOG_MIN), upper));
}
