import { useEffect, useMemo, useRef, useState } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import {
  Activity,
  Camera,
  Check,
  Clipboard,
  Copy,
  Crosshair,
  Dices,
  ExternalLink,
  FileSearch,
  Hash,
  KeyRound,
  LoaderCircle,
  Minus,
  Moon,
  Network,
  Palette,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  Sparkles,
  Store,
  Sun,
  TerminalSquare,
  Trash2,
  Video,
  WandSparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  inspectPorts,
  inspectProcesses,
  isDesktopApp,
  killProcesses,
  listenSystemWidgetVisibility,
  loadSettings,
  openExternalUrl,
  pickScreenColor,
  saveSettings,
  showMainWindow,
  chooseExecutable,
} from "./lib/native";
import { RecordingTool } from "./components/RecordingTool";
import { LanTool } from "./components/LanTool";
import { ScreenshotTool } from "./components/ScreenshotTool";
import { SettingsTool } from "./components/SettingsTool";
import { SystemMonitorTool } from "./components/SystemMonitorTool";
import { ToolHeader } from "./components/ToolHeader";
import { createTranslator, fontFamilies } from "./i18n";
import type {
  AppLanguage,
  AppSettings,
  ColorSample,
  PortProcess,
  ToolId,
} from "./types";

const tools: Array<{
  id: ToolId;
  labelKey: string;
  detailKey: string;
  icon: typeof Palette;
}> = [
  { id: "color", labelKey: "nav.color", detailKey: "nav.colorDetail", icon: Crosshair },
  { id: "ports", labelKey: "nav.ports", detailKey: "nav.portsDetail", icon: Network },
  { id: "screenshot", labelKey: "nav.screenshot", detailKey: "nav.screenshotDetail", icon: Camera },
  { id: "recording", labelKey: "nav.recording", detailKey: "nav.recordingDetail", icon: Video },
  { id: "strings", labelKey: "nav.strings", detailKey: "nav.stringsDetail", icon: WandSparkles },
  { id: "lan", labelKey: "nav.lan", detailKey: "nav.lanDetail", icon: Share2 },
  { id: "system", labelKey: "nav.system", detailKey: "nav.systemDetail", icon: Activity },
];

const stringCharsets = {
  alphanumeric: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  hex: "0123456789abcdef",
  symbols: "!@#$%^&*_-+=?",
};

type StringMode = keyof typeof stringCharsets | "uuid";
let shortcutRegistrationQueue: Promise<void> = Promise.resolve();
const PORT_INPUT_KEY = "tooldock-port-input";
const PORT_HISTORY_KEY = "tooldock-port-history";
const PROCESS_INPUT_KEY = "tooldock-process-input";
const PROCESS_HISTORY_KEY = "tooldock-process-history";
type ProcessQueryMode = "port" | "process" | "executable";

const routeMarketUrl =
  "https://routemarket.ai/?utm_source=tooldock&utm_medium=desktop_app&utm_campaign=sidebar_promo&utm_content=routemarket";
const routeMarketToolsUrl =
  "https://tools.routemarket.ai/?utm_source=tooldock&utm_medium=desktop_app&utm_campaign=sidebar_promo&utm_content=tools";

function parsePorts(input: string): number[] {
  const values = new Set<number>();
  const segments = input.split(/[\s,，]+/).filter(Boolean);

  for (const segment of segments) {
    if (segment.includes("-")) {
      const [rawStart, rawEnd] = segment.split("-", 2);
      const start = Number(rawStart);
      const end = Number(rawEnd);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) continue;
      for (let port = start; port <= Math.min(end, start + 199); port += 1) {
        if (port >= 1 && port <= 65535) values.add(port);
      }
    } else {
      const port = Number(segment);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) values.add(port);
    }
  }

  return [...values].slice(0, 200);
}

function formatBytes(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function randomString(length: number, charset: string) {
  const output: string[] = [];
  const maxValid = Math.floor(256 / charset.length) * charset.length;
  while (output.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(16, length)));
    for (const byte of bytes) {
      if (byte < maxValid) output.push(charset[byte % charset.length]);
      if (output.length === length) break;
    }
  }
  return output.join("");
}

function generateStrings(mode: StringMode, length: number, count: number, includeSymbols: boolean) {
  return Array.from({ length: count }, () => {
    if (mode === "uuid") return crypto.randomUUID();
    const charset =
      stringCharsets[mode] + (includeSymbols && mode !== "symbols" ? stringCharsets.symbols : "");
    return randomString(length, charset);
  });
}

function copyText(value: string, setCopied: (value: string) => void) {
  navigator.clipboard.writeText(value);
  setCopied(value);
  window.setTimeout(() => setCopied(""), 1200);
}

function App() {
  const [activeTool, setActiveTool] = useState<ToolId>("ports");
  const [status, setStatus] = useState("");
  const [settings, setSettings] = useState<AppSettings>({
    theme: "light",
    language: "zh-CN",
    uiFont: "sans",
    fontScale: 1.2,
    screenshotDir: "",
    recordingDir: "",
    colorShortcut: "CommandOrControl+Alt+C",
    screenshotShortcut: "CommandOrControl+Alt+S",
    recordingShortcut: "CommandOrControl+Alt+R",
    closeToTray: true,
    lanEnabled: true,
    lanDeviceId: "",
    lanDeviceName: "ToolDock Device",
    lanPassword: "",
    lanReceiveDir: "",
    systemWidgetEnabled: false,
    systemWidgetAlwaysOnTop: true,
    systemWidgetMode: "floating",
    systemWidgetMetrics: ["cpu", "memory", "temperature", "download", "upload"],
    systemTrayMetric: "none",
  });
  const [colorShortcutTrigger, setColorShortcutTrigger] = useState(0);
  const [screenshotShortcutTrigger, setScreenshotShortcutTrigger] = useState(0);
  const [recordingShortcutTrigger, setRecordingShortcutTrigger] = useState(0);
  const t = createTranslator(settings.language);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSystemWidgetVisibility((visible) => {
      if (!disposed) {
        setSettings((current) => ({ ...current, systemWidgetEnabled: visible }));
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    loadSettings()
      .then((value) => {
        setSettings(value);
        setStatus(createTranslator(value.language)("common.local"));
      })
      .catch((reason) => setStatus(t("status.settingsReadFailed", { error: String(reason) })));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
    document.documentElement.lang = settings.language;
    document.documentElement.style.setProperty("--ui-font-family", fontFamilies[settings.uiFont]);
    document.documentElement.style.setProperty("--ui-font-scale", String(settings.fontScale));
  }, [settings.fontScale, settings.language, settings.theme, settings.uiFont]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;

    async function triggerTool(tool: "color" | "screenshot" | "recording") {
      await showMainWindow().catch(() => undefined);
      if (tool === "color") {
        setActiveTool("color");
        setColorShortcutTrigger((value) => value + 1);
      } else if (tool === "screenshot") {
        setActiveTool("screenshot");
        setScreenshotShortcutTrigger((value) => value + 1);
      } else {
        setActiveTool("recording");
        setRecordingShortcutTrigger((value) => value + 1);
      }
    }

    shortcutRegistrationQueue = shortcutRegistrationQueue
      .then(async () => {
        await unregisterAll();
        if (cancelled) return;
        await register(settings.colorShortcut, (event) => {
          if (event.state === "Pressed") void triggerTool("color");
        });
        await register(settings.screenshotShortcut, (event) => {
          if (event.state === "Pressed") void triggerTool("screenshot");
        });
        await register(settings.recordingShortcut, (event) => {
          if (event.state === "Pressed") void triggerTool("recording");
        });
      })
      .catch(async (reason) => {
        await unregisterAll().catch(() => undefined);
        if (!cancelled) setStatus(t("status.shortcutFailed", { error: String(reason) }));
      });

    return () => {
      cancelled = true;
      shortcutRegistrationQueue = shortcutRegistrationQueue
        .then(() => unregisterAll())
        .catch(() => undefined);
    };
  }, [
    settings.colorShortcut,
    settings.language,
    settings.recordingShortcut,
    settings.screenshotShortcut,
  ]);

  async function persistSettings(next: AppSettings) {
    setSettings(next);
    const saved = await saveSettings(next);
    setSettings(saved);
  }

  async function toggleTheme() {
    const next = { ...settings, theme: settings.theme === "dark" ? "light" : "dark" } as AppSettings;
    try {
      await persistSettings(next);
      setStatus(next.theme === "light" ? t("status.themeLight") : t("status.themeDark"));
    } catch (reason) {
      setStatus(t("status.themeFailed", { error: String(reason) }));
    }
  }

  async function openPromotion(url: string, label: string) {
    try {
      await openExternalUrl(url);
      setStatus(t("status.opened", { label }));
    } catch (reason) {
      setStatus(t("status.openFailed", { label, error: String(reason) }));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/tooldock.svg" alt="" />
          <div>
            <strong>ToolDock</strong>
            <span>One Toolbox</span>
          </div>
        </div>

        <nav className="tool-nav" aria-label={t("nav.tools")}>
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                className={activeTool === tool.id ? "nav-item active" : "nav-item"}
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>
                  <strong>{t(tool.labelKey)}</strong>
                  <small>{t(tool.detailKey)}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="route-market-links" aria-label="RouteMarket">
            <button onClick={() => void openPromotion(routeMarketUrl, "RouteMarket.ai")}>
              <Store size={16} />
              <span>
                <strong>RouteMarket.ai</strong>
                <small>{t("nav.market")}</small>
              </span>
              <ExternalLink size={13} />
            </button>
            <button onClick={() => void openPromotion(routeMarketToolsUrl, "RouteMarket Tools")}>
              <Wrench size={16} />
              <span>
                <strong>RouteMarket Tools</strong>
                <small>{t("nav.onlineTools")}</small>
              </span>
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="sidebar-actions">
            <button
              onClick={toggleTheme}
              title={settings.theme === "dark" ? t("theme.switchLight") : t("theme.switchDark")}
            >
              {settings.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{settings.theme === "dark" ? t("theme.light") : t("theme.dark")}</span>
            </button>
            <button
              className={activeTool === "settings" ? "active" : ""}
              onClick={() => setActiveTool("settings")}
            >
              <Settings size={17} />
              <span>{t("common.settings")}</span>
            </button>
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            <span title={status}>{status}</span>
            <kbd>v0.1.2</kbd>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {activeTool === "ports" && <PortsTool language={settings.language} onStatus={setStatus} />}
        {activeTool === "color" && (
          <ColorTool
            language={settings.language}
            shortcutTrigger={colorShortcutTrigger}
            onStatus={setStatus}
          />
        )}
        {activeTool === "screenshot" && (
          <ScreenshotTool
            settings={settings}
            shortcutTrigger={screenshotShortcutTrigger}
            onStatus={setStatus}
          />
        )}
        {activeTool === "recording" && (
          <RecordingTool
            settings={settings}
            shortcutTrigger={recordingShortcutTrigger}
            onStatus={setStatus}
          />
        )}
        {activeTool === "strings" && (
          <StringTool language={settings.language} onStatus={setStatus} />
        )}
        {activeTool === "lan" && (
          <LanTool settings={settings} onSaveSettings={persistSettings} onStatus={setStatus} />
        )}
        {activeTool === "system" && (
          <SystemMonitorTool
            settings={settings}
            onSaveSettings={persistSettings}
            onStatus={setStatus}
          />
        )}
        {activeTool === "settings" && (
          <SettingsTool settings={settings} onSave={persistSettings} onStatus={setStatus} />
        )}
      </main>
    </div>
  );
}

function PortsTool({
  language,
  onStatus,
}: {
  language: AppLanguage;
  onStatus: (value: string) => void;
}) {
  const t = createTranslator(language);
  const [portInput, setPortInput] = useState(
    () => window.localStorage.getItem(PORT_INPUT_KEY) || "3000, 5173, 8000-8003",
  );
  const [recentPortQueries, setRecentPortQueries] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(PORT_HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [recentProcessQueries, setRecentProcessQueries] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(PROCESS_HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [queryMode, setQueryMode] = useState<ProcessQueryMode>("port");
  const [processQuery, setProcessQuery] = useState(
    () => window.localStorage.getItem(PROCESS_INPUT_KEY) || "",
  );
  const [executablePath, setExecutablePath] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ports = useMemo(() => parsePorts(portInput), [portInput]);
  const selectedProcesses = processes.filter((item) => selected.has(item.pid));
  const selectablePids = useMemo(
    () => [...new Set(processes.map((item) => item.pid).filter((pid) => pid > 0))],
    [processes],
  );
  const allSelected = selectablePids.length > 0 && selectablePids.every((pid) => selected.has(pid));
  const someSelected = selectablePids.some((pid) => selected.has(pid));
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem(PORT_INPUT_KEY, portInput);
  }, [portInput]);

  useEffect(() => {
    window.localStorage.setItem(PROCESS_INPUT_KEY, processQuery);
  }, [processQuery]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [allSelected, someSelected]);

  async function runInspect() {
    if (queryMode === "port" && !ports.length) {
      setError(t("ports.invalid"));
      return;
    }
    if (queryMode === "process" && !processQuery.trim()) {
      setError(t("ports.processInvalid"));
      return;
    }
    if (queryMode === "executable" && !executablePath) {
      setError(t("ports.executableInvalid"));
      return;
    }
    if (queryMode === "port") {
      const normalizedQuery = portInput.trim();
      setRecentPortQueries((current) => {
        const next = [normalizedQuery, ...current.filter((item) => item !== normalizedQuery)].slice(
          0,
          6,
        );
        window.localStorage.setItem(PORT_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    } else if (queryMode === "process") {
      const normalizedQuery = processQuery.trim();
      setRecentProcessQueries((current) => {
        const next = [normalizedQuery, ...current.filter((item) => item !== normalizedQuery)].slice(
          0,
          6,
        );
        window.localStorage.setItem(PROCESS_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    }
    setLoading(true);
    setError("");
    onStatus(t("ports.scanning"));
    try {
      const result =
        queryMode === "port"
          ? await inspectPorts(ports)
          : await inspectProcesses(processQuery, queryMode === "executable" ? executablePath : undefined);
      setProcesses(result);
      setSelected(new Set());
      onStatus(
        queryMode === "port"
          ? t("ports.queried", { count: ports.length })
          : t("ports.processQueried", { count: result.length }),
      );
    } catch (reason) {
      setError(String(reason));
      onStatus(t("ports.scanFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function runKill() {
    const pids = [...selected];
    setConfirmOpen(false);
    setLoading(true);
    onStatus(t("ports.killing", { count: pids.length }));
    try {
      const results = await killProcesses(pids);
      const succeeded = new Set(results.filter((item) => item.success).map((item) => item.pid));
      if (succeeded.size) {
        setProcesses((current) => current.filter((item) => !succeeded.has(item.pid)));
      }
      const failed = results.filter((item) => !item.success);
      setError(failed.map((item) => `PID ${item.pid}: ${item.message}`).join("\n"));
      setSelected(new Set());
      onStatus(t("ports.killed", { count: succeeded.size }));
    } catch (reason) {
      setError(String(reason));
      onStatus(t("ports.killFailed"));
    } finally {
      setLoading(false);
    }
  }

  function togglePid(pid: number) {
    if (pid <= 0) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function toggleAllPids() {
    setSelected(allSelected ? new Set() : new Set(selectablePids));
  }

  return (
    <section className="tool-page">
      <ToolHeader
        icon={Network}
        title={t("ports.title")}
        description={t("ports.description")}
        action={
          <button className="icon-button" title={t("ports.refresh")} onClick={runInspect} disabled={loading}>
            <RefreshCw size={17} />
          </button>
        }
      />

      <div className="query-bar">
        <div className="segmented process-query-modes">
          {(["port", "process", "executable"] as ProcessQueryMode[]).map((mode) => (
            <button
              className={queryMode === mode ? "active" : ""}
              key={mode}
              onClick={() => {
                setQueryMode(mode);
                setError("");
              }}
            >
              {t(`ports.mode.${mode}`)}
            </button>
          ))}
        </div>
        <div className="input-wrap">
          {queryMode === "executable" ? <FileSearch size={18} /> : <TerminalSquare size={18} />}
          {queryMode === "port" ? (
            <input
              value={portInput}
              onChange={(event) => setPortInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runInspect()}
              placeholder="3000, 5173, 8000-8010"
              aria-label={t("ports.port")}
            />
          ) : queryMode === "process" ? (
            <input
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runInspect()}
              placeholder={t("ports.processPlaceholder")}
              aria-label={t("ports.processName")}
            />
          ) : (
            <input
              value={executablePath}
              readOnly
              placeholder={t("ports.executablePlaceholder")}
              aria-label={t("ports.executable")}
            />
          )}
          {queryMode === "port" ? (
            <span>{t("ports.count", { count: ports.length })}</span>
          ) : queryMode === "executable" ? (
            <button
              className="inline-browse-button"
              onClick={async () => {
                const path = await chooseExecutable();
                if (path) setExecutablePath(path);
              }}
            >
              {t("common.browse")}
            </button>
          ) : null}
        </div>
        <button className="primary-button" onClick={runInspect} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
          {t("ports.search")}
        </button>
      </div>

      <div className="tip-line">
        <Sparkles size={15} />
        {t(`ports.tip.${queryMode}`)}
      </div>
      {queryMode === "port" && recentPortQueries.length > 0 && (
        <div className="quick-values port-query-history" aria-label={t("ports.recent")}>
          {recentPortQueries.map((query) => (
            <button key={query} onClick={() => setPortInput(query)}>
              {query}
            </button>
          ))}
        </div>
      )}
      {queryMode === "process" && recentProcessQueries.length > 0 && (
        <div className="quick-values port-query-history" aria-label={t("ports.recent")}>
          {recentProcessQueries.map((query) => (
            <button key={query} onClick={() => setProcessQuery(query)}>
              {query}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <ShieldAlert size={17} />
          <span>{error}</span>
          <button className="icon-button small" onClick={() => setError("")} title={t("common.close")}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className="table-shell">
        <div className="table-toolbar">
          <div>
            <strong>{processes.length ? t("ports.records", { count: processes.length }) : t("ports.results")}</strong>
            <span>
              {processes.length
                ? queryMode === "port"
                  ? t("ports.coverage", {
                      count: new Set(processes.flatMap((item) => item.ports)).size,
                    })
                  : t("ports.processCoverage", { count: processes.length })
                : t("ports.notQueried")}
            </span>
          </div>
          <button
            className="danger-button"
            disabled={!selected.size || loading}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 size={16} />
            {t("ports.killSelected")} {selected.size ? `(${selected.size})` : ""}
          </button>
        </div>

        {processes.length ? (
          <div className="process-table">
            <div className="process-row process-head">
              <label
                className={
                  allSelected || someSelected ? "checkbox checked process-select-all" : "checkbox process-select-all"
                }
                title={t("ports.selectAll")}
              >
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAllPids}
                  aria-label={t("ports.selectAll")}
                />
                {allSelected && <Check size={13} />}
                {someSelected && !allSelected && <Minus size={13} />}
              </label>
              <span>{t("ports.port")}</span>
              <span>{t("ports.process")}</span>
              <span>PID</span>
              <span>{t("ports.state")}</span>
              <span>{t("ports.memory")}</span>
            </div>
            {processes.map((process) => (
              <label className="process-row" key={`${process.port ?? "none"}-${process.protocol}-${process.pid}`}>
                <span className={selected.has(process.pid) ? "checkbox checked" : "checkbox"}>
                  <input
                    type="checkbox"
                    checked={selected.has(process.pid)}
                    onChange={() => togglePid(process.pid)}
                  />
                  {selected.has(process.pid) && <Check size={13} />}
                </span>
                <span>
                  <strong className="port-number">
                    {process.ports.length ? process.ports.slice(0, 3).join(", ") : "-"}
                  </strong>
                  <small>{process.protocol || "-"}</small>
                </span>
                <span className="process-cell">
                  <span className="process-icon">
                    <TerminalSquare size={17} />
                  </span>
                  <span>
                    <strong>{process.processName || t("ports.unknown")}</strong>
                    <small title={process.command}>{process.command || process.executable || "-"}</small>
                  </span>
                </span>
                <code>{process.pid || "-"}</code>
                <span>
                  <span className={process.state === "LISTEN" ? "state listening" : "state"}>
                    {process.state || "-"}
                  </span>
                </span>
                <span className="memory">{formatBytes(process.memoryBytes)}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-visual">
              <Network size={30} />
            </span>
            <strong>{t("ports.emptyTitle")}</strong>
            <p>{t("ports.emptyText")}</p>
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon danger">
              <ShieldAlert size={22} />
            </span>
            <h2>{t("ports.confirmTitle")}</h2>
            <p>{t("ports.confirmText", { count: selectedProcesses.length })}</p>
            <div className="pid-list">
              {selectedProcesses.map((item) => (
                <span key={item.pid}>
                  {item.processName} <code>{item.pid}</code>
                </span>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setConfirmOpen(false)}>
                {t("common.cancel")}
              </button>
              <button className="danger-button solid" onClick={runKill}>
                <Trash2 size={16} />
                {t("ports.confirmKill")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ColorTool({
  language,
  shortcutTrigger,
  onStatus,
}: {
  language: AppLanguage;
  shortcutTrigger: number;
  onStatus: (value: string) => void;
}) {
  const t = createTranslator(language);
  const [sample, setSample] = useState<ColorSample>({
    hex: "#4ADE80",
    rgb: [74, 222, 128],
    position: [0, 0],
  });
  const [history, setHistory] = useState<ColorSample[]>([]);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const handledShortcut = useRef(0);

  async function pick() {
    if (picking) return;
    setPicking(true);
    setError("");
    onStatus(t("color.picking"));
    try {
      const next = await pickScreenColor();
      setSample(next);
      setHistory((current) => [next, ...current.filter((item) => item.hex !== next.hex)].slice(0, 12));
      onStatus(t("color.picked", { value: next.hex }));
    } catch (reason) {
      const message = String(reason);
      if (!message.toLowerCase().includes("cancel")) setError(message);
      onStatus(t("color.cancelled"));
    } finally {
      setPicking(false);
    }
  }

  useEffect(() => {
    if (shortcutTrigger <= handledShortcut.current) return;
    handledShortcut.current = shortcutTrigger;
    void pick();
  }, [shortcutTrigger]);

  const rgbText = `rgb(${sample.rgb.join(", ")})`;

  return (
    <section className="tool-page">
      <ToolHeader icon={Crosshair} title={t("color.title")} description={t("color.description")} />

      <div className="color-layout">
        <div className="color-stage" style={{ backgroundColor: sample.hex }}>
          <div className="color-grid" />
          <div className="color-reticle">
            <Crosshair size={28} />
          </div>
          <div className="color-stage-meta">
            <span>{sample.hex}</span>
            <small>{rgbText}</small>
          </div>
        </div>

        <div className="control-panel">
          <span className="panel-label">{t("color.current")}</span>
          <div className="color-value-row">
            <span className="color-swatch" style={{ backgroundColor: sample.hex }} />
            <div>
              <strong>{sample.hex}</strong>
              <small>
                R {sample.rgb[0]} · G {sample.rgb[1]} · B {sample.rgb[2]}
              </small>
            </div>
          </div>

          <button className="primary-button wide" onClick={pick} disabled={picking}>
            {picking ? <LoaderCircle className="spin" size={18} /> : <Crosshair size={18} />}
            {picking ? t("color.waiting") : t("color.pick")}
          </button>

          <div className="copy-grid">
            {[sample.hex, rgbText].map((value) => (
              <button key={value} onClick={() => copyText(value, setCopied)}>
                <code>{value}</code>
                {copied === value ? <Check size={15} /> : <Copy size={15} />}
              </button>
            ))}
          </div>
          {error && <p className="inline-error">{error}</p>}
        </div>
      </div>

      <div className="history-section">
        <div className="section-title">
          <div>
            <strong>{t("color.recent")}</strong>
            <span>{t("color.recentHint")}</span>
          </div>
          {history.length > 0 && (
            <button className="text-button" onClick={() => setHistory([])}>
              {t("common.clear")}
            </button>
          )}
        </div>
        <div className="swatch-list">
          {(history.length ? history : [sample]).map((item, index) => (
            <button
              className="swatch-card"
              key={`${item.hex}-${index}`}
              onClick={() => copyText(item.hex, setCopied)}
            >
              <span style={{ backgroundColor: item.hex }} />
              <code>{item.hex}</code>
              {copied === item.hex ? <Check size={14} /> : <Copy size={14} />}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function StringTool({
  language,
  onStatus,
}: {
  language: AppLanguage;
  onStatus: (value: string) => void;
}) {
  const t = createTranslator(language);
  const [mode, setMode] = useState<StringMode>("alphanumeric");
  const [length, setLength] = useState(32);
  const [count, setCount] = useState(5);
  const [includeSymbols, setIncludeSymbols] = useState(false);
  const [results, setResults] = useState<string[]>(() =>
    generateStrings("alphanumeric", 32, 5, false),
  );
  const [copied, setCopied] = useState("");

  function generate() {
    const next = generateStrings(mode, mode === "uuid" ? 36 : length, count, includeSymbols);
    setResults(next);
    onStatus(t("strings.generated", { count }));
  }

  useEffect(() => {
    generate();
    // Generation should follow explicit option changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const modes: Array<{ id: StringMode; label: string; icon: typeof Hash }> = [
    { id: "alphanumeric", label: t("strings.alphanumeric"), icon: KeyRound },
    { id: "letters", label: t("strings.letters"), icon: Hash },
    { id: "numbers", label: t("strings.numbers"), icon: Dices },
    { id: "hex", label: "HEX", icon: Palette },
    { id: "uuid", label: "UUID v4", icon: Sparkles },
  ];

  return (
    <section className="tool-page">
      <ToolHeader
        icon={WandSparkles}
        title={t("strings.title")}
        description={t("strings.description")}
        action={
          <button className="primary-button" onClick={generate}>
            <RefreshCw size={16} />
            {t("strings.regenerate")}
          </button>
        }
      />

      <div className="generator-layout">
        <div className="generator-settings">
          <div>
            <span className="panel-label">{t("strings.type")}</span>
            <div className="mode-grid">
              {modes.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={mode === item.id ? "mode-button active" : "mode-button"}
                    key={item.id}
                    onClick={() => setMode(item.id)}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={mode === "uuid" ? "range-setting disabled" : "range-setting"}>
            <div>
              <span className="panel-label">{t("strings.length")}</span>
              <output>{mode === "uuid" ? 36 : length}</output>
            </div>
            <input
              type="range"
              min="4"
              max="128"
              step="1"
              value={mode === "uuid" ? 36 : length}
              disabled={mode === "uuid"}
              onChange={(event) => setLength(Number(event.target.value))}
            />
            <div className="quick-values">
              {[16, 32, 64, 128].map((value) => (
                <button
                  className={length === value && mode !== "uuid" ? "active" : ""}
                  key={value}
                  disabled={mode === "uuid"}
                  onClick={() => setLength(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="count-row">
            <label>
              <span className="panel-label">{t("strings.count")}</span>
              <span className="stepper">
                <button onClick={() => setCount((value) => Math.max(1, value - 1))}>−</button>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={count}
                  onChange={(event) =>
                    setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                  }
                />
                <button onClick={() => setCount((value) => Math.min(50, value + 1))}>+</button>
              </span>
            </label>
            <label className={mode === "uuid" ? "toggle-row disabled" : "toggle-row"}>
              <span>
                <strong>{t("strings.symbols")}</strong>
                <small>{t("strings.symbolsHint")}</small>
              </span>
              <button
                className={includeSymbols ? "toggle active" : "toggle"}
                role="switch"
                aria-checked={includeSymbols}
                disabled={mode === "uuid"}
                onClick={() => setIncludeSymbols((value) => !value)}
              >
                <span />
              </button>
            </label>
          </div>

          <button className="primary-button wide" onClick={generate}>
            <WandSparkles size={17} />
            {t("strings.generate")}
          </button>
        </div>

        <div className="result-panel">
          <div className="section-title">
            <div>
              <strong>{t("strings.results")}</strong>
              <span>{t("strings.items", { count: results.length })}</span>
            </div>
            <button
              className="secondary-button compact"
              onClick={() => copyText(results.join("\n"), setCopied)}
            >
              {copied === results.join("\n") ? <Check size={15} /> : <Clipboard size={15} />}
              {t("strings.copyAll")}
            </button>
          </div>
          <div className="string-list">
            {results.map((result, index) => (
              <div className="string-row" key={`${result}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{result}</code>
                <button title={t("common.copy")} onClick={() => copyText(result, setCopied)}>
                  {copied === result ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default App;
