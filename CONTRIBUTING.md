# Contributing to ToolDock

[English](#english) | [简体中文](#简体中文) | [日本語](#日本語)

## English

Thank you for contributing. Keep changes focused on small, repeatable developer workflows.

1. Create a branch from `develop`.
2. Install dependencies with `npm ci`.
3. Run the desktop app with `npm run desktop:dev`.
4. Before opening a pull request, run `npm run check`.
5. Describe platform-specific behavior and permissions in the pull request.

Do not include private process lists, file paths, tokens, screenshots, or credentials in issues and logs.

## 简体中文

感谢参与贡献。请优先解决明确、重复出现的开发者工作流问题，避免把工具扩展成无限制执行系统命令的平台。

1. 从 `develop` 创建功能分支。
2. 使用 `npm ci` 安装依赖。
3. 使用 `npm run desktop:dev` 启动桌面应用。
4. 提交 Pull Request 前运行 `npm run check`。
5. 在 Pull Request 中说明受影响的平台、权限和测试结果。

请勿在 Issue 或日志中提交私有进程列表、文件路径、令牌、截图或账号凭据。

## 日本語

コントリビューションありがとうございます。変更は、明確で繰り返し発生する開発作業に集中させてください。

1. `develop` から作業ブランチを作成します。
2. `npm ci` で依存関係をインストールします。
3. `npm run desktop:dev` でデスクトップアプリを起動します。
4. Pull Request を作成する前に `npm run check` を実行します。
5. 対象OS、必要な権限、確認結果を Pull Request に記載します。

Issue やログに、非公開のプロセス一覧、ファイルパス、トークン、スクリーンショット、認証情報を含めないでください。
