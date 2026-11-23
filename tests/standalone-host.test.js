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

test("宿主启动的是 ChatGPT.exe 而不是 Codex.exe", () => {
  assert.match(host, /app", "ChatGPT\.exe"/, "宿主必须以 ChatGPT.exe 为启动目标");
  assert.doesNotMatch(host, /app", "Codex\.exe"/, "Codex.exe 是更新器 trampoline，不能作为启动目标");
});

test("宿主调试端口参数与官方插件一致", () => {
  assert.match(host, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(host, /--remote-debugging-port=/);
  assert.match(host, /--remote-allow-origins=\*/);
});

test("宿主失败时退出而不是重试", () => {
  // 旧实现是 while(true) { try { ... } catch { sleep 2 } }，失败就无限重启 Codex。
  // 现在端口没就绪必须直接返回，且不能有「重试启动」的循环。
  assert.match(host, /宿主退出（不重试，不打断 Codex）/, "端口未就绪必须直接退出");
  assert.doesNotMatch(host, /host error:/, "不得再有旧版的无限重试错误分支");
});

test("宿主只在 Codex 未运行时才启动它", () => {
  assert.match(host, /if \(!\(await codexRunning\(\)\)\)/, "Codex 在跑时不得重复启动");
  assert.match(host, /async function codexRunning\(\)/);
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
  assert.match(host, /readThreadUsageHistory/);
  assert.match(host, /contextLimit/, "历史行必须带上下文窗口");
  assert.match(host, /contextUsed/, "历史行必须带上下文占用");
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
test("启动脚本用 node 跑宿主", () => {
  assert.match(launcher, /tokenlens-host\.mjs/);
  assert.doesNotMatch(launcher, /tokenlens-host\.ps1/, "旧的 PowerShell 宿主已被移除");
});
