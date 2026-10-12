import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 约定：固定 1420 端口，忽略 src-tauri 变更避免 Rust 侧热重载互相触发
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
