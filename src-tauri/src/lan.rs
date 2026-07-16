use arboard::Clipboard;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use chrono::Local;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const DISCOVERY_PORT: u16 = 38_421;
const DISCOVERY_ADDRESS: &str = "255.255.255.255:38421";
const PROTOCOL_VERSION: u8 = 3;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_CLIPBOARD_BYTES: usize = 1024 * 1024;
const FILE_CHUNK_BYTES: usize = 256 * 1024;
const PEER_TTL_MS: u64 = 30_000;
const REQUEST_TTL_MS: u64 = 120_000;
const TRANSFER_TIMEOUT_SECONDS: u64 = 300;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct LanConfig {
    pub enabled: bool,
    pub device_id: String,
    pub device_name: String,
    pub password: String,
    pub receive_dir: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanDevice {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub password_required: bool,
    pub last_seen_ms: u64,
    pub connected: bool,
    #[serde(skip)]
    instance_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanStatus {
    enabled: bool,
    local_device: Option<LanDevice>,
    receive_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanTransferRecord {
    id: String,
    file_name: String,
    path: String,
    size_bytes: u64,
    direction: String,
    device_id: String,
    device_name: String,
    status: String,
    created_at: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanClipboardRecord {
    id: String,
    direction: String,
    device_name: String,
    preview: String,
    created_at: String,
}

#[derive(Clone)]
struct PeerConnection {
    device: LanDevice,
    key: [u8; 32],
}

struct LanRuntime {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

pub(crate) struct LanState {
    runtime: Mutex<Option<LanRuntime>>,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    transfers: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    clipboards: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    local_device: Arc<Mutex<Option<LanDevice>>>,
    receive_dir: Arc<Mutex<String>>,
}

impl Default for LanState {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
            peers: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(Mutex::new(HashMap::new())),
            transfers: Arc::new(Mutex::new(VecDeque::new())),
            clipboards: Arc::new(Mutex::new(VecDeque::new())),
            local_device: Arc::new(Mutex::new(None)),
            receive_dir: Arc::new(Mutex::new(String::new())),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryAnnouncement {
    marker: String,
    version: u8,
    instance_id: String,
    device_id: String,
    device_name: String,
    port: u16,
    password_required: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireRequest {
    version: u8,
    request_id: String,
    timestamp_ms: u64,
    sender_instance_id: String,
    sender_id: String,
    sender_name: String,
    sender_port: u16,
    target_instance_id: String,
    target_id: String,
    action: String,
    file_name: Option<String>,
    payload_size: u64,
    auth: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireResponse {
    ok: bool,
    message: String,
}

enum LanEvent {
    DevicesChanged,
    TransferUpdated(LanTransferRecord),
    ClipboardReceived(LanClipboardRecord),
}

impl LanState {
    pub(crate) fn restart(&self, app: AppHandle, config: LanConfig) -> Result<(), String> {
        self.stop();
        self.peers
            .lock()
            .map_err(|_| "LAN peer state is unavailable")?
            .clear();
        self.connections
            .lock()
            .map_err(|_| "LAN connection state is unavailable")?
            .clear();
        *self
            .receive_dir
            .lock()
            .map_err(|_| "LAN receive directory state is unavailable")? =
            config.receive_dir.clone();

        if !config.enabled {
            *self
                .local_device
                .lock()
                .map_err(|_| "LAN local device state is unavailable")? = None;
            return Ok(());
        }

        fs::create_dir_all(&config.receive_dir)
            .map_err(|error| format!("Unable to create LAN receive folder: {error}"))?;
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|error| format!("Unable to start LAN transfer service: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Unable to configure LAN transfer service: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Unable to read LAN transfer port: {error}"))?
            .port();

        let discovery =
            UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)).map_err(|error| {
                format!("Unable to start LAN discovery on port {DISCOVERY_PORT}: {error}")
            })?;
        discovery
            .set_nonblocking(true)
            .map_err(|error| format!("Unable to configure LAN discovery: {error}"))?;
        discovery
            .set_broadcast(true)
            .map_err(|error| format!("Unable to enable LAN discovery broadcasts: {error}"))?;

        let local_device = LanDevice {
            id: config.device_id.clone(),
            name: config.device_name.clone(),
            address: "0.0.0.0".into(),
            port,
            password_required: !config.password.is_empty(),
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: new_runtime_id(&config.device_id),
        };
        *self
            .local_device
            .lock()
            .map_err(|_| "LAN local device state is unavailable")? = Some(local_device.clone());

        let stop = Arc::new(AtomicBool::new(false));
        let discovery_thread = spawn_discovery(
            discovery,
            stop.clone(),
            local_device.clone(),
            self.peers.clone(),
            self.connections.clone(),
            app.clone(),
        );
        let server_thread = spawn_server(
            listener,
            stop.clone(),
            config,
            local_device,
            self.peers.clone(),
            self.connections.clone(),
            self.transfers.clone(),
            self.clipboards.clone(),
            app,
        );

        *self
            .runtime
            .lock()
            .map_err(|_| "LAN runtime state is unavailable")? = Some(LanRuntime {
            stop,
            threads: vec![discovery_thread, server_thread],
        });
        Ok(())
    }

    fn stop(&self) {
        let runtime = self
            .runtime
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.take());
        if let Some(runtime) = runtime {
            runtime.stop.store(true, Ordering::Relaxed);
            for worker in runtime.threads {
                let _ = worker.join();
            }
        }
    }
}

fn spawn_discovery(
    socket: UdpSocket,
    stop: Arc<AtomicBool>,
    local: LanDevice,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    app: AppHandle,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let announcement = DiscoveryAnnouncement {
            marker: "tooldock-lan".into(),
            version: PROTOCOL_VERSION,
            instance_id: local.instance_id.clone(),
            device_id: local.id.clone(),
            device_name: local.name.clone(),
            port: local.port,
            password_required: local.password_required,
        };
        let bytes = serde_json::to_vec(&announcement).unwrap_or_default();
        let mut last_announcement = Instant::now() - Duration::from_secs(5);
        let mut last_cleanup = Instant::now();
        let mut buffer = [0u8; 4096];

        while !stop.load(Ordering::Relaxed) {
            if last_announcement.elapsed() >= Duration::from_millis(1500) {
                let _ = socket.send_to(&bytes, DISCOVERY_ADDRESS);
                last_announcement = Instant::now();
            }

            loop {
                match socket.recv_from(&mut buffer) {
                    Ok((size, source)) => {
                        let Ok(item) =
                            serde_json::from_slice::<DiscoveryAnnouncement>(&buffer[..size])
                        else {
                            continue;
                        };
                        if item.marker != "tooldock-lan"
                            || item.version != PROTOCOL_VERSION
                            || item.device_id == local.id
                        {
                            continue;
                        }
                        reconcile_discovered_peer(item, source.ip(), &peers, &connections);
                        let _ = app.emit("lan-devices-changed", ());
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                    Err(_) => break,
                }
            }

            if last_cleanup.elapsed() >= Duration::from_secs(2) {
                let cutoff = now_ms().saturating_sub(PEER_TTL_MS);
                let connected_ids = connections
                    .lock()
                    .map(|items| items.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                if let Ok(mut items) = peers.lock() {
                    items.retain(|id, item| {
                        item.last_seen_ms >= cutoff || connected_ids.iter().any(|value| value == id)
                    });
                }
                let _ = app.emit("lan-devices-changed", ());
                last_cleanup = Instant::now();
            }
            thread::sleep(Duration::from_millis(80));
        }
    })
}

fn reconcile_discovered_peer(
    item: DiscoveryAnnouncement,
    source_ip: IpAddr,
    peers: &Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: &Arc<Mutex<HashMap<String, PeerConnection>>>,
) {
    let address = source_ip.to_string();
    let connected = connections
        .lock()
        .map(|mut items| {
            let stale = items
                .get(&item.device_id)
                .map(|connection| {
                    connection.device.instance_id != item.instance_id
                        || connection.device.address != address
                        || connection.device.port != item.port
                })
                .unwrap_or(false);
            if stale {
                items.remove(&item.device_id);
            }
            items.contains_key(&item.device_id)
        })
        .unwrap_or(false);
    let peer = LanDevice {
        id: item.device_id,
        name: item.device_name,
        address,
        port: item.port,
        password_required: item.password_required,
        last_seen_ms: now_ms(),
        connected,
        instance_id: item.instance_id,
    };
    if let Ok(mut items) = peers.lock() {
        items.insert(peer.id.clone(), peer);
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_server(
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    config: LanConfig,
    local: LanDevice,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    transfers: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    clipboards: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    app: AppHandle,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let seen_requests = Arc::new(Mutex::new(HashMap::<String, u64>::new()));
        while !stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, address)) => {
                    let config = config.clone();
                    let local = local.clone();
                    let peers = peers.clone();
                    let connections = connections.clone();
                    let transfers = transfers.clone();
                    let clipboards = clipboards.clone();
                    let seen_requests = seen_requests.clone();
                    let app = app.clone();
                    thread::spawn(move || {
                        if let Err(error) = handle_incoming(
                            stream,
                            address,
                            config,
                            local,
                            peers,
                            connections,
                            transfers,
                            clipboards,
                            seen_requests,
                            app,
                        ) {
                            append_lan_log(&format!(
                                "Incoming request from {address} failed: {error}"
                            ));
                            eprintln!("ToolDock LAN request from {address} failed: {error}");
                        }
                    });
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => thread::sleep(Duration::from_millis(150)),
            }
        }
    })
}

#[allow(clippy::too_many_arguments)]
fn handle_incoming(
    stream: TcpStream,
    address: SocketAddr,
    config: LanConfig,
    local: LanDevice,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    transfers: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    clipboards: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    seen_requests: Arc<Mutex<HashMap<String, u64>>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut emit = |event| match event {
        LanEvent::DevicesChanged => {
            let _ = app.emit("lan-devices-changed", ());
        }
        LanEvent::TransferUpdated(record) => {
            let _ = app.emit("lan-transfer-updated", record);
        }
        LanEvent::ClipboardReceived(record) => {
            let _ = app.emit("lan-clipboard-received", record);
        }
    };
    handle_incoming_core(
        stream,
        address,
        config,
        local,
        peers,
        connections,
        transfers,
        clipboards,
        seen_requests,
        &mut emit,
    )
}

#[allow(clippy::too_many_arguments)]
fn handle_incoming_core(
    stream: TcpStream,
    address: SocketAddr,
    config: LanConfig,
    local: LanDevice,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    transfers: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    clipboards: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    seen_requests: Arc<Mutex<HashMap<String, u64>>>,
    emit: &mut dyn FnMut(LanEvent),
) -> Result<(), String> {
    handle_incoming_core_with_clipboard_writer(
        stream,
        address,
        config,
        local,
        peers,
        connections,
        transfers,
        clipboards,
        seen_requests,
        emit,
        &mut |text| {
            Clipboard::new()
                .and_then(|mut clipboard| clipboard.set_text(text.to_string()))
                .map_err(|error| format!("Unable to write received clipboard text: {error}"))
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn handle_incoming_core_with_clipboard_writer(
    mut stream: TcpStream,
    address: SocketAddr,
    config: LanConfig,
    local: LanDevice,
    peers: Arc<Mutex<HashMap<String, LanDevice>>>,
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    transfers: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    clipboards: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    seen_requests: Arc<Mutex<HashMap<String, u64>>>,
    emit: &mut dyn FnMut(LanEvent),
    write_clipboard: &mut dyn FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    configure_stream(&stream)?;
    let request: WireRequest = read_json_frame(&mut stream)?;
    if request.version != PROTOCOL_VERSION
        || request.target_id != local.id
        || request.target_instance_id != local.instance_id
    {
        write_response(&mut stream, false, "Unsupported LAN request")?;
        return Err("Unsupported LAN request".into());
    }
    if let Err(error) = validate_request_time(&request, &seen_requests) {
        let _ = write_response(&mut stream, false, &error);
        return Err(error);
    }

    if request.action == "connect" {
        let access_key = derive_key(&config.password);
        if let Err(error) = validate_auth(&request, &access_key) {
            write_response(&mut stream, false, &error)?;
            return Err(error);
        }
        let session_key = derive_session_key(
            &access_key,
            &request.request_id,
            &request.sender_id,
            &request.target_id,
        );
        let device = LanDevice {
            id: request.sender_id.clone(),
            name: request.sender_name.clone(),
            address: address.ip().to_string(),
            port: request.sender_port,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: request.sender_instance_id.clone(),
        };
        if let Ok(mut items) = connections.lock() {
            items.insert(
                device.id.clone(),
                PeerConnection {
                    device: device.clone(),
                    key: session_key,
                },
            );
        }
        if let Ok(mut items) = peers.lock() {
            items.insert(device.id.clone(), device);
        }
        write_response(&mut stream, true, "Connected")?;
        emit(LanEvent::DevicesChanged);
        return Ok(());
    }

    let connection = connections
        .lock()
        .map_err(|_| "LAN connection state is unavailable")?
        .get(&request.sender_id)
        .cloned();
    let Some(connection) = connection else {
        let error = "The connection expired on the receiving device. Reconnect and try again.";
        let _ = write_response(&mut stream, false, error);
        return Err(error.into());
    };
    if let Err(error) = validate_auth(&request, &connection.key) {
        let _ = write_response(&mut stream, false, &error);
        return Err(error);
    }

    match request.action.as_str() {
        "clipboard" => receive_clipboard(
            &mut stream,
            &request,
            &connection,
            clipboards,
            emit,
            write_clipboard,
        ),
        "file" => receive_file(
            &mut stream,
            &request,
            &connection,
            &config.receive_dir,
            transfers,
            emit,
        ),
        _ => {
            write_response(&mut stream, false, "Unknown LAN action")?;
            Err("Unknown LAN action".into())
        }
    }
}

fn receive_clipboard(
    stream: &mut TcpStream,
    request: &WireRequest,
    connection: &PeerConnection,
    history: Arc<Mutex<VecDeque<LanClipboardRecord>>>,
    emit: &mut dyn FnMut(LanEvent),
    write_clipboard: &mut dyn FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    if request.payload_size as usize > MAX_CLIPBOARD_BYTES {
        write_response(stream, false, "Clipboard text is too large")?;
        return Err("Clipboard text is too large".into());
    }
    write_response(stream, true, "Ready")?;
    let result = (|| {
        let encrypted = read_bytes_frame(stream, MAX_CLIPBOARD_BYTES + 64)?;
        let plain = decrypt_chunk(&connection.key, &request.request_id, 0, &encrypted)?;
        if plain.len() as u64 != request.payload_size {
            return Err("Clipboard payload size mismatch".into());
        }
        let text = String::from_utf8(plain)
            .map_err(|_| "Clipboard text is not valid UTF-8".to_string())?;
        write_clipboard(&text)?;
        Ok::<String, String>(text)
    })();
    let text = match result {
        Ok(text) => text,
        Err(error) => {
            let _ = write_response(stream, false, &error);
            return Err(error);
        }
    };
    let record = LanClipboardRecord {
        id: request.request_id.clone(),
        direction: "incoming".into(),
        device_name: connection.device.name.clone(),
        preview: text_preview(&text),
        created_at: Local::now().to_rfc3339(),
    };
    push_limited(&history, record.clone(), 50);
    write_response(stream, true, "Clipboard received")?;
    emit(LanEvent::ClipboardReceived(record));
    Ok(())
}

fn receive_file(
    stream: &mut TcpStream,
    request: &WireRequest,
    connection: &PeerConnection,
    receive_dir: &str,
    history: Arc<Mutex<VecDeque<LanTransferRecord>>>,
    emit: &mut dyn FnMut(LanEvent),
) -> Result<(), String> {
    fs::create_dir_all(receive_dir)
        .map_err(|error| format!("Unable to prepare the file receive folder: {error}"))?;
    let file_name = match safe_file_name(request.file_name.as_deref().unwrap_or("received-file")) {
        Ok(file_name) => file_name,
        Err(error) => {
            let _ = write_response(stream, false, &error);
            return Err(error);
        }
    };
    let destination = unique_destination(Path::new(receive_dir), &file_name);
    let partial = destination.with_extension(format!(
        "{}.tooldock-part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
    ));
    let record = LanTransferRecord {
        id: request.request_id.clone(),
        file_name: file_name.clone(),
        path: destination.to_string_lossy().into_owned(),
        size_bytes: request.payload_size,
        direction: "incoming".into(),
        device_id: connection.device.id.clone(),
        device_name: connection.device.name.clone(),
        status: "receiving".into(),
        created_at: Local::now().to_rfc3339(),
        message: String::new(),
    };
    push_limited(&history, record.clone(), 50);
    emit(LanEvent::TransferUpdated(record));

    write_response(stream, true, "Ready")?;
    let result = receive_file_payload(stream, request, connection, &partial, &destination);

    if let Err(error) = result {
        let _ = fs::remove_file(&partial);
        update_transfer(&history, &request.request_id, "failed", &error);
        if let Some(record) = find_transfer(&history, &request.request_id) {
            emit(LanEvent::TransferUpdated(record));
        }
        append_lan_log(&format!(
            "Receiving {} from {} failed: {}",
            file_name, connection.device.name, error
        ));
        let _ = write_response(stream, false, &error);
        return Err(error);
    }
    update_transfer(&history, &request.request_id, "completed", "");
    write_response(stream, true, "File received")?;
    if let Some(record) = find_transfer(&history, &request.request_id) {
        emit(LanEvent::TransferUpdated(record));
    }
    Ok(())
}

fn receive_file_payload(
    stream: &mut TcpStream,
    request: &WireRequest,
    connection: &PeerConnection,
    partial: &Path,
    destination: &Path,
) -> Result<(), String> {
    let mut file = File::create(partial)
        .map_err(|error| format!("Unable to create received file: {error}"))?;
    let mut received = 0u64;
    let mut chunk_index = 0u64;
    while received < request.payload_size {
        let encrypted = read_bytes_frame(stream, FILE_CHUNK_BYTES + 64).map_err(|error| {
            format!(
                "Receiving file chunk {} at {} of {} bytes failed: {}",
                chunk_index + 1,
                received,
                request.payload_size,
                error
            )
        })?;
        let plain = decrypt_chunk(
            &connection.key,
            &request.request_id,
            chunk_index,
            &encrypted,
        )
        .map_err(|error| format!("Unable to decrypt file chunk {}: {error}", chunk_index + 1))?;
        let remaining = request.payload_size - received;
        if plain.len() as u64 > remaining {
            return Err("Received file is larger than announced".into());
        }
        file.write_all(&plain).map_err(|error| {
            format!(
                "Unable to write file chunk {} to the receive folder: {error}",
                chunk_index + 1
            )
        })?;
        received += plain.len() as u64;
        chunk_index += 1;
    }
    finalize_received_file(file, partial, destination)
}

#[tauri::command]
pub(crate) fn lan_status(state: State<'_, LanState>) -> Result<LanStatus, String> {
    let local_device = state
        .local_device
        .lock()
        .map_err(|_| "LAN local device state is unavailable")?
        .clone();
    let receive_dir = state
        .receive_dir
        .lock()
        .map_err(|_| "LAN receive directory state is unavailable")?
        .clone();
    Ok(LanStatus {
        enabled: local_device.is_some(),
        local_device,
        receive_dir,
    })
}

#[tauri::command]
pub(crate) fn list_lan_devices(state: State<'_, LanState>) -> Result<Vec<LanDevice>, String> {
    let connections = state
        .connections
        .lock()
        .map_err(|_| "LAN connection state is unavailable")?;
    let mut devices = state
        .peers
        .lock()
        .map_err(|_| "LAN peer state is unavailable")?
        .values()
        .cloned()
        .map(|mut device| {
            device.connected = connections.contains_key(&device.id);
            device
        })
        .collect::<Vec<_>>();
    devices.sort_by(|left, right| {
        right
            .connected
            .cmp(&left.connected)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(devices)
}

#[tauri::command]
pub(crate) async fn connect_lan_device(
    device_id: String,
    password: String,
    state: State<'_, LanState>,
) -> Result<LanDevice, String> {
    let peer = state
        .peers
        .lock()
        .map_err(|_| "LAN peer state is unavailable")?
        .get(&device_id)
        .cloned()
        .ok_or_else(|| "The selected device is no longer available".to_string())?;
    let local = state
        .local_device
        .lock()
        .map_err(|_| "LAN local device state is unavailable")?
        .clone()
        .ok_or_else(|| "LAN sharing is disabled".to_string())?;
    let connections = state.connections.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let access_key = derive_key(&password);
        let request = new_request(&local, &peer, "connect", None, 0, &access_key);
        let mut stream = connect_stream(&peer)?;
        write_json_frame(&mut stream, &request)?;
        let response: WireResponse = read_json_frame(&mut stream)?;
        if !response.ok {
            return Err(if response.message.is_empty() {
                "Connection password was rejected".into()
            } else {
                response.message
            });
        }
        let session_key = derive_session_key(&access_key, &request.request_id, &local.id, &peer.id);
        let mut connected_peer = peer.clone();
        connected_peer.connected = true;
        connections
            .lock()
            .map_err(|_| "LAN connection state is unavailable")?
            .insert(
                peer.id.clone(),
                PeerConnection {
                    device: connected_peer.clone(),
                    key: session_key,
                },
            );
        Ok(connected_peer)
    })
    .await
    .map_err(|error| format!("LAN connection task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn disconnect_lan_device(
    device_id: String,
    state: State<'_, LanState>,
) -> Result<(), String> {
    state
        .connections
        .lock()
        .map_err(|_| "LAN connection state is unavailable")?
        .remove(&device_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn send_lan_files(
    device_id: String,
    paths: Vec<String>,
    state: State<'_, LanState>,
) -> Result<Vec<LanTransferRecord>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let connection = state
        .connections
        .lock()
        .map_err(|_| "LAN connection state is unavailable")?
        .get(&device_id)
        .cloned()
        .ok_or_else(|| "Connect to the selected device first".to_string())?;
    let local = state
        .local_device
        .lock()
        .map_err(|_| "LAN local device state is unavailable")?
        .clone()
        .ok_or_else(|| "LAN sharing is disabled".to_string())?;
    let history = state.transfers.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        for raw_path in paths {
            let path = PathBuf::from(raw_path);
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "Unable to read the selected file name".to_string())?
                .to_string();
            let size = fs::metadata(&path)
                .map_err(|error| format!("Unable to read {file_name}: {error}"))?
                .len();
            let request = new_request(
                &local,
                &connection.device,
                "file",
                Some(file_name.clone()),
                size,
                &connection.key,
            );
            let mut record = LanTransferRecord {
                id: request.request_id.clone(),
                file_name: file_name.clone(),
                path: path.to_string_lossy().into_owned(),
                size_bytes: size,
                direction: "outgoing".into(),
                device_id: connection.device.id.clone(),
                device_name: connection.device.name.clone(),
                status: "sending".into(),
                created_at: Local::now().to_rfc3339(),
                message: String::new(),
            };
            push_limited(&history, record.clone(), 50);
            let result = send_file_request(&connection, &request, &path);
            match result {
                Ok(()) => record.status = "completed".into(),
                Err(error) => {
                    append_lan_log(&format!(
                        "Sending {} to {} failed: {}",
                        file_name, connection.device.name, error
                    ));
                    record.status = "failed".into();
                    record.message = error;
                }
            }
            update_transfer(&history, &record.id, &record.status, &record.message);
            results.push(record);
        }
        Ok(results)
    })
    .await
    .map_err(|error| format!("LAN file transfer task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn list_lan_transfers(
    state: State<'_, LanState>,
) -> Result<Vec<LanTransferRecord>, String> {
    Ok(state
        .transfers
        .lock()
        .map_err(|_| "LAN transfer history is unavailable")?
        .iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub(crate) fn read_lan_clipboard() -> Result<String, String> {
    Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|error| format!("Unable to read text from the clipboard: {error}"))
}

#[tauri::command]
pub(crate) async fn send_lan_clipboard(
    text: String,
    device_ids: Vec<String>,
    state: State<'_, LanState>,
) -> Result<Vec<LanClipboardRecord>, String> {
    if text.as_bytes().len() > MAX_CLIPBOARD_BYTES {
        return Err("Clipboard text is too large to sync".into());
    }
    let local = state
        .local_device
        .lock()
        .map_err(|_| "LAN local device state is unavailable")?
        .clone()
        .ok_or_else(|| "LAN sharing is disabled".to_string())?;
    let targets = {
        let connections = state
            .connections
            .lock()
            .map_err(|_| "LAN connection state is unavailable")?;
        connections
            .values()
            .filter(|connection| {
                device_ids.is_empty() || device_ids.iter().any(|id| id == &connection.device.id)
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    if targets.is_empty() {
        return Err("No connected LAN devices".into());
    }
    let history = state.clipboards.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut records = Vec::new();
        for connection in targets {
            send_clipboard_request(&local, &connection, &text)?;
            let record = LanClipboardRecord {
                id: new_request_id(&local.id),
                direction: "outgoing".into(),
                device_name: connection.device.name.clone(),
                preview: text_preview(&text),
                created_at: Local::now().to_rfc3339(),
            };
            push_limited(&history, record.clone(), 50);
            records.push(record);
        }
        Ok(records)
    })
    .await
    .map_err(|error| format!("LAN clipboard task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn list_lan_clipboard_history(
    state: State<'_, LanState>,
) -> Result<Vec<LanClipboardRecord>, String> {
    Ok(state
        .clipboards
        .lock()
        .map_err(|_| "LAN clipboard history is unavailable")?
        .iter()
        .cloned()
        .collect())
}

fn send_file_request(
    connection: &PeerConnection,
    request: &WireRequest,
    path: &Path,
) -> Result<(), String> {
    let mut stream = connect_stream(&connection.device)?;
    write_json_frame(&mut stream, request)
        .map_err(|error| format!("Unable to send the file request header: {error}"))?;
    expect_ready(&mut stream).map_err(|error| {
        format!("The receiving device did not accept the file request: {error}")
    })?;
    let mut file =
        File::open(path).map_err(|error| format!("Unable to open selected file: {error}"))?;
    let mut buffer = vec![0u8; FILE_CHUNK_BYTES];
    let mut chunk_index = 0u64;
    let mut remaining = request.payload_size;
    while remaining > 0 {
        let read_size = usize::try_from(remaining.min(FILE_CHUNK_BYTES as u64))
            .map_err(|_| "Selected file is too large to transfer")?;
        let size = file
            .read(&mut buffer[..read_size])
            .map_err(|error| format!("Unable to read selected file: {error}"))?;
        if size == 0 {
            return Err(
                "The selected file changed while it was being sent. Select it again and retry."
                    .into(),
            );
        }
        let encrypted = encrypt_chunk(
            &connection.key,
            &request.request_id,
            chunk_index,
            &buffer[..size],
        )?;
        write_bytes_frame(&mut stream, &encrypted).map_err(|error| {
            format!(
                "Unable to send file chunk {} with {} bytes remaining: {}",
                chunk_index + 1,
                remaining,
                error
            )
        })?;
        chunk_index += 1;
        remaining -= size as u64;
    }
    let response: WireResponse = read_json_frame(&mut stream).map_err(|error| {
        format!(
            "All {} file chunks were sent, but the receiving device did not return the final confirmation: {}",
            chunk_index, error
        )
    })?;
    if response.ok {
        Ok(())
    } else {
        Err(response.message)
    }
}

fn send_clipboard_request(
    local: &LanDevice,
    connection: &PeerConnection,
    text: &str,
) -> Result<(), String> {
    let request = new_request(
        local,
        &connection.device,
        "clipboard",
        None,
        text.len() as u64,
        &connection.key,
    );
    let mut stream = connect_stream(&connection.device)?;
    write_json_frame(&mut stream, &request)?;
    expect_ready(&mut stream)?;
    let encrypted = encrypt_chunk(&connection.key, &request.request_id, 0, text.as_bytes())?;
    write_bytes_frame(&mut stream, &encrypted)?;
    let response: WireResponse = read_json_frame(&mut stream)?;
    if response.ok {
        Ok(())
    } else {
        Err(response.message)
    }
}

fn connect_stream(device: &LanDevice) -> Result<TcpStream, String> {
    let ip = device
        .address
        .parse::<IpAddr>()
        .map_err(|_| "The selected device has an invalid LAN address")?;
    let address = SocketAddr::new(ip, device.port);
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|error| format!("Unable to reach {}: {error}", device.name))?;
    configure_stream(&stream)?;
    Ok(stream)
}

fn configure_stream(stream: &TcpStream) -> Result<(), String> {
    stream
        .set_nonblocking(false)
        .map_err(|error| format!("Unable to configure LAN blocking mode: {error}"))?;
    stream
        .set_nodelay(true)
        .map_err(|error| format!("Unable to configure LAN low-latency mode: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(TRANSFER_TIMEOUT_SECONDS)))
        .map_err(|error| format!("Unable to configure LAN read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(TRANSFER_TIMEOUT_SECONDS)))
        .map_err(|error| format!("Unable to configure LAN write timeout: {error}"))
}

fn new_request(
    local: &LanDevice,
    target: &LanDevice,
    action: &str,
    file_name: Option<String>,
    payload_size: u64,
    key: &[u8; 32],
) -> WireRequest {
    let mut request = WireRequest {
        version: PROTOCOL_VERSION,
        request_id: new_request_id(&local.id),
        timestamp_ms: now_ms(),
        sender_instance_id: local.instance_id.clone(),
        sender_id: local.id.clone(),
        sender_name: local.name.clone(),
        sender_port: local.port,
        target_instance_id: target.instance_id.clone(),
        target_id: target.id.clone(),
        action: action.into(),
        file_name,
        payload_size,
        auth: String::new(),
    };
    request.auth = request_auth(&request, key);
    request
}

fn validate_request_time(
    request: &WireRequest,
    seen_requests: &Arc<Mutex<HashMap<String, u64>>>,
) -> Result<(), String> {
    let now = now_ms();
    if now.abs_diff(request.timestamp_ms) > REQUEST_TTL_MS {
        return Err("LAN request has expired".into());
    }
    let mut seen = seen_requests
        .lock()
        .map_err(|_| "LAN replay protection is unavailable")?;
    seen.retain(|_, timestamp| now.saturating_sub(*timestamp) <= REQUEST_TTL_MS);
    if seen.contains_key(&request.request_id) {
        return Err("Duplicate LAN request rejected".into());
    }
    seen.insert(request.request_id.clone(), now);
    Ok(())
}

fn validate_auth(request: &WireRequest, key: &[u8; 32]) -> Result<(), String> {
    if request.auth == request_auth(request, key) {
        Ok(())
    } else {
        Err("Connection password was rejected".into())
    }
}

fn request_auth(request: &WireRequest, key: &[u8; 32]) -> String {
    let signing = format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        request.version,
        request.request_id,
        request.timestamp_ms,
        request.sender_instance_id,
        request.sender_id,
        request.sender_name,
        request.sender_port,
        request.target_instance_id,
        request.target_id,
        request.action,
        request.file_name.as_deref().unwrap_or("")
    );
    let mut bytes = signing.into_bytes();
    bytes.extend_from_slice(&request.payload_size.to_le_bytes());
    blake3::keyed_hash(key, &bytes).to_hex().to_string()
}

fn derive_key(password: &str) -> [u8; 32] {
    blake3::derive_key("ToolDock LAN access key v1", password.as_bytes())
}

fn derive_session_key(
    access_key: &[u8; 32],
    request_id: &str,
    sender_id: &str,
    target_id: &str,
) -> [u8; 32] {
    let material = format!("{request_id}\n{sender_id}\n{target_id}");
    *blake3::keyed_hash(access_key, material.as_bytes()).as_bytes()
}

fn encrypt_chunk(
    key: &[u8; 32],
    request_id: &str,
    chunk_index: u64,
    plain: &[u8],
) -> Result<Vec<u8>, String> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(&chunk_nonce(request_id, chunk_index), plain)
        .map_err(|_| "Unable to encrypt LAN payload".into())
}

fn decrypt_chunk(
    key: &[u8; 32],
    request_id: &str,
    chunk_index: u64,
    encrypted: &[u8],
) -> Result<Vec<u8>, String> {
    XChaCha20Poly1305::new(key.into())
        .decrypt(&chunk_nonce(request_id, chunk_index), encrypted)
        .map_err(|_| "Unable to decrypt LAN payload".into())
}

fn chunk_nonce(request_id: &str, chunk_index: u64) -> XNonce {
    let digest = blake3::hash(request_id.as_bytes());
    let mut nonce = [0u8; 24];
    nonce[..16].copy_from_slice(&digest.as_bytes()[..16]);
    nonce[16..].copy_from_slice(&chunk_index.to_le_bytes());
    nonce.into()
}

fn write_response(stream: &mut TcpStream, ok: bool, message: &str) -> Result<(), String> {
    write_json_frame(
        stream,
        &WireResponse {
            ok,
            message: message.into(),
        },
    )
}

fn expect_ready(stream: &mut TcpStream) -> Result<(), String> {
    let response: WireResponse = read_json_frame(stream)?;
    if response.ok {
        Ok(())
    } else {
        Err(response.message)
    }
}

fn write_json_frame<T: Serialize>(stream: &mut TcpStream, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to encode LAN message: {error}"))?;
    write_bytes_frame(stream, &bytes)
}

fn read_json_frame<T: DeserializeOwned>(stream: &mut TcpStream) -> Result<T, String> {
    let bytes = read_bytes_frame(stream, MAX_HEADER_BYTES)?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Unable to decode LAN message: {error}"))
}

fn write_bytes_frame(stream: &mut TcpStream, bytes: &[u8]) -> Result<(), String> {
    let size = u32::try_from(bytes.len()).map_err(|_| "LAN message is too large")?;
    stream
        .write_all(&size.to_be_bytes())
        .and_then(|_| stream.write_all(bytes))
        .and_then(|_| stream.flush())
        .map_err(|error| format!("Unable to send LAN message: {error}"))
}

fn read_bytes_frame(stream: &mut TcpStream, limit: usize) -> Result<Vec<u8>, String> {
    let mut size_bytes = [0u8; 4];
    stream
        .read_exact(&mut size_bytes)
        .map_err(|error| {
            if error.kind() == ErrorKind::UnexpectedEof {
                "The remote device closed the connection before completing the transfer. Reconnect the device and try again.".into()
            } else {
                format!("Unable to read LAN message size: {error}")
            }
        })?;
    let size = u32::from_be_bytes(size_bytes) as usize;
    if size > limit {
        return Err("LAN message exceeds the allowed size".into());
    }
    let mut bytes = vec![0u8; size];
    stream
        .read_exact(&mut bytes)
        .map_err(|error| {
            if error.kind() == ErrorKind::UnexpectedEof {
                "The remote device closed the connection before completing the transfer. Reconnect the device and try again.".into()
            } else {
                format!("Unable to read LAN message: {error}")
            }
        })?;
    Ok(bytes)
}

fn safe_file_name(value: &str) -> Result<String, String> {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Received file name is invalid".into())
}

fn finalize_received_file(
    mut file: File,
    partial: &Path,
    destination: &Path,
) -> Result<(), String> {
    file.flush()
        .map_err(|error| format!("Unable to finish received file: {error}"))?;
    drop(file);
    fs::rename(partial, destination)
        .map_err(|error| format!("Unable to finalize received file: {error}"))
}

fn unique_destination(directory: &Path, file_name: &str) -> PathBuf {
    let direct = directory.join(file_name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("received");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let candidate = match extension {
            Some(extension) => directory.join(format!("{stem} ({index}).{extension}")),
            None => directory.join(format!("{stem} ({index})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}", now_ms()))
}

fn text_preview(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let preview = chars.by_ref().take(120).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn append_lan_log(message: &str) {
    let directory = dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ToolDock");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join("lan.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {}", Local::now().to_rfc3339(), message);
    }
}

fn push_limited<T: Clone>(history: &Arc<Mutex<VecDeque<T>>>, item: T, limit: usize) {
    if let Ok(mut items) = history.lock() {
        items.push_front(item);
        items.truncate(limit);
    }
}

fn update_transfer(
    history: &Arc<Mutex<VecDeque<LanTransferRecord>>>,
    id: &str,
    status: &str,
    message: &str,
) {
    if let Ok(mut items) = history.lock() {
        if let Some(item) = items.iter_mut().find(|item| item.id == id) {
            item.status = status.into();
            item.message = message.into();
        }
    }
}

fn find_transfer(
    history: &Arc<Mutex<VecDeque<LanTransferRecord>>>,
    id: &str,
) -> Option<LanTransferRecord> {
    history
        .lock()
        .ok()
        .and_then(|items| items.iter().find(|item| item.id == id).cloned())
}

fn new_request_id(device_id: &str) -> String {
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{device_id}-{}-{counter}", now_nanos())
}

fn new_runtime_id(device_id: &str) -> String {
    format!("{device_id}-runtime-{}", now_nanos())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, VecDeque},
        fs::{self, File, OpenOptions},
        io::{ErrorKind, Write},
        net::{IpAddr, TcpListener, TcpStream},
        sync::{Arc, Mutex},
        thread,
        time::Duration,
    };

    use super::{
        configure_stream, connect_stream, decrypt_chunk, derive_key, derive_session_key,
        encrypt_chunk, expect_ready, finalize_received_file, handle_incoming_core,
        handle_incoming_core_with_clipboard_writer, new_request, now_ms, now_nanos,
        read_json_frame, reconcile_discovered_peer, safe_file_name, send_clipboard_request,
        send_file_request, write_json_frame, DiscoveryAnnouncement, LanConfig, LanDevice,
        PeerConnection, WireResponse,
    };

    #[test]
    fn encrypted_chunks_round_trip() {
        let key = derive_key("123456");
        let encrypted = encrypt_chunk(&key, "request-1", 4, b"ToolDock clipboard")
            .expect("payload should encrypt");
        assert_ne!(encrypted, b"ToolDock clipboard");
        assert_eq!(
            decrypt_chunk(&key, "request-1", 4, &encrypted).expect("payload should decrypt"),
            b"ToolDock clipboard"
        );
    }

    #[test]
    fn received_file_names_drop_parent_paths() {
        assert_eq!(
            safe_file_name("../../example.txt").expect("file name should be sanitized"),
            "example.txt"
        );
    }

    #[test]
    fn received_file_names_allow_dotfiles() {
        assert_eq!(
            safe_file_name(".codex-tauri.err.log").expect("dotfile should be accepted"),
            ".codex-tauri.err.log"
        );
    }

    #[test]
    fn received_files_are_closed_before_the_final_rename() {
        let directory = std::env::temp_dir().join(format!("tooldock-lan-finalize-{}", now_nanos()));
        fs::create_dir_all(&directory).expect("test folder should be created");
        let partial = directory.join("example.txt.tooldock-part");
        let destination = directory.join("example.txt");
        let mut file = File::create(&partial).expect("partial file should be created");
        file.write_all(b"ToolDock").expect("file should be written");

        finalize_received_file(file, &partial, &destination)
            .expect("open file should be closed before rename");

        assert_eq!(
            fs::read(&destination).expect("final file should be readable"),
            b"ToolDock"
        );
        fs::remove_dir_all(&directory).expect("test folder should be removed");
    }

    #[test]
    fn production_file_handler_round_trips_and_ignores_appended_bytes() {
        let directory = std::env::temp_dir().join(format!("tooldock-lan-transfer-{}", now_nanos()));
        fs::create_dir_all(&directory).expect("test folder should be created");
        let source = directory.join("source.log");
        let receive_directory = directory.join("received");
        fs::create_dir_all(&receive_directory).expect("receive folder should be created");
        let snapshot = b"ToolDock snapshot";
        fs::write(&source, snapshot).expect("source file should be created");

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener should start");
        let port = listener
            .local_addr()
            .expect("listener address should be available")
            .port();
        let key = derive_key("transfer-test");
        let sender_device = LanDevice {
            id: "sender".into(),
            name: "Sender".into(),
            address: "127.0.0.1".into(),
            port: 1,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "sender-runtime".into(),
        };
        let receiver_device = LanDevice {
            id: "receiver".into(),
            name: "Receiver".into(),
            address: "127.0.0.1".into(),
            port,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "receiver-runtime".into(),
        };
        let request = new_request(
            &sender_device,
            &receiver_device,
            "file",
            Some("received.log".into()),
            snapshot.len() as u64,
            &key,
        );
        OpenOptions::new()
            .append(true)
            .open(&source)
            .expect("source file should open for append")
            .write_all(b" appended after metadata")
            .expect("source file should grow");

        let receiver_request_id = request.request_id.clone();
        let receiver_connection = PeerConnection {
            device: sender_device.clone(),
            key,
        };
        let connections = Arc::new(Mutex::new(HashMap::from([(
            sender_device.id.clone(),
            receiver_connection,
        )])));
        let transfers = Arc::new(Mutex::new(VecDeque::new()));
        let server_transfers = transfers.clone();
        let config = LanConfig {
            enabled: true,
            device_id: receiver_device.id.clone(),
            device_name: receiver_device.name.clone(),
            password: "unused-after-connect".into(),
            receive_dir: receive_directory.to_string_lossy().into_owned(),
        };
        let server_local = receiver_device.clone();
        let server = thread::spawn(move || {
            let (stream, address) = listener.accept().expect("receiver should accept sender");
            handle_incoming_core(
                stream,
                address,
                config,
                server_local,
                Arc::new(Mutex::new(HashMap::new())),
                connections,
                server_transfers,
                Arc::new(Mutex::new(VecDeque::new())),
                Arc::new(Mutex::new(HashMap::new())),
                &mut |_| {},
            )
            .expect("production receiver should complete the request");
        });

        let sender_connection = PeerConnection {
            device: receiver_device,
            key,
        };
        send_file_request(&sender_connection, &request, &source)
            .expect("sender should receive the completion response");
        server.join().expect("receiver thread should finish");

        assert_eq!(
            fs::read(receive_directory.join("received.log"))
                .expect("received file should be readable"),
            snapshot
        );
        let history = transfers
            .lock()
            .expect("transfer history should be available");
        let record = history
            .iter()
            .find(|record| record.id == receiver_request_id)
            .expect("receiver should record the transfer");
        assert_eq!(record.status, "completed");
        drop(history);
        fs::remove_dir_all(&directory).expect("test folder should be removed");
    }

    #[test]
    fn production_connect_then_repeated_file_transfers_round_trip() {
        let directory =
            std::env::temp_dir().join(format!("tooldock-lan-handshake-{}", now_nanos()));
        fs::create_dir_all(&directory).expect("test folder should be created");
        let source = directory.join("source.bin");
        let large_source = directory.join("source-large.bin");
        let receive_directory = directory.join("received");
        fs::create_dir_all(&receive_directory).expect("receive folder should be created");
        let payload = (0..700_000)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let large_payload = (0..8_000_123)
            .map(|index| (index % 239) as u8)
            .collect::<Vec<_>>();
        fs::write(&source, &payload).expect("source file should be created");
        fs::write(&large_source, &large_payload).expect("large source file should be created");

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener should start");
        let port = listener
            .local_addr()
            .expect("listener address should be available")
            .port();
        let sender_device = LanDevice {
            id: "sender".into(),
            name: "Sender".into(),
            address: "127.0.0.1".into(),
            port: 31_001,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "sender-runtime-1".into(),
        };
        let receiver_device = LanDevice {
            id: "receiver".into(),
            name: "Receiver".into(),
            address: "127.0.0.1".into(),
            port,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "receiver-runtime-1".into(),
        };
        let password = "shared-password";
        let config = LanConfig {
            enabled: true,
            device_id: receiver_device.id.clone(),
            device_name: receiver_device.name.clone(),
            password: password.into(),
            receive_dir: receive_directory.to_string_lossy().into_owned(),
        };
        let peers = Arc::new(Mutex::new(HashMap::new()));
        let connections = Arc::new(Mutex::new(HashMap::new()));
        let transfers = Arc::new(Mutex::new(VecDeque::new()));
        let server_peers = peers.clone();
        let server_connections = connections.clone();
        let server_transfers = transfers.clone();
        let server_local = receiver_device.clone();
        let server = thread::spawn(move || {
            let seen_requests = Arc::new(Mutex::new(HashMap::new()));
            for _ in 0..3 {
                let (stream, address) = listener.accept().expect("receiver should accept sender");
                handle_incoming_core(
                    stream,
                    address,
                    config.clone(),
                    server_local.clone(),
                    server_peers.clone(),
                    server_connections.clone(),
                    server_transfers.clone(),
                    Arc::new(Mutex::new(VecDeque::new())),
                    seen_requests.clone(),
                    &mut |_| {},
                )
                .expect("production receiver should complete the request");
            }
        });

        let access_key = derive_key(password);
        let connect_request = new_request(
            &sender_device,
            &receiver_device,
            "connect",
            None,
            0,
            &access_key,
        );
        let mut connect = connect_stream(&receiver_device).expect("sender should reach receiver");
        write_json_frame(&mut connect, &connect_request).expect("connect request should be sent");
        expect_ready(&mut connect).expect("receiver should accept the password");

        let session_key = derive_session_key(
            &access_key,
            &connect_request.request_id,
            &sender_device.id,
            &receiver_device.id,
        );
        let connection = PeerConnection {
            device: receiver_device.clone(),
            key: session_key,
        };
        let file_request = new_request(
            &sender_device,
            &receiver_device,
            "file",
            Some("received.bin".into()),
            payload.len() as u64,
            &session_key,
        );
        send_file_request(&connection, &file_request, &source)
            .expect("sender should receive the completion response");
        let large_file_request = new_request(
            &sender_device,
            &receiver_device,
            "file",
            Some("received-large.bin".into()),
            large_payload.len() as u64,
            &session_key,
        );
        send_file_request(&connection, &large_file_request, &large_source)
            .expect("sender should complete the repeated large-file transfer");
        server.join().expect("receiver thread should finish");

        assert_eq!(
            fs::read(receive_directory.join("received.bin"))
                .expect("received file should be readable"),
            payload
        );
        assert_eq!(
            fs::read(receive_directory.join("received-large.bin"))
                .expect("received large file should be readable"),
            large_payload
        );
        assert!(connections
            .lock()
            .expect("connections should be available")
            .contains_key(&sender_device.id));
        let transfer_history = transfers
            .lock()
            .expect("transfer history should be available");
        assert_eq!(transfer_history.len(), 2);
        assert!(transfer_history
            .iter()
            .all(|record| record.status == "completed"));
        drop(transfer_history);
        fs::remove_dir_all(&directory).expect("test folder should be removed");
    }

    #[test]
    fn production_connect_then_clipboard_sync_round_trip() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener should start");
        let port = listener
            .local_addr()
            .expect("listener address should be available")
            .port();
        let sender_device = LanDevice {
            id: "clipboard-sender".into(),
            name: "Clipboard Sender".into(),
            address: "127.0.0.1".into(),
            port: 31_002,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "clipboard-sender-runtime".into(),
        };
        let receiver_device = LanDevice {
            id: "clipboard-receiver".into(),
            name: "Clipboard Receiver".into(),
            address: "127.0.0.1".into(),
            port,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "clipboard-receiver-runtime".into(),
        };
        let password = "clipboard-password";
        let config = LanConfig {
            enabled: true,
            device_id: receiver_device.id.clone(),
            device_name: receiver_device.name.clone(),
            password: password.into(),
            receive_dir: std::env::temp_dir().to_string_lossy().into_owned(),
        };
        let peers = Arc::new(Mutex::new(HashMap::new()));
        let connections = Arc::new(Mutex::new(HashMap::new()));
        let clipboards = Arc::new(Mutex::new(VecDeque::new()));
        let received_text = Arc::new(Mutex::new(String::new()));
        let server_connections = connections.clone();
        let server_clipboards = clipboards.clone();
        let server_received_text = received_text.clone();
        let server_local = receiver_device.clone();
        let server = thread::spawn(move || {
            let seen_requests = Arc::new(Mutex::new(HashMap::new()));
            for _ in 0..2 {
                let (stream, address) = listener.accept().expect("receiver should accept sender");
                let received_text = server_received_text.clone();
                handle_incoming_core_with_clipboard_writer(
                    stream,
                    address,
                    config.clone(),
                    server_local.clone(),
                    peers.clone(),
                    server_connections.clone(),
                    Arc::new(Mutex::new(VecDeque::new())),
                    server_clipboards.clone(),
                    seen_requests.clone(),
                    &mut |_| {},
                    &mut |text| {
                        *received_text
                            .lock()
                            .map_err(|_| "test clipboard is unavailable".to_string())? =
                            text.to_string();
                        Ok(())
                    },
                )
                .expect("production receiver should complete the clipboard request");
            }
        });

        let access_key = derive_key(password);
        let connect_request = new_request(
            &sender_device,
            &receiver_device,
            "connect",
            None,
            0,
            &access_key,
        );
        let mut connect = connect_stream(&receiver_device).expect("sender should reach receiver");
        write_json_frame(&mut connect, &connect_request).expect("connect request should be sent");
        expect_ready(&mut connect).expect("receiver should accept the password");
        let session_key = derive_session_key(
            &access_key,
            &connect_request.request_id,
            &sender_device.id,
            &receiver_device.id,
        );
        let connection = PeerConnection {
            device: receiver_device,
            key: session_key,
        };
        let text = "ToolDock clipboard sync: こんにちは";
        send_clipboard_request(&sender_device, &connection, text)
            .expect("sender should receive the clipboard completion response");
        server.join().expect("receiver thread should finish");

        assert_eq!(
            received_text
                .lock()
                .expect("test clipboard should be available")
                .as_str(),
            text
        );
        let history = clipboards
            .lock()
            .expect("clipboard history should be available");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].direction, "incoming");
        assert_eq!(history[0].device_name, sender_device.name);
        assert!(history[0].preview.contains("ToolDock clipboard sync"));
    }

    #[test]
    fn accepted_stream_from_nonblocking_listener_waits_for_delayed_frame() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener should start");
        listener
            .set_nonblocking(true)
            .expect("listener should become nonblocking");
        let address = listener
            .local_addr()
            .expect("listener address should be available");

        let sender = thread::spawn(move || {
            let mut stream = TcpStream::connect(address).expect("sender should connect");
            thread::sleep(Duration::from_millis(80));
            write_json_frame(
                &mut stream,
                &WireResponse {
                    ok: true,
                    message: "ready".into(),
                },
            )
            .expect("sender should write a delayed frame");
        });

        let mut accepted = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("receiver should accept sender: {error}"),
            }
        };
        configure_stream(&accepted).expect("accepted stream should use blocking protocol IO");
        let response: WireResponse =
            read_json_frame(&mut accepted).expect("receiver should wait for the delayed frame");
        assert!(response.ok);
        assert_eq!(response.message, "ready");
        sender.join().expect("sender should finish");
    }

    #[test]
    fn discovery_invalidates_a_connection_from_an_old_runtime() {
        let old_device = LanDevice {
            id: "receiver".into(),
            name: "Receiver".into(),
            address: "192.168.1.20".into(),
            port: 40_001,
            password_required: true,
            last_seen_ms: now_ms(),
            connected: true,
            instance_id: "runtime-old".into(),
        };
        let peers = Arc::new(Mutex::new(HashMap::from([(
            old_device.id.clone(),
            old_device.clone(),
        )])));
        let connections = Arc::new(Mutex::new(HashMap::from([(
            old_device.id.clone(),
            PeerConnection {
                device: old_device,
                key: derive_key("password"),
            },
        )])));
        let announcement = DiscoveryAnnouncement {
            marker: "tooldock-lan".into(),
            version: super::PROTOCOL_VERSION,
            instance_id: "runtime-new".into(),
            device_id: "receiver".into(),
            device_name: "Receiver".into(),
            port: 40_002,
            password_required: true,
        };

        reconcile_discovered_peer(
            announcement,
            "192.168.1.20".parse::<IpAddr>().expect("valid IP"),
            &peers,
            &connections,
        );

        assert!(connections
            .lock()
            .expect("connections should be available")
            .is_empty());
        let peer = peers
            .lock()
            .expect("peers should be available")
            .get("receiver")
            .cloned()
            .expect("peer should remain discoverable");
        assert_eq!(peer.port, 40_002);
        assert_eq!(peer.instance_id, "runtime-new");
        assert!(!peer.connected);
    }
}
