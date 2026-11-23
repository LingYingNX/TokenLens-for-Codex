# TokenLens 官方 Codex 宿主

把 TokenLens 吞吐状态栏装进**官方 Codex 桌面应用**（不是 Codex++）。

## 为什么需要这一层

Codex++ 宿主本体已被删除（2026-10-22），而官方 Codex 没有 UserScript 扩展点：
app.asar 里搜不到 `user_scripts` / `userscript`，插件系统只有 `.codex-plugin/plugin.json`
（skills / hooks / mcp），没有前端 DOM 注入类型。所以 `tokenlens.js` 只能靠 CDP 注入。

官方 Codex 原生提供了 tokenlens.js 需要的大部分能力：

| tokenlens.js 依赖 | 官方 Codex 现状 |
|---|---|
| `appServices.httpFetch` 取 Magpie 用量 | 有。webpack 模块 `GaA7`，tokenlens.js 自带解析器已能找到 |
| `thread/tokenUsage/updated` 等事件流 | 有。官方通过 `mcp-notification` 推给 renderer |
| 线程 ID（DOM） | 有。`[data-above-composer-conversation-id]` |
| `window.codexPlus.call` 路由 | **没有** |
| `window.__codexSessionDeleteBridge` | **没有** |

适配层 `tokenlens-host-adapter.js` 只补这两条路由，tokenlens.js 本体一行不改。

## 踩过的坑（别再踩）

1. **启动目标必须是 `ChatGPT.exe`**。`Codex.exe` 只有 20KB，是 windows-update trampoline，
   给它 `--remote-debugging-port` 不会有任何效果，端口永远起不来。
2. **失败绝不重试启动**。旧实现是「端口没就绪 → 杀 Codex → 再启动」的无限循环，
   这就是「启动几秒后 Codex 闪退」的真正原因：Codex 是被 `Stop-Process` 主动杀的，
   Windows 事件日志里没有它的崩溃记录。
3. **注入必须幂等**。tokenlens.js 没有自带幂等守卫，重复 evaluate 会渲染双份状态栏。
   宿主在 `activate()` 前先检查 `window.__codexPlusThroughputStatusLineRuntime`。
4. **不要覆盖 `window.electronBridge`**。官方 bridge 明确拒绝裸 fetch：
   「HTTP requests must use the HTTP fetch service.」覆盖它只会破坏宿主自己的通道。

## 用法

### 安装

```powershell
powershell -ExecutionPolicy Bypass -File .\standalone\install.ps1
```

装完得到：

- 桌面快捷方式 **TokenLens Codex** —— 双击即启动 Codex 并注入 TokenLens。
- 计划任务 **TokenLens Host** —— 登录 30 秒后附着到已运行的 Codex。

卸载：`powershell -ExecutionPolicy Bypass -File .\standalone\install.ps1 -Uninstall`

### 手动运行

```powershell
node .\standalone\tokenlens-host.mjs
```

宿主行为：

- Codex 没在跑 → 用调试端口启动它。
- Codex 在跑但没调试端口 → **不打断它**，只提示你用桌面快捷方式重启。
- CDP 断开（Codex 被你手动关掉）→ 等它回来并重新附着。
- 端口始终起不来 → 记录日志后退出，**不循环重启**。

日志：`standalone/tokenlens-host.log`

### 验证

```powershell
node .\standalone\tools\check.mjs
```

对着正在运行的 Codex 跑，输出 6 项检查（适配层、运行时、单实例、事件链、Magpie、线程历史）。
全绿退出码为 0。状态栏只在**线程页**显示，验证前先用 `tools/enter-thread.mjs` 跳到线程。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `TOKENLENS_CDP_PORT` | `9229` | CDP 端口 |

## 文件

| 文件 | 作用 |
|---|---|
| `tokenlens-host.mjs` | Node 宿主：启动/附着 Codex、CDP 注入、读 rollout 算线程历史 |
| `tokenlens-host-adapter.js` | renderer 适配层：补 `codexPlus` / `__codexSessionDeleteBridge` |
| `start-tokenlens.cmd` | 启动器 |
| `install.ps1` | 安装/卸载器 |
| `tools/check.mjs` | 端到端验证：对着正在运行的 Codex 查状态栏、事件链、用量源 |
| `tools/cdp.mjs` | 最小 CDP 客户端（只用 Node 内置 WebSocket/fetch） |
| `tools/enter-thread.mjs` | 辅助：跳到线程页（状态栏只在有 threadId 时渲染） |

## 已知限制

- 宿主读磁盘 rollout 文件算线程用量历史，等于 Codex++ 旧宿主的 `/thread-usage-history` 行为；
  压缩切换后分段历史仍可能不全。
- Magpie 用量完全依赖 `http://127.0.0.1:3425` 在跑；没起来时状态栏的用量区显示空。
- 状态栏只在**线程页**显示（tokenlens.js 要求有 threadId），首页不显示，这是插件原有行为。
- 注入需要 `--remote-debugging-port`，等于开了本地调试端口。只监听 127.0.0.1，
  且 `--remote-allow-origins=*` 只对本地 CDP 生效。介意的话别用这个方案。
