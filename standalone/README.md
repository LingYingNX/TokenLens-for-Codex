# TokenLens Standalone（不装 Codex++ 也能用）

给**没有 Codex++** 的 Codex Desktop 用的注入器。插件本体仍是仓库根目录的 `tokenlens.js`，本目录只提供宿主替身。

## 它做什么

1. 用 `--remote-debugging-port=9229` 启动 Codex Desktop（Electron）。
2. 通过 CDP 把 `tokenlens-shim.js` + `tokenlens.js` 注入 `app://-/index.html`。
3. 常驻：页面重载自动重注；滚动读取 `%USERPROFILE%\.codex\sessions\**\*.jsonl`，把 `task_started` / `task_complete` / `token_count` / `item_completed` 合成为插件认识的 `turn/*`、`thread/tokenUsage/updated`、`item/completed` 通知，再 `window.postMessage` 送进页面。
4. 代理 `window.electronBridge` 的 HTTP 请求（Magpie 用量），并实现插件用到的 `/settings/get`、`/thread-usage-history` 路由。

## 文件

| 文件 | 作用 |
|------|------|
| `tokenlens-shim.js` | 注入前置：补 `window.codexPlus` 与 `window.electronBridge` |
| `tokenlens-host.ps1` | 常驻宿主：启动/附加 Codex、CDP 注入、rollout 事件合成、HTTP/RPC 桥 |
| `start-tokenlens.cmd` | 双击启动：带调试端口重启 Codex 并注入 |
| `install.ps1` | 注册登录自启计划任务 + 桌面快捷方式（`-Uninstall` 卸载） |
| `tokenlens-host.log` | 运行日志（自动生成） |

## 安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\codex目录\codex任务仪表盘\standalone\install.ps1"
```

然后**完全退出 Codex**，双击桌面 `TokenLens Codex`。之后每次登录会自动以附加模式启动，Codex 用自带快捷方式启动时不会带调试端口，需要改用它。

卸载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\codex目录\codex任务仪表盘\standalone\install.ps1" -Uninstall
```

## 安全提示

`--remote-debugging-port` 会让**本机任意进程**都能连上 Codex 渲染页并执行任意 JS。只在可信机器上用；不用时删掉计划任务并正常启动 Codex。

## 与 Codex++ 版的差异

| 项 | Codex++ 版 | Standalone 版 |
|---|---|---|
| 用量/缓存/账本 | 原生 | 同（Magpie HTTP 直连） |
| 柱状图 / TOP 3 / 本轮调用 | 原生 | 同（由 rollout 的 `token_count` 回填） |
| 工具耗时 | 原生事件 | 由 `item_completed` 的 `started_at_ms` / `completed_at_ms` 计算 |
| tok/s | 逐 delta 解码窗口 | 由相邻 `token_count` 的间隔推算，**是近似值**，精度低于 Codex++ |
| 上下文窗口 | `/thread-usage-live` | 取 `token_count` 的 `model_context_window`，无实时增量 |
| 页面刷新 | 宿主重注 | 常驻进程重注 |

## 已知限制

- 必须由本脚本启动 Codex（或改快捷方式带 `--remote-debugging-port`），否则拿不到注入面。
- 只读本地文件与 `127.0.0.1:3425`，不上传任何内容。
- Codex 升级改动 rollout 事件格式或页面 URL 时，先坏的是 `tokenlens-host.ps1` 的事件映射。