import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  FolderOpen,
  Eye,
  EyeOff,
  Image,
  KeyRound,
  Languages,
  LoaderCircle,
  PanelTop,
  PanelTopClose,
  PictureInPicture2,
  Radio,
  RotateCcw,
  Settings,
  Type,
  Video,
} from "lucide-react";
import {
  createTranslator,
  fontOptions,
  languageOptions,
} from "../i18n";
import { chooseDirectory } from "../lib/native";
import type { AppSettings } from "../types";
import { SelectMenu } from "./SelectMenu";
import { ToolHeader } from "./ToolHeader";

export function SettingsTool({
  settings,
  onSave,
  onStatus,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onStatus: (value: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [lanPasswordVisible, setLanPasswordVisible] = useState(false);
  const t = createTranslator(draft.language);

  useEffect(() => setDraft(settings), [settings]);

  async function browse(field: "screenshotDir" | "recordingDir" | "lanReceiveDir") {
    const selected = await chooseDirectory(draft[field]);
    if (selected) setDraft((current) => ({ ...current, [field]: selected }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    const shortcuts = [
      draft.colorShortcut,
      draft.screenshotShortcut,
      draft.recordingShortcut,
    ];
    if (new Set(shortcuts).size !== shortcuts.length) {
      setError(t("settings.duplicateShortcut"));
      setSaving(false);
      return;
    }
    if (draft.lanPassword.length > 0 && draft.lanPassword.length < 4) {
      setError(t("settings.lanPasswordInvalid"));
      setSaving(false);
      return;
    }
    try {
      await onSave(draft);
      setSaved(true);
      onStatus(t("settings.savedStatus"));
      window.setTimeout(() => setSaved(false), 1600);
    } catch (reason) {
      setError(String(reason));
      onStatus(t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tool-page settings-page">
      <ToolHeader
        icon={Settings}
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <Languages size={18} />
          </span>
          <div>
            <strong>{t("settings.appearance")}</strong>
            <small>{t("settings.appearanceHint")}</small>
          </div>
        </div>

        <div className="setting-row appearance-setting">
          <span>
            <strong>{t("settings.language")}</strong>
            <small>{t("settings.languageHint")}</small>
          </span>
          <SelectMenu
            className="setting-select"
            value={draft.language}
            ariaLabel={t("settings.language")}
            options={languageOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                language: value as AppSettings["language"],
              }))
            }
          />
        </div>

        <div className="setting-row appearance-setting">
          <span>
            <strong>{t("settings.font")}</strong>
            <small>{t("settings.fontHint")}</small>
          </span>
          <SelectMenu
            className="setting-select"
            value={draft.uiFont}
            ariaLabel={t("settings.font")}
            icon={<Type size={15} />}
            options={fontOptions.map((option) => ({
              value: option.value,
              label: t(option.key),
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                uiFont: value as AppSettings["uiFont"],
              }))
            }
          />
        </div>

        <div className="setting-row appearance-setting">
          <span>
            <strong>{t("settings.fontSize")}</strong>
            <small>{t("settings.fontSizeHint")}</small>
          </span>
          <div className="segmented font-scale-control">
            {[1, 1.1, 1.2].map((scale) => (
              <button
                className={draft.fontScale === scale ? "active" : ""}
                key={scale}
                onClick={() => setDraft((current) => ({ ...current, fontScale: scale }))}
              >
                {Math.round(scale * 100)}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <KeyRound size={18} />
          </span>
          <div>
            <strong>{t("settings.shortcuts")}</strong>
            <small>{t("settings.shortcutsHint")}</small>
          </div>
        </div>

        <ShortcutSetting
          label={t("settings.colorShortcut")}
          detail={t("settings.colorShortcutHint")}
          value={draft.colorShortcut}
          defaultValue="CommandOrControl+Alt+C"
          onChange={(value) => setDraft((current) => ({ ...current, colorShortcut: value }))}
          t={t}
        />
        <ShortcutSetting
          label={t("settings.screenshotShortcut")}
          detail={t("settings.screenshotShortcutHint")}
          value={draft.screenshotShortcut}
          defaultValue="CommandOrControl+Alt+S"
          onChange={(value) => setDraft((current) => ({ ...current, screenshotShortcut: value }))}
          t={t}
        />
        <ShortcutSetting
          label={t("settings.recordingShortcut")}
          detail={t("settings.recordingShortcutHint")}
          value={draft.recordingShortcut}
          defaultValue="CommandOrControl+Alt+R"
          onChange={(value) => setDraft((current) => ({ ...current, recordingShortcut: value }))}
          t={t}
        />
        <div className="setting-row">
          <span className="setting-with-icon">
            <span className="folder-setting-icon">
              <PanelTopClose size={18} />
            </span>
            <span>
              <strong>{t("settings.closeToTray")}</strong>
              <small>{t("settings.closeToTrayHint")}</small>
            </span>
          </span>
          <button
            className={draft.closeToTray ? "toggle active" : "toggle"}
            onClick={() => setDraft((current) => ({ ...current, closeToTray: !current.closeToTray }))}
            role="switch"
            aria-checked={draft.closeToTray}
            title={t("settings.closeToTray")}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <FolderOpen size={18} />
          </span>
          <div>
            <strong>{t("settings.files")}</strong>
            <small>{t("settings.filesHint")}</small>
          </div>
        </div>

        <FolderSetting
          icon={Image}
          label={t("settings.screenshotDir")}
          detail={t("settings.screenshotDirHint")}
          value={draft.screenshotDir}
          onChange={(value) => setDraft((current) => ({ ...current, screenshotDir: value }))}
          onBrowse={() => browse("screenshotDir")}
          browseLabel={t("common.browse")}
        />
        <FolderSetting
          icon={Video}
          label={t("settings.recordingDir")}
          detail={t("settings.recordingDirHint")}
          value={draft.recordingDir}
          onChange={(value) => setDraft((current) => ({ ...current, recordingDir: value }))}
          onBrowse={() => browse("recordingDir")}
          browseLabel={t("common.browse")}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <Activity size={18} />
          </span>
          <div>
            <strong>{t("settings.systemMonitor")}</strong>
            <small>{t("settings.systemMonitorHint")}</small>
          </div>
        </div>

        <div className="setting-row">
          <span>
            <strong>{t("settings.systemWidgetMode")}</strong>
            <small>{t("settings.systemWidgetModeHint")}</small>
          </span>
          <div className="segmented widget-mode-setting">
            <button
              className={draft.systemWidgetMode === "floating" ? "active" : ""}
              onClick={() =>
                setDraft((current) => ({ ...current, systemWidgetMode: "floating" }))
              }
            >
              <PictureInPicture2 size={14} />
              {t("system.floatingMode")}
            </button>
            <button
              className={draft.systemWidgetMode === "taskbar" ? "active" : ""}
              onClick={() =>
                setDraft((current) => ({ ...current, systemWidgetMode: "taskbar" }))
              }
            >
              <PanelTop size={14} />
              {t("system.taskbarMode")}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <span>
            <strong>{t("settings.systemWidget")}</strong>
            <small>{t("settings.systemWidgetHint")}</small>
          </span>
          <button
            className={draft.systemWidgetEnabled ? "toggle active" : "toggle"}
            aria-label={t("settings.systemWidget")}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                systemWidgetEnabled: !current.systemWidgetEnabled,
              }))
            }
          >
            <span />
          </button>
        </div>

        <div className="setting-row">
          <span>
            <strong>{t("settings.systemWidgetAlwaysOnTop")}</strong>
            <small>{t("settings.systemWidgetAlwaysOnTopHint")}</small>
          </span>
          <button
            className={draft.systemWidgetAlwaysOnTop ? "toggle active" : "toggle"}
            aria-label={t("settings.systemWidgetAlwaysOnTop")}
            disabled={!draft.systemWidgetEnabled || draft.systemWidgetMode === "taskbar"}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                systemWidgetAlwaysOnTop: !current.systemWidgetAlwaysOnTop,
              }))
            }
          >
            <span />
          </button>
        </div>

      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <Radio size={18} />
          </span>
          <div>
            <strong>{t("settings.lan")}</strong>
            <small>{t("settings.lanHint")}</small>
          </div>
        </div>

        <div className="setting-row">
          <span>
            <strong>{t("settings.lanEnabled")}</strong>
            <small>{t("settings.lanEnabledHint")}</small>
          </span>
          <button
            className={draft.lanEnabled ? "toggle active" : "toggle"}
            onClick={() =>
              setDraft((current) => ({ ...current, lanEnabled: !current.lanEnabled }))
            }
            role="switch"
            aria-checked={draft.lanEnabled}
            title={t("settings.lanEnabled")}
          >
            <span />
          </button>
        </div>

        <div className="setting-row lan-setting-row">
          <span>
            <strong>{t("settings.lanDeviceName")}</strong>
            <small>{t("settings.lanDeviceNameHint")}</small>
          </span>
          <input
            className="setting-text-input"
            value={draft.lanDeviceName}
            disabled={!draft.lanEnabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, lanDeviceName: event.target.value }))
            }
          />
        </div>

        <div className="setting-row lan-setting-row">
          <span>
            <strong>{t("settings.lanPassword")}</strong>
            <small>{t("settings.lanPasswordHint")}</small>
          </span>
          <div className="setting-password-input">
            <input
              type={lanPasswordVisible ? "text" : "password"}
              value={draft.lanPassword}
              disabled={!draft.lanEnabled}
              placeholder={t("settings.lanPasswordPlaceholder")}
              onChange={(event) =>
                setDraft((current) => ({ ...current, lanPassword: event.target.value }))
              }
            />
            <button
              className="icon-button"
              title={
                lanPasswordVisible ? t("settings.hideLanPassword") : t("settings.showLanPassword")
              }
              onClick={() => setLanPasswordVisible((value) => !value)}
              disabled={!draft.lanEnabled}
            >
              {lanPasswordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <FolderSetting
          icon={FolderOpen}
          label={t("settings.lanReceiveDir")}
          detail={t("settings.lanReceiveDirHint")}
          value={draft.lanReceiveDir}
          onChange={(value) => setDraft((current) => ({ ...current, lanReceiveDir: value }))}
          onBrowse={() => browse("lanReceiveDir")}
          browseLabel={t("common.browse")}
        />
      </div>

      <div className="settings-actions">
        {error && <p className="inline-error">{error}</p>}
        <button className="primary-button" onClick={save} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : saved ? <Check size={16} /> : <Settings size={16} />}
          {saving ? t("common.saving") : saved ? t("common.saved") : t("settings.save")}
        </button>
      </div>
    </section>
  );
}

function ShortcutSetting({
  label,
  detail,
  value,
  defaultValue,
  onChange,
  t,
}: {
  label: string;
  detail: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");

  function record(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecording(false);
      setHint("");
      event.currentTarget.blur();
      return;
    }

    const key = normalizeShortcutKey(event.key);
    const modifiers: string[] = [];
    if (event.ctrlKey || event.metaKey) modifiers.push("CommandOrControl");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    if (!key || !modifiers.some((item) => item === "CommandOrControl" || item === "Alt")) {
      setHint(t("settings.shortcutInvalid"));
      return;
    }

    onChange([...modifiers, key].join("+"));
    setRecording(false);
    setHint("");
    event.currentTarget.blur();
  }

  return (
    <div className="setting-row shortcut-setting">
      <span>
        <strong>{label}</strong>
        <small>{hint || detail}</small>
      </span>
      <div className="shortcut-control">
        <button
          className={recording ? "shortcut-recorder recording" : "shortcut-recorder"}
          onClick={() => {
            setRecording(true);
            setHint(t("settings.shortcutPrompt"));
          }}
          onKeyDown={record}
        >
          <KeyRound size={15} />
          <kbd>{recording ? t("settings.waitingKey") : displayShortcut(value)}</kbd>
        </button>
        <button
          className="icon-button"
          title={t("settings.restoreShortcut")}
          onClick={() => {
            onChange(defaultValue);
            setRecording(false);
            setHint("");
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}

function normalizeShortcutKey(key: string) {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (key === " ") return "Space";
  if (["Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
    return key;
  }
  return "";
}

function displayShortcut(value: string) {
  return value.replace("CommandOrControl", "Ctrl/Cmd").replaceAll("+", " + ");
}

function FolderSetting({
  icon: Icon,
  label,
  detail,
  value,
  onChange,
  onBrowse,
  browseLabel,
}: {
  icon: typeof Image;
  label: string;
  detail: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  browseLabel: string;
}) {
  return (
    <div className="folder-setting">
      <span className="folder-setting-icon">
        <Icon size={18} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      <button className="secondary-button" onClick={onBrowse}>
        <FolderOpen size={15} />
        {browseLabel}
      </button>
    </div>
  );
}
