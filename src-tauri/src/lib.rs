use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, Local};
use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{self, Receiver, Sender, TryRecvError},
        Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, System};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use xcap::{
    image::{self, GenericImageView, RgbaImage},
    Frame, Monitor, VideoRecorder, Window,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortProcess {
    port: u16,
    protocol: String,
    state: String,
    pid: u32,
    process_name: String,
    executable: String,
    command: String,
    memory_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KillResult {
    pid: u32,
    success: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    id: usize,
    name: String,
    width: u32,
    height: u32,
    scale_factor: f32,
    is_primary: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotResult {
    path: String,
    data_url: String,
    width: u32,
    height: u32,
    monitor_name: String,
    created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureRegion {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegionSelectorOverlay {
    monitor_id: usize,
    data_url: String,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    is_primary: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRegionSelection {
    token: String,
    monitor_id: usize,
    monitor_name: String,
    region: CaptureRegion,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegionSelectionResultEvent {
    purpose: String,
    selection: Option<DesktopRegionSelection>,
}

struct RegionSelectorSession {
    token: String,
    purpose: String,
    overlays: HashMap<usize, RegionSelectorOverlay>,
    images: HashMap<usize, RgbaImage>,
    monitor_names: HashMap<usize, String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ColorSample {
    hex: String,
    rgb: [u8; 3],
    position: [i32; 2],
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ColorPickerOverlay {
    monitor_id: usize,
    data_url: String,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    is_primary: bool,
    initial_position: Option<[i32; 2]>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ColorPickerResultEvent {
    sample: Option<ColorSample>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    theme: String,
    #[serde(default = "default_language")]
    language: String,
    #[serde(default = "default_ui_font")]
    ui_font: String,
    #[serde(default = "default_font_scale")]
    font_scale: f64,
    screenshot_dir: String,
    recording_dir: String,
    #[serde(default = "default_color_shortcut")]
    color_shortcut: String,
    #[serde(default = "default_screenshot_shortcut")]
    screenshot_shortcut: String,
    #[serde(default = "default_recording_shortcut")]
    recording_shortcut: String,
    #[serde(default = "default_true")]
    close_to_tray: bool,
}

struct TrayMenuState {
    show_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum RecordingSourceConfig {
    Monitor {
        monitor_id: usize,
    },
    Region {
        monitor_id: usize,
        region: CaptureRegion,
    },
    Window {
        window_id: u32,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordingConfig {
    source: RecordingSourceConfig,
    width: Option<u32>,
    height: Option<u32>,
    fps: u32,
    bitrate_kbps: u32,
    #[serde(default)]
    audio_enabled: bool,
    audio_input_id: Option<String>,
    output_directory: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInputInfo {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureWindowInfo {
    id: u32,
    title: String,
    app_name: String,
    pid: u32,
    width: u32,
    height: u32,
    is_focused: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingResult {
    path: String,
    duration_seconds: u64,
    created_at: String,
    size_bytes: u64,
    thumbnail_data_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingPreview {
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingMetadata {
    duration_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    active: bool,
    path: Option<String>,
    elapsed_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingCapabilities {
    available: bool,
    ffmpeg_path: Option<String>,
    message: String,
}

#[derive(Default)]
struct CaptureState(Mutex<HashMap<String, RgbaImage>>);

#[derive(Default)]
struct ColorPickerState(Mutex<HashMap<usize, ColorPickerOverlay>>);

#[derive(Default)]
struct RegionSelectorState(Mutex<Option<RegionSelectorSession>>);

#[derive(Default)]
struct RecordingState(Mutex<Option<RecordingSession>>);

struct RecordingSession {
    stop_tx: Sender<()>,
    join: JoinHandle<Result<RecordingResult, String>>,
    path: String,
    started: Instant,
}

fn tcp_state_label(state: TcpState) -> String {
    match state {
        TcpState::Listen => "LISTEN".into(),
        _ => format!("{state:?}").to_uppercase(),
    }
}

#[tauri::command]
async fn inspect_ports(ports: Vec<u16>) -> Result<Vec<PortProcess>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if ports.is_empty() {
            return Ok(Vec::new());
        }

        let wanted: HashSet<u16> = ports.into_iter().collect();
        let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
        let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
        let sockets = get_sockets_info(af_flags, proto_flags)
            .map_err(|error| format!("无法读取端口信息：{error}"))?;
        let system = System::new_all();
        let mut rows = Vec::new();
        let mut seen = HashSet::new();

        for socket in sockets {
            let (port, protocol, state) = match socket.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) => (
                    tcp.local_port,
                    "TCP".to_string(),
                    tcp_state_label(tcp.state),
                ),
                ProtocolSocketInfo::Udp(udp) => {
                    (udp.local_port, "UDP".to_string(), "BOUND".to_string())
                }
            };

            if !wanted.contains(&port) {
                continue;
            }

            if socket.associated_pids.is_empty() {
                let key = (port, protocol.clone(), 0);
                if seen.insert(key) {
                    rows.push(PortProcess {
                        port,
                        protocol,
                        state,
                        pid: 0,
                        process_name: "权限不足或系统进程".into(),
                        executable: String::new(),
                        command: String::new(),
                        memory_bytes: 0,
                    });
                }
                continue;
            }

            for pid_value in socket.associated_pids {
                let key = (port, protocol.clone(), pid_value);
                if !seen.insert(key) {
                    continue;
                }

                let process = system.process(Pid::from_u32(pid_value));
                rows.push(PortProcess {
                    port,
                    protocol: protocol.clone(),
                    state: state.clone(),
                    pid: pid_value,
                    process_name: process
                        .map(|item| item.name().to_string_lossy().into_owned())
                        .unwrap_or_else(|| "未知进程".into()),
                    executable: process
                        .and_then(|item| item.exe())
                        .map(|path| path.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    command: process
                        .map(|item| {
                            item.cmd()
                                .iter()
                                .map(|part| part.to_string_lossy())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .unwrap_or_default(),
                    memory_bytes: process.map(|item| item.memory()).unwrap_or(0),
                });
            }
        }

        rows.sort_by_key(|item| (item.port, item.pid));
        Ok(rows)
    })
    .await
    .map_err(|error| format!("端口查询任务失败：{error}"))?
}

#[tauri::command]
async fn kill_processes(pids: Vec<u32>) -> Result<Vec<KillResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let system = System::new_all();
        let own_pid = std::process::id();
        let mut results = Vec::new();

        for pid_value in pids.into_iter().collect::<HashSet<_>>() {
            if pid_value == 0 || pid_value == own_pid {
                results.push(KillResult {
                    pid: pid_value,
                    success: false,
                    message: "拒绝结束无效进程或 ToolDock 自身进程".into(),
                });
                continue;
            }

            match system.process(Pid::from_u32(pid_value)) {
                Some(process) => {
                    let success = process.kill();
                    results.push(KillResult {
                        pid: pid_value,
                        success,
                        message: if success {
                            "结束信号已发送".into()
                        } else {
                            "系统拒绝结束该进程，请检查权限".into()
                        },
                    });
                }
                None => results.push(KillResult {
                    pid: pid_value,
                    success: false,
                    message: "进程不存在或已经退出".into(),
                }),
            }
        }

        results.sort_by_key(|item| item.pid);
        Ok(results)
    })
    .await
    .map_err(|error| format!("结束进程任务失败：{error}"))?
}

#[tauri::command]
async fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let monitors = Monitor::all().map_err(|error| format!("无法读取显示器：{error}"))?;
        monitors
            .into_iter()
            .enumerate()
            .map(|(id, monitor)| {
                Ok(MonitorInfo {
                    id,
                    name: monitor
                        .friendly_name()
                        .unwrap_or_else(|_| format!("显示器 {}", id + 1)),
                    width: monitor.width().map_err(|error| error.to_string())?,
                    height: monitor.height().map_err(|error| error.to_string())?,
                    scale_factor: monitor.scale_factor().map_err(|error| error.to_string())? as f32,
                    is_primary: monitor.is_primary().unwrap_or(false),
                })
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|error| format!("显示器查询任务失败：{error}"))?
}

fn default_screenshot_folder() -> PathBuf {
    dirs::picture_dir()
        .or_else(dirs::download_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("ToolDock")
}

fn default_recording_folder() -> PathBuf {
    dirs::video_dir()
        .or_else(dirs::download_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("ToolDock")
}

fn default_color_shortcut() -> String {
    "CommandOrControl+Alt+C".into()
}

fn default_screenshot_shortcut() -> String {
    "CommandOrControl+Alt+S".into()
}

fn default_recording_shortcut() -> String {
    "CommandOrControl+Alt+R".into()
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "zh-CN".into()
}

fn tray_labels(language: &str) -> (&'static str, &'static str) {
    match language {
        "en" => ("Show ToolDock", "Quit"),
        "ja" => ("ToolDock を表示", "終了"),
        "ko" => ("ToolDock 표시", "종료"),
        _ => ("显示 ToolDock", "退出"),
    }
}

fn default_ui_font() -> String {
    "system".into()
}

fn default_font_scale() -> f64 {
    1.1
}

fn settings_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ToolDock")
        .join("settings.json")
}

fn default_settings() -> AppSettings {
    AppSettings {
        theme: "dark".into(),
        language: default_language(),
        ui_font: default_ui_font(),
        font_scale: default_font_scale(),
        screenshot_dir: default_screenshot_folder().to_string_lossy().into_owned(),
        recording_dir: default_recording_folder().to_string_lossy().into_owned(),
        color_shortcut: default_color_shortcut(),
        screenshot_shortcut: default_screenshot_shortcut(),
        recording_shortcut: default_recording_shortcut(),
        close_to_tray: true,
    }
}

fn read_settings() -> AppSettings {
    fs::read(settings_file())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AppSettings>(&bytes).ok())
        .unwrap_or_else(default_settings)
}

fn write_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_file();
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位设置目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录：{error}"))?;
    let bytes =
        serde_json::to_vec_pretty(settings).map_err(|error| format!("无法序列化设置：{error}"))?;
    fs::write(path, bytes).map_err(|error| format!("无法保存设置：{error}"))
}

#[tauri::command]
fn load_settings() -> AppSettings {
    read_settings()
}

#[tauri::command]
fn save_settings(
    mut settings: AppSettings,
    tray_menu: State<'_, TrayMenuState>,
) -> Result<AppSettings, String> {
    if settings.theme != "light" {
        settings.theme = "dark".into();
    }
    if !matches!(settings.language.as_str(), "zh-CN" | "en" | "ja" | "ko") {
        settings.language = default_language();
    }
    if !matches!(
        settings.ui_font.as_str(),
        "system" | "sans" | "cjk" | "mono"
    ) {
        settings.ui_font = default_ui_font();
    }
    settings.font_scale = if settings.font_scale < 1.05 {
        1.0
    } else if settings.font_scale < 1.15 {
        1.1
    } else {
        1.2
    };
    if settings.screenshot_dir.trim().is_empty() {
        settings.screenshot_dir = default_screenshot_folder().to_string_lossy().into_owned();
    }
    if settings.recording_dir.trim().is_empty() {
        settings.recording_dir = default_recording_folder().to_string_lossy().into_owned();
    }
    if settings.color_shortcut.trim().is_empty() {
        settings.color_shortcut = default_color_shortcut();
    }
    if settings.screenshot_shortcut.trim().is_empty() {
        settings.screenshot_shortcut = default_screenshot_shortcut();
    }
    if settings.recording_shortcut.trim().is_empty() {
        settings.recording_shortcut = default_recording_shortcut();
    }
    let shortcuts = [
        &settings.color_shortcut,
        &settings.screenshot_shortcut,
        &settings.recording_shortcut,
    ];
    if shortcuts.iter().collect::<HashSet<_>>().len() != shortcuts.len() {
        return Err("取色、截图和录屏不能使用相同的快捷键".into());
    }
    fs::create_dir_all(&settings.screenshot_dir)
        .map_err(|error| format!("无法创建截图目录：{error}"))?;
    fs::create_dir_all(&settings.recording_dir)
        .map_err(|error| format!("无法创建录屏目录：{error}"))?;
    write_settings(&settings)?;
    let (show_label, quit_label) = tray_labels(&settings.language);
    tray_menu
        .show_item
        .set_text(show_label)
        .map_err(|error| format!("无法更新托盘菜单：{error}"))?;
    tray_menu
        .quit_item
        .set_text(quit_label)
        .map_err(|error| format!("无法更新托盘菜单：{error}"))?;
    Ok(settings)
}

#[tauri::command]
async fn choose_directory(initial: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(path) = initial.filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_directory(path);
    }
    Ok(dialog
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned()))
}

fn requested_folder(requested: Option<String>, fallback: PathBuf) -> Result<PathBuf, String> {
    let folder = requested
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback);
    fs::create_dir_all(&folder).map_err(|error| format!("无法创建保存目录：{error}"))?;
    Ok(folder)
}

fn encode_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("无法读取图片预览：{error}"))?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn copy_image_to_clipboard(image: &RgbaImage) -> Result<(), String> {
    Clipboard::new()
        .and_then(|mut clipboard| {
            clipboard.set_image(ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: Cow::Owned(image.as_raw().clone()),
            })
        })
        .map_err(|error| format!("无法将截图写入剪贴板：{error}"))
}

fn copy_text_to_clipboard(value: String) -> Result<(), String> {
    Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(value))
        .map_err(|error| format!("无法将颜色写入剪贴板：{error}"))
}

fn save_screenshot_image(
    image: &RgbaImage,
    monitor_name: String,
    directory: Option<String>,
) -> Result<ScreenshotResult, String> {
    let folder = requested_folder(directory, default_screenshot_folder())?;
    let path = folder.join(format!(
        "ToolDock-{}.png",
        Local::now().format("%Y%m%d-%H%M%S-%3f")
    ));
    image
        .save(&path)
        .map_err(|error| format!("无法保存截图：{error}"))?;
    copy_image_to_clipboard(image)?;

    Ok(ScreenshotResult {
        path: path.to_string_lossy().into_owned(),
        data_url: encode_data_url(&path)?,
        width: image.width(),
        height: image.height(),
        monitor_name,
        created_at: Local::now().to_rfc3339(),
    })
}

fn selected_monitor(monitor_id: usize) -> Result<(Monitor, String), String> {
    let monitors = Monitor::all().map_err(|error| format!("无法读取显示器：{error}"))?;
    let monitor = monitors
        .into_iter()
        .nth(monitor_id)
        .ok_or_else(|| "所选显示器不存在".to_string())?;
    let name = monitor
        .friendly_name()
        .unwrap_or_else(|_| format!("显示器 {}", monitor_id + 1));
    Ok((monitor, name))
}

#[tauri::command]
async fn capture_screenshot(
    monitor_id: usize,
    directory: Option<String>,
) -> Result<ScreenshotResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (monitor, monitor_name) = selected_monitor(monitor_id)?;
        let image = monitor
            .capture_image()
            .map_err(|error| format!("截图失败：{error}"))?;
        save_screenshot_image(&image, monitor_name, directory)
    })
    .await
    .map_err(|error| format!("截图任务失败：{error}"))?
}

#[tauri::command]
async fn finish_region_capture(
    token: String,
    region: CaptureRegion,
    monitor_name: String,
    directory: Option<String>,
    state: State<'_, CaptureState>,
) -> Result<ScreenshotResult, String> {
    let image = state
        .0
        .lock()
        .map_err(|_| "区域截图状态不可用".to_string())?
        .remove(&token)
        .ok_or_else(|| "区域截图已失效，请重新截取".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        if region.width < 2 || region.height < 2 {
            return Err("请选择更大的截图区域".into());
        }
        let x = region.x.min(image.width().saturating_sub(1));
        let y = region.y.min(image.height().saturating_sub(1));
        let width = region.width.min(image.width().saturating_sub(x));
        let height = region.height.min(image.height().saturating_sub(y));
        let cropped = image::imageops::crop_imm(&image, x, y, width, height).to_image();
        save_screenshot_image(&cropped, monitor_name, directory)
    })
    .await
    .map_err(|error| format!("区域截图任务失败：{error}"))?
}

#[tauri::command]
async fn list_screenshot_history(
    directory: Option<String>,
) -> Result<Vec<ScreenshotResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = requested_folder(directory, default_screenshot_folder())?;
        let mut entries = fs::read_dir(folder)
            .map_err(|error| format!("无法读取截图目录：{error}"))?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let is_png = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("png"));
                if !is_png {
                    return None;
                }
                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(UNIX_EPOCH);
                Some((modified, path))
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| right.0.cmp(&left.0));

        entries
            .into_iter()
            .take(20)
            .filter_map(|(modified, path)| {
                let opened = image::open(&path).ok()?;
                let (width, height) = opened.dimensions();
                let created: DateTime<Local> = modified.into();
                Some(Ok(ScreenshotResult {
                    path: path.to_string_lossy().into_owned(),
                    data_url: encode_data_url(&path).ok()?,
                    width,
                    height,
                    monitor_name: "截图".into(),
                    created_at: created.to_rfc3339(),
                }))
            })
            .collect()
    })
    .await
    .map_err(|error| format!("截图历史任务失败：{error}"))?
}

#[tauri::command]
async fn list_recording_history(directory: Option<String>) -> Result<Vec<RecordingResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = requested_folder(directory, default_recording_folder())?;
        let mut entries = fs::read_dir(folder)
            .map_err(|error| format!("无法读取录屏目录：{error}"))?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let is_mp4 = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("mp4"));
                if !is_mp4 {
                    return None;
                }
                let metadata = entry.metadata().ok()?;
                let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
                Some((modified, metadata.len(), path))
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| right.0.cmp(&left.0));

        Ok(entries
            .into_iter()
            .take(20)
            .map(|(modified, size_bytes, path)| {
                let duration_seconds = fs::read(path.with_extension("json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<RecordingMetadata>(&bytes).ok())
                    .map(|metadata| metadata.duration_seconds)
                    .unwrap_or(0);
                let thumbnail_data_url = fs::read(path.with_extension("preview.jpg"))
                    .ok()
                    .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
                let created: DateTime<Local> = modified.into();
                RecordingResult {
                    path: path.to_string_lossy().into_owned(),
                    duration_seconds,
                    created_at: created.to_rfc3339(),
                    size_bytes,
                    thumbnail_data_url,
                }
            })
            .collect())
    })
    .await
    .map_err(|error| format!("录屏历史任务失败：{error}"))?
}

fn encode_image_data_url(image: &RgbaImage) -> Result<String, String> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|error| format!("无法编码取色器屏幕快照：{error}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

fn close_region_selector_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("region-selector-") {
            let _ = window.close();
        }
    }
}

#[tauri::command]
async fn open_region_selector(
    app: tauri::AppHandle,
    purpose: String,
    state: State<'_, RegionSelectorState>,
) -> Result<(), String> {
    if purpose != "screenshot" && purpose != "recording" {
        return Err("不支持的区域选择用途".into());
    }

    close_region_selector_windows(&app);
    *state
        .0
        .lock()
        .map_err(|_| "区域选择状态不可用".to_string())? = None;

    let cursor_position = app.cursor_position().ok();
    let (overlays, images, monitor_names) = tauri::async_runtime::spawn_blocking(|| {
        let monitors = Monitor::all().map_err(|error| format!("无法读取显示器：{error}"))?;
        let mut overlays = Vec::new();
        let mut images = HashMap::new();
        let mut monitor_names = HashMap::new();

        for (monitor_id, monitor) in monitors.into_iter().enumerate() {
            let width = monitor.width().map_err(|error| error.to_string())?;
            let height = monitor.height().map_err(|error| error.to_string())?;
            let image = monitor
                .capture_image()
                .map_err(|error| format!("无法准备区域选择屏幕快照：{error}"))?;
            let monitor_name = monitor
                .friendly_name()
                .unwrap_or_else(|_| format!("显示器 {}", monitor_id + 1));
            overlays.push(RegionSelectorOverlay {
                monitor_id,
                data_url: encode_image_data_url(&image)?,
                width,
                height,
                origin_x: monitor.x().map_err(|error| error.to_string())?,
                origin_y: monitor.y().map_err(|error| error.to_string())?,
                is_primary: monitor.is_primary().unwrap_or(false),
            });
            images.insert(monitor_id, image);
            monitor_names.insert(monitor_id, monitor_name);
        }

        Ok::<_, String>((overlays, images, monitor_names))
    })
    .await
    .map_err(|error| format!("区域选择准备任务失败：{error}"))??;

    if overlays.is_empty() {
        return Err("没有可供选择的显示器，请检查屏幕捕获权限".into());
    }

    let token = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    {
        let overlay_map = overlays
            .iter()
            .cloned()
            .map(|overlay| (overlay.monitor_id, overlay))
            .collect();
        *state
            .0
            .lock()
            .map_err(|_| "区域选择状态不可用".to_string())? = Some(RegionSelectorSession {
            token,
            purpose,
            overlays: overlay_map,
            images,
            monitor_names,
        });
    }

    let focused_monitor = cursor_position.and_then(|position| {
        overlays
            .iter()
            .find(|overlay| {
                let cursor_x = position.x.floor() as i32;
                let cursor_y = position.y.floor() as i32;
                cursor_x >= overlay.origin_x
                    && cursor_x < overlay.origin_x + overlay.width as i32
                    && cursor_y >= overlay.origin_y
                    && cursor_y < overlay.origin_y + overlay.height as i32
            })
            .map(|overlay| overlay.monitor_id)
    });

    let creation_result = (|| -> Result<(), String> {
        for overlay in &overlays {
            let label = format!("region-selector-{}", overlay.monitor_id);
            let url = WebviewUrl::App(
                format!("index.html?regionSelectorMonitor={}", overlay.monitor_id).into(),
            );
            let window = WebviewWindowBuilder::new(&app, label, url)
                .title("ToolDock Region Selector")
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .closable(false)
                .resizable(false)
                .shadow(false)
                .visible(false)
                .inner_size(overlay.width as f64, overlay.height as f64)
                .build()
                .map_err(|error| format!("无法创建区域选择遮罩窗口：{error}"))?;
            window
                .set_position(PhysicalPosition::new(overlay.origin_x, overlay.origin_y))
                .map_err(|error| format!("无法定位区域选择遮罩窗口：{error}"))?;
            window
                .set_size(PhysicalSize::new(overlay.width, overlay.height))
                .map_err(|error| format!("无法设置区域选择遮罩窗口大小：{error}"))?;
            window
                .show()
                .map_err(|error| format!("无法显示区域选择遮罩窗口：{error}"))?;
            if focused_monitor == Some(overlay.monitor_id)
                || (focused_monitor.is_none() && overlay.is_primary)
            {
                let _ = window.set_focus();
            }
        }
        Ok(())
    })();

    if let Err(error) = creation_result {
        close_region_selector_windows(&app);
        if let Ok(mut session) = state.0.lock() {
            *session = None;
        }
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
fn get_region_selector_overlay(
    monitor_id: usize,
    state: State<'_, RegionSelectorState>,
) -> Result<RegionSelectorOverlay, String> {
    state
        .0
        .lock()
        .map_err(|_| "区域选择状态不可用".to_string())?
        .as_ref()
        .and_then(|session| session.overlays.get(&monitor_id))
        .cloned()
        .ok_or_else(|| "区域选择屏幕快照不存在".to_string())
}

#[tauri::command]
fn finish_region_selector(
    app: tauri::AppHandle,
    monitor_id: Option<usize>,
    region: Option<CaptureRegion>,
    state: State<'_, RegionSelectorState>,
    capture_state: State<'_, CaptureState>,
) -> Result<(), String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "区域选择状态不可用".to_string())?
        .take()
        .ok_or_else(|| "区域选择会话已经结束".to_string())?;

    let purpose = session.purpose.clone();
    let outcome = (|| -> Result<Option<DesktopRegionSelection>, String> {
        match (monitor_id, region) {
            (Some(monitor_id), Some(region)) => {
                if region.width < 2 || region.height < 2 {
                    return Err("请选择更大的区域".into());
                }
                let overlay = session
                    .overlays
                    .get(&monitor_id)
                    .ok_or_else(|| "所选显示器不存在".to_string())?;
                let x = region.x.min(overlay.width.saturating_sub(1));
                let y = region.y.min(overlay.height.saturating_sub(1));
                let width = region.width.min(overlay.width.saturating_sub(x));
                let height = region.height.min(overlay.height.saturating_sub(y));
                let normalized = CaptureRegion {
                    x,
                    y,
                    width,
                    height,
                };
                if session.purpose == "screenshot" {
                    let image = session
                        .images
                        .remove(&monitor_id)
                        .ok_or_else(|| "区域截图快照不存在".to_string())?;
                    capture_state
                        .0
                        .lock()
                        .map_err(|_| "区域截图状态不可用".to_string())?
                        .insert(session.token.clone(), image);
                }
                Ok(Some(DesktopRegionSelection {
                    token: session.token.clone(),
                    monitor_id,
                    monitor_name: session
                        .monitor_names
                        .remove(&monitor_id)
                        .unwrap_or_else(|| format!("显示器 {}", monitor_id + 1)),
                    region: normalized,
                }))
            }
            (None, None) => Ok(None),
            _ => Err("区域选择结果不完整".into()),
        }
    })();

    let event_result = app.emit_to(
        "main",
        "region-selection-result",
        RegionSelectionResultEvent {
            purpose,
            selection: outcome.as_ref().ok().cloned().flatten(),
        },
    );

    close_region_selector_windows(&app);
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    outcome?;
    event_result.map_err(|error| format!("无法返回区域选择结果：{error}"))
}

fn close_color_picker_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("color-picker-") {
            let _ = window.close();
        }
    }
}

#[tauri::command]
async fn open_color_picker(
    app: tauri::AppHandle,
    state: State<'_, ColorPickerState>,
) -> Result<(), String> {
    close_color_picker_windows(&app);
    state
        .0
        .lock()
        .map_err(|_| "取色器状态不可用".to_string())?
        .clear();

    let cursor_position = app.cursor_position().ok();
    let mut overlays = tauri::async_runtime::spawn_blocking(|| {
        let monitors = Monitor::all().map_err(|error| format!("无法读取显示器：{error}"))?;
        monitors
            .into_iter()
            .enumerate()
            .map(|(monitor_id, monitor)| {
                let width = monitor.width().map_err(|error| error.to_string())?;
                let height = monitor.height().map_err(|error| error.to_string())?;
                let image = monitor
                    .capture_image()
                    .map_err(|error| format!("无法准备取色器屏幕快照：{error}"))?;
                Ok(ColorPickerOverlay {
                    monitor_id,
                    data_url: encode_image_data_url(&image)?,
                    width,
                    height,
                    origin_x: monitor.x().map_err(|error| error.to_string())?,
                    origin_y: monitor.y().map_err(|error| error.to_string())?,
                    is_primary: monitor.is_primary().unwrap_or(false),
                    initial_position: None,
                })
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|error| format!("取色器准备任务失败：{error}"))??;

    if overlays.is_empty() {
        return Err("没有可供取色的显示器，请检查屏幕捕获权限".into());
    }

    if let Some(position) = cursor_position {
        let cursor_x = position.x.floor() as i32;
        let cursor_y = position.y.floor() as i32;
        if let Some(overlay) = overlays.iter_mut().find(|overlay| {
            cursor_x >= overlay.origin_x
                && cursor_x < overlay.origin_x + overlay.width as i32
                && cursor_y >= overlay.origin_y
                && cursor_y < overlay.origin_y + overlay.height as i32
        }) {
            overlay.initial_position =
                Some([cursor_x - overlay.origin_x, cursor_y - overlay.origin_y]);
        }
    }

    {
        let mut stored = state.0.lock().map_err(|_| "取色器状态不可用".to_string())?;
        stored.extend(
            overlays
                .iter()
                .cloned()
                .map(|overlay| (overlay.monitor_id, overlay)),
        );
    }

    let creation_result = (|| -> Result<(), String> {
        for overlay in &overlays {
            let label = format!("color-picker-{}", overlay.monitor_id);
            let url =
                WebviewUrl::App(format!("index.html?pickerMonitor={}", overlay.monitor_id).into());
            let window = WebviewWindowBuilder::new(&app, label, url)
                .title("ToolDock Color Picker")
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .visible(false)
                .inner_size(overlay.width as f64, overlay.height as f64)
                .build()
                .map_err(|error| format!("无法创建取色器遮罩窗口：{error}"))?;
            window
                .set_position(PhysicalPosition::new(overlay.origin_x, overlay.origin_y))
                .map_err(|error| format!("无法定位取色器遮罩窗口：{error}"))?;
            window
                .set_size(PhysicalSize::new(overlay.width, overlay.height))
                .map_err(|error| format!("无法设置取色器遮罩窗口大小：{error}"))?;
            window
                .show()
                .map_err(|error| format!("无法显示取色器遮罩窗口：{error}"))?;
            if overlay.is_primary {
                let _ = window.set_focus();
            }
        }

        Ok(())
    })();

    if let Err(error) = creation_result {
        close_color_picker_windows(&app);
        if let Ok(mut stored) = state.0.lock() {
            stored.clear();
        }
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
fn get_color_picker_overlay(
    monitor_id: usize,
    state: State<'_, ColorPickerState>,
) -> Result<ColorPickerOverlay, String> {
    state
        .0
        .lock()
        .map_err(|_| "取色器状态不可用".to_string())?
        .get(&monitor_id)
        .cloned()
        .ok_or_else(|| "取色器屏幕快照不存在".to_string())
}

#[tauri::command]
fn finish_color_picker(
    app: tauri::AppHandle,
    state: State<'_, ColorPickerState>,
    sample: Option<ColorSample>,
) -> Result<(), String> {
    let clipboard_result = sample
        .as_ref()
        .map(|value| copy_text_to_clipboard(value.hex.clone()))
        .transpose();
    let emit_result = app.emit_to(
        "main",
        "color-picker-result",
        ColorPickerResultEvent {
            sample: sample.clone(),
        },
    );

    close_color_picker_windows(&app);
    state
        .0
        .lock()
        .map_err(|_| "取色器状态不可用".to_string())?
        .clear();

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    clipboard_result?;
    emit_result.map_err(|error| format!("无法返回取色结果：{error}"))?;
    Ok(())
}

#[tauri::command]
async fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let own_pid = std::process::id();
        let mut windows = Window::all()
            .map_err(|error| format!("无法读取应用窗口：{error}"))?
            .into_iter()
            .filter_map(|window| {
                let id = window.id().ok()?;
                let pid = window.pid().ok()?;
                let title = window.title().ok()?.trim().to_string();
                let app_name = window.app_name().ok()?.trim().to_string();
                let width = window.width().ok()?;
                let height = window.height().ok()?;
                let minimized = window.is_minimized().unwrap_or(true);
                if pid == own_pid
                    || title.is_empty()
                    || app_name.is_empty()
                    || minimized
                    || width < 64
                    || height < 64
                {
                    return None;
                }
                Some(CaptureWindowInfo {
                    id,
                    title,
                    app_name,
                    pid,
                    width,
                    height,
                    is_focused: window.is_focused().unwrap_or(false),
                })
            })
            .collect::<Vec<_>>();
        windows.sort_by(|left, right| {
            right
                .is_focused
                .cmp(&left.is_focused)
                .then_with(|| {
                    left.app_name
                        .to_lowercase()
                        .cmp(&right.app_name.to_lowercase())
                })
                .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
        });
        Ok(windows)
    })
    .await
    .map_err(|error| format!("应用窗口查询任务失败：{error}"))?
}

fn selected_window(window_id: u32) -> Result<Window, String> {
    Window::all()
        .map_err(|error| format!("无法读取应用窗口：{error}"))?
        .into_iter()
        .find(|window| window.id().ok() == Some(window_id))
        .ok_or_else(|| "所选应用窗口不存在或已经关闭".to_string())
}

fn apply_no_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}

fn ffmpeg_works(path: &Path) -> bool {
    let mut command = Command::new(path);
    command
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut command);
    command.status().is_ok_and(|status| status.success())
}

fn find_ffmpeg() -> Option<PathBuf> {
    let executable_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let mut candidates = Vec::new();
    if let Ok(configured) = std::env::var("TOOLDOCK_FFMPEG") {
        candidates.push(PathBuf::from(configured));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(executable_name));
            candidates.push(parent.join("resources").join(executable_name));
            if let Some(bundle_parent) = parent.parent() {
                candidates.push(bundle_parent.join("Resources").join(executable_name));
            }
        }
    }
    candidates.push(PathBuf::from(executable_name));
    candidates.into_iter().find(|path| ffmpeg_works(path))
}

#[tauri::command]
fn recording_capabilities() -> RecordingCapabilities {
    match find_ffmpeg() {
        Some(path) => RecordingCapabilities {
            available: true,
            ffmpeg_path: Some(path.to_string_lossy().into_owned()),
            message: "FFmpeg 已就绪".into(),
        },
        None => RecordingCapabilities {
            available: false,
            ffmpeg_path: None,
            message: "未找到 FFmpeg。请安装 FFmpeg，或通过 TOOLDOCK_FFMPEG 指定可执行文件。".into(),
        },
    }
}

#[tauri::command]
fn list_audio_inputs() -> Result<Vec<AudioInputInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "未找到 FFmpeg，无法检测音频设备".to_string())?;
        let output = Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-list_devices",
                "true",
                "-f",
                "dshow",
                "-i",
                "dummy",
            ])
            .output()
            .map_err(|error| format!("无法检测音频设备：{error}"))?;
        let stderr = String::from_utf8_lossy(&output.stderr);
        let mut devices = Vec::new();
        for line in stderr
            .lines()
            .filter(|line| line.trim_end().ends_with("(audio)"))
        {
            let Some(start) = line.find('"') else {
                continue;
            };
            let Some(relative_end) = line[start + 1..].find('"') else {
                continue;
            };
            let name = line[start + 1..start + 1 + relative_end].trim();
            if !name.is_empty() && !devices.iter().any(|item: &AudioInputInfo| item.id == name) {
                devices.push(AudioInputInfo {
                    id: name.into(),
                    name: name.into(),
                    is_default: devices.is_empty(),
                });
            }
        }
        return Ok(devices);
    }

    #[cfg(target_os = "macos")]
    {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "FFmpeg was not found".to_string())?;
        let output = Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-f",
                "avfoundation",
                "-list_devices",
                "true",
                "-i",
                "",
            ])
            .output()
            .map_err(|error| format!("Could not detect audio devices: {error}"))?;
        let stderr = String::from_utf8_lossy(&output.stderr);
        let mut in_audio_section = false;
        let mut devices = Vec::new();
        for line in stderr.lines() {
            if line.contains("AVFoundation audio devices:") {
                in_audio_section = true;
                continue;
            }
            if !in_audio_section {
                continue;
            }
            let Some(index_start) = line.rfind('[') else {
                continue;
            };
            let Some(index_end) = line[index_start + 1..].find(']') else {
                continue;
            };
            let id = line[index_start + 1..index_start + 1 + index_end].trim();
            let name = line[index_start + 1 + index_end + 1..].trim();
            if id.parse::<u32>().is_ok() && !name.is_empty() {
                devices.push(AudioInputInfo {
                    id: id.into(),
                    name: name.into(),
                    is_default: devices.is_empty(),
                });
            }
        }
        return Ok(devices);
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("pactl")
            .args(["list", "sources", "short"])
            .output();
        let mut devices = Vec::new();
        if let Ok(output) = output {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let fields = line.split_whitespace().collect::<Vec<_>>();
                if fields.len() >= 2 {
                    devices.push(AudioInputInfo {
                        id: fields[1].into(),
                        name: fields[1].into(),
                        is_default: devices.is_empty(),
                    });
                }
            }
        }
        if devices.is_empty() {
            devices.push(AudioInputInfo {
                id: "default".into(),
                name: "Default audio input".into(),
                is_default: true,
            });
        }
        return Ok(devices);
    }

    #[allow(unreachable_code)]
    Ok(Vec::new())
}

fn spawn_ffmpeg(
    ffmpeg: &Path,
    input_width: u32,
    input_height: u32,
    output_width: u32,
    output_height: u32,
    fps: u32,
    bitrate_kbps: u32,
    audio_enabled: bool,
    audio_input_id: Option<&str>,
    path: &Path,
) -> Result<(Child, ChildStdin, JoinHandle<String>), String> {
    let filter = format!(
        "scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2"
    );
    let mut command = Command::new(ffmpeg);
    command.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-video_size",
        &format!("{input_width}x{input_height}"),
        "-framerate",
        &fps.to_string(),
        "-i",
        "pipe:0",
    ]);

    if audio_enabled {
        let device = audio_input_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "请选择音频输入设备".to_string())?;
        command.args(["-thread_queue_size", "512"]);
        #[cfg(target_os = "windows")]
        command
            .args(["-f", "dshow", "-i"])
            .arg(format!("audio={device}"));
        #[cfg(target_os = "macos")]
        command
            .args(["-f", "avfoundation", "-i"])
            .arg(format!(":{device}"));
        #[cfg(target_os = "linux")]
        command.args(["-f", "pulse", "-i", device]);
        command.args(["-map", "0:v:0", "-map", "1:a:0"]);
    } else {
        command.arg("-an");
    }

    command.args([
        "-vf",
        &filter,
        "-r",
        &fps.to_string(),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        &format!("{bitrate_kbps}k"),
        "-maxrate",
        &format!("{bitrate_kbps}k"),
        "-bufsize",
        &format!("{}k", bitrate_kbps.saturating_mul(2)),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]);
    if audio_enabled {
        command.args([
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
        ]);
    }
    command
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    apply_no_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 FFmpeg 输入流".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 FFmpeg 错误输出".to_string())?;
    let stderr_join = thread::spawn(move || {
        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output);
        output
    });
    Ok((child, stdin, stderr_join))
}

fn normalize_capture_region(
    region: CaptureRegion,
    frame_width: u32,
    frame_height: u32,
) -> Result<CaptureRegion, String> {
    if frame_width < 2 || frame_height < 2 {
        return Err("录制源尺寸无效".into());
    }
    let x = region.x.min(frame_width.saturating_sub(1));
    let y = region.y.min(frame_height.saturating_sub(1));
    let width = region.width.min(frame_width.saturating_sub(x));
    let height = region.height.min(frame_height.saturating_sub(y));
    if width < 2 || height < 2 {
        return Err("录制区域过小".into());
    }
    Ok(CaptureRegion {
        x,
        y,
        width,
        height,
    })
}

fn crop_frame_raw(frame: &Frame, region: &CaptureRegion) -> Vec<u8> {
    let source_stride = frame.width as usize * 4;
    let row_size = region.width as usize * 4;
    let mut cropped = Vec::with_capacity(row_size * region.height as usize);
    for row in region.y..region.y + region.height {
        let start = row as usize * source_stride + region.x as usize * 4;
        cropped.extend_from_slice(&frame.raw[start..start + row_size]);
    }
    cropped
}

fn encode_recording_preview(
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(RecordingPreview, Vec<u8>), String> {
    let source = RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "无法创建录屏预览帧".to_string())?;
    let scale = (720.0 / width as f64).min(405.0 / height as f64).min(1.0);
    let preview_width = ((width as f64 * scale).round() as u32).max(2);
    let preview_height = ((height as f64 * scale).round() as u32).max(2);
    let preview = image::imageops::resize(
        &source,
        preview_width,
        preview_height,
        image::imageops::FilterType::Triangle,
    );
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(preview)
        .write_to(&mut bytes, image::ImageFormat::Jpeg)
        .map_err(|error| format!("无法编码录屏预览：{error}"))?;
    let jpeg = bytes.into_inner();
    Ok((
        RecordingPreview {
            data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(&jpeg)),
            width: preview_width,
            height: preview_height,
        },
        jpeg,
    ))
}

fn finish_recording_result(
    path: PathBuf,
    duration_seconds: u64,
    preview_jpeg: Option<Vec<u8>>,
) -> Result<RecordingResult, String> {
    let thumbnail_data_url = if let Some(bytes) = preview_jpeg {
        fs::write(path.with_extension("preview.jpg"), &bytes)
            .map_err(|error| format!("无法保存录屏预览：{error}"))?;
        Some(format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(&bytes)
        ))
    } else {
        None
    };
    let metadata = RecordingMetadata { duration_seconds };
    let metadata_bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| format!("无法生成录屏元数据：{error}"))?;
    fs::write(path.with_extension("json"), metadata_bytes)
        .map_err(|error| format!("无法保存录屏元数据：{error}"))?;
    let file_metadata =
        fs::metadata(&path).map_err(|error| format!("无法读取录屏文件信息：{error}"))?;
    let created: DateTime<Local> = file_metadata
        .modified()
        .unwrap_or_else(|_| SystemTime::now())
        .into();
    Ok(RecordingResult {
        path: path.to_string_lossy().into_owned(),
        duration_seconds,
        created_at: created.to_rfc3339(),
        size_bytes: file_metadata.len(),
        thumbnail_data_url,
    })
}

fn encode_monitor_recording(
    app: tauri::AppHandle,
    recorder: VideoRecorder,
    receiver: Receiver<Frame>,
    first_frame: Frame,
    region: Option<CaptureRegion>,
    mut child: Child,
    mut stdin: ChildStdin,
    stderr_join: JoinHandle<String>,
    stop_rx: Receiver<()>,
    fps: u32,
    path: PathBuf,
    started: Instant,
) -> Result<RecordingResult, String> {
    let frame_interval = Duration::from_secs_f64(1.0 / fps as f64);
    let expected_size = (first_frame.width, first_frame.height);
    let mut current_frame = first_frame;
    let mut next_frame_at = Instant::now();
    let mut next_preview_at = Instant::now();
    let mut last_preview_jpeg = None;
    let mut stream_error = None;

    loop {
        match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => break,
            Err(TryRecvError::Empty) => {}
        }

        while let Ok(frame) = receiver.try_recv() {
            if (frame.width, frame.height) == expected_size {
                current_frame = frame;
            }
        }

        let now = Instant::now();
        if now >= next_frame_at {
            let cropped;
            let bytes = if let Some(region) = region.as_ref() {
                cropped = crop_frame_raw(&current_frame, region);
                cropped.as_slice()
            } else {
                current_frame.raw.as_slice()
            };
            if let Err(error) = stdin.write_all(bytes) {
                stream_error = Some(format!("写入录屏数据失败：{error}"));
                break;
            }
            if now >= next_preview_at {
                if let Ok((preview, jpeg)) = encode_recording_preview(
                    region
                        .as_ref()
                        .map(|region| region.width)
                        .unwrap_or(current_frame.width),
                    region
                        .as_ref()
                        .map(|region| region.height)
                        .unwrap_or(current_frame.height),
                    bytes,
                ) {
                    let _ = app.emit("recording-preview", preview);
                    last_preview_jpeg = Some(jpeg);
                }
                next_preview_at = now + Duration::from_millis(250);
            }
            next_frame_at += frame_interval;
            if next_frame_at < now {
                next_frame_at = now + frame_interval;
            }
        }

        let wait = next_frame_at
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(12));
        if let Ok(frame) = receiver.recv_timeout(wait) {
            if (frame.width, frame.height) == expected_size {
                current_frame = frame;
            }
        }
    }

    let _ = recorder.stop();
    drop(stdin);
    let status = child
        .wait()
        .map_err(|error| format!("等待 FFmpeg 结束失败：{error}"))?;
    let ffmpeg_error = stderr_join.join().unwrap_or_default();
    if let Some(error) = stream_error {
        return Err(error);
    }
    if !status.success() {
        return Err(format!(
            "FFmpeg 编码失败，请检查编码器和音频输入设备。{}",
            if ffmpeg_error.trim().is_empty() {
                String::new()
            } else {
                format!(" {}", ffmpeg_error.trim())
            }
        ));
    }
    finish_recording_result(path, started.elapsed().as_secs(), last_preview_jpeg)
}

fn encode_window_recording(
    app: tauri::AppHandle,
    window: Window,
    first_image: RgbaImage,
    mut child: Child,
    mut stdin: ChildStdin,
    stderr_join: JoinHandle<String>,
    stop_rx: Receiver<()>,
    fps: u32,
    path: PathBuf,
    started: Instant,
) -> Result<RecordingResult, String> {
    let frame_interval = Duration::from_secs_f64(1.0 / fps as f64);
    let expected_size = first_image.dimensions();
    let mut current_image = first_image;
    let mut next_frame_at = Instant::now();
    let mut next_preview_at = Instant::now();
    let mut last_preview_jpeg = None;
    let mut stream_error = None;

    loop {
        match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => break,
            Err(TryRecvError::Empty) => {}
        }

        let now = Instant::now();
        if now >= next_frame_at {
            if let Ok(image) = window.capture_image() {
                current_image = if image.dimensions() == expected_size {
                    image
                } else {
                    image::imageops::resize(
                        &image,
                        expected_size.0,
                        expected_size.1,
                        image::imageops::FilterType::Triangle,
                    )
                };
            }
            if let Err(error) = stdin.write_all(current_image.as_raw()) {
                stream_error = Some(format!("写入窗口录制数据失败：{error}"));
                break;
            }
            if now >= next_preview_at {
                if let Ok((preview, jpeg)) = encode_recording_preview(
                    current_image.width(),
                    current_image.height(),
                    current_image.as_raw(),
                ) {
                    let _ = app.emit("recording-preview", preview);
                    last_preview_jpeg = Some(jpeg);
                }
                next_preview_at = now + Duration::from_millis(250);
            }
            next_frame_at += frame_interval;
            if next_frame_at < now {
                next_frame_at = now + frame_interval;
            }
        }

        thread::sleep(
            next_frame_at
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(12)),
        );
    }

    drop(stdin);
    let status = child
        .wait()
        .map_err(|error| format!("等待 FFmpeg 结束失败：{error}"))?;
    let ffmpeg_error = stderr_join.join().unwrap_or_default();
    if let Some(error) = stream_error {
        return Err(error);
    }
    if !status.success() {
        return Err(format!(
            "FFmpeg 编码失败，请检查编码器和音频输入设备。{}",
            if ffmpeg_error.trim().is_empty() {
                String::new()
            } else {
                format!(" {}", ffmpeg_error.trim())
            }
        ));
    }
    finish_recording_result(path, started.elapsed().as_secs(), last_preview_jpeg)
}

enum PreparedRecordingInput {
    Monitor {
        recorder: VideoRecorder,
        receiver: Receiver<Frame>,
        first_frame: Frame,
        region: Option<CaptureRegion>,
    },
    Window {
        window: Window,
        first_image: RgbaImage,
    },
}

fn prepare_monitor_recording_input(
    monitor_id: usize,
    requested_region: Option<CaptureRegion>,
) -> Result<(PreparedRecordingInput, u32, u32), String> {
    let (monitor, _) = selected_monitor(monitor_id)?;
    let (recorder, receiver) = monitor
        .video_recorder()
        .map_err(|error| format!("无法初始化屏幕录制：{error}"))?;
    recorder
        .start()
        .map_err(|error| format!("无法开始屏幕录制：{error}"))?;
    let first_frame = receiver
        .recv_timeout(Duration::from_secs(6))
        .map_err(|error| {
            let _ = recorder.stop();
            format!("等待首帧超时，请检查屏幕录制权限：{error}")
        })?;
    let region = match requested_region
        .map(|region| normalize_capture_region(region, first_frame.width, first_frame.height))
        .transpose()
    {
        Ok(region) => region,
        Err(error) => {
            let _ = recorder.stop();
            return Err(error);
        }
    };
    let input_width = region
        .as_ref()
        .map(|region| region.width)
        .unwrap_or(first_frame.width);
    let input_height = region
        .as_ref()
        .map(|region| region.height)
        .unwrap_or(first_frame.height);
    Ok((
        PreparedRecordingInput::Monitor {
            recorder,
            receiver,
            first_frame,
            region,
        },
        input_width,
        input_height,
    ))
}

fn prepare_recording(
    config: RecordingConfig,
    app: tauri::AppHandle,
) -> Result<(RecordingSession, RecordingStatus), String> {
    if !(1..=60).contains(&config.fps) {
        return Err("帧率必须在 1-60 FPS 之间".into());
    }
    if !(500..=100_000).contains(&config.bitrate_kbps) {
        return Err("码率必须在 500-100000 Kbps 之间".into());
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "未找到 FFmpeg。请安装 FFmpeg，或通过 TOOLDOCK_FFMPEG 指定可执行文件。".to_string()
    })?;
    let (input, input_width, input_height) = match config.source {
        RecordingSourceConfig::Monitor { monitor_id } => {
            prepare_monitor_recording_input(monitor_id, None)?
        }
        RecordingSourceConfig::Region { monitor_id, region } => {
            prepare_monitor_recording_input(monitor_id, Some(region))?
        }
        RecordingSourceConfig::Window { window_id } => {
            let window = selected_window(window_id)?;
            let first_image = window
                .capture_image()
                .map_err(|error| format!("无法捕获所选应用窗口：{error}"))?;
            let (input_width, input_height) = first_image.dimensions();
            if input_width < 2 || input_height < 2 {
                return Err("所选应用窗口尺寸无效".into());
            }
            (
                PreparedRecordingInput::Window {
                    window,
                    first_image,
                },
                input_width,
                input_height,
            )
        }
    };

    let requested_width = config.width.unwrap_or(input_width).max(2);
    let requested_height = config.height.unwrap_or(input_height).max(2);
    let output_width = requested_width.saturating_sub(requested_width % 2);
    let output_height = requested_height.saturating_sub(requested_height % 2);
    let folder = requested_folder(config.output_directory, default_recording_folder())?;
    let path = folder.join(format!(
        "ToolDock-{}.mp4",
        Local::now().format("%Y%m%d-%H%M%S")
    ));
    let (child, stdin, stderr_join) = match spawn_ffmpeg(
        &ffmpeg,
        input_width,
        input_height,
        output_width,
        output_height,
        config.fps,
        config.bitrate_kbps,
        config.audio_enabled,
        config.audio_input_id.as_deref(),
        &path,
    ) {
        Ok(process) => process,
        Err(error) => {
            if let PreparedRecordingInput::Monitor { recorder, .. } = &input {
                let _ = recorder.stop();
            }
            return Err(error);
        }
    };
    let (stop_tx, stop_rx) = mpsc::channel();
    let started = Instant::now();
    let thread_path = path.clone();
    let fps = config.fps;
    let join = thread::spawn(move || match input {
        PreparedRecordingInput::Monitor {
            recorder,
            receiver,
            first_frame,
            region,
        } => encode_monitor_recording(
            app,
            recorder,
            receiver,
            first_frame,
            region,
            child,
            stdin,
            stderr_join,
            stop_rx,
            fps,
            thread_path,
            started,
        ),
        PreparedRecordingInput::Window {
            window,
            first_image,
        } => encode_window_recording(
            app,
            window,
            first_image,
            child,
            stdin,
            stderr_join,
            stop_rx,
            fps,
            thread_path,
            started,
        ),
    });
    let path_string = path.to_string_lossy().into_owned();
    Ok((
        RecordingSession {
            stop_tx,
            join,
            path: path_string.clone(),
            started,
        },
        RecordingStatus {
            active: true,
            path: Some(path_string),
            elapsed_seconds: 0,
        },
    ))
}

#[tauri::command]
async fn start_recording(
    config: RecordingConfig,
    app: tauri::AppHandle,
    state: State<'_, RecordingState>,
) -> Result<RecordingStatus, String> {
    {
        let active = state.0.lock().map_err(|_| "录屏状态不可用".to_string())?;
        if active.is_some() {
            return Err("已有录屏正在进行".into());
        }
    }

    let (session, status) =
        tauri::async_runtime::spawn_blocking(move || prepare_recording(config, app))
            .await
            .map_err(|error| format!("启动录屏任务失败：{error}"))??;
    let mut active = state.0.lock().map_err(|_| "录屏状态不可用".to_string())?;
    if active.is_some() {
        let _ = session.stop_tx.send(());
        return Err("已有录屏正在进行".into());
    }
    *active = Some(session);
    Ok(status)
}

#[tauri::command]
fn recording_status(state: State<'_, RecordingState>) -> Result<RecordingStatus, String> {
    let active = state.0.lock().map_err(|_| "录屏状态不可用".to_string())?;
    Ok(match active.as_ref() {
        Some(session) => RecordingStatus {
            active: true,
            path: Some(session.path.clone()),
            elapsed_seconds: session.started.elapsed().as_secs(),
        },
        None => RecordingStatus {
            active: false,
            path: None,
            elapsed_seconds: 0,
        },
    })
}

#[tauri::command]
async fn stop_recording(state: State<'_, RecordingState>) -> Result<RecordingResult, String> {
    let session = state
        .0
        .lock()
        .map_err(|_| "录屏状态不可用".to_string())?
        .take()
        .ok_or_else(|| "当前没有正在进行的录屏".to_string())?;
    let _ = session.stop_tx.send(());
    tauri::async_runtime::spawn_blocking(move || {
        session
            .join
            .join()
            .map_err(|_| "录屏编码线程异常退出".to_string())?
    })
    .await
    .map_err(|error| format!("停止录屏任务失败：{error}"))?
}

fn show_main_window_handle(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window
        .show()
        .map_err(|error| format!("无法显示主窗口：{error}"))?;
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦主窗口：{error}"))
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    show_main_window_handle(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(CaptureState::default())
        .manage(ColorPickerState::default())
        .manage(RegionSelectorState::default())
        .manage(RecordingState::default())
        .setup(|app| {
            let settings = read_settings();
            let (show_label, quit_label) = tray_labels(&settings.language);
            let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            app.manage(TrayMenuState {
                show_item,
                quit_item,
            });
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ToolDock")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        let _ = show_main_window_handle(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        let _ = show_main_window_handle(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if read_settings().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            inspect_ports,
            kill_processes,
            list_monitors,
            load_settings,
            save_settings,
            choose_directory,
            capture_screenshot,
            finish_region_capture,
            list_screenshot_history,
            list_recording_history,
            open_region_selector,
            get_region_selector_overlay,
            finish_region_selector,
            open_color_picker,
            get_color_picker_overlay,
            finish_color_picker,
            list_capture_windows,
            recording_capabilities,
            list_audio_inputs,
            start_recording,
            recording_status,
            stop_recording,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running ToolDock");
}

#[cfg(test)]
mod tests {
    use super::{RecordingConfig, RecordingSourceConfig};

    #[test]
    fn recording_window_source_accepts_camel_case_window_id() {
        let config: RecordingConfig = serde_json::from_value(serde_json::json!({
            "source": {
                "kind": "window",
                "windowId": 42
            },
            "width": null,
            "height": null,
            "fps": 30,
            "bitrateKbps": 8000,
            "outputDirectory": null
        }))
        .expect("windowId should deserialize from the frontend recording config");

        assert!(matches!(
            config.source,
            RecordingSourceConfig::Window { window_id: 42 }
        ));
    }
}
