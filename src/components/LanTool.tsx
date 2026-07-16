import { Children, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Link2,
  LoaderCircle,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Unplug,
  Upload,
  Wifi,
} from "lucide-react";
import { createTranslator, localeFor } from "../i18n";
import {
  chooseFiles,
  connectLanDevice,
  disconnectLanDevice,
  getLanStatus,
  listLanClipboardHistory,
  listLanDevices,
  listLanTransfers,
  listenLanClipboardReceived,
  readLanClipboard,
  sendLanClipboard,
  sendLanFiles,
} from "../lib/native";
import type {
  AppSettings,
  LanClipboardRecord,
  LanDevice,
  LanStatus,
  LanTransferRecord,
} from "../types";
import { ToolHeader } from "./ToolHeader";

export function LanTool({
  settings,
  onSaveSettings,
  onStatus,
}: {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onStatus: (value: string) => void;
}) {
  const t = createTranslator(settings.language);
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [devices, setDevices] = useState<LanDevice[]>([]);
  const [transfers, setTransfers] = useState<LanTransferRecord[]>([]);
  const [clipboards, setClipboards] = useState<LanClipboardRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [connectTarget, setConnectTarget] = useState<LanDevice | null>(null);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localPasswordVisible, setLocalPasswordVisible] = useState(false);
  const [autoClipboard, setAutoClipboard] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const lastClipboardRef = useRef("");
  const clipboardBusyRef = useRef(false);

  const connectedDevices = useMemo(
    () => devices.filter((device) => device.connected),
    [devices],
  );
  const selectedDevice =
    connectedDevices.find((device) => device.id === selectedDeviceId) ?? connectedDevices[0];

  async function refresh(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setBusy("refresh");
    try {
      const [nextStatus, nextDevices, nextTransfers, nextClipboards] = await Promise.all([
        getLanStatus(),
        listLanDevices(),
        listLanTransfers(),
        listLanClipboardHistory(),
      ]);
      setStatus(nextStatus);
      setDevices(nextDevices);
      setTransfers(nextTransfers);
      setClipboards(nextClipboards);
      setSelectedDeviceId((current) => {
        if (nextDevices.some((device) => device.id === current && device.connected)) return current;
        return nextDevices.find((device) => device.connected)?.id ?? "";
      });
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      if (!options.quiet) setBusy("");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh({ quiet: true }), 1400);
    return () => window.clearInterval(timer);
  }, [settings.lanEnabled]);

  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    void listenLanClipboardReceived(() => {
      void readLanClipboard()
        .then((text) => {
          if (active) lastClipboardRef.current = text;
        })
        .catch(() => undefined);
      void refresh({ quiet: true });
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (!autoClipboard || connectedDevices.length === 0) return;
    let active = true;
    void readLanClipboard()
      .then((text) => {
        lastClipboardRef.current = text;
      })
      .catch(() => undefined);
    const timer = window.setInterval(async () => {
      if (!active || clipboardBusyRef.current) return;
      clipboardBusyRef.current = true;
      try {
        const text = await readLanClipboard();
        if (text && text !== lastClipboardRef.current) {
          lastClipboardRef.current = text;
          await sendLanClipboard(text, []);
          await refresh({ quiet: true });
        }
      } catch (reason) {
        if (active) {
          setAutoClipboard(false);
          setError(String(reason));
        }
      } finally {
        clipboardBusyRef.current = false;
      }
    }, 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [autoClipboard, connectedDevices.length]);

  async function connect() {
    if (!connectTarget) return;
    setBusy(`connect:${connectTarget.id}`);
    setError("");
    try {
      const device = await connectLanDevice(connectTarget.id, password);
      setSelectedDeviceId(device.id);
      setConnectTarget(null);
      setPassword("");
      onStatus(t("lan.connectedStatus", { name: device.name }));
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function disconnect(device: LanDevice) {
    setBusy(`disconnect:${device.id}`);
    try {
      await disconnectLanDevice(device.id);
      onStatus(t("lan.disconnectedStatus", { name: device.name }));
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function chooseAndSendFiles() {
    if (!selectedDevice) return;
    const paths = await chooseFiles();
    if (!paths.length) return;
    setBusy("files");
    setError("");
    try {
      const results = await sendLanFiles(selectedDevice.id, paths);
      const failures = results.filter((item) => item.status === "failed");
      const failed = failures.length;
      if (failed) {
        setError(failures[0].message || t("lan.transferFailedUnknown"));
      }
      onStatus(
        failed
          ? t("lan.filesPartialStatus", { count: results.length, failed })
          : t("lan.filesSentStatus", { count: results.length, name: selectedDevice.name }),
      );
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function retryTransfer(record: LanTransferRecord) {
    setBusy(`retry:${record.id}`);
    setError("");
    try {
      const [result] = await sendLanFiles(record.deviceId, [record.path]);
      if (!result || result.status === "failed") {
        throw new Error(result?.message || t("lan.transferFailedUnknown"));
      }
      onStatus(t("lan.retrySentStatus", { name: record.fileName }));
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function sendClipboardNow() {
    setBusy("clipboard");
    setError("");
    try {
      const text = await readLanClipboard();
      if (!text) throw new Error(t("lan.clipboardEmpty"));
      lastClipboardRef.current = text;
      const results = await sendLanClipboard(text, []);
      onStatus(t("lan.clipboardSentStatus", { count: results.length }));
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(settings.lanPassword);
    onStatus(t("lan.passwordCopied"));
  }

  async function refreshPassword() {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const lanPassword = String(random[0] % 1_000_000).padStart(6, "0");
    setBusy("password");
    setError("");
    try {
      await onSaveSettings({ ...settings, lanPassword });
      setLocalPasswordVisible(true);
      onStatus(t("lan.passwordRefreshed"));
      await refresh({ quiet: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="tool-page lan-page">
      <ToolHeader
        icon={Wifi}
        title={t("lan.title")}
        description={t("lan.description")}
        action={
          <button
            className="secondary-button compact"
            onClick={() => void refresh()}
            disabled={busy === "refresh"}
          >
            <RefreshCw className={busy === "refresh" ? "spin" : ""} size={15} />
            {t("lan.refresh")}
          </button>
        }
      />

      {!settings.lanEnabled || status?.enabled === false ? (
        <div className="lan-disabled">
          <span className="empty-visual">
            <Wifi size={26} />
          </span>
          <strong>{t("lan.disabledTitle")}</strong>
          <p>{t("lan.disabledText")}</p>
        </div>
      ) : (
        <>
          <section className="lan-identity">
            <div className="lan-identity-main">
              <span className="lan-section-icon">
                <MonitorSmartphone size={20} />
              </span>
              <span>
                <small>{t("lan.thisDevice")}</small>
                <strong>{status?.localDevice?.name ?? settings.lanDeviceName}</strong>
                <code>{status?.localDevice?.id ?? settings.lanDeviceId}</code>
              </span>
            </div>
            <div className="lan-password">
              <span>
                <small>{t("lan.connectionPassword")}</small>
                <strong>{localPasswordVisible ? settings.lanPassword || t("lan.openMode") : "••••••"}</strong>
              </span>
              <button
                className="icon-button small"
                title={localPasswordVisible ? t("lan.hidePassword") : t("lan.showPassword")}
                onClick={() => setLocalPasswordVisible((value) => !value)}
              >
                {localPasswordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                className="icon-button small"
                title={t("lan.copyPassword")}
                onClick={() => void copyPassword()}
                disabled={!settings.lanPassword}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button small"
                title={t("lan.refreshPassword")}
                onClick={() => void refreshPassword()}
                disabled={busy === "password"}
              >
                <RefreshCw className={busy === "password" ? "spin" : ""} size={14} />
              </button>
            </div>
            <div className="lan-security-note">
              <ShieldCheck size={17} />
              <span>{t("lan.passwordHint")}</span>
            </div>
          </section>

          <div className="lan-columns">
            <section className="lan-section">
              <header className="lan-section-heading">
                <span>
                  <Radio size={17} />
                  <strong>{t("lan.nearbyDevices")}</strong>
                </span>
                <small>{t("lan.deviceCount", { count: devices.length })}</small>
              </header>
              <div className="lan-device-list">
                {devices.length === 0 ? (
                  <div className="lan-list-empty">
                    <Wifi size={21} />
                    <strong>{t("lan.noDevices")}</strong>
                    <small>{t("lan.noDevicesHint")}</small>
                  </div>
                ) : (
                  devices.map((device) => {
                    const selected = selectedDevice?.id === device.id;
                    return (
                      <div
                        className={`lan-device-row${selected ? " selected" : ""}`}
                        key={device.id}
                        onClick={() => device.connected && setSelectedDeviceId(device.id)}
                      >
                        <span className={`lan-device-status${device.connected ? " connected" : ""}`}>
                          {device.connected ? <Link2 size={16} /> : <MonitorSmartphone size={16} />}
                        </span>
                        <span className="lan-device-copy">
                          <strong>{device.name}</strong>
                          <small>
                            {device.address}:{device.port}
                          </small>
                        </span>
                        {device.connected ? (
                          <>
                            <span className="lan-connected-label">
                              <CheckCircle2 size={13} />
                              {t("lan.connected")}
                            </span>
                            <button
                              className="icon-button small"
                              title={t("lan.disconnect")}
                              disabled={busy === `disconnect:${device.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void disconnect(device);
                              }}
                            >
                              {busy === `disconnect:${device.id}` ? (
                                <LoaderCircle className="spin" size={14} />
                              ) : (
                                <Unplug size={14} />
                              )}
                            </button>
                          </>
                        ) : (
                          <button
                            className="secondary-button compact"
                            onClick={() => {
                              setPassword("");
                              setPasswordVisible(false);
                              setConnectTarget(device);
                            }}
                          >
                            <KeyRound size={14} />
                            {t("lan.connect")}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="lan-section lan-actions-panel">
              <header className="lan-section-heading">
                <span>
                  <Send size={17} />
                  <strong>{t("lan.share")}</strong>
                </span>
                <small>{selectedDevice?.name ?? t("lan.noTarget")}</small>
              </header>

              <div className="lan-share-action">
                <span className="lan-action-icon">
                  <FileUp size={19} />
                </span>
                <span>
                  <strong>{t("lan.fileTransfer")}</strong>
                  <small>{t("lan.fileTransferHint")}</small>
                </span>
                <button
                  className="primary-button"
                  onClick={() => void chooseAndSendFiles()}
                  disabled={!selectedDevice || busy === "files"}
                >
                  {busy === "files" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Upload size={15} />
                  )}
                  {t("lan.chooseFiles")}
                </button>
              </div>

              <div className="lan-share-action">
                <span className="lan-action-icon">
                  <Clipboard size={19} />
                </span>
                <span>
                  <strong>{t("lan.clipboardSync")}</strong>
                  <small>{t("lan.clipboardSyncHint")}</small>
                </span>
                <div className="lan-clipboard-actions">
                  <button
                    className={autoClipboard ? "toggle active" : "toggle"}
                    onClick={() => setAutoClipboard((value) => !value)}
                    disabled={connectedDevices.length === 0}
                    role="switch"
                    aria-checked={autoClipboard}
                    title={t("lan.autoSync")}
                  >
                    <span />
                  </button>
                  <button
                    className="secondary-button compact"
                    onClick={() => void sendClipboardNow()}
                    disabled={connectedDevices.length === 0 || busy === "clipboard"}
                  >
                    {busy === "clipboard" ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Send size={14} />
                    )}
                    {t("lan.sendNow")}
                  </button>
                </div>
              </div>

              <div className="lan-receive-path">
                <Download size={15} />
                <span>
                  <small>{t("lan.receiveFolder")}</small>
                  <code title={status?.receiveDir}>{status?.receiveDir}</code>
                </span>
              </div>
            </section>
          </div>

          {error && (
            <div className="lan-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="lan-history-columns">
            <HistorySection
              title={t("lan.transferHistory")}
              empty={t("lan.noTransfers")}
              icon={<FileUp size={16} />}
            >
              {transfers.map((record) => (
                <div className="lan-history-row" key={record.id}>
                  <span className={`lan-direction ${record.direction}`}>
                    {record.direction === "incoming" ? (
                      <Download size={15} />
                    ) : (
                      <Upload size={15} />
                    )}
                  </span>
                  <span>
                    <strong title={record.fileName}>{record.fileName}</strong>
                    <small
                      className={record.status === "failed" ? "lan-history-error" : undefined}
                      title={record.message || undefined}
                    >
                      {record.status === "failed" && record.message
                        ? record.message
                        : `${record.deviceName} · ${formatBytes(record.sizeBytes)}`}
                    </small>
                  </span>
                  <span className={`lan-transfer-state ${record.status}`}>
                    {t(`lan.status.${record.status}`)}
                  </span>
                  {record.direction === "outgoing" && record.status === "failed" ? (
                    <button
                      className="icon-button small"
                      title={t("lan.retry")}
                      onClick={() => void retryTransfer(record)}
                      disabled={busy === `retry:${record.id}`}
                    >
                      {busy === `retry:${record.id}` ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </button>
                  ) : (
                    <span className="lan-history-action-spacer" />
                  )}
                  <time>{formatTime(record.createdAt, settings.language)}</time>
                </div>
              ))}
            </HistorySection>

            <HistorySection
              title={t("lan.clipboardHistory")}
              empty={t("lan.noClipboardHistory")}
              icon={<Clipboard size={16} />}
            >
              {clipboards.map((record) => (
                <div className="lan-history-row clipboard" key={record.id}>
                  <span className={`lan-direction ${record.direction}`}>
                    {record.direction === "incoming" ? (
                      <Download size={15} />
                    ) : (
                      <Upload size={15} />
                    )}
                  </span>
                  <span>
                    <strong title={record.preview}>{record.preview || t("lan.emptyText")}</strong>
                    <small>{record.deviceName}</small>
                  </span>
                  <time>{formatTime(record.createdAt, settings.language)}</time>
                </div>
              ))}
            </HistorySection>
          </div>
        </>
      )}

      {connectTarget && (
        <div className="modal-backdrop" onMouseDown={() => setConnectTarget(null)}>
          <div className="modal lan-connect-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon lan-modal-icon">
              <KeyRound size={20} />
            </span>
            <h2>{t("lan.connectTitle", { name: connectTarget.name })}</h2>
            <p>{t("lan.connectText")}</p>
            <label className="lan-password-input">
              <span>{t("lan.connectionPassword")}</span>
              <span>
                <input
                  autoFocus
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  placeholder={connectTarget.passwordRequired ? t("lan.passwordPlaceholder") : t("lan.openMode")}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connect();
                  }}
                />
                <button
                  className="icon-button"
                  title={passwordVisible ? t("lan.hidePassword") : t("lan.showPassword")}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  {passwordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
            {error && <p className="inline-error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setConnectTarget(null)}>
                {t("common.cancel")}
              </button>
              <button className="primary-button" onClick={() => void connect()}>
                {busy === `connect:${connectTarget.id}` ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Link2 size={15} />
                )}
                {t("lan.connect")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function HistorySection({
  title,
  empty,
  icon,
  children,
}: {
  title: string;
  empty: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasChildren = Children.count(children) > 0;
  return (
    <section className="lan-history">
      <header>
        <span>
          {icon}
          <strong>{title}</strong>
        </span>
      </header>
      <div className="lan-history-list">
        {hasChildren ? children : <div className="lan-history-empty">{empty}</div>}
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTime(value: string, language: AppSettings["language"]) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(localeFor(language), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
