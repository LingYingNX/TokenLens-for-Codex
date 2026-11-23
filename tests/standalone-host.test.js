// standalone 宿主契约测试。
//
// 这些断言直接钉住「Codex 闪退」和「插件未生效」两个回归：
//   1. 宿主绝不调用 Stop-Process / kill 杀 Codex（旧实现正是这么把 Codex 杀到闪退的）
//   2. 宿主启动目标是 ChatGPT.exe，不是 Codex.exe（Codex.exe 是 20KB trampoline，带调试端口参数也起不来）
//   3. 适配层提供 tokenlens.js 需要的宿主路由，且不破坏官方 electronBridge
//   4. 适配层能自己找到官方 appServices.httpFetch

const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repo = path.resolve(__dirname, "..");
const hostPath = path.join(repo, "standalone", "tokenlens-host.mjs");
const adapterPath = path.join(repo, "standalone", "tokenlens-host-adapter.js");
const launcherPath = path.join(repo, "standalone", "start-tokenlens.cmd");

const host = readFileSync(hostPath, "utf8");
const adapter = readFileSync(adapterPath, "utf8");
const launcher = readFileSync(launcherPath, "utf8");

test("宿主绝不杀 Codex 进程", () => {
  assert.doesNotMatch(host, /Stop-Process/i, "宿主不得调用 Stop-Process");
  assert.doesNotMatch(host, /process\.kill/i, "宿主不得调用 process.kill");
  assert.doesNotMatch(host, /taskkill/i, "宿主不得调用 taskkill");
  assert.doesNotMatch(host, /CloseMainWindow/i, "宿主不得请求关闭 Codex 主窗口");
});

test("宿主不自己启动 Codex，只附着等待", () => {
  // 用户要的是「正常启动 Codex 后脚本在后台生效」，不是换一种启动方式。
  // 调试端口由桌面快捷方式的启动参数打开，宿主只负责等端口出现后附着。
  assert.doesNotMatch(host, /spawn\(/, "宿主不得自己启动 Codex 进程");
  assert.doesNotMatch(host, /launchCodex/, "不得保留代启 Codex 的函数");
  assert.match(host, /等待 Codex 启动/, "宿主必须等待 Codex 出现");
});

test("调试端口参数由启动配置提供", () => {
  // 端口不在宿主命令行里（那会改变启动方式），而是写进桌面快捷方式的参数。
  const setup = readFileSync(path.join(repo, "standalone", "setup-launcher.ps1"), "utf8");
  assert.match(setup, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(setup, /--remote-debugging-port=9229/);
  assert.match(setup, /--remote-allow-origins=\*/);
});

test("宿主不会因为 Codex 未启动而退出", () => {
  // 宿主先于 Codex 启动是常态（开机自启）。它必须一直等，不能误判后退出。
  assert.doesNotMatch(host, /Codex 已在运行但没有调试端口。.*\n.*process\.exitCode/s, "不得因检测到 Codex 在跑就退出");
  assert.match(host, /宿主继续等待/, "检测到 Codex 在跑但没端口时应继续等待");
  assert.doesNotMatch(host, /host error:/, "不得再有旧版的无限重试错误分支");
});

test("宿主检测 Codex 是否在运行但绝不干预它", () => {
  assert.match(host, /async function codexRunning\(\)/);
  assert.match(host, /async function codexHasDebugPort\(\)/, "必须能判断端口是否已开");
});

test("宿主支持 CDP 断线后重新附着", () => {
  assert.match(host, /会话结束/);
  assert.match(host, /等待 Codex 重新启动以便再次附着/);
});

test("宿主注入是幂等的", () => {
  // tokenlens.js 没有自带幂等守卫，重复 evaluate 会渲染双份状态栏。
  assert.match(host, /__codexPlusThroughputStatusLineRuntime/, "重复注入前必须先检查运行时是否已存在");
  assert.match(host, /async function register\(cdp, session\)/);
  assert.match(host, /async function activate\(cdp\)/);
  // 守卫现在同时看运行时和样式：运行时在、样式不在 = 半注入，要补样式。
  assert.match(host, /state\?\.runtime === true && state\?\.style === true/, "运行时与样式都在才跳过重复注入");
});

test("宿主路由实现了线程用量历史", () => {
  assert.match(host, /\/thread-usage-history/, "必须实现 /thread-usage-history");
  assert.match(host, /readThreadUsageHistory/, "必须调用历史解析模块");
  assert.match(host, /import \{ readThreadUsageHistory \} from "\.\/rollout-history\.mjs"/, "历史解析必须在独立模块里");
});

test("宿主不用 token_count 的累计量当单次调用量", () => {
  // 踩过的坑：token_count.info.total_token_usage 是线程累计量（该线程已到 9167 万），
  // 喂给 tokenlens.js 会让 TOP3 显示「9167.95万」这种不可能的单次调用。
  assert.doesNotMatch(host, /total_token_usage/, "宿主不得使用累计量当单次调用量");
  assert.doesNotMatch(host, /token_count/, "宿主不得解析 token_count 事件");
});

test("适配层提供 tokenlens.js 依赖的宿主路由", () => {
  assert.match(adapter, /window\.codexPlus/, "必须提供 window.codexPlus");
  assert.match(adapter, /window\.__codexSessionDeleteBridge/, "必须提供 __codexSessionDeleteBridge");
  assert.match(adapter, /\/settings\/get/, "必须实现 /settings/get");
  assert.match(adapter, /\/thread-usage-history/, "必须实现 /thread-usage-history");
  assert.match(adapter, /\/thread-usage-live/, "必须实现 /thread-usage-live");
});

test("适配层不替换官方 electronBridge", () => {
  // 官方 bridge 明确拒绝裸 fetch（"HTTP requests must use the HTTP fetch service."），
  // 覆盖它只会破坏宿主自己的通道；tokenlens.js 自带的 appServices 解析器已能找到 httpFetch。
  assert.doesNotMatch(adapter, /window\.electronBridge\s*=/, "不得覆盖官方 electronBridge");
});

test("appServices 解析职责留在 tokenlens.js，不在适配层重复实现", () => {
  // tokenlens.js 自带 codexPlusUsageResolveAppServices，能在官方 Codex 的 webpack 模块缓存里
  // 找到 appServices.httpFetch。适配层重复实现只会带来两份扫描逻辑。
  assert.doesNotMatch(adapter, /__webpack_require__/, "适配层不应重复实现 appServices 解析");
  const plugin = readFileSync(path.join(repo, "tokenlens.js"), "utf8");
  assert.match(plugin, /function codexPlusUsageResolveAppServices/, "tokenlens.js 必须保留自己的 appServices 解析器");
  assert.match(plugin, /__webpack_require__/, "tokenlens.js 的解析器必须走 webpack 模块缓存");
  assert.match(plugin, /httpFetch/, "tokenlens.js 必须用官方 httpFetch 通道");
});

test("适配层把用量事件留给 tokenlens.js 原生处理", () => {
  // 官方 Codex 通过 mcp-notification 推 thread/tokenUsage/updated，tokenlens.js 原生能吃。
  assert.match(adapter, /mcp-notification/);
  assert.match(adapter, /thread\/tokenUsage\/updated/);
});


test("重新附着后必须重新注册宿主桥", () => {
  // Runtime.addBinding 绑在 CDP 会话上；用模块级标记会让重连后的会话跳过注册，
  // 结果是 renderer 侧 window.__tokenlensHostBinding 不存在，宿主路由全挂。
  assert.match(host, /session\.registered/, "注册标记必须是会话级的");
  assert.doesNotMatch(host, /^let registered = false;/m, "不得用模块级注册标记");
  assert.match(host, /register\(cdp, session\)/, "注册必须传入会话对象");
});

test("启动配置用 MSIX 执行别名开调试端口，不改 flavor", () => {
  const setup = readFileSync(path.join(repo, "standalone", "setup-launcher.ps1"), "utf8");
  // 走 BUILD_FLAVOR=dev + CODEX_ELECTRON_CHROMIUM_SWITCHES 会让官方应用内更新器停摆
  //（Dev 不在更新器白名单 [Nightly, InternalAlpha, PublicBeta, Prod] 里）。
  // 所以改用 MSIX 的执行别名 chatgpt-desktop.exe + 命令行开关：仍是 prod flavor。
  // 只允许在 Uninstall 分支里把旧变量清空，不得把 BUILD_FLAVOR 设成 dev。
  assert.doesNotMatch(setup, /SetEnvironmentVariable\("BUILD_FLAVOR",\s*"dev"/, "不得把 build flavor 设成 dev，否则应用内更新器停摆");
  assert.doesNotMatch(setup, /SetEnvironmentVariable\("CODEX_ELECTRON_CHROMIUM_SWITCHES",\s*\$switches/, "不得用环境变量方式开端口");
  assert.match(setup, /chatgpt-desktop\.exe/, "必须用 MSIX 执行别名，它能带参数");
  assert.match(setup, /--remote-debugging-port=9229/, "必须开调试端口");
  assert.match(setup, /127\.0\.0\.1/, "调试端口只能监听回环地址");
  assert.match(setup, /-Uninstall/, "必须能撤销启动配置");
});

test("PowerShell 脚本必须是 UTF-8 BOM", () => {
  // PS 5.1 按 ANSI 读无 BOM 的 UTF-8，中文乱码会把引号配对搞错，脚本直接语法报错。
  for (const name of ["install.ps1", "setup-launcher.ps1"]) {
    const bytes = readFileSync(path.join(repo, "standalone", name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], name + " 必须带 UTF-8 BOM");
  }
});

test("安装器优先使用现代 PowerShell", () => {
  const install = readFileSync(path.join(repo, "standalone", "install.ps1"), "utf8");
  assert.match(install, /Get-Command pwsh/, "必须优先用 pwsh 而不是 PS 5.1");
  assert.doesNotMatch(install, /powershell\.exe -NoProfile/, "不得硬编码调用 PS 5.1");
});

test("安装器不再创建桌面快捷方式", () => {
  const install = readFileSync(path.join(repo, "standalone", "install.ps1"), "utf8");
  assert.doesNotMatch(install, /CreateShortcut/, "不再需要启动器快捷方式");
  assert.match(install, /Register-ScheduledTask/, "仍需注册后台宿主计划任务");
});

test("live 上下文是单次占用量，不是线程累计量", () => {
  // 踩过的坑：live 路由把 thread_token_usage（线程累计 9167 万）当上下文占用，
  // 占用率直接顶到 100%。上下文占用应是单次调用的 token 数（44 万）。
  const adapter = readFileSync(path.join(repo, "standalone", "tokenlens-host-adapter.js"), "utf8");
  assert.match(adapter, /last\?\.totalTokens/, "live 上下文必须取 last 桶（单次调用量）");
  assert.doesNotMatch(adapter, /total\?\.totalTokens \?\?/, "不得用 total 桶（累计量）当上下文占用");
  assert.match(host, /total_tokens: Number\(last\.usage\?\.total_tokens \|\| 0\)/, "宿主 live 路由必须用单次调用量");
  assert.doesNotMatch(host, /total_tokens: Number\(last\.usage\?\.contextUsed/, "不得用 contextUsed（累计量）当上下文占用");
});

test("宿主实现 /thread-usage-live 路由", () => {
  // 页面刚刷新时官方还没推任何用量事件，live 上下文必须能从历史兜底。
  assert.match(host, /route === "\/thread-usage-live"/, "必须实现 /thread-usage-live");
  assert.match(host, /context_window/, "live 路由必须给出上下文窗口");
});
test("启动脚本用 node 跑宿主", () => {
  assert.match(launcher, /tokenlens-host\.mjs/);
  assert.doesNotMatch(launcher, /tokenlens-host\.ps1/, "旧的 PowerShell 宿主已被移除");
});
