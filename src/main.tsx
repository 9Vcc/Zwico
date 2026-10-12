import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function start() {
  // 仅开发模式：浏览器里直接打开时装入假数据，便于单独调试界面
  // （生产构建时该分支被移除，mock 模块不会进入产物）
  if (import.meta.env.DEV) {
    const { installDevMock } = await import("./dev-mock");
    installDevMock();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
