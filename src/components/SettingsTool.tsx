import { useEffect, useState } from "react";
import {
  Check,
  FolderOpen,
  Image,
  KeyRound,
  LoaderCircle,
  PanelTopClose,
  RotateCcw,
  Settings,
  Video,
} from "lucide-react";
import { chooseDirectory } from "../lib/native";
import type { AppSettings } from "../types";
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

  useEffect(() => setDraft(settings), [settings]);

  async function browse(field: "screenshotDir" | "recordingDir") {
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
      setError("取色、截图和录屏不能使用相同的快捷键");
      setSaving(false);
      return;
    }
    try {
      await onSave(draft);
      setSaved(true);
      onStatus("设置已保存");
      window.setTimeout(() => setSaved(false), 1600);
    } catch (reason) {
      setError(String(reason));
      onStatus("设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tool-page settings-page">
      <ToolHeader icon={Settings} title="设置" description="管理全局快捷键、窗口行为和媒体文件保存位置。" />

      <div className="settings-section">
        <div className="settings-section-heading">
          <span className="heading-icon">
            <KeyRound size={18} />
          </span>
          <div>
            <strong>快捷键与窗口</strong>
            <small>全局快捷键在程序最小化或隐藏后仍然可用</small>
          </div>
        </div>

        <ShortcutSetting
          label="屏幕取色"
          detail="点击右侧后直接按下新的组合键"
          value={draft.colorShortcut}
          defaultValue="CommandOrControl+Alt+C"
          onChange={(value) => setDraft((current) => ({ ...current, colorShortcut: value }))}
        />
        <ShortcutSetting
          label="区域截图"
          detail="快捷键会直接打开桌面区域框选"
          value={draft.screenshotShortcut}
          defaultValue="CommandOrControl+Alt+S"
          onChange={(value) => setDraft((current) => ({ ...current, screenshotShortcut: value }))}
        />
        <ShortcutSetting
          label="开始或停止录屏"
          detail="打开录屏工具，并使用当前配置开始录制或停止保存"
          value={draft.recordingShortcut}
          defaultValue="CommandOrControl+Alt+R"
          onChange={(value) => setDraft((current) => ({ ...current, recordingShortcut: value }))}
        />
        <div className="setting-row">
          <span className="setting-with-icon">
            <span className="folder-setting-icon">
              <PanelTopClose size={18} />
            </span>
            <span>
              <strong>关闭时隐藏到系统托盘</strong>
              <small>关闭主窗口后仍可通过托盘或快捷键恢复</small>
            </span>
          </span>
          <button
            className={draft.closeToTray ? "toggle active" : "toggle"}
            onClick={() => setDraft((current) => ({ ...current, closeToTray: !current.closeToTray }))}
            role="switch"
            aria-checked={draft.closeToTray}
            title={draft.closeToTray ? "关闭后隐藏到托盘" : "关闭后退出程序"}
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
            <strong>文件与目录</strong>
            <small>保存时会自动创建不存在的目录</small>
          </div>
        </div>

        <FolderSetting
          icon={Image}
          label="截图保存文件夹"
          detail="PNG 截图与截图历史从此目录读取"
          value={draft.screenshotDir}
          onChange={(value) => setDraft((current) => ({ ...current, screenshotDir: value }))}
          onBrowse={() => browse("screenshotDir")}
        />
        <FolderSetting
          icon={Video}
          label="录屏保存文件夹"
          detail="H.264 MP4 视频会保存在此目录"
          value={draft.recordingDir}
          onChange={(value) => setDraft((current) => ({ ...current, recordingDir: value }))}
          onBrowse={() => browse("recordingDir")}
        />
      </div>

      <div className="settings-actions">
        {error && <p className="inline-error">{error}</p>}
        <button className="primary-button" onClick={save} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : saved ? <Check size={16} /> : <Settings size={16} />}
          {saving ? "正在保存…" : saved ? "已保存" : "保存设置"}
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
}: {
  label: string;
  detail: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
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
      setHint("请包含 Ctrl/Cmd 或 Alt，并按下字母、数字或功能键");
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
            setHint("请按下新的组合键，Esc 取消");
          }}
          onKeyDown={record}
        >
          <KeyRound size={15} />
          <kbd>{recording ? "等待按键…" : displayShortcut(value)}</kbd>
        </button>
        <button
          className="icon-button"
          title="恢复默认快捷键"
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
}: {
  icon: typeof Image;
  label: string;
  detail: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
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
        浏览
      </button>
    </div>
  );
}
