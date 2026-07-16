import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  AudioInputInfo,
  CaptureWindowInfo,
  ColorSample,
  DesktopRegionSelection,
  KillResult,
  LanClipboardRecord,
  LanDevice,
  LanStatus,
  LanTransferRecord,
  MonitorInfo,
  PortProcess,
  RecordingCapabilities,
  RecordingConfig,
  RecordingPreview,
  RecordingResult,
  RecordingStatus,
  ScreenshotResult,
  SystemMetrics,
} from "../types";

const inTauri = () => "__TAURI_INTERNALS__" in window;

const demoSettings: AppSettings = {
  theme: "light",
  language: "zh-CN",
  uiFont: "sans",
  fontScale: 1.2,
  screenshotDir: "Pictures/ToolDock",
  recordingDir: "Videos/ToolDock",
  colorShortcut: "CommandOrControl+Alt+C",
  screenshotShortcut: "CommandOrControl+Alt+S",
  recordingShortcut: "CommandOrControl+Alt+R",
  closeToTray: true,
  lanEnabled: true,
  lanDeviceId: "td-browser-preview",
  lanDeviceName: "Browser Preview",
  lanPassword: "123456",
  lanReceiveDir: "Downloads/ToolDock/Received",
  systemWidgetEnabled: false,
  systemWidgetAlwaysOnTop: true,
  systemWidgetMode: "floating",
  systemWidgetMetrics: ["cpu", "memory", "temperature", "download", "upload"],
  systemTrayMetric: "none",
};

export const isDesktopApp = inTauri;

export async function openExternalUrl(url: string): Promise<void> {
  if (!inTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}

export async function openLocalPath(path: string): Promise<void> {
  if (!inTauri()) {
    throw new Error("Opening local files is only available in the desktop app.");
  }
  await openPath(path);
}

export async function revealLocalPath(path: string): Promise<void> {
  if (!inTauri()) {
    throw new Error("Revealing local files is only available in the desktop app.");
  }
  await revealItemInDir(path);
}

export async function copyLocalFile(path: string): Promise<void> {
  if (!inTauri()) {
    throw new Error("Copying local files is only available in the desktop app.");
  }
  await invoke("copy_file_to_clipboard", { path });
}

const demoProcesses: PortProcess[] = [
  {
    port: 5173,
    ports: [5173],
    protocol: "TCP",
    state: "LISTEN",
    pid: 24816,
    processName: "node.exe",
    executable: "C:\\Program Files\\nodejs\\node.exe",
    command: "node vite --host 127.0.0.1",
    memoryBytes: 87_031_808,
  },
  {
    port: 3000,
    ports: [3000],
    protocol: "TCP",
    state: "LISTEN",
    pid: 19304,
    processName: "node.exe",
    executable: "C:\\Program Files\\nodejs\\node.exe",
    command: "next dev",
    memoryBytes: 142_606_336,
  },
];

async function withHiddenWindow<T>(task: () => Promise<T>): Promise<T> {
  if (!inTauri()) return task();

  const appWindow = getCurrentWindow();
  await appWindow.hide();
  await new Promise((resolve) => window.setTimeout(resolve, 280));

  try {
    return await task();
  } finally {
    await appWindow.show();
    await appWindow.setFocus();
  }
}

export async function inspectPorts(ports: number[]): Promise<PortProcess[]> {
  if (!inTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    return demoProcesses.filter((item) => item.port !== null && ports.includes(item.port));
  }
  return invoke<PortProcess[]>("inspect_ports", { ports });
}

export async function killProcesses(pids: number[]): Promise<KillResult[]> {
  if (!inTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    return pids.map((pid) => ({ pid, success: true, message: "Demo mode: no real process was terminated." }));
  }
  return invoke<KillResult[]>("kill_processes", { pids });
}

export async function listMonitors(): Promise<MonitorInfo[]> {
  if (!inTauri()) {
    return [
      {
        id: 0,
        name: "Primary display",
        width: 2560,
        height: 1440,
        scaleFactor: 1.25,
        isPrimary: true,
      },
    ];
  }
  return invoke<MonitorInfo[]>("list_monitors");
}

export async function loadSettings(): Promise<AppSettings> {
  if (!inTauri()) {
    const stored = window.localStorage.getItem("tooldock-settings");
    return stored ? { ...demoSettings, ...(JSON.parse(stored) as Partial<AppSettings>) } : demoSettings;
  }
  const settings = await invoke<AppSettings>("load_settings");
  window.localStorage.setItem("tooldock-settings", JSON.stringify(settings));
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!inTauri()) {
    window.localStorage.setItem("tooldock-settings", JSON.stringify(settings));
    return settings;
  }
  const saved = await invoke<AppSettings>("save_settings", { settings });
  window.localStorage.setItem("tooldock-settings", JSON.stringify(saved));
  return saved;
}

export async function chooseDirectory(initial?: string): Promise<string | null> {
  if (!inTauri()) return initial || null;
  return invoke<string | null>("choose_directory", { initial: initial || null });
}

export async function inspectProcesses(
  query: string,
  executablePath?: string,
): Promise<PortProcess[]> {
  if (!inTauri()) {
    const normalized = query.toLowerCase();
    return demoProcesses.filter(
      (item) =>
        (executablePath && item.executable.toLowerCase() === executablePath.toLowerCase()) ||
        item.processName.toLowerCase().includes(normalized) ||
        item.executable.toLowerCase().includes(normalized),
    );
  }
  return invoke<PortProcess[]>("inspect_processes", {
    query,
    executablePath: executablePath || null,
  });
}

export async function chooseFiles(): Promise<string[]> {
  if (!inTauri()) return [];
  return invoke<string[]>("choose_files");
}

export async function chooseExecutable(): Promise<string | null> {
  if (!inTauri()) return demoProcesses[0]?.executable ?? null;
  return invoke<string | null>("choose_executable");
}

export async function getLanStatus(): Promise<LanStatus> {
  if (!inTauri()) {
    return {
      enabled: true,
      localDevice: {
        id: demoSettings.lanDeviceId,
        name: demoSettings.lanDeviceName,
        address: "127.0.0.1",
        port: 38421,
        passwordRequired: true,
        lastSeenMs: Date.now(),
        connected: true,
      },
      receiveDir: demoSettings.lanReceiveDir,
    };
  }
  return invoke<LanStatus>("lan_status");
}

export async function listLanDevices(): Promise<LanDevice[]> {
  if (!inTauri()) return [];
  return invoke<LanDevice[]>("list_lan_devices");
}

export async function connectLanDevice(deviceId: string, password: string): Promise<LanDevice> {
  return invoke<LanDevice>("connect_lan_device", { deviceId, password });
}

export async function disconnectLanDevice(deviceId: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("disconnect_lan_device", { deviceId });
}

export async function sendLanFiles(
  deviceId: string,
  paths: string[],
): Promise<LanTransferRecord[]> {
  return invoke<LanTransferRecord[]>("send_lan_files", { deviceId, paths });
}

export async function listLanTransfers(): Promise<LanTransferRecord[]> {
  if (!inTauri()) return [];
  return invoke<LanTransferRecord[]>("list_lan_transfers");
}

export async function readLanClipboard(): Promise<string> {
  if (!inTauri()) return navigator.clipboard.readText();
  return invoke<string>("read_lan_clipboard");
}

export async function sendLanClipboard(
  text: string,
  deviceIds: string[],
): Promise<LanClipboardRecord[]> {
  return invoke<LanClipboardRecord[]>("send_lan_clipboard", { text, deviceIds });
}

export async function listLanClipboardHistory(): Promise<LanClipboardRecord[]> {
  if (!inTauri()) return [];
  return invoke<LanClipboardRecord[]>("list_lan_clipboard_history");
}

export async function listenLanClipboardReceived(
  handler: (record: LanClipboardRecord) => void,
): Promise<UnlistenFn> {
  if (!inTauri()) return () => undefined;
  return listen<LanClipboardRecord>("lan-clipboard-received", (event) => handler(event.payload));
}

export async function captureScreenshot(
  monitorId: number,
  directory?: string,
): Promise<ScreenshotResult> {
  return withHiddenWindow(async () => {
    if (!inTauri()) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return {
        path: "Browser preview does not write files",
        dataUrl: "",
        width: 2560,
        height: 1440,
        monitorName: "Primary display",
        createdAt: new Date().toISOString(),
      };
    }
    return invoke<ScreenshotResult>("capture_screenshot", {
      monitorId,
      directory: directory || null,
    });
  });
}

export async function finishRegionCapture(
  selection: DesktopRegionSelection,
  directory?: string,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>("finish_region_capture", {
    token: selection.token,
    region: selection.region,
    monitorName: selection.monitorName,
    directory: directory || null,
  });
}

export async function selectDesktopRegion(
  purpose: "screenshot" | "recording",
): Promise<DesktopRegionSelection | null> {
  if (!inTauri()) {
    throw new Error("Region selection is only available in the desktop app.");
  }

  const appWindow = getCurrentWindow();
  let unlisten: UnlistenFn | undefined;
  let resolveResult!: (selection: DesktopRegionSelection | null) => void;
  const result = new Promise<DesktopRegionSelection | null>((resolve) => {
    resolveResult = resolve;
  });

  try {
    unlisten = await listen<{
      purpose: "screenshot" | "recording";
      selection: DesktopRegionSelection | null;
    }>("region-selection-result", (event) => {
      if (event.payload.purpose === purpose) {
        resolveResult(event.payload.selection);
      }
    });
    await appWindow.hide();
    await invoke("open_region_selector", { purpose });
    return await result;
  } finally {
    unlisten?.();
    await appWindow.show().catch(() => undefined);
    await appWindow.setFocus().catch(() => undefined);
  }
}

export async function listScreenshotHistory(directory?: string): Promise<ScreenshotResult[]> {
  if (!inTauri()) return [];
  return invoke<ScreenshotResult[]>("list_screenshot_history", {
    directory: directory || null,
  });
}

export async function pickScreenColor(): Promise<ColorSample> {
  if (!inTauri() && "EyeDropper" in window) {
    const EyeDropperClass = (
      window as unknown as {
        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
      }
    ).EyeDropper;
    const result = await new EyeDropperClass().open();
    const hex = result.sRGBHex.toUpperCase();
    const rgb = [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ] as [number, number, number];
    return { hex, rgb, position: [0, 0] };
  }

  if (!inTauri()) {
    return { hex: "#4ADE80", rgb: [74, 222, 128], position: [0, 0] };
  }

  const appWindow = getCurrentWindow();
  let unlisten: UnlistenFn | undefined;
  let resolveResult!: (sample: ColorSample) => void;
  let rejectResult!: (reason: Error) => void;

  const result = new Promise<ColorSample>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  try {
    unlisten = await listen<{ sample: ColorSample | null }>("color-picker-result", (event) => {
      if (event.payload.sample) {
        resolveResult(event.payload.sample);
      } else {
        rejectResult(new Error("cancelled"));
      }
    });
    await appWindow.hide();
    await invoke("open_color_picker");
    return await result;
  } finally {
    unlisten?.();
    await appWindow.show().catch(() => undefined);
    await appWindow.setFocus().catch(() => undefined);
  }
}

export async function getRecordingCapabilities(): Promise<RecordingCapabilities> {
  if (!inTauri()) {
    return {
      available: false,
      message: "Screen recording requires the desktop app and FFmpeg.",
    };
  }
  return invoke<RecordingCapabilities>("recording_capabilities");
}

export async function listCaptureWindows(): Promise<CaptureWindowInfo[]> {
  if (!inTauri()) return [];
  return invoke<CaptureWindowInfo[]>("list_capture_windows");
}

export async function listAudioInputs(): Promise<AudioInputInfo[]> {
  if (!inTauri()) return [];
  return invoke<AudioInputInfo[]>("list_audio_inputs");
}

export async function startRecording(config: RecordingConfig): Promise<RecordingStatus> {
  return invoke<RecordingStatus>("start_recording", { config });
}

export async function getRecordingStatus(): Promise<RecordingStatus> {
  if (!inTauri()) return { active: false, elapsedSeconds: 0 };
  return invoke<RecordingStatus>("recording_status");
}

export async function stopRecording(): Promise<RecordingResult> {
  return invoke<RecordingResult>("stop_recording");
}

export async function listRecordingHistory(directory?: string): Promise<RecordingResult[]> {
  if (!inTauri()) return [];
  return invoke<RecordingResult[]>("list_recording_history", {
    directory: directory || null,
  });
}

export async function listenRecordingPreview(
  handler: (preview: RecordingPreview) => void,
): Promise<UnlistenFn> {
  if (!inTauri()) return () => undefined;
  return listen<RecordingPreview>("recording-preview", (event) => handler(event.payload));
}

export async function showMainWindow(): Promise<void> {
  if (!inTauri()) return;
  await invoke("show_main_window");
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  if (!inTauri()) {
    return {
      cpuUsage: 27,
      memoryUsedBytes: 9.6 * 1024 ** 3,
      memoryTotalBytes: 32 * 1024 ** 3,
      memoryUsage: 30,
      cpuTemperatureC: 54,
      fanRpm: null,
      networkDownloadBytesPerSecond: 91.4 * 1024,
      networkUploadBytesPerSecond: 660 * 1024,
      timestampMs: Date.now(),
    };
  }
  return invoke<SystemMetrics>("system_metrics");
}

export async function listenSystemMetrics(
  handler: (metrics: SystemMetrics) => void,
): Promise<UnlistenFn> {
  if (!inTauri()) return () => undefined;
  return listen<SystemMetrics>("system-metrics", (event) => handler(event.payload));
}

export async function showSystemWidget(): Promise<void> {
  if (!inTauri()) return;
  await invoke("show_system_widget");
}

export async function hideSystemWidget(): Promise<void> {
  if (!inTauri()) return;
  await invoke("hide_system_widget");
}

export async function listenSystemWidgetVisibility(
  handler: (visible: boolean) => void,
): Promise<UnlistenFn> {
  if (!inTauri()) return () => undefined;
  return listen<boolean>("system-widget-visibility", (event) => handler(event.payload));
}
