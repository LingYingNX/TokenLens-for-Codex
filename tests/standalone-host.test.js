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
  // 调试端口由 setup-env.ps1 设的环境变量打开，宿主只负责等端口出现后附着。
  assert.doesNotMatch(host, /spawn\(/, "宿主不得自己启动 Codex 进程");
  assert.doesNotMatch(host, /launchCodex/, "不得保留代启 Codex 的函数");
  assert.match(host, /等待 Codex 启动/, "宿主必须等待 Codex 出现");
});

test("调试端口参数由环境变量脚本配置", () => {
  // 端口不再由宿主命令行传入（那会改变启动方式），改由官方开关环境变量提供。
  const setup = readFileSync(path.join(repo, "standalone", "setup-env.ps1"), "utf8");
  assert.match(setup, /"remote-debugging-address"\s*=\s*"127\.0\.0\.1"/);
  assert.match(setup, /"remote-debugging-port"\s*=\s*"9229"/);
  assert.match(setup, /"remote-allow-origins"\s*=\s*"\*"/);
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
  assert.match(host, /if \(alive === true\) return false;/, "已有运行时必须跳过重复注入");
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

test("环境变量脚本配置官方唯一支持的开关入口", () => {
  const setup = readFileSync(path.join(repo, "standalone", "setup-env.ps1"), "utf8");
  // 官方 app.asar 只在 BUILD_FLAVOR=dev 时读 CODEX_ELECTRON_CHROMIUM_SWITCHES。
  assert.match(setup, /CODEX_ELECTRON_CHROMIUM_SWITCHES/, "必须设置官方开关环境变量");
  assert.match(setup, /BUILD_FLAVOR/, "必须设置 BUILD_FLAVOR=dev，否则官方不读开关");
  assert.match(setup, /remote-debugging-port/, "必须开调试端口");
  assert.match(setup, /127\.0\.0\.1/, "调试端口只能监听回环地址");
  assert.match(setup, /-Uninstall/, "必须能撤销环境变量");
});

test("PowerShell 脚本必须是 UTF-8 BOM", () => {
  // PS 5.1 按 ANSI 读无 BOM 的 UTF-8，中文乱码会把引号配对搞错，脚本直接语法报错。
  for (const name of ["install.ps1", "setup-env.ps1"]) {
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
test("启动脚本用 node 跑宿主", () => {
  assert.match(launcher, /tokenlens-host\.mjs/);
  assert.doesNotMatch(launcher, /tokenlens-host\.ps1/, "旧的 PowerShell 宿主已被移除");
});
