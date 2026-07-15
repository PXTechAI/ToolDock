# 发布流程

GitHub Release workflow 会在推送 `v*` Tag 时自动运行，并创建一个 Draft Release。

## 1. 更新版本

以下三个文件中的版本必须完全一致：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

然后运行：

```bash
npm run check:versions
```

## 2. 更新日志

将 `CHANGELOG.md` 中 `[Unreleased]` 的内容移动到新版本标题下，并填写发布日期。

## 3. 本地验证

```bash
npm ci
npm run check
npm run desktop:build
```

## 4. 创建 Tag

版本 `0.2.0` 对应 Tag `v0.2.0`：

```bash
git tag -a v0.2.0 -m "ToolDock v0.2.0"
git push origin v0.2.0
```

## 5. 检查并发布

Actions 完成后：

1. 打开 GitHub Releases。
2. 找到自动创建的 Draft Release。
3. 检查 Windows、macOS Intel、macOS Apple Silicon 和 Linux 产物。
4. 补充发布说明。
5. 手动点击 Publish release。

## 签名

默认 CI 生成未签名的 Windows/Linux 包和使用 ad-hoc 签名的 macOS 包，适合内部测试。公开分发前，建议配置 Windows 代码签名以及 Apple Developer ID 签名和公证。
