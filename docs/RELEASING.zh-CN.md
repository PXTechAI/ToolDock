# ToolDock 发布与 Apple 签名

ToolDock 的 macOS Release 必须使用 `Developer ID Application` 证书签名，并
提交 Apple notarization。GitHub Actions 从 `release-signing` Environment
读取凭据，仓库本身可以保持 Public。

## 1. 创建 Developer ID Application 证书

1. 在 Mac 上打开“钥匙串访问”。
2. 选择“证书助理” -> “从证书颁发机构请求证书”。
3. 输入 Apple 开发者账号邮箱，选择“存储到磁盘”，生成 CSR。
4. 打开 Apple Developer 网站的 Certificates 页面。
5. 新建 `Developer ID Application` 证书并上传 CSR。
6. 下载证书并双击安装到钥匙串。
7. 在“我的证书”中找到 `Developer ID Application: 名称 (TEAM_ID)`。
8. 展开证书，确认下方存在对应私钥。
9. 右键导出为 `ToolDock-Developer-ID.p12`，设置一个强密码。

证书必须包含私钥。只有 `.cer` 文件不能用于 CI 签名。

## 2. 准备 Apple notarization 凭据

1. 登录 Apple Account 网站。
2. 在“登录与安全”中创建 App-Specific Password。
3. 记录 Apple ID 邮箱、App-Specific Password 和 Team ID。

这里的 `APPLE_PASSWORD` 必须是 App-Specific Password，不是 Apple
账号登录密码。

## 3. 创建 GitHub Environment

打开仓库：

`Settings` -> `Environments` -> `New environment`

环境名称必须是：

```text
release-signing
```

建议启用 Required reviewers，然后在 Environment secrets 中创建：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | `.p12` 文件的单行 Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | Apple 开发者账号邮箱 |
| `APPLE_PASSWORD` | App-Specific Password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

在 Mac 上生成 `.p12` 的单行 Base64：

```bash
openssl base64 -A -in ToolDock-Developer-ID.p12 | pbcopy
```

将剪贴板内容作为 `APPLE_CERTIFICATE` 的值。不要把 `.p12`、私钥或密码
提交到 Git 仓库。Release 工作流会把证书导入一次性的临时钥匙串，自动
识别 `Developer ID Application` 签名身份，并在构建结束后删除钥匙串。

## 4. 发布

确认 `package.json`、`src-tauri/Cargo.toml` 和
`src-tauri/tauri.conf.json` 中的版本一致，然后创建并推送 Tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release 工作流会：

1. 准备并校验对应平台的 FFmpeg sidecar。
2. 构建 Windows、Linux 和两种 macOS 架构。
3. 使用 Developer ID Application 签署 macOS 应用及嵌套可执行文件。
4. 将应用提交 Apple notarization。
5. 完成 notarization ticket 的 stapling。
6. 运行 `codesign`、Gatekeeper 和 stapling 自动校验。
7. 创建 GitHub Draft Release。

发布前应在一台没有开发证书的 Mac 上验证：

```bash
spctl --assess --type execute --verbose ToolDock.app
codesign --verify --deep --strict --verbose=2 ToolDock.app
xcrun stapler validate ToolDock.app
```

## 5. 证书更新

Developer ID 证书或 App-Specific Password 更新后，只需替换
`release-signing` Environment 中对应的 Secret，不需要修改仓库代码。
