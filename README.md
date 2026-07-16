# ToolDock

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

ToolDock is a local, cross-platform desktop toolbox for repetitive developer tasks. It runs on Windows, macOS, and Linux without requiring an account or background service.

## Features

- **Screen color picker**: Use a cross-display overlay and a single cursor-following magnifier. The selected value is copied automatically. Press `Esc` to cancel.
- **Port process manager**: Inspect ports, identify owning processes, select multiple entries, and terminate them after confirmation.
- **Screenshot capture**: Capture a complete display or freely select a region across displays. PNG results are copied to the clipboard and shown in recent history.
- **Screen recording**: Record a display, selected region, or individual application window with a live preview, configurable encoding, and recording history.
- **Secure string generator**: Generate strings with preset lengths, hexadecimal values, numbers, symbols, and UUID v4 values.
- **Appearance and storage settings**: Switch themes from the sidebar, configure media folders and global shortcuts, and optionally close to the system tray.

The sidebar also includes optional links to RouteMarket.ai and RouteMarket Tools. They open in the system browser with UTM campaign parameters; ToolDock does not upload screenshots, recordings, colors, or process data when those links are used.

## Install Or Run Portably?

For public GitHub releases, the recommended default is an installer on Windows and macOS, while Linux should provide both installed and portable choices:

| Platform | Package | Recommendation |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | Recommended. Creates normal Start menu and uninstall entries. |
| macOS Apple Silicon | `.dmg` | Recommended for M1 and newer Macs. |
| macOS Intel | `.dmg` | Recommended for Intel-based Macs. |
| Linux x64 | `.AppImage` | Portable option with no installation flow. |
| Linux x64 | `.deb` | Installed option for Debian and Ubuntu-based systems. |

This keeps first-time use familiar while still offering a portable Linux build. The first public builds may be unsigned, so users may see an operating-system security warning.

## Usage

### Pick A Color

1. Open **Color Picker**.
2. Select **Pick from screen**.
3. ToolDock temporarily hides its window and shows a desktop overlay with a cursor-following magnifier.
4. Click a screen pixel, or press `Esc` to cancel.
5. The value is copied automatically; HEX and RGB can also be copied again from the result panel.

### Inspect And Terminate Port Processes

1. Open **Port Processes**.
2. Enter ports separated by commas or spaces, or use a range such as `8000-8010`.
3. Select **Search**.
4. Review the process name, PID, state, command, and memory usage.
5. Select one or more processes, then choose **Terminate selected** and confirm.

ToolDock cannot terminate protected or elevated processes unless it is running with matching privileges. Always review the PID before terminating a process.

### Capture Screenshots

1. Open **Screenshot**.
2. Choose **Full display** or **Select region**.
3. Choose the display and an optional delay.
4. For a region capture, the app hides and overlays every display; drag to select the capture rectangle.
5. The saved image is copied automatically and can be pasted directly into another application.
6. Open recent captures from the screenshot history shown below the capture controls.

The default folder is `Pictures/ToolDock`. Change it from **Settings**.

### Record The Screen

1. Install FFmpeg and ensure `ffmpeg` is available on `PATH`.
2. Open **Screen Recording**.
3. Choose a display, region, or application window, then set the output resolution, frame rate, and bitrate.
4. Select **Start recording**. The left panel shows the captured image in real time.
5. Select **Stop and save**. The result appears in recording history below.

The default folder is `Videos/ToolDock`. Change it from **Settings**. If FFmpeg is installed in a custom location, set `TOOLDOCK_FFMPEG` to the full FFmpeg executable path before starting ToolDock.

### Generate Strings

1. Open **String Generator**.
2. Choose alphanumeric, letters, numbers, HEX, or UUID v4.
3. Set the length and count.
4. Optionally include symbols.
5. Generate and copy one result or all results.

## Settings

The lower-left theme control switches immediately between dark and light modes. The selected theme persists across restarts.

Open **Settings** to configure:

- Screenshot save folder and history source.
- Screen recording save folder and history source.
- Global shortcuts for color picking, region screenshots, and starting or stopping screen recording.
- Exit on close or hide in the system tray.

Missing folders are created automatically when media is saved.

## Platform Permissions

- **Windows**: WebView2 is required. Terminating elevated processes may require running ToolDock as administrator.
- **macOS**: Color picking, screenshots, and recording require Screen Recording permission. Color picking may also require Input Monitoring permission.
- **Linux**: X11 has the broadest capture support. Wayland behavior depends on the compositor and desktop portal. Screen recording also requires working PipeWire support.

## FFmpeg

Screen recording uses an external FFmpeg executable for H.264 encoding. FFmpeg is intentionally not bundled because it substantially increases release size and may require additional licensing review by distributors.

ToolDock searches:

1. `TOOLDOCK_FFMPEG`
2. `ffmpeg` on `PATH`
3. Common executable locations beside the application

Screenshots, color picking, port management, and string generation work without FFmpeg.

## Development

Requirements:

- Node.js 22
- Rust stable
- Tauri 2 system prerequisites for your operating system
- FFmpeg for testing screen recording

```bash
npm ci
npm run desktop:dev
```

Run only the interface in browser demo mode:

```bash
npm run dev
```

Run all local checks:

```bash
npm run check
```

Build a desktop package:

```bash
npm run desktop:build
```

Native packages must be built on their target operating system.

## Continuous Integration And Releases

- `.github/workflows/ci.yml` checks versions, builds the frontend, validates Rust formatting, and runs native checks on Windows, macOS, and Linux.
- `.github/workflows/release.yml` builds Windows NSIS, macOS DMG, Linux AppImage, and Linux DEB packages.
- Pushing a tag such as `v0.2.0` creates a draft GitHub Release. Review and publish it manually.

Before tagging, keep the versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` identical and update `CHANGELOG.md`.

See [the release guide](docs/RELEASING.md) for details.

## Project Structure

```text
.
|-- .github/workflows/   # CI and release automation
|-- public/              # Static assets
|-- scripts/             # Repository maintenance scripts
|-- src/                 # React interface
|-- src-tauri/           # Rust native layer and Tauri configuration
|-- README.zh-CN.md      # Simplified Chinese documentation
`-- README.ja.md         # Japanese documentation
```

## Contributing And Security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security issues privately according to [SECURITY.md](SECURITY.md).

No open-source license has been selected yet. Choose and add a license before public distribution.
