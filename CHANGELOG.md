# Changelog

All notable changes to ToolDock will be documented in this file.

The format follows Keep a Changelog, and release versions follow Semantic Versioning.

## [Unreleased]

## [0.1.4] - 2026-07-17

### Added

- Windows taskbar system-monitor widget with topmost positioning beside the notification area.
- Hardware-monitor startup and first-sample diagnostics for troubleshooting sensor access.

### Changed

- Hardware sensor data is stored in the active user's ToolDock data directory with explicit read access for standard users.
- The installer replaces stale hardware-monitor scheduled tasks before registering and starting the updated task.

### Fixed

- System-monitor widgets remain visible when taskbar mode is selected.
- Hardware-monitor task failures now include the Windows Task Scheduler error details.

## [0.1.3] - 2026-07-17

### Added

- Folder-based process lookup with direct path entry, folder selection, and persistent query history.
- Privileged Windows CPU temperature and fan monitoring with automatic watchdog recovery.

### Changed

- Process query tabs stay on one line and remain usable in narrow windows.
- Screenshot and recording views avoid blocking work while loading thumbnails or checking FFmpeg.
- Windows helper processes start without flashing command prompt windows.

### Fixed

- Hardware sensor collection automatically restarts if a low-level sensor read stalls.
- Switching to screenshot, recording, LAN, or string-generator tools no longer pauses while opening a command window.

### Added

- Cross-platform GitHub Actions CI.
- Draft GitHub Release workflow for Windows, macOS, and Linux.
- English, Simplified Chinese, and Japanese user documentation.
- Live preview while recording displays, regions, or application windows.
- Recording history with thumbnails, duration, creation time, and file size.
- Screenshot and color results are copied to the clipboard automatically.
- Global shortcuts for color picking, screenshots, and recording, plus light theme, configurable media folders, and close-to-tray behavior.
- Optional RouteMarket.ai and RouteMarket Tools sidebar links with UTM campaign tracking.

### Changed

- Renamed the application and release assets to ToolDock.

## [0.1.0] - 2026-07-15

### Added

- Global screen color picker.
- Local port-to-process lookup and batch process termination.
- Display screenshot capture with delay options.
- Secure random string, hexadecimal, numeric, and UUID generation.
