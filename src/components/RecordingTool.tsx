import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Crop,
  Film,
  FileVideo,
  FolderOpen,
  Gauge,
  HardDrive,
  LoaderCircle,
  Mic,
  Monitor,
  Play,
  RefreshCw,
  Square,
  Timer,
  Video,
  VolumeX,
} from "lucide-react";
import {
  getRecordingCapabilities,
  getRecordingStatus,
  listAudioInputs,
  listRecordingHistory,
  listCaptureWindows,
  listMonitors,
  listenRecordingPreview,
  openLocalPath,
  revealLocalPath,
  selectDesktopRegion,
  startRecording,
  stopRecording,
} from "../lib/native";
import { createTranslator, localeFor } from "../i18n";
import type {
  AppSettings,
  AudioInputInfo,
  CaptureWindowInfo,
  DesktopRegionSelection,
  MonitorInfo,
  RecordingCapabilities,
  RecordingPreview,
  RecordingResult,
} from "../types";
import { ToolHeader } from "./ToolHeader";

const resolutions = [
  { id: "native" },
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
  const t = createTranslator(settings.language);
  const locale = localeFor(settings.language);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [monitorId, setMonitorId] = useState(0);
  const [sourceMode, setSourceMode] = useState<RecordingSourceMode>("monitor");
  const [selectedRegion, setSelectedRegion] = useState<DesktopRegionSelection | null>(null);
  const [windows, setWindows] = useState<CaptureWindowInfo[]>([]);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [resolution, setResolution] = useState("native");
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(8_000);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioInputs, setAudioInputs] = useState<AudioInputInfo[]>([]);
  const [audioInputId, setAudioInputId] = useState("");
  const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
  const [active, setActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastRecording, setLastRecording] = useState<RecordingResult | null>(null);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const [history, setHistory] = useState<RecordingResult[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
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

  async function refreshAudioInputs() {
    const items = await listAudioInputs();
    setAudioInputs(items);
    setAudioInputId((current) => {
      if (current && items.some((item) => item.id === current)) return current;
      return items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? "";
    });
  }

  useEffect(() => {
    Promise.all([
      listMonitors(),
      getRecordingCapabilities(),
      getRecordingStatus(),
      listCaptureWindows(),
      listAudioInputs(),
    ])
      .then(([items, capability, status, windowItems, audioItems]) => {
        setMonitors(items);
        setCapabilities(capability);
        setActive(status.active);
        setElapsed(status.elapsedSeconds);
        setWindows(windowItems);
        setWindowId(windowItems[0]?.id ?? null);
        setAudioInputs(audioItems);
        setAudioInputId(audioItems.find((item) => item.isDefault)?.id ?? audioItems[0]?.id ?? "");
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
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

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
    onStatus(t("recording.starting"));
    try {
      let source;
      if (sourceMode === "region") {
        const selection = selectedRegion ?? (await selectDesktopRegion("recording"));
        if (!selection) {
          onStatus(t("recording.regionCancelled"));
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
          throw new Error(t("recording.chooseWindow"));
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
        audioEnabled,
        audioInputId: audioEnabled ? audioInputId : undefined,
        outputDirectory: settings.recordingDir,
      });
      setPreview(null);
      setElapsed(0);
      setActive(true);
      onStatus(t("recording.active"));
    } catch (reason) {
      setError(String(reason));
      onStatus(t("recording.startFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function stop() {
    setLoading(true);
    onStatus(t("recording.finishing"));
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
      onStatus(t("recording.saved"));
    } catch (reason) {
      setError(String(reason));
      onStatus(t("recording.stopFailed"));
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
        ? t("recording.regionSize", {
            width: selectedRegion.region.width,
            height: selectedRegion.region.height,
          })
        : t("recording.customRegion")
      : sourceMode === "window"
        ? selectedWindow?.appName || t("common.window")
        : monitors.find((item) => item.id === monitorId)?.name || t("common.display");
  const SourceIcon = sourceMode === "region" ? Crop : sourceMode === "window" ? AppWindow : Monitor;
  const stageImage = active ? preview?.dataUrl : lastRecording?.thumbnailDataUrl || preview?.dataUrl;

  return (
    <section className="tool-page">
      <ToolHeader
        icon={Video}
        title={t("recording.title")}
        description={t("recording.description")}
        action={
          <button className="icon-button" title={t("recording.refreshFfmpeg")} onClick={refreshCapabilities}>
            <RefreshCw size={17} />
          </button>
        }
      />

      <div className="recording-layout">
        <div className={active ? "recording-stage active" : "recording-stage"}>
          {stageImage ? (
            <>
              <img className="recording-preview-image" src={stageImage} alt={t("recording.preview")} />
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
                <strong>
                  {active ? t("recording.recording", { source: sourceLabel }) : t("recording.preview")}
                </strong>
                <small>{active ? sourceLabel : lastRecording?.path}</small>
              </div>
            </>
          ) : (
            <>
              <span className="recording-monitor">
                <SourceIcon size={64} strokeWidth={1.15} />
              </span>
              <strong>
                {active
                  ? t("recording.waitingFrame", { source: sourceLabel })
                  : t("recording.readySource", { source: sourceLabel })}
              </strong>
              <div className="recording-time">{displayTimeText}</div>
              <p>
                {active
                  ? t("recording.firstFrame")
                  : t("recording.checkOptions")}
              </p>
            </>
          )}
        </div>

        <div className="control-panel recording-controls">
          <div>
            <span className="panel-label">{t("recording.source")}</span>
            <div className="segmented recording-source">
              <button
                className={sourceMode === "monitor" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("monitor")}
              >
                <Monitor size={14} />
                {t("common.display")}
              </button>
              <button
                className={sourceMode === "region" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("region")}
              >
                <Crop size={14} />
                {t("common.region")}
              </button>
              <button
                className={sourceMode === "window" ? "active" : ""}
                disabled={active}
                onClick={() => setSourceMode("window")}
              >
                <AppWindow size={14} />
                {t("common.window")}
              </button>
            </div>
          </div>

          {sourceMode === "monitor" && (
            <label>
              <span className="panel-label">{t("common.display")}</span>
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
              <span className="panel-label">{t("recording.recordRegion")}</span>
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
                  <strong>
                    {selectedRegion ? t("recording.selectedRegion") : t("recording.pickRegion")}
                  </strong>
                  <small>
                    {selectedRegion
                      ? `${selectedRegion.monitorName} · ${selectedRegion.region.width}×${selectedRegion.region.height}`
                      : t("recording.regionOverlay")}
                  </small>
                </span>
              </button>
            </div>
          )}

          {sourceMode === "window" && (
            <label>
              <span className="panel-label source-label-row">
                <span>{t("common.window")}</span>
                <button
                  className="inline-icon-button"
                  title={t("recording.refreshWindows")}
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
                    <option value="">{t("recording.noWindows")}</option>
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
            <span className="panel-label">{t("recording.resolution")}</span>
            <span className="select-wrap">
              <Film size={17} />
              <select value={resolution} disabled={active} onChange={(event) => setResolution(event.target.value)}>
                {resolutions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id === "native" ? t("recording.nativeResolution") : item.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </span>
          </label>

          <div className="recording-option-grid">
            <div>
              <span className="panel-label">{t("recording.fps")}</span>
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
              <span className="panel-label">{t("recording.bitrate")}</span>
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

          <div className="audio-recording-control">
            <div className="toggle-row">
              <span>
                <strong>{t("recording.audio")}</strong>
                <small>{t("recording.audioHint")}</small>
              </span>
              <button
                className={audioEnabled ? "toggle active" : "toggle"}
                role="switch"
                aria-checked={audioEnabled}
                disabled={active || audioInputs.length === 0}
                onClick={() => setAudioEnabled((value) => !value)}
              >
                <span />
              </button>
            </div>
            <label>
              <span className="panel-label source-label-row">
                <span>{t("recording.audioSource")}</span>
                <button
                  className="inline-icon-button"
                  title={t("recording.refreshAudio")}
                  disabled={active}
                  onClick={(event) => {
                    event.preventDefault();
                    void refreshAudioInputs().catch((reason) => setError(String(reason)));
                  }}
                >
                  <RefreshCw size={13} />
                </button>
              </span>
              <span className="select-wrap">
                {audioEnabled ? <Mic size={17} /> : <VolumeX size={17} />}
                <select
                  value={audioInputId}
                  disabled={active || !audioEnabled || audioInputs.length === 0}
                  onChange={(event) => setAudioInputId(event.target.value)}
                >
                  {audioInputs.length === 0 ? (
                    <option value="">{t("recording.noAudioDevices")}</option>
                  ) : (
                    audioInputs.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                        {item.isDefault ? ` (${t("recording.defaultAudio")})` : ""}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
          </div>

          <div className={capabilities?.available ? "encoder-status ready" : "encoder-status"}>
            {capabilities?.available ? <Check size={15} /> : <HardDrive size={15} />}
            <span>
              <strong>
                {capabilities?.available
                  ? t("recording.encoderReady")
                  : t("recording.encoderWaiting")}
              </strong>
              <small title={capabilities?.ffmpegPath}>
                {capabilities?.available
                  ? t("recording.ffmpegReady")
                  : ready
                    ? t("recording.ffmpegMissing")
                    : t("recording.detectingFfmpeg")}
              </small>
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
            {loading
              ? t("recording.processing")
              : active
                ? t("recording.stop")
                : t("recording.start")}
          </button>

          {error && <p className="inline-error">{error}</p>}
        </div>
      </div>

      <div className="recording-meta">
        <span>
          <Timer size={16} />
          <strong>{t("recording.duration")}</strong>
          <small>{displayTimeText}</small>
        </span>
        <span>
          <Gauge size={16} />
          <strong>{t("recording.currentConfig")}</strong>
          <small>
            {sourceLabel} · {fps} FPS · {bitrate / 1000} Mbps ·{" "}
            {resolution === "native"
              ? t("recording.nativeResolution")
              : resolutions.find((item) => item.id === resolution)?.label}
            {" · "}
            {audioEnabled ? t("recording.audioOn") : t("recording.audioOff")}
          </small>
        </span>
        <span>
          <HardDrive size={16} />
          <strong>{t("recording.saveLocation")}</strong>
          <small title={lastRecording?.path || settings.recordingDir}>{lastRecording?.path || settings.recordingDir}</small>
        </span>
      </div>

      <div className="history-section recording-history">
        <div className="section-title">
          <div>
            <strong>{t("recording.history")}</strong>
            <span>
              {history.length
                ? t("recording.recent", { count: history.length })
                : t("recording.empty")}
            </span>
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
                  void openLocalPath(item.path).catch((reason) => {
                    setError(String(reason));
                    onStatus(t("recording.openFailed"));
                  });
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ path: item.path, x: event.clientX, y: event.clientY });
                }}
                title={t("recording.play")}
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
                  <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
                  <small>{formatFileSize(item.sizeBytes)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="compact-empty">
            <FileVideo size={22} />
            {t("recording.first")}
          </div>
        )}
      </div>
      {contextMenu && (
        <div
          className="recording-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              void openLocalPath(contextMenu.path).catch((reason) => setError(String(reason)));
              setContextMenu(null);
            }}
          >
            <Play size={15} />
            {t("recording.play")}
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.path);
              onStatus(t("recording.pathCopied"));
              setContextMenu(null);
            }}
          >
            <Copy size={15} />
            {t("recording.copyPath")}
          </button>
          <button
            onClick={() => {
              void revealLocalPath(contextMenu.path).catch((reason) => setError(String(reason)));
              setContextMenu(null);
            }}
          >
            <FolderOpen size={15} />
            {t("recording.reveal")}
          </button>
        </div>
      )}
    </section>
  );
}
