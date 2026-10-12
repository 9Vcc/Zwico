// 应用版本号的统一读取入口。
//
// 旧实现是 api.ts 里的硬编码常量，升版本要人肉同步四处，漏改就显示旧版本
// （0.0.1 → 0.0.2 时实际发生过）。现在的取值顺序：
// 1. `getVersion()`：运行时读 tauri.conf.json 的 version（打包进 exe，
//    与 release.yml 打 tag / 安装包命名用的是同一个值）——单一数据源；
// 2. `__APP_VERSION__`：vite 构建期从 package.json 注入的常量，
//    仅在无 Tauri 运行时时用到（pnpm dev + 浏览器 dev-mock 预览）。
// 结果进程内缓存，避免每次渲染重复跨 IPC 调用。

import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION } from "../api";

let cached: string | null = null;

export async function appVersion(): Promise<string> {
  if (cached) return cached;
  try {
    const v = await getVersion();
    if (v) {
      cached = v;
      return v;
    }
  } catch {
    // 无 Tauri 运行时（浏览器预览），落回构建期注入值
  }
  cached = APP_VERSION;
  return cached;
}
