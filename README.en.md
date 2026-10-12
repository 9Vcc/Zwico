# Zwico

简体中文 | [English](./README.en.md)

**Zwico** = **Z**ed **Wi**ndows **Ico**n

## What problem it solves

When the Windows version of the Zed editor sets itself as the default program
for file types, all related file types show the same icon in Explorer, making
them hard to tell apart. Zwico solves this: it changes the system's file icon
associations to custom icons, so that after setting Zed as the default editor
in Windows Explorer, each file type displays a distinctive icon.

Built with Tauri 2 + React 19 + TypeScript. Only touches the current user's
(HKCU) registry — **no administrator rights required**.

## Name origin

Zwico is a blend of **Z**ed **Wi**ndows **Ico**n (Zed + Windows + Icon).

## Features

- **App registration**: declares which file extensions ZedG can open
  (Capabilities + ProgID), so it shows up in Windows "Default apps" and the
  right-click "Open with" menu; about 44 preset extensions plus manual ones;
  can be removed entirely or per extension
- **Custom icons**: point to an icon folder matched by `<extension>.ico` /
  `<extension>.png` (PNG is auto-wrapped into ICO, size 1–256), with
  `default.ico` as the fallback when no dedicated icon exists; the default
  folder is the `icon` folder next to the app
- **Icon modes**: system icons / app icon (the Zed exe's icon) / custom
  folder — batch-apply in one click
- **Association diagnostics**: per extension, shows active / overridden by the
  system default / unassociated / shared (extensions associated via "Open
  with" share one ProgID; the tool writes the icon to an independent ProgID
  and guides the migration)
- **Startup behaviour**: launch at startup; re-apply icons at launch; refresh
  the system icon cache at launch (all off by default)
- **System tray**: closing the window = hide to tray and keep running; tray
  menu "Show main window / Quit"; quitting while a task runs pulls the window
  back first
- **Others**: config import/export (JSON presets), log panel (filter + copy),
  icon cache refresh / Explorer restart

## Install

Download the latest `Zwico_<version>_x64-setup.exe` from
[GitHub Releases](../../releases) and run it.

Requirements: Windows 10/11 (WebView2 runtime ships with the system). Only
writes HKCU — no administrator rights needed.

## Usage

1. On first launch Zed is detected automatically (uninstall registry → common
   folders → Scoop shim); if not found, point to it manually in Settings or
   pick from the scan list;
2. **App registration** → click **Register fully**: registers the preset
   extensions plus any manually added ones into Windows "Default apps";
3. Open **Windows Settings → Default apps → ZedG** and set the extensions you
   need as default — each extension's independent icon takes effect;
4. Under **Icon source**, pick **Custom folder** pointing at the `icon`
   folder (leave empty to use the default folder);
5. To maintain associations automatically, enable the options under
   **Startup** (autostart, apply at startup, refresh cache).

> "Open with → Always use this app" makes several extensions share one ProgID
> (icons are shared across types); for independent icons, use the Windows
> "Default apps" settings instead — the tool completes the migration
> automatically.

## Build from source

```bash
pnpm install
pnpm tdev             # dev window (frontend hot reload)
pnpm build            # frontend only (type check + build)
pnpm test             # backend unit tests
pnpm tbuild           # NSIS installer + standalone exe
```

Requirements: Node ≥ 20, pnpm, Rust ≥ 1.77.2, Windows 10/11 (WebView2
runtime).

## Release

Driven by GitHub Actions (`.github/workflows/release.yml`): bump `version` in
`src-tauri/tauri.conf.json`, commit, then `git tag v<version> && git push
origin v<version>` — the NSIS installer is built and published to GitHub
Releases automatically. Pushing to main does not trigger a build.

## App icon

`app-icon.png` is the 1024×1024 source image; `pnpm tauri icon
app-icon.png` regenerates `src-tauri/icons/`. (Currently a placeholder —
replace the source image and regenerate any time.)

## License

MIT
