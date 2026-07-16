import { useEffect, useMemo, useRef, useState } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import {
  Camera,
  Check,
  Clipboard,
  Copy,
  Crosshair,
  Dices,
  ExternalLink,
  Hash,
  KeyRound,
  LoaderCircle,
  Moon,
  Network,
  Palette,
  RefreshCw,
  Search,
  Settings,
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
  isDesktopApp,
  killProcesses,
  loadSettings,
  openExternalUrl,
  pickScreenColor,
  saveSettings,
  showMainWindow,
} from "./lib/native";
import { RecordingTool } from "./components/RecordingTool";
import { ScreenshotTool } from "./components/ScreenshotTool";
import { SettingsTool } from "./components/SettingsTool";
import { ToolHeader } from "./components/ToolHeader";
import type {
  AppSettings,
  ColorSample,
  PortProcess,
  ToolId,
} from "./types";

const tools: Array<{
  id: ToolId;
  label: string;
  detail: string;
  icon: typeof Palette;
}> = [
  { id: "color", label: "取色器", detail: "屏幕任意位置", icon: Crosshair },
  { id: "ports", label: "端口进程", detail: "查询与批量结束", icon: Network },
  { id: "screenshot", label: "截图", detail: "全屏、区域与历史", icon: Camera },
  { id: "recording", label: "屏幕录制", detail: "分辨率、帧率与码率", icon: Video },
  { id: "strings", label: "字符串生成", detail: "随机、安全、可批量", icon: WandSparkles },
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
  const [status, setStatus] = useState("本地运行");
  const [settings, setSettings] = useState<AppSettings>({
    theme: "dark",
    screenshotDir: "",
    recordingDir: "",
    colorShortcut: "CommandOrControl+Alt+C",
    screenshotShortcut: "CommandOrControl+Alt+S",
    recordingShortcut: "CommandOrControl+Alt+R",
    closeToTray: true,
  });
  const [colorShortcutTrigger, setColorShortcutTrigger] = useState(0);
  const [screenshotShortcutTrigger, setScreenshotShortcutTrigger] = useState(0);
  const [recordingShortcutTrigger, setRecordingShortcutTrigger] = useState(0);

  useEffect(() => {
    loadSettings()
      .then((value) => setSettings(value))
      .catch((reason) => setStatus(`设置读取失败：${String(reason)}`));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

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
        if (!cancelled) setStatus(`快捷键注册失败：${String(reason)}`);
      });

    return () => {
      cancelled = true;
      shortcutRegistrationQueue = shortcutRegistrationQueue
        .then(() => unregisterAll())
        .catch(() => undefined);
    };
  }, [
    settings.colorShortcut,
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
      setStatus(next.theme === "light" ? "已切换浅色模式" : "已切换深色模式");
    } catch (reason) {
      setStatus(`主题保存失败：${String(reason)}`);
    }
  }

  async function openPromotion(url: string, label: string) {
    try {
      await openExternalUrl(url);
      setStatus(`已打开 ${label}`);
    } catch (reason) {
      setStatus(`无法打开 ${label}：${String(reason)}`);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/tooldock.svg" alt="" />
          <div>
            <strong>ToolDock</strong>
            <span>Developer Toolbox</span>
          </div>
        </div>

        <nav className="tool-nav" aria-label="工具">
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
                  <strong>{tool.label}</strong>
                  <small>{tool.detail}</small>
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
                <small>开发者资源市场</small>
              </span>
              <ExternalLink size={13} />
            </button>
            <button onClick={() => void openPromotion(routeMarketToolsUrl, "RouteMarket Tools")}>
              <Wrench size={16} />
              <span>
                <strong>RouteMarket Tools</strong>
                <small>发现更多在线工具</small>
              </span>
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="sidebar-actions">
            <button onClick={toggleTheme} title={settings.theme === "dark" ? "切换浅色模式" : "切换深色模式"}>
              {settings.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{settings.theme === "dark" ? "浅色模式" : "深色模式"}</span>
            </button>
            <button
              className={activeTool === "settings" ? "active" : ""}
              onClick={() => setActiveTool("settings")}
            >
              <Settings size={17} />
              <span>设置</span>
            </button>
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            <span title={status}>{status}</span>
            <kbd>v0.1</kbd>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {activeTool === "ports" && <PortsTool onStatus={setStatus} />}
        {activeTool === "color" && (
          <ColorTool shortcutTrigger={colorShortcutTrigger} onStatus={setStatus} />
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
        {activeTool === "strings" && <StringTool onStatus={setStatus} />}
        {activeTool === "settings" && (
          <SettingsTool settings={settings} onSave={persistSettings} onStatus={setStatus} />
        )}
      </main>
    </div>
  );
}

function PortsTool({ onStatus }: { onStatus: (value: string) => void }) {
  const [portInput, setPortInput] = useState("3000, 5173, 8000-8003");
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ports = useMemo(() => parsePorts(portInput), [portInput]);
  const selectedProcesses = processes.filter((item) => selected.has(item.pid));

  async function runInspect() {
    if (!ports.length) {
      setError("请输入有效端口，范围为 1-65535。");
      return;
    }
    setLoading(true);
    setError("");
    onStatus("正在扫描端口");
    try {
      const result = await inspectPorts(ports);
      setProcesses(result);
      setSelected(new Set());
      onStatus(`已查询 ${ports.length} 个端口`);
    } catch (reason) {
      setError(String(reason));
      onStatus("端口扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function runKill() {
    const pids = [...selected];
    setConfirmOpen(false);
    setLoading(true);
    onStatus(`正在结束 ${pids.length} 个进程`);
    try {
      const results = await killProcesses(pids);
      const succeeded = new Set(results.filter((item) => item.success).map((item) => item.pid));
      if (succeeded.size) {
        setProcesses((current) => current.filter((item) => !succeeded.has(item.pid)));
      }
      const failed = results.filter((item) => !item.success);
      setError(failed.map((item) => `PID ${item.pid}: ${item.message}`).join("\n"));
      setSelected(new Set());
      onStatus(`已结束 ${succeeded.size} 个进程`);
    } catch (reason) {
      setError(String(reason));
      onStatus("结束进程失败");
    } finally {
      setLoading(false);
    }
  }

  function togglePid(pid: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  return (
    <section className="tool-page">
      <ToolHeader
        icon={Network}
        title="端口进程"
        description="定位占用本机端口的进程，并安全地批量结束。"
        action={
          <button className="icon-button" title="重新扫描" onClick={runInspect} disabled={loading}>
            <RefreshCw size={17} />
          </button>
        }
      />

      <div className="query-bar">
        <div className="input-wrap">
          <TerminalSquare size={18} />
          <input
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && runInspect()}
            placeholder="3000, 5173, 8000-8010"
            aria-label="端口"
          />
          <span>{ports.length} 个端口</span>
        </div>
        <button className="primary-button" onClick={runInspect} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
          查询
        </button>
      </div>

      <div className="tip-line">
        <Sparkles size={15} />
        支持逗号、空格和范围输入，单次最多查询 200 个端口。
      </div>

      {error && (
        <div className="error-banner">
          <ShieldAlert size={17} />
          <span>{error}</span>
          <button className="icon-button small" onClick={() => setError("")} title="关闭">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="table-shell">
        <div className="table-toolbar">
          <div>
            <strong>{processes.length ? `${processes.length} 个占用记录` : "查询结果"}</strong>
            <span>{processes.length ? `覆盖 ${new Set(processes.map((item) => item.port)).size} 个端口` : "尚未查询"}</span>
          </div>
          <button
            className="danger-button"
            disabled={!selected.size || loading}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 size={16} />
            结束所选 {selected.size ? `(${selected.size})` : ""}
          </button>
        </div>

        {processes.length ? (
          <div className="process-table">
            <div className="process-row process-head">
              <span />
              <span>端口</span>
              <span>进程</span>
              <span>PID</span>
              <span>状态</span>
              <span>内存</span>
            </div>
            {processes.map((process) => (
              <label className="process-row" key={`${process.port}-${process.protocol}-${process.pid}`}>
                <span className={selected.has(process.pid) ? "checkbox checked" : "checkbox"}>
                  <input
                    type="checkbox"
                    checked={selected.has(process.pid)}
                    onChange={() => togglePid(process.pid)}
                  />
                  {selected.has(process.pid) && <Check size={13} />}
                </span>
                <span>
                  <strong className="port-number">{process.port}</strong>
                  <small>{process.protocol}</small>
                </span>
                <span className="process-cell">
                  <span className="process-icon">
                    <TerminalSquare size={17} />
                  </span>
                  <span>
                    <strong>{process.processName || "未知进程"}</strong>
                    <small title={process.command}>{process.command || process.executable || "-"}</small>
                  </span>
                </span>
                <code>{process.pid || "-"}</code>
                <span>
                  <span className={process.state === "LISTEN" ? "state listening" : "state"}>
                    {process.state || "BOUND"}
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
            <strong>输入端口开始查询</strong>
            <p>在浏览器预览中，3000 和 5173 会返回演示数据。</p>
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon danger">
              <ShieldAlert size={22} />
            </span>
            <h2>结束所选进程？</h2>
            <p>
              将向 {selectedProcesses.length} 个进程发送强制结束信号。未保存的数据可能丢失，此操作无法撤销。
            </p>
            <div className="pid-list">
              {selectedProcesses.map((item) => (
                <span key={item.pid}>
                  {item.processName} <code>{item.pid}</code>
                </span>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button className="danger-button solid" onClick={runKill}>
                <Trash2 size={16} />
                确认结束
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ColorTool({
  shortcutTrigger,
  onStatus,
}: {
  shortcutTrigger: number;
  onStatus: (value: string) => void;
}) {
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
    onStatus("点击屏幕任意位置取色");
    try {
      const next = await pickScreenColor();
      setSample(next);
      setHistory((current) => [next, ...current.filter((item) => item.hex !== next.hex)].slice(0, 12));
      onStatus(`已取得并复制颜色 ${next.hex}`);
    } catch (reason) {
      const message = String(reason);
      if (!message.toLowerCase().includes("cancel")) setError(message);
      onStatus("取色已取消");
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
      <ToolHeader icon={Crosshair} title="取色器" description="从屏幕任意位置读取精确颜色值。" />

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
          <span className="panel-label">当前颜色</span>
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
            {picking ? "等待取色…" : "从屏幕取色"}
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
            <strong>最近颜色</strong>
            <span>点击色块即可复制 HEX</span>
          </div>
          {history.length > 0 && (
            <button className="text-button" onClick={() => setHistory([])}>
              清空
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

function StringTool({ onStatus }: { onStatus: (value: string) => void }) {
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
    onStatus(`已生成 ${count} 条随机字符串`);
  }

  useEffect(() => {
    generate();
    // Generation should follow explicit option changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const modes: Array<{ id: StringMode; label: string; icon: typeof Hash }> = [
    { id: "alphanumeric", label: "字母 + 数字", icon: KeyRound },
    { id: "letters", label: "仅字母", icon: Hash },
    { id: "numbers", label: "仅数字", icon: Dices },
    { id: "hex", label: "HEX", icon: Palette },
    { id: "uuid", label: "UUID v4", icon: Sparkles },
  ];

  return (
    <section className="tool-page">
      <ToolHeader
        icon={WandSparkles}
        title="字符串生成"
        description="使用系统加密随机源，批量生成开发测试数据。"
        action={
          <button className="primary-button" onClick={generate}>
            <RefreshCw size={16} />
            重新生成
          </button>
        }
      />

      <div className="generator-layout">
        <div className="generator-settings">
          <div>
            <span className="panel-label">类型</span>
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
              <span className="panel-label">长度</span>
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
              <span className="panel-label">生成数量</span>
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
                <strong>包含符号</strong>
                <small>! @ # $ % 等</small>
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
            生成字符串
          </button>
        </div>

        <div className="result-panel">
          <div className="section-title">
            <div>
              <strong>生成结果</strong>
              <span>{results.length} 条</span>
            </div>
            <button
              className="secondary-button compact"
              onClick={() => copyText(results.join("\n"), setCopied)}
            >
              {copied === results.join("\n") ? <Check size={15} /> : <Clipboard size={15} />}
              复制全部
            </button>
          </div>
          <div className="string-list">
            {results.map((result, index) => (
              <div className="string-row" key={`${result}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{result}</code>
                <button title="复制" onClick={() => copyText(result, setCopied)}>
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
