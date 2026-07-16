# ToolDock

[English](README.md) | **简体中文** | [日本語](README.ja.md)

ToolDock 是一个在本机运行的跨平台开发者桌面工具箱，支持 Windows、macOS 和 Linux，不需要账号，也不会安装后台服务。

## 功能

- **屏幕取色**：通过跨屏遮罩、单一跟随鼠标的放大镜获取颜色，完成后自动复制色值；按 `Esc` 可以取消。
- **端口进程管理**：查询端口占用进程，查看 PID、命令和内存信息，确认后可批量结束。
- **截图**：支持完整显示器或跨屏自由框选区域，保存为 PNG、自动写入剪贴板，并显示最近截图历史。
- **屏幕录制**：录制显示器、自定义区域或独立应用窗口，实时显示捕获画面，保存为 H.264 MP4，并显示录屏历史。
- **安全字符串生成**：生成指定长度的随机字符串、HEX、数字、符号组合和 UUID v4。
- **外观与存储设置**：在侧栏切换深色/浅色主题，设置媒体目录和全局快捷键，并可选择关闭后隐藏到系统托盘。

侧栏还提供可选的 RouteMarket.ai 与 RouteMarket Tools 入口。链接会携带 UTM 活动参数并在系统浏览器中打开；点击链接不会上传 ToolDock 中的截图、录屏、色值或进程数据。

## 是否需要安装

放到 GitHub Releases 后，建议采用“主流平台提供标准安装包，Linux 同时提供便携版”的方式：

| 平台 | 文件 | 建议 |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | 推荐，提供开始菜单和标准卸载入口。 |
| macOS Apple Silicon | `.dmg` | 推荐，适用于 M1 及更新的 Mac。 |
| macOS Intel | `.dmg` | 推荐，适用于 Intel Mac。 |
| Linux x64 | `.AppImage` | 免安装便携版。 |
| Linux x64 | `.deb` | 适用于 Debian、Ubuntu 等系统的安装版。 |

这样既符合 Windows/macOS 用户的使用习惯，也保留 Linux 免安装运行的选择。首批公开构建如果没有商业代码签名，系统可能会显示安全提示。

## 使用方法

### 屏幕取色

1. 打开“取色器”。
2. 点击“从屏幕取色”。
3. ToolDock 会暂时隐藏主窗口，并显示全桌面半透明遮罩与跟随鼠标的放大镜。
4. 点击屏幕像素完成取色，或按 `Esc` 取消。
5. 色值会自动写入剪贴板，也可以在结果区域再次复制 HEX 或 RGB。

### 查询并结束端口进程

1. 打开“端口进程”。
2. 输入用逗号或空格分隔的端口，也可以输入 `8000-8010` 这样的范围。
3. 点击“查询”。
4. 检查进程名、PID、状态、启动命令和内存占用。
5. 勾选一个或多个进程，点击“结束所选”并再次确认。

受系统保护或以更高权限运行的进程，需要 ToolDock 具备相同权限才能结束。结束进程前请确认 PID。

### 截图

1. 打开“截图”。
2. 选择“完整显示器”或“选择区域”。
3. 选择显示器和可选的延时时间。
4. 区域截图会隐藏主窗口，并在所有显示器上显示遮罩；拖动鼠标选择矩形区域。
5. 截图保存后会自动写入剪贴板，可直接粘贴到聊天或图片编辑器。
6. 页面下方的“截图历史”会显示最近保存的图片。

默认保存到 `图片/ToolDock`。可在“设置”中修改截图文件夹。

### 屏幕录制

1. 安装 FFmpeg，并确保命令行可以找到 `ffmpeg`。
2. 打开“屏幕录制”。
3. 选择显示器、自定义区域或应用窗口，并设置输出分辨率、帧率和码率。
4. 点击“开始录制”，左侧会实时显示当前捕获画面。
5. 完成后点击“停止并保存”，结果会出现在页面下方的录屏历史中。

默认保存到 `视频/ToolDock`。可在“设置”中修改录屏文件夹。如果 FFmpeg 位于自定义目录，请在启动 ToolDock 前将环境变量 `TOOLDOCK_FFMPEG` 设置为 FFmpeg 可执行文件的完整路径。

### 生成字符串

1. 打开“字符串生成”。
2. 选择字母数字、仅字母、仅数字、HEX 或 UUID v4。
3. 设置长度和数量。
4. 根据需要开启符号。
5. 生成后复制单条结果或全部结果。

## 设置

左下角的主题按钮可以立即切换深色和浅色模式，选择会在重启后保留。

打开“设置”可以配置：

- 截图保存文件夹，同时也是截图历史的读取目录。
- 屏幕录制保存文件夹，同时也是录屏历史的读取目录。
- 取色、区域截图与开始/停止录屏的全局快捷键。
- 关闭窗口时退出程序，或隐藏到系统托盘。

保存媒体文件时，不存在的目录会自动创建。

## 系统权限

- **Windows**：需要 WebView2。结束管理员进程时，可能需要以管理员身份运行 ToolDock。
- **macOS**：取色、截图和录屏需要“屏幕录制”权限；取色还可能需要“输入监控”权限。
- **Linux**：X11 支持最完整；Wayland 行为取决于桌面环境、合成器和 Portal。录屏还需要可用的 PipeWire。

## FFmpeg

录屏使用外部 FFmpeg 完成 H.264 编码。项目不直接打包 FFmpeg，以避免显著增加安装包体积，并让发布者自行完成相应的许可证审查。

ToolDock 会按顺序查找：

1. `TOOLDOCK_FFMPEG`
2. `PATH` 中的 `ffmpeg`
3. 应用程序旁的常见可执行文件位置

没有 FFmpeg 时，截图、取色、端口管理和字符串生成仍可正常使用。

## 本地开发

环境要求：

- Node.js 22
- Rust stable
- 当前操作系统对应的 Tauri 2 系统依赖
- 测试录屏功能时需要 FFmpeg

```bash
npm ci
npm run desktop:dev
```

仅在浏览器中预览界面：

```bash
npm run dev
```

运行全部本地检查：

```bash
npm run check
```

构建当前系统的桌面安装包：

```bash
npm run desktop:build
```

原生安装包必须在对应操作系统中构建。

## CI 与发布

- `.github/workflows/ci.yml` 会检查版本、构建前端、验证 Rust 格式，并在 Windows、macOS、Linux 上执行原生检查。
- `.github/workflows/release.yml` 会构建 Windows NSIS、macOS DMG、Linux AppImage 和 Linux DEB。
- `.github/workflows/pages.yml` 会将 `website/` 中的多语言静态项目页发布到 GitHub Pages。
- 推送类似 `v0.2.0` 的 Tag 后，会创建 GitHub Draft Release，检查产物后再手动发布。

发布前请确保 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的版本一致，并更新 `CHANGELOG.md`。

详细步骤见[发布说明](docs/RELEASING.md)。

## 目录结构

```text
.
|-- .github/workflows/   # CI 与发布自动化
|-- public/              # 静态资源
|-- scripts/             # 仓库维护脚本
|-- src/                 # React 界面
|-- src-tauri/           # Rust 原生层与 Tauri 配置
|-- website/             # 多语言 GitHub Pages 项目页
|-- README.md            # 英文文档
`-- README.ja.md         # 日文文档
```

## 贡献与安全

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

ToolDock 基于 [MIT License](LICENSE) 开源。
