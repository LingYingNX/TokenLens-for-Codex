# TokenLens for Codex（官方桌面版）

把 TokenLens 的吞吐状态栏装进**官方 Codex 桌面应用**（微软商店的 MSIX 版）。

装完以后：**用任何方式启动 Codex**（开始菜单、桌面图标、任务栏、`codex://` 链接），
状态栏都会自动出现在输入框下方，不需要额外操作，也不需要改你的启动习惯。

---

## 它长什么样

在对话框输入区下方显示一行：`12 tok/s · 93.0%`。点它可以展开面板，看缓存命中、
上下文占用、工具耗时、逐次调用图表、TOP3 输出、每轮均值、以及按天的用量日历。

状态栏**只在具体会话页显示**；首页（"和 Codex 一起工作"）没有当前会话，按设计不显示。

---

## 前置要求

| 项 | 要求 | 检查方法 |
|---|---|---|
| 系统 | Windows 10 / 11 | — |
| Codex | **微软商店版**（MSIX 安装，包名 `OpenAI.Codex`） | `Get-AppxPackage OpenAI.Codex` 有输出 |
| Node.js | 18 或更高（用于后台宿主） | `node -v` 有输出 |
| PowerShell | 5.1 或 7（系统自带就有） | — |

> Codex 必须是商店版。从第三方下载的绿色版/安装包版本目录结构不同，本方案不适用。

---

## 安装

### 1. 拿到仓库

```powershell
git clone https://github.com/LingYingNX/TokenLens-for-Codex.git
cd TokenLens-for-Codex
git checkout standalone-injector
```

没有 git 的话，在 GitHub 上切到 `standalone-injector` 分支，下载 ZIP 解压也行。

### 2. 运行安装器

在仓库根目录执行：

```powershell
pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1

# 如果机器上没有 pwsh（PowerShell 7），用这个：
powershell -ExecutionPolicy Bypass -File .\standalone\install.ps1
```

安装器做三件事：

1. 设置两个**用户级**环境变量（`BUILD_FLAVOR=dev` + 调试端口开关）。
2. 注册计划任务 `TokenLens Host`：登录时启动，之后每分钟确认一次在跑。
3. 把桌面快捷方式还原成官方原样（本方案不需要改快捷方式）。

不需要管理员权限。

### 3. 重启 Codex

**完全退出** Codex（右键任务栏图标 → 退出，或任务管理器结束 `ChatGPT.exe`），
然后照平时的方式启动。

环境变量只在进程启动时读取，所以不彻底退出是没用的 —— 这是最常见的"装了没反应"。

---

## 验证装好了

```powershell
node .\standalone\tools\check.mjs
```

对着正在运行的 Codex 执行，会输出 8 项检查：

| 检查项 | 说明 |
|---|---|
| 宿主适配层已装载 | 注入层就位 |
| tokenlens.js 运行时已建立 | 插件在跑 |
| 状态栏没有重复实例 | 没被重复注入 |
| 官方事件流驱动状态栏 | 能吃到用量事件 |
| Magpie 用量源可达 | 可选的本地用量服务（没有就跳过） |
| 宿主路由返回线程用量历史 | 能从会话记录里读出历史 |
| 历史样本是单次调用量 | 数值口径正确 |
| 刷新后上下文占用回到真实数值 | 刷新后能自愈 |

全绿退出码 0。**状态栏只在会话页显示**，如果检查时停在首页，先跑
`node .\standalone\tools\enter-thread.mjs` 让人帮你点进第一个会话。

也可以直接肉眼看：随便打开一个已存在的对话，输入框下方应该有一行 `xx tok/s · yy%`。

---

## 日常使用

- 正常用 Codex 就行，不用管后台。
- 后台宿主是一个隐藏的 node 进程，**不会有黑窗口**。
- 日志在 `standalone/tokenlens-host.log`，出问题先看它。
- Codex 更新后插件自动继续工作（注入不依赖改安装目录）。

---

## 卸载

```powershell
pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1 -Uninstall
```

会清掉计划任务、两个环境变量，并还原桌面快捷方式。之后重启 Codex 即恢复原样。

---

## 它是怎么工作的（以及代价）

官方 Codex **没有任何前端扩展点** —— `app.asar` 里搜不到 `user_scripts`，
插件系统只有 `.codex-plugin/plugin.json`（skills / hooks / mcp），没有 DOM 注入类型。
所以只能走 Chromium 的调试协议（CDP）把脚本注进渲染进程。

完整链路：

```
环境变量 → Codex 自己开本地调试端口 9229（只监听 127.0.0.1）
        → 计划任务常驻的 Node 宿主发现端口 → CDP 附着
        → 注入适配层 + tokenlens.js → 状态栏出现
```

### 为什么必须 `BUILD_FLAVOR=dev`

官方只在一个地方读调试开关，而且硬绑 Dev 分支。`app.asar` 原文：

```js
let a = env.CODEX_ELECTRON_CHROMIUM_SWITCHES?.trim();
if (buildFlavor !== Dev || !a) return [];      // 只有 Dev 才读
```

### 代价：应用内更新器停摆

Dev 不在官方更新器白名单里：

```js
f = [Nightly, InternalAlpha, PublicBeta, Prod]
g = (e,t,r,n) => "false" !== n.CODEX_SPARKLE_ENABLED && f.includes(e) && t === r
```

所以 `enableUpdater=false`，Codex 不会再自己提示/执行更新。
**这不是本方案关掉的，是 Dev 分支的设计结果。**

微软商店更新照常：应用是 MSIX 包，由商店和 Windows 负责升级，与 flavor 无关。

另一个副作用：Codex 的会话索引库会切到 `codex-dev.db`。实测里面是完整线程目录
（本机 169 条，比 prod 库的 14 条更全），不丢历史。

### 试过但走不通的路

| 方案 | 结果 |
|---|---|
| 桌面快捷方式带上调试参数 | 只有从快捷方式启动才有效；开始菜单/任务栏走 AUMID 会丢掉参数，且混用两种入口会开出两个窗口 |
| `NODE_OPTIONS=--require` 注入 Electron 主进程 | Electron fuse `EnableNodeOptionsEnvironmentVariable` 是关闭的，文件根本不加载 |
| 只设 `CODEX_ELECTRON_CHROMIUM_SWITCHES` 不设 flavor | 官方只在 Dev 下读，无效 |
| 改 `app.asar` | `WindowsApps` 目录属 TrustedInstaller，且开了完整性校验 |
| 改 `AppxManifest.xml` | 包已签名 |
| 进程启动触发（审计 + 计划任务） | 要另开审计策略，还得在 Codex 起来后杀掉重开 |
| 应用内浏览器 CDP / app-server websocket | 拿不到渲染进程 DOM，注不进去 |

---

## 常见问题

**装了没反应？**
先确认 Codex 是**完全退出后重新启动**的（环境变量只在启动时读取）。
再看 `standalone/tokenlens-host.log` 最后几行有没有「已连接 app://-/index.html」「TokenLens 已注入」。

**首页看不到状态栏？**
正常。首页没有当前会话，插件按设计只在会话页显示。随便打开一个对话就能看到。

**状态栏出现两个？**
说明注入了两次。重启计划任务即可：
`Stop-ScheduledTask 'TokenLens Host'; Start-ScheduledTask 'TokenLens Host'`。
宿主本身有幂等守卫，正常不会发生。

**端口 9229 被占用？**
换端口：改 `standalone/setup-env.ps1` 里的 `remote-debugging-port`，同时设环境变量
`TOKENLENS_CDP_PORT`，然后重跑 `install.ps1`。

**不想让应用内更新停摆？**
那就只能牺牲「任意入口都有插件」：本仓库历史提交 `76395d0` 是另一条路线
（桌面快捷方式指向 MSIX 执行别名 + 命令行参数，保持 prod flavor），
代价是只有从那个快捷方式启动才有插件。两者不可兼得。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `install.ps1` | 安装 / 卸载（`-Uninstall`） |
| `setup-env.ps1` | 单独设置 / 撤销环境变量 |
| `tokenlens-host.mjs` | 后台宿主：等端口 → CDP 附着 → 注入 |
| `tokenlens-host.vbs` | 无窗口启动宿主（计划任务和手动启动都走它） |
| `tokenlens-host-adapter.js` | 渲染进程适配层，只补官方缺的两条路由 |
| `rollout-history.mjs` | 从会话记录还原线程用量历史 |
| `start-tokenlens.cmd` | 手动启动宿主（也走 VBS，不弹窗） |
| `tools/check.mjs` | 端到端验证（8 项） |
| `tools/enter-thread.mjs` | 辅助：确保停在会话页 |
| `tools/cdp.mjs` | 最小 CDP 客户端（只用 Node 内置 WebSocket） |
| `tokenlens-host.log` | 运行日志 |

插件本体是仓库根目录的 `tokenlens.js`（单文件 UserScript，宿主无关）。
