import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  Circle,
  Crop,
  Film,
  FileVideo,
  Gauge,
  HardDrive,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Square,
  Timer,
  Video,
} from "lucide-react";
import {
  getRecordingCapabilities,
  getRecordingStatus,
  listRecordingHistory,
  listCaptureWindows,
  listMonitors,
  listenRecordingPreview,
  selectDesktopRegion,
  startRecording,
  stopRecording,
} from "../lib/native";
import type {
  AppSettings,
  CaptureWindowInfo,
  DesktopRegionSelection,
  MonitorInfo,
  RecordingCapabilities,
  RecordingPreview,
  RecordingResult,
} from "../types";
import { ToolHeader } from "./ToolHeader";

const resolutions = [
  { id: "native", label: "原始分辨率" },
  { id: "1080p", label: "1920 × 1080", width: 1920, height: 1080 },
  { id: "720p", label: "1280 × 720", width: 1280, height: 720 },
];

type RecordingSourceMode = "monitor" | "region" | "window";

function formatDuration(seconds: number) {
  if (!seconds) return "--:--";
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RecordingTool({
  settings,
  shortcutTrigger,
  onStatus,
}: {
  settings: AppSettings;
  shortcutTrigger: number;
  onStatus: (value: string) => void;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [monitorId, setMonitorId] = useState(0);
  const [sourceMode, setSourceMode] = useState<RecordingSourceMode>("monitor");
  const [selectedRegion, setSelectedRegion] = useState<DesktopRegionSelection | null>(null);
  const [windows, setWindows] = useState<CaptureWindowInfo[]>([]);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [resolution, setResolution] = useState("native");
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(8_000);
  const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
  const [active, setActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastRecording, setLastRecording] = useState<RecordingResult | null>(null);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const [history, setHistory] = useState<RecordingResult[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const handledShortcut = useRef(0);

  async function refreshCapabilities() {
    setCapabilities(await getRecordingCapabilities());
  }

  async function refreshWindows() {
    const items = await listCaptureWindows();
    setWindows(items);
    setWindowId((current) => {
      if (current !== null && items.some((item) => item.id === current)) return current;
      return items[0]?.id ?? null;
    });
  }

  useEffect(() => {
    Promise.all([
      listMonitors(),
      getRecordingCapabilities(),
      getRecordingStatus(),
      listCaptureWindows(),
    ])
      .then(([items, capability, status, windowItems]) => {
        setMonitors(items);
        setCapabilities(capability);
        setActive(status.active);
        setElapsed(status.elapsedSeconds);
        setWindows(windowItems);
        setWindowId(windowItems[0]?.id ?? null);
        const primary = items.find((item) => item.isPrimary);
        if (primary) setMonitorId(primary.id);
        setReady(true);
      })
      .catch((reason) => {
        setError(String(reason));
        setReady(true);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenRecordingPreview((nextPreview) => {
      if (!disposed) setPreview(nextPreview);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    listRecordingHistory(settings.recordingDir)
      .then((items) => {
        setHistory(items);
        setLastRecording((current) => current ?? items[0] ?? null);
      })
      .catch((reason) => setError(String(reason)));
  }, [settings.recordingDir]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  async function start() {
    const selectedResolution = resolutions.find((item) => item.id === resolution);
    setLoading(true);
    setError("");
    onStatus("正在启动录屏");
    try {
      let source;
      if (sourceMode === "region") {
        const selection = selectedRegion ?? (await selectDesktopRegion("recording"));
        if (!selection) {
          onStatus("区域录制已取消");
          return;
        }
        setSelectedRegion(selection);
        source = {
          kind: "region" as const,
          monitorId: selection.monitorId,
          region: selection.region,
        };
      } else if (sourceMode === "window") {
        if (windowId === null) {
          throw new Error("请选择要录制的应用窗口");
        }
        source = { kind: "window" as const, windowId };
      } else {
        source = { kind: "monitor" as const, monitorId };
      }
      await startRecording({
        source,
        width: selectedResolution?.width,
        height: selectedResolution?.height,
        fps,
        bitrateKbps: bitrate,
        outputDirectory: settings.recordingDir,
      });
      setPreview(null);
      setElapsed(0);
      setActive(true);
      onStatus("屏幕录制中");
    } catch (reason) {
      setError(String(reason));
      onStatus("录屏启动失败");
    } finally {
      setLoading(false);
    }
  }

  async function stop() {
    setLoading(true);
    onStatus("正在完成视频编码");
    try {
      const result = await stopRecording();
      setLastRecording(result);
      setPreview(
        result.thumbnailDataUrl
          ? { dataUrl: result.thumbnailDataUrl, width: 0, height: 0 }
          : null,
      );
      setHistory((items) => [result, ...items.filter((item) => item.path !== result.path)].slice(0, 20));
      setActive(false);
      setElapsed(result.durationSeconds);
      onStatus("录屏已保存");
    } catch (reason) {
      setError(String(reason));
      onStatus("停止录屏失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready || loading || shortcutTrigger <= handledShortcut.current) return;
    handledShortcut.current = shortcutTrigger;
    void (active ? stop() : start());
  }, [loading, ready, shortcutTrigger]);

  const timeText = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const displayTimeText =
    !active && lastRecording ? formatDuration(lastRecording.durationSeconds) : timeText;
  const selectedWindow = windows.find((item) => item.id === windowId);
  const sourceLabel =
    sourceMode === "region"
      ? selectedRegion
        ? `区域 ${selectedRegion.region.width} × ${selectedRegion.region.height}`
        : "自定义区域"
      : sourceMode === "window"
        ? selectedWindow?.appName || "应用窗口"
        : monitors.find((item) => item.id === monitorId)?.name || "显示器";
  const SourceIcon = sourceMode === "region" ? Crop : sourceMode === "window" ? AppWindow : Monitor;
  const stageImage = active ? preview?.dataUrl : lastRecording?.thumbnailDataUrl || preview?.dataUrl;

  return (
    <section className="tool-page">
      <ToolHeader
        icon={Video}
        title="屏幕录制"
        description="录制显示器、自定义区域或独立应用窗口，并编码为 H.264 MP4。"
        action={
          <button className="icon-button" title="重新检测 FFmpeg" onClick={refreshCapabilities}>
            <RefreshCw size={17} />
          </button>
        }
      />

      <div className="recording-layout">
        <div className={active ? "recording-stage active" : "recording-stage"}>
          {stageImage ? (
            <>
              <img className="recording-preview-image" src={stageImage} alt="录屏预览" />
              <div className="recording-preview-overlay">
                {active && (
                  <span className="recording-live">
                    <span className="recording-indicator" />
                    REC
                  </span>
                )}
                <span className="recording-time compact">{displayTimeText}</span>
              </div>
              <div className="recording-preview-caption">
                <strong>{active ? `正在录制：${sourceLabel}` : "录屏预览"}</strong>
                <small>{active ? sourceLabel : lastRecording?.path}</small>
              </div>
            </>
          ) : (
            <>
              <span className="recording-monitor">
                <SourceIcon size={64} strokeWidth={1.15} />
              </span>
              <strong>{active ? `正在等待画面：${sourceLabel}` : `准备录制：${sourceLabel}`}</strong>
              <div className="recording-time">{displayTimeText}</div>
              <p>
                {active
                  ? "首个实时预览帧即将显示"
                  : "开始前请确认录制来源和编码参数"}
              </p>
            </>
          )}
        </div>

        <div className="control-panel recording-controls">
          <div>
            <span className="panel-label">录制来源</span>
            <div className="segmented recording-source">
              <button
                className={sourceMode === "monitor" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("monitor")}
              >
                <Monitor size={14} />
                显示器
              </button>
              <button
                className={sourceMode === "region" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("region")}
              >
                <Crop size={14} />
                区域
              </button>
              <button
                className={sourceMode === "window" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("window")}
              >
                <AppWindow size={14} />
                应用窗口
              </button>
            </div>
          </div>

          {sourceMode === "monitor" && (
            <label>
              <span className="panel-label">显示器</span>
              <span className="select-wrap">
                <Monitor size={17} />
                <select
                  value={monitorId}
                  disabled={active}
                  onChange={(event) => setMonitorId(Number(event.target.value))}
                >
                  {monitors.map((monitor) => (
                    <option value={monitor.id} key={monitor.id}>
                      {monitor.name} · {monitor.width}×{monitor.height}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
          )}

          {sourceMode === "region" && (
            <div>
              <span className="panel-label">录制区域</span>
              <button
                className="source-picker-button"
                disabled={active}
                onClick={async () => {
                  try {
                    const selection = await selectDesktopRegion("recording");
                    if (selection) setSelectedRegion(selection);
                  } catch (reason) {
                    setError(String(reason));
                  }
                }}
              >
                <Crop size={17} />
                <span>
                  <strong>{selectedRegion ? "已选择区域" : "在桌面上框选区域"}</strong>
                  <small>
                    {selectedRegion
                      ? `${selectedRegion.monitorName} · ${selectedRegion.region.width}×${selectedRegion.region.height}`
                      : "所有显示器会显示遮罩，拖拽完成框选"}
                  </small>
                </span>
              </button>
            </div>
          )}

          {sourceMode === "window" && (
            <label>
              <span className="panel-label source-label-row">
                <span>应用窗口</span>
                <button
                  className="inline-icon-button"
                  title="刷新应用窗口"
                  disabled={active}
                  onClick={(event) => {
                    event.preventDefault();
                    void refreshWindows().catch((reason) => setError(String(reason)));
                  }}
                >
                  <RefreshCw size={13} />
                </button>
              </span>
              <span className="select-wrap">
                <AppWindow size={17} />
                <select
                  value={windowId ?? ""}
                  disabled={active || windows.length === 0}
                  onChange={(event) => setWindowId(Number(event.target.value))}
                >
                  {windows.length === 0 ? (
                    <option value="">没有可录制的应用窗口</option>
                  ) : (
                    windows.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.appName} · {item.title} · {item.width}×{item.height}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
          )}

          <label>
            <span className="panel-label">输出分辨率</span>
            <span className="select-wrap">
              <Film size={17} />
              <select value={resolution} disabled={active} onChange={(event) => setResolution(event.target.value)}>
                {resolutions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </span>
          </label>

          <div className="recording-option-grid">
            <div>
              <span className="panel-label">帧率</span>
              <div className="segmented two">
                {[30, 60].map((value) => (
                  <button
                    className={fps === value ? "active" : ""}
                    key={value}
                    disabled={active}
                    onClick={() => setFps(value)}
                  >
                    {value} FPS
                  </button>
                ))}
              </div>
            </div>
            <label>
              <span className="panel-label">视频码率</span>
              <span className="select-wrap compact-select">
                <Gauge size={16} />
                <select value={bitrate} disabled={active} onChange={(event) => setBitrate(Number(event.target.value))}>
                  {[4_000, 8_000, 12_000, 20_000].map((value) => (
                    <option key={value} value={value}>
                      {value / 1000} Mbps
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
          </div>

          <div className={capabilities?.available ? "encoder-status ready" : "encoder-status"}>
            {capabilities?.available ? <Check size={15} /> : <HardDrive size={15} />}
            <span>
              <strong>{capabilities?.available ? "编码器可用" : "等待编码器"}</strong>
              <small title={capabilities?.ffmpegPath}>{capabilities?.message || "正在检测 FFmpeg…"}</small>
            </span>
          </div>

          <button
            className={active ? "danger-button solid wide recording-button" : "primary-button wide recording-button"}
            onClick={active ? stop : start}
            disabled={
              loading
              || (!active && !capabilities?.available)
              || (!active && sourceMode === "window" && windowId === null)
            }
          >
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : active ? (
              <Square size={16} fill="currentColor" />
            ) : (
              <Circle size={17} fill="currentColor" />
            )}
            {loading ? "正在处理…" : active ? "停止并保存" : "开始录制"}
          </button>

          {error && <p className="inline-error">{error}</p>}
        </div>
      </div>

      <div className="recording-meta">
        <span>
          <Timer size={16} />
          <strong>时长</strong>
          <small>{displayTimeText}</small>
        </span>
        <span>
          <Gauge size={16} />
          <strong>当前配置</strong>
          <small>
            {sourceLabel} · {fps} FPS · {bitrate / 1000} Mbps ·{" "}
            {resolutions.find((item) => item.id === resolution)?.label}
          </small>
        </span>
        <span>
          <HardDrive size={16} />
          <strong>保存位置</strong>
          <small title={lastRecording?.path || settings.recordingDir}>{lastRecording?.path || settings.recordingDir}</small>
        </span>
      </div>

      <div className="history-section recording-history">
        <div className="section-title">
          <div>
            <strong>录屏历史</strong>
            <span>{history.length ? `最近 ${history.length} 段` : "当前目录暂无录屏"}</span>
          </div>
          <small className="directory-hint" title={settings.recordingDir}>
            {settings.recordingDir}
          </small>
        </div>
        {history.length ? (
          <div className="recording-history-list">
            {history.map((item) => (
              <button
                className={lastRecording?.path === item.path ? "recording-history-item active" : "recording-history-item"}
                onClick={() => {
                  setLastRecording(item);
                  setPreview(
                    item.thumbnailDataUrl
                      ? { dataUrl: item.thumbnailDataUrl, width: 0, height: 0 }
                      : null,
                  );
                }}
                key={item.path}
              >
                <span className="recording-history-thumb">
                  {item.thumbnailDataUrl ? (
                    <img src={item.thumbnailDataUrl} alt="" />
                  ) : (
                    <FileVideo size={25} />
                  )}
                  <small>{formatDuration(item.durationSeconds)}</small>
                </span>
                <span>
                  <strong title={item.path}>{item.path.split(/[\\/]/).pop()}</strong>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                  <small>{formatFileSize(item.sizeBytes)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="compact-empty">
            <FileVideo size={22} />
            完成第一段录屏后会显示在这里
          </div>
        )}
      </div>
    </section>
  );
}
