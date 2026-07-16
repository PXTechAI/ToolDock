export type ToolId = "color" | "ports" | "screenshot" | "recording" | "strings" | "settings";
export type ThemeMode = "dark" | "light";
export type AppLanguage = "zh-CN" | "en" | "ja" | "ko";
export type UiFont = "system" | "sans" | "cjk" | "mono";

export interface PortProcess {
  port: number;
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
  audioEnabled: boolean;
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
