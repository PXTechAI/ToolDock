import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Crop,
  Image as ImageIcon,
  LoaderCircle,
  Monitor,
} from "lucide-react";
import {
  captureScreenshot,
  finishRegionCapture,
  listMonitors,
  listScreenshotHistory,
  selectDesktopRegion,
} from "../lib/native";
import { createTranslator, localeFor } from "../i18n";
import type {
  AppSettings,
  MonitorInfo,
  ScreenshotResult,
} from "../types";
import { ToolHeader } from "./ToolHeader";

type CaptureMode = "full" | "region";

export function ScreenshotTool({
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
  const [mode, setMode] = useState<CaptureMode>("full");
  const [delay, setDelay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastShot, setLastShot] = useState<ScreenshotResult | null>(null);
  const [history, setHistory] = useState<ScreenshotResult[]>([]);
  const [error, setError] = useState("");
  const handledShortcut = useRef(0);

  useEffect(() => {
    listMonitors()
      .then((items) => {
        setMonitors(items);
        const primary = items.find((item) => item.isPrimary);
        if (primary) setMonitorId(primary.id);
      })
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    listScreenshotHistory(settings.screenshotDir)
      .then((items) => {
        setHistory(items);
        if (items[0]) setLastShot(items[0]);
      })
      .catch((reason) => setError(String(reason)));
  }, [settings.screenshotDir]);

  function remember(result: ScreenshotResult) {
    setLastShot(result);
    setHistory((current) => [result, ...current.filter((item) => item.path !== result.path)].slice(0, 20));
    onStatus(t("screenshot.saved"));
  }

  async function capture(requestedMode: CaptureMode = mode, requestedDelay = delay) {
    if (loading) return;
    setLoading(true);
    setError("");
    onStatus(
      requestedDelay
        ? t("screenshot.delayed", { count: requestedDelay })
        : t("screenshot.capturingStatus"),
    );
    try {
      if (requestedDelay) {
        await new Promise((resolve) => window.setTimeout(resolve, requestedDelay * 1000));
      }
      if (requestedMode === "region") {
        const selection = await selectDesktopRegion("screenshot");
        if (!selection) {
          onStatus(t("screenshot.cancelled"));
          return;
        }
        remember(await finishRegionCapture(selection, settings.screenshotDir));
      } else {
        remember(await captureScreenshot(monitorId, settings.screenshotDir));
      }
    } catch (reason) {
      setError(String(reason));
      onStatus(t("screenshot.failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (shortcutTrigger <= handledShortcut.current) return;
    handledShortcut.current = shortcutTrigger;
    setMode("region");
    void capture("region", 0);
  }, [shortcutTrigger]);

  return (
    <section className="tool-page">
      <ToolHeader
        icon={Camera}
        title={t("screenshot.title")}
        description={t("screenshot.description")}
      />

      <div className="screenshot-layout">
        <div className="capture-preview">
          {lastShot?.dataUrl ? (
            <img src={lastShot.dataUrl} alt={t("screenshot.latestAlt")} />
          ) : (
            <div className="monitor-placeholder">
              <span className="monitor-frame">
                <Monitor size={56} strokeWidth={1.2} />
              </span>
              <strong>{t("screenshot.ready")}</strong>
              <p>{t("screenshot.hideHint")}</p>
            </div>
          )}
        </div>

        <div className="control-panel capture-controls">
          <div>
            <span className="panel-label">{t("screenshot.mode")}</span>
            <div className="segmented capture-mode">
              <button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}>
                <Monitor size={14} />
                {t("screenshot.full")}
              </button>
              <button className={mode === "region" ? "active" : ""} onClick={() => setMode("region")}>
                <Crop size={14} />
                {t("screenshot.selectRegion")}
              </button>
            </div>
          </div>

          {mode === "full" ? (
            <label>
              <span className="panel-label">{t("common.display")}</span>
              <span className="select-wrap">
                <Monitor size={17} />
                <select value={monitorId} onChange={(event) => setMonitorId(Number(event.target.value))}>
                  {monitors.map((monitor) => (
                    <option value={monitor.id} key={monitor.id}>
                      {monitor.name} · {monitor.width}×{monitor.height}
                      {monitor.isPrimary ? ` (${t("common.primary")})` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
          ) : (
            <div className="capture-region-hint">
              <Crop size={17} />
              <span>
                <strong>{t("screenshot.allDisplays")}</strong>
                <small>{t("screenshot.regionHint")}</small>
              </span>
            </div>
          )}

          <div>
            <span className="panel-label">{t("screenshot.delay")}</span>
            <div className="segmented">
              {[0, 3, 5].map((value) => (
                <button
                  className={delay === value ? "active" : ""}
                  key={value}
                  onClick={() => setDelay(value)}
                >
                  {value ? t("common.seconds", { count: value }) : t("common.none")}
                </button>
              ))}
            </div>
          </div>

          <button className="primary-button wide capture-button" onClick={() => capture()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : mode === "full" ? <Camera size={18} /> : <Crop size={18} />}
            {loading
              ? t("screenshot.capturing")
              : mode === "full"
                ? t("screenshot.captureDisplay")
                : t("screenshot.captureRegion")}
          </button>

          {lastShot && (
            <div className="saved-path">
              <Check size={16} />
              <span>
                <strong>{lastShot.width} × {lastShot.height}</strong>
                <small title={lastShot.path}>{lastShot.path}</small>
              </span>
            </div>
          )}
          {error && <p className="inline-error">{error}</p>}
        </div>
      </div>

      <div className="history-section screenshot-history">
        <div className="section-title">
          <div>
            <strong>{t("screenshot.history")}</strong>
            <span>
              {history.length
                ? t("screenshot.recent", { count: history.length })
                : t("screenshot.empty")}
            </span>
          </div>
          <small className="directory-hint" title={settings.screenshotDir}>
            {settings.screenshotDir}
          </small>
        </div>
        {history.length ? (
          <div className="screenshot-history-list">
            {history.map((item) => (
              <button className="screenshot-history-item" key={item.path} onClick={() => setLastShot(item)}>
                {item.dataUrl ? <img src={item.dataUrl} alt="" /> : <ImageIcon size={24} />}
                <span>
                  <strong>{item.width} × {item.height}</strong>
                  <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="compact-empty">
            <ImageIcon size={22} />
            {t("screenshot.first")}
          </div>
        )}
      </div>

    </section>
  );
}
