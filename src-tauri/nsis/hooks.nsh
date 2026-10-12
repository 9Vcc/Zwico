; Zwico NSIS 安装钩子
; 由 tauri.conf.json bundle.windows.nsis.installerHooks 引入，随安装器模板编译。
;
; 背景：应用「关窗即隐藏到托盘常驻」，覆盖安装时旧实例极大概率仍在运行，
; NSIS 覆写 Zwico.exe 会因文件被占用（ERROR_SHARING_VIOLATION）而中途失败，
; 留下「新卸载器已删、新 exe 没写入、旧 exe 还在跑」的半新半旧目录 ——
; 即「覆盖安装后应用不可用」。安装器模板自带的 CheckIfAppIsRunning
; 依赖用户在弹窗里点确认、且只按当前 exe 名查杀，这里在复制文件前
; 先强制结束本应用全部进程（含改名前的历史二进制名，清理开发期安装残留）。
;
; taskkill 退出码 128 = 进程不存在（首次安装的正常情况），无需处理。
; /T 连同进程树一起结束（WebView2 子进程挂在主进程下）。

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "正在关闭运行中的 Zwico ..."
  nsExec::Exec 'taskkill /F /T /IM "Zwico.exe"'
  nsExec::Exec 'taskkill /F /T /IM "zed-file-assoc-gui.exe"'
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "正在关闭运行中的 Zwico ..."
  nsExec::Exec 'taskkill /F /T /IM "Zwico.exe"'
  nsExec::Exec 'taskkill /F /T /IM "zed-file-assoc-gui.exe"'
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
