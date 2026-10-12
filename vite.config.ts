import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 从 package.json 取版本号，构建期注入前端全局常量 __APP_VERSION__
// （运行时优先 getVersion() 读 tauri.conf.json，此值仅作无 Tauri 运行时时的回退）
const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

// Tauri 约定：固定 1420 端口，忽略 src-tauri 变更避免 Rust 侧热重载互相触发
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
