export type ToolId =
  | "color"
  | "ports"
  | "screenshot"
  | "recording"
  | "strings"
  | "lan"
  | "system"
  | "settings";
export type ThemeMode = "dark" | "light";
export type AppLanguage = "zh-CN" | "en" | "ja" | "ko";
export type UiFont = "system" | "sans" | "cjk" | "mono";
export type SystemTrayMetric =
  | "none"
  | "cpu"
  | "memory"
  | "network";
export type SystemWidgetMode = "floating" | "taskbar";
export type SystemWidgetMetric =
  | "cpu"
  | "memory"
  | "temperature"
  | "download"
  | "upload";
export type RecordingAudioSource = "none" | "system" | "microphone";

export interface PortProcess {
  port: number | null;
  ports: number[];
  protocol: string;
  state: string;
  pid: number;
  processName: string;
  executable: string;
  command: string;
  memoryBytes: number;
}

export interface KillResult {
  pid: number;
  success: boolean;
  message: string;
}

export interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface ScreenshotResult {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  monitorName: string;
  createdAt: string;
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionSelectorOverlayData {
  monitorId: number;
  dataUrl: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  isPrimary: boolean;
}

export interface DesktopRegionSelection {
  token: string;
  monitorId: number;
  monitorName: string;
  region: CaptureRegion;
}

export interface ColorSample {
  hex: string;
  rgb: [number, number, number];
  position: [number, number];
}

export interface ColorPickerOverlayData {
  monitorId: number;
  dataUrl: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  isPrimary: boolean;
  initialPosition: [number, number] | null;
}

export interface AppSettings {
  theme: ThemeMode;
  language: AppLanguage;
  uiFont: UiFont;
  fontScale: number;
  screenshotDir: string;
  recordingDir: string;
  colorShortcut: string;
  screenshotShortcut: string;
  recordingShortcut: string;
  closeToTray: boolean;
  lanEnabled: boolean;
  lanDeviceId: string;
  lanDeviceName: string;
  lanPassword: string;
  lanReceiveDir: string;
  systemWidgetEnabled: boolean;
  systemWidgetAlwaysOnTop: boolean;
  systemWidgetMode: SystemWidgetMode;
  systemWidgetMetrics: SystemWidgetMetric[];
  systemTrayMetric: SystemTrayMetric;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryUsage: number;
  cpuTemperatureC: number | null;
  fanRpm: number | null;
  networkDownloadBytesPerSecond: number;
  networkUploadBytesPerSecond: number;
  timestampMs: number;
}

export interface LanDevice {
  id: string;
  name: string;
  address: string;
  port: number;
  passwordRequired: boolean;
  lastSeenMs: number;
  connected: boolean;
}

export interface LanStatus {
  enabled: boolean;
  localDevice?: LanDevice;
  receiveDir: string;
}

export interface LanTransferRecord {
  id: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  direction: "incoming" | "outgoing";
  deviceId: string;
  deviceName: string;
  status: "receiving" | "sending" | "completed" | "failed";
  createdAt: string;
  message: string;
}

export interface LanClipboardRecord {
  id: string;
  direction: "incoming" | "outgoing";
  deviceName: string;
  preview: string;
  createdAt: string;
}

export type RecordingSource =
  | { kind: "monitor"; monitorId: number }
  | { kind: "region"; monitorId: number; region: CaptureRegion }
  | { kind: "window"; windowId: number };

export interface RecordingConfig {
  source: RecordingSource;
  width?: number;
  height?: number;
  fps: number;
  bitrateKbps: number;
  audioSource: RecordingAudioSource;
  audioInputId?: string;
  outputDirectory?: string;
}

export interface AudioInputInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface RecordingCapabilities {
  available: boolean;
  ffmpegPath?: string;
  message: string;
}

export interface RecordingStatus {
  active: boolean;
  path?: string;
  elapsedSeconds: number;
}

export interface RecordingResult {
  path: string;
  durationSeconds: number;
  createdAt: string;
  sizeBytes: number;
  thumbnailDataUrl?: string;
}

export interface RecordingPreview {
  dataUrl: string;
  width: number;
  height: number;
}

export interface CaptureWindowInfo {
  id: number;
  title: string;
  appName: string;
  pid: number;
  width: number;
  height: number;
  isFocused: boolean;
}
