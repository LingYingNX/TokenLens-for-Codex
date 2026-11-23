# TokenLens 官方 Codex 宿主

把 TokenLens 吞吐状态栏装进**官方 Codex 桌面应用**（不是 Codex++）。

**用法：正常启动 Codex 就行。** 后台宿主常驻，检测到 Codex 起来就自动附着并注入，
不需要任何启动器、快捷方式或额外操作。

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

## 调试端口怎么开的

CDP 注入必须先有调试端口。官方只有一个开关入口，app.asar 里的原文是：

```js
let a = env.CODEX_ELECTRON_CHROMIUM_SWITCHES?.trim();
if (buildFlavor !== Dev || !a) return [];   // 只有 Dev flavor 才读这个变量
```

所以 `setup-env.ps1` 设两个用户级环境变量：

| 变量 | 值 |
|---|---|
| `BUILD_FLAVOR` | `dev` |
| `CODEX_ELECTRON_CHROMIUM_SWITCHES` | `{"remote-debugging-address":"127.0.0.1","remote-debugging-port":"9229","remote-allow-origins":"*"}` |

### dev flavor 的两个副作用（已实测）

1. **app-server 的库换成 `.codex\sqlite\codex-dev.db`**。里面是 169 条完整线程目录，
   比 prod 的 `codex.db`（14 条近期）更全，**不丢历史**。
2. **应用内自动更新关闭**（Sparkle / Windows Store updater）。官方 asar 里
   `shouldIncludeWindowsUpdater` 只在 prod/beta/nightly 等 flavor 启用。
   微软商店的更新入口不受影响。

### 试过但走不通的路

| 方案 | 结果 |
|---|---|
| 命令行 `--remote-debugging-port` | 要改启动方式，等于换了个启动器 |
| `NODE_OPTIONS=--require` 注入 Electron main 进程 | **Electron fuse 已禁用**（`EnableNodeOptionsEnvironmentVariable = 0`），不执行 |
| `CODEX_ELECTRON_CHROMIUM_SWITCHES` 单独设 | 官方只在 Dev flavor 读，无效 |

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
5. **注入时机早到没有 `document.head`**。`Page.addScriptToEvaluateOnNewDocument` 的脚本
   在 `document.readyState === "loading"`、`document.head` 还是 `undefined` 时执行。
   `document.head?.appendChild(style)` 会静默失败，样式永久丢失，状态栏就变成竖着堆叠的裸文本。
   tokenlens.js 现在等 `DOMContentLoaded` 再装样式；宿主也会检查样式标签，
   发现「运行时在、样式不在」的半注入状态时只补样式、不重跑整个脚本。
6. **PowerShell 脚本要写 UTF-8 with BOM**。PS 5.1 按 ANSI 读无 BOM 的 UTF-8，
   中文乱码会把引号配对搞错，脚本直接语法报错。

## 安装

```powershell
pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1
```

装完得到：

- 用户级环境变量（`BUILD_FLAVOR` / `CODEX_ELECTRON_CHROMIUM_SWITCHES`）。
- 计划任务 `TokenLens Host` —— 登录 30 秒后常驻等待 Codex。

**重启 Codex**（环境变量在进程启动时读取），之后正常用就行。

卸载：`pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1 -Uninstall`

## 手动运行

```powershell
node .\standalone\tokenlens-host.mjs
```

宿主行为：

- Codex 没在跑 → 等着。
- Codex 在跑但没端口 → 提示去跑 `setup-env.ps1` 并重启，**继续等**，不退出也不打断。
- CDP 断开（Codex 被手动关掉）→ 等它回来并重新附着。
- 端口始终起不来 → 记日志后退出，**不循环重启**。

日志：`standalone/tokenlens-host.log`

## 验证

```powershell
node .\standalone\tools\check.mjs
```

对着正在运行的 Codex 跑，输出 8 项检查：

| 检查项 | 断言 |
|---|---|
| 宿主适配层已装载 | `codexPlus` / `__codexSessionDeleteBridge` 就位 |
| tokenlens.js 运行时已建立 | 运行时对象存在 |
| 状态栏没有重复实例 | DOM 里只有一份 |
| 官方事件流驱动状态栏 | 合成事件后气泡层输出 token 增长 |
| Magpie 用量源可达 | 官方 `appServices.httpFetch` 返回 200 |
| 宿主路由返回线程用量历史 | 历史行数 > 0 |
| 历史样本是单次调用量 | 最大单次调用 < 500 万（累计量会是 9000 多万） |
| 刷新后上下文占用回到真实数值 | 气泡层占用率等于 `total_tokens / contextLimit` |

第 4 项会发一条合成的用量事件（它会真的累加进本轮用量），所以最后一步会刷新页面重置内存状态。
连跑多次结果一致。
全绿退出码为 0。状态栏只在**线程页**显示，验证前先用 `tools/enter-thread.mjs` 跳到线程。

## 文件

| 文件 | 作用 |
|---|---|
| `tokenlens-host.mjs` | Node 宿主：等待/附着 Codex、CDP 注入、读 rollout 算线程历史 |
| `tokenlens-host-adapter.js` | renderer 适配层：补 `codexPlus` / `__codexSessionDeleteBridge` |
| `rollout-history.mjs` | 从 rollout 还原线程用量历史（单次调用量口径） |
| `setup-env.ps1` | 设置/撤销环境变量 |
| `install.ps1` | 安装/卸载器 |
| `start-tokenlens.cmd` | 手动启动宿主用 |
| `tools/check.mjs` | 端到端验证 |
| `tools/cdp.mjs` | 最小 CDP 客户端（只用 Node 内置 WebSocket/fetch） |
| `tools/enter-thread.mjs` | 辅助：跳到线程页（状态栏只在有 threadId 时渲染） |

## 用量历史的口径

线程用量历史来自 rollout 文件的 `token_usage_record` 事件，**必须用单次调用量**：

| rollout 字段 | 含义 | 用在哪 |
|---|---|---|
| `usage` | 单次调用量 | TOP3、柱状图、每轮统计 |
| `turn_id` | 轮次归属 | 分轮聚合 |
| `thread_token_usage` | 线程累计量 | `contextUsed`（上下文占用） |
| `token_count.info.model_context_window` | 上下文窗口 | `contextLimit` |

`/thread-usage-live` 的「上下文占用」同样用**单次调用量**（44 万），
不是线程累计量（9167 万）。用累计量会让占用率直接顶到 100%。

**不能用 `token_count.info.total_token_usage`** —— 那是整个线程的累计量
（该线程已到 9167 万）。喂给 tokenlens.js 会让 TOP3 显示「9167.95万」这种
不可能的单次调用，柱状图刻度顶到 10240 万。这个坑踩过一次，`tests/rollout-history.test.js` 钉住了它。

## 已知限制

- 宿主读磁盘 rollout 文件算线程用量历史，等于 Codex++ 旧宿主的 `/thread-usage-history` 行为；
- 计划任务每分钟拉一次宿主，宿主本身常驻等待 Codex（`MultipleInstances=IgnoreNew` 保证不重复）。
  压缩切换后分段历史仍可能不全。
- Magpie 用量完全依赖 `http://127.0.0.1:3425` 在跑；没起来时状态栏的用量区显示空。
- 状态栏只在**线程页**显示（tokenlens.js 要求有 threadId），首页不显示，这是插件原有行为。
- 注入需要本地调试端口，只监听 127.0.0.1。介意的话别用这个方案。
- dev flavor 下 Codex 应用内不弹更新提示，得从微软商店更新。
  原因是官方把 Dev 排除在更新器白名单外（app.asar 里是
  `[Nightly, InternalAlpha, PublicBeta, Prod]`），不是本方案关掉的。
- 状态栏只在**线程页**显示（tokenlens.js 要求有 threadId），首页不显示 —— 这是插件原有行为，
  2026-11-23 已确认保留。
