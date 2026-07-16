import {
  useEffect,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Fan,
  Gauge,
  GripVertical,
  MemoryStick,
  PanelTop,
  PictureInPicture2,
  Power,
  RefreshCw,
  Thermometer,
  X,
} from "lucide-react";
import {
  getSystemMetrics,
  hideSystemWidget,
  isDesktopApp,
  listenSystemMetrics,
  loadSettings,
  showSystemWidget,
} from "../lib/native";
import { createTranslator, fontFamilies } from "../i18n";
import type {
  AppLanguage,
  AppSettings,
  SystemMetrics,
  SystemWidgetMetric,
} from "../types";
import { ToolHeader } from "./ToolHeader";

const defaultWidgetMetrics: SystemWidgetMetric[] = [
  "cpu",
  "memory",
  "temperature",
  "download",
  "upload",
];

const emptyMetrics: SystemMetrics = {
  cpuUsage: 0,
  memoryUsedBytes: 0,
  memoryTotalBytes: 0,
  memoryUsage: 0,
  cpuTemperatureC: null,
  fanRpm: null,
  networkDownloadBytesPerSecond: 0,
  networkUploadBytesPerSecond: 0,
  timestampMs: 0,
};

export function SystemMonitorTool({
  settings,
  onSaveSettings,
  onStatus,
}: {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onStatus: (value: string) => void;
}) {
  const t = createTranslator(settings.language);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [widgetBusy, setWidgetBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [error, setError] = useState("");

  useSystemMetrics(setMetrics, setLoading, setError);

  async function refresh() {
    setLoading(true);
    try {
      setMetrics(await getSystemMetrics());
      setError("");
      onStatus(t("system.refreshed"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function toggleWidget() {
    setWidgetBusy(true);
    setError("");
    const enabled = !settings.systemWidgetEnabled;
    try {
      if (enabled) {
        await showSystemWidget();
      } else {
        await hideSystemWidget();
      }
      onStatus(enabled ? t("system.widgetOpened") : t("system.widgetClosed"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWidgetBusy(false);
    }
  }

  async function setWidgetMode(mode: AppSettings["systemWidgetMode"]) {
    if (mode === settings.systemWidgetMode) return;
    setModeBusy(true);
    setError("");
    try {
      await onSaveSettings({ ...settings, systemWidgetMode: mode });
      onStatus(
        mode === "taskbar" ? t("system.taskbarModeEnabled") : t("system.floatingModeEnabled"),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setModeBusy(false);
    }
  }

  async function toggleWidgetMetric(metric: SystemWidgetMetric) {
    const selected = settings.systemWidgetMetrics.length
      ? settings.systemWidgetMetrics
      : defaultWidgetMetrics;
    const isSelected = selected.includes(metric);
    if (isSelected && selected.length === 1) {
      onStatus(t("system.keepOneMetric"));
      return;
    }

    const nextMetrics = isSelected
      ? selected.filter((value) => value !== metric)
      : defaultWidgetMetrics.filter((value) => value === metric || selected.includes(value));
    setMetricsBusy(true);
    setError("");
    try {
      await onSaveSettings({ ...settings, systemWidgetMetrics: nextMetrics });
      onStatus(t("system.metricsUpdated"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setMetricsBusy(false);
    }
  }

  const selectedMetrics = settings.systemWidgetMetrics.length
    ? settings.systemWidgetMetrics
    : defaultWidgetMetrics;
  const metricOptions: Array<{
    id: SystemWidgetMetric;
    icon: typeof Cpu;
    label: string;
  }> = [
    { id: "cpu", icon: Cpu, label: t("system.cpu") },
    { id: "memory", icon: MemoryStick, label: t("system.memory") },
    { id: "temperature", icon: Thermometer, label: t("system.temperatureShort") },
    { id: "download", icon: ArrowDown, label: t("system.download") },
    { id: "upload", icon: ArrowUp, label: t("system.upload") },
  ];

  return (
    <section className="tool-page system-monitor-page">
      <ToolHeader
        icon={Activity}
        title={t("system.title")}
        description={t("system.description")}
        action={
          <div className="system-header-actions">
            <button
              className={settings.systemWidgetEnabled ? "secondary-button active" : "secondary-button"}
              onClick={toggleWidget}
              disabled={widgetBusy}
            >
              <Power size={16} />
              {settings.systemWidgetEnabled ? t("system.closeWidget") : t("system.openWidget")}
            </button>
            <button
              className="icon-button"
              title={t("system.refresh")}
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw className={loading ? "spin" : ""} size={17} />
            </button>
          </div>
        }
      />

      {error && <p className="inline-error system-error">{error}</p>}

      <div className="system-widget-mode-panel">
        <span>
          <strong>{t("system.widgetMode")}</strong>
          <small>{t("system.widgetModeHint")}</small>
        </span>
        <div className="segmented two">
          <button
            className={settings.systemWidgetMode === "floating" ? "active" : ""}
            disabled={modeBusy}
            onClick={() => void setWidgetMode("floating")}
          >
            <PictureInPicture2 size={15} />
            {t("system.floatingMode")}
          </button>
          <button
            className={settings.systemWidgetMode === "taskbar" ? "active" : ""}
            disabled={modeBusy}
            onClick={() => void setWidgetMode("taskbar")}
          >
            <PanelTop size={15} />
            {t("system.taskbarMode")}
          </button>
        </div>
      </div>

      <div className="system-widget-metrics-panel">
        <span>
          <strong>{t("system.widgetMetrics")}</strong>
          <small>{t("system.widgetMetricsHint")}</small>
        </span>
        <div className="system-widget-metric-options">
          {metricOptions.map(({ id, icon: Icon, label }) => {
            const checked = selectedMetrics.includes(id);
            return (
              <label
                className={checked ? "system-widget-metric-option checked" : "system-widget-metric-option"}
                key={id}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={metricsBusy}
                  onChange={() => void toggleWidgetMetric(id)}
                />
                <span className="checkbox" aria-hidden="true">
                  {checked && <span>✓</span>}
                </span>
                <Icon size={15} />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="system-primary-grid">
        <MetricCard
          icon={Cpu}
          label={t("system.cpu")}
          value={`${metrics.cpuUsage.toFixed(0)}%`}
          detail={t("system.currentUsage")}
          progress={metrics.cpuUsage}
          tone="green"
          prominent
        />
        <MetricCard
          icon={MemoryStick}
          label={t("system.memory")}
          value={`${metrics.memoryUsage.toFixed(0)}%`}
          detail={`${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`}
          progress={metrics.memoryUsage}
          tone="blue"
          prominent
        />
      </div>

      <div className="system-secondary-grid">
        <MetricCard
          icon={Thermometer}
          label={t("system.cpuTemperature")}
          value={
            metrics.cpuTemperatureC === null
              ? t("system.unavailable")
              : `${metrics.cpuTemperatureC.toFixed(0)} °C`
          }
          detail={t("system.sensorReading")}
          tone="amber"
        />
        <MetricCard
          icon={Fan}
          label={t("system.fanSpeed")}
          value={metrics.fanRpm === null ? t("system.unavailable") : `${metrics.fanRpm} RPM`}
          detail={t("system.sensorReading")}
          tone="purple"
        />
        <MetricCard
          icon={ArrowDown}
          label={t("system.download")}
          value={formatRate(metrics.networkDownloadBytesPerSecond)}
          detail={t("system.allInterfaces")}
          tone="orange"
        />
        <MetricCard
          icon={ArrowUp}
          label={t("system.upload")}
          value={formatRate(metrics.networkUploadBytesPerSecond)}
          detail={t("system.allInterfaces")}
          tone="green"
        />
      </div>

      <div className="system-info-band">
        <Gauge size={17} />
        <span>
          <strong>{t("system.hardwareNoteTitle")}</strong>
          <small>{t("system.hardwareNote")}</small>
        </span>
      </div>
    </section>
  );
}

export function SystemWidget() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [metricIndex, setMetricIndex] = useState(0);
  const language = settings?.language ?? "zh-CN";
  const t = createTranslator(language);
  const mode = settings?.systemWidgetMode ?? "floating";
  const selectedMetrics =
    settings?.systemWidgetMetrics?.length ? settings.systemWidgetMetrics : defaultWidgetMetrics;
  const selectedMetricKey = selectedMetrics.join(",");

  useEffect(() => {
    loadSettings()
      .then((value) => {
        setSettings(value);
        document.documentElement.dataset.theme = value.theme;
        document.documentElement.style.colorScheme = value.theme;
        document.documentElement.lang = value.language;
        document.documentElement.style.setProperty("--ui-font-family", fontFamilies[value.uiFont]);
        document.documentElement.style.setProperty("--ui-font-scale", String(value.fontScale));
      })
      .catch(() => undefined);
  }, []);

  useSystemMetrics(setMetrics);

  useEffect(() => {
    setMetricIndex(0);
    if (mode !== "taskbar") {
      return;
    }
    const timer = window.setInterval(() => {
      setMetricIndex((current) => (current + 1) % selectedMetrics.length);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [mode, selectedMetricKey, selectedMetrics.length]);

  const widgetMetrics = selectedMetrics.map((metric) =>
    renderWidgetMetric(metric, metrics, t),
  );
  const embeddedMetric = widgetMetrics[metricIndex % widgetMetrics.length];

  async function startWidgetDragging(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || !isDesktopApp()) return;
    event.preventDefault();
    await getCurrentWindow().startDragging();
  }

  return (
    <main
      className={`system-widget ${mode === "taskbar" ? "embedded" : "floating"}`}
      data-tauri-drag-region={mode === "floating" ? true : undefined}
    >
      {mode === "floating" && (
        <span
          className="system-widget-drag-handle"
          data-tauri-drag-region
          onPointerDown={(event) => void startWidgetDragging(event)}
        >
          <GripVertical size={14} data-tauri-drag-region />
        </span>
      )}
      {mode === "taskbar" && embeddedMetric}
      {mode === "floating" && widgetMetrics}
      {mode === "floating" && (
        <button
          className="system-widget-close"
          title={t("common.close")}
          onClick={() => void hideSystemWidget()}
        >
          <X size={14} />
        </button>
      )}
    </main>
  );
}

function renderWidgetMetric(
  metric: SystemWidgetMetric,
  metrics: SystemMetrics,
  t: ReturnType<typeof createTranslator>,
): ReactNode {
  switch (metric) {
    case "cpu":
      return (
        <WidgetMetric
          key={metric}
          icon={Cpu}
          label={t("system.cpu")}
          value={`${metrics.cpuUsage.toFixed(0)}%`}
        />
      );
    case "memory":
      return (
        <WidgetMetric
          key={metric}
          icon={MemoryStick}
          label={t("system.memory")}
          value={`${metrics.memoryUsage.toFixed(0)}%`}
        />
      );
    case "temperature":
      return (
        <WidgetMetric
          key={metric}
          icon={Thermometer}
          label={t("system.temperatureShort")}
          value={
            metrics.cpuTemperatureC === null
              ? "--"
              : `${metrics.cpuTemperatureC.toFixed(0)} °C`
          }
        />
      );
    case "download":
      return (
        <WidgetMetric
          key={metric}
          icon={ArrowDown}
          label={t("system.download")}
          value={formatRate(metrics.networkDownloadBytesPerSecond)}
        />
      );
    case "upload":
      return (
        <WidgetMetric
          key={metric}
          icon={ArrowUp}
          label={t("system.upload")}
          value={formatRate(metrics.networkUploadBytesPerSecond)}
        />
      );
  }
}

function useSystemMetrics(
  onMetrics: (metrics: SystemMetrics) => void,
  onLoading?: (loading: boolean) => void,
  onError?: (error: string) => void,
) {
  useEffect(() => {
    let disposed = false;
    let interval = 0;
    let unlisten: (() => void) | undefined;

    getSystemMetrics()
      .then((value) => {
        if (!disposed) onMetrics(value);
      })
      .catch((reason) => {
        if (!disposed) onError?.(String(reason));
      })
      .finally(() => {
        if (!disposed) onLoading?.(false);
      });

    void listenSystemMetrics((value) => {
      if (!disposed) {
        onMetrics(value);
        onLoading?.(false);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    if (!isDesktopApp()) {
      interval = window.setInterval(() => {
        void getSystemMetrics().then((value) => {
          if (!disposed) onMetrics(value);
        });
      }, 1000);
    }

    return () => {
      disposed = true;
      unlisten?.();
      if (interval) window.clearInterval(interval);
    };
  }, []);
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  progress,
  tone,
  prominent = false,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  detail: string;
  progress?: number;
  tone: string;
  prominent?: boolean;
}) {
  return (
    <article className={`system-metric-card ${prominent ? "prominent" : ""} tone-${tone}`}>
      <span className="system-metric-icon">
        <Icon size={prominent ? 20 : 18} />
      </span>
      <span className="system-metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </span>
      {progress !== undefined && (
        <span className="system-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
    </article>
  );
}

function WidgetMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <span className="system-widget-metric" data-tauri-drag-region>
      <Icon size={13} data-tauri-drag-region />
      <small data-tauri-drag-region>{label}</small>
      <strong data-tauri-drag-region>{value}</strong>
    </span>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 GB";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 ** 3) return `${(bytesPerSecond / 1024 ** 3).toFixed(1)} GB/s`;
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(bytesPerSecond >= 100 * 1024 ? 0 : 1)} KB/s`;
}
