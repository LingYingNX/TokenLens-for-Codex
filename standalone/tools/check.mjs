// TokenLens 端到端验证：对着正在运行的 Codex 检查状态栏、事件链与用量源。
//
// 用法：
//   node standalone/tools/check.mjs            只做非破坏性检查
//   node standalone/tools/check.mjs --reload   额外刷新页面并切换会话（会打断当前轮次）
//
// 退出码 0 = 全绿；非 0 = 有检查项没过。
//
// 注意：事件链验证会发一条合成的 thread/tokenUsage/updated。
// 它必须用唯一累计值才能穿过 tokenlens.js 的 appliedTotals 去重，
// 但生效后会真的累加进本轮用量，所以最后必须刷新页面重置内存状态。
import { findPage, Cdp, sleep } from "./cdp.mjs";

const port = Number(process.env.TOKENLENS_CDP_PORT || 9229);
const page = await findPage(port);
if (!page) {
  console.error("找不到 Codex 渲染页（app://-/）。先启动 Codex（带调试端口）。");
  process.exit(2);
}

const cdp = await Cdp.connect(page.webSocketDebuggerUrl);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
};
const skip = (name, detail) => {
  results.push({ name, ok: true, skipped: true, detail });
};

// 刷新页面会打断用户正在跑的轮次，切侧栏会话还会把用户从当前会话带走，必须显式开启。
const reload = process.argv.includes("--reload");

// 窗口最小化时 Chromium 把所有几何信息归零（getClientRects/offsetWidth 全是 0），Codex 还会把
// Composer 从 DOM 上摘掉，依赖渲染的断言只会假失败。先问一次可见性，可见才跑这些检查。
const pageState = await cdp.evaluate(`(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }))()`);
const domTrustworthy = pageState?.visibility === "visible";

// 1. 宿主适配层已装载
const runtime = await cdp.evaluate(`(() => ({
  runtime: typeof window.__codexPlusThroughputStatusLineRuntime === "object",
  codexPlus: typeof window.codexPlus?.call === "function",
  bridge: typeof window.__codexSessionDeleteBridge === "function",
  standalone: window.__tokenlensStandalone === true,
}))()`);
check("宿主适配层已装载", runtime?.codexPlus && runtime?.bridge, JSON.stringify(runtime));
check("tokenlens.js 运行时已建立", runtime?.runtime === true, JSON.stringify(runtime));

// 2. 状态栏只有一个实例（重复注入会渲染两份）
const dom = await cdp.evaluate(`(() => ({
  statusLines: document.querySelectorAll("#codex-plus-throughput-statusline").length,
  popovers: document.querySelectorAll("#codex-plus-throughput-popover").length,
  placement: document.querySelector("[data-codex-composer-root]")?.getAttribute("data-composer-placement") || null,
  threadId: document.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id") || null,
}))()`);
check("状态栏没有重复实例", dom?.statusLines <= 1, JSON.stringify(dom));

// 3. 官方事件流能驱动状态栏
//
// 断言气泡层里的上下文占用百分比：合成事件把 modelContextWindow 压到一半，
// 占用率必然从真实值跳到 100%。这个信号稳定，不依赖具体线程的累计量。
// 合成事件必须用唯一累计值，否则 tokenlens.js 的 appliedTotals 会整条丢弃。
// 生效后会污染本轮用量，所以第 6 步会刷新页面重置内存状态并断言还原。
const eventProbe = !domTrustworthy ? null : await cdp.evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const readContextPercent = async () => {
    const btn = document.querySelector("#codex-plus-throughput-statusline button");
    if (btn) {
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(900);
    }
    const pop = document.getElementById("codex-plus-throughput-popover");
    const text = pop?.textContent.replace(/\\s+/g, " ").trim() || "";
    const match = text.match(/([\\d.]+)%\\//);
    return match ? match[1] : null;
  };
  const before = await readContextPercent();
  const threadId = document.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id");
  const probe = Date.now() * 1000 + 4242;
  window.postMessage({
    type: "mcp-notification",
    hostId: "local",
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      tokenUsage: {
        total: { inputTokens: probe, cachedInputTokens: probe, outputTokens: 0, totalTokens: probe },
        last: { inputTokens: probe, cachedInputTokens: probe, outputTokens: 0, totalTokens: probe },
        modelContextWindow: 1,
      },
    },
  }, "*");
  await sleep(2500);
  const after = await readContextPercent();
  return { before, after };
})()`);
if (!domTrustworthy) {
  skip("官方事件流驱动状态栏", "Codex 窗口不可见（visibilityState=" + pageState?.visibility + "），先恢复窗口再跑");
} else {
  check(
    "官方事件流驱动状态栏",
    eventProbe?.before !== eventProbe?.after && eventProbe?.after !== null,
    JSON.stringify(eventProbe),
  );
}

// 4. Magpie 用量源可达（经官方 appServices.httpFetch）
const magpie = await cdp.evaluate(`(async () => {
  try {
    const urls = new Set();
    const push = (v) => { try { const u = new URL(String(v), document.baseURI || location.href).href; if (/\\/assets\\/.+\\.js(?:$|\\?)/.test(u)) urls.add(u); } catch {} };
    document.querySelectorAll("script[src],link[href]").forEach((n) => push(n.getAttribute("src") || n.getAttribute("href") || ""));
    performance.getEntriesByType("resource").forEach((e) => push(e.name));
    let services = null;
    for (const url of urls) {
      let mod;
      try { mod = await import(/* @vite-ignore */ url); } catch { continue; }
      if (mod?.appServices?.httpFetch?.fetch) { services = mod.appServices; break; }
      const req = mod?.__webpack_require__;
      if (!req?.c) continue;
      for (const id of Object.keys(req.c)) {
        const s = req.c[id]?.exports?.appServices;
        if (s?.httpFetch?.fetch) { services = s; break; }
      }
      if (services) break;
    }
    if (!services) return { ok: false, reason: "no appServices.httpFetch" };
    const result = await services.httpFetch.fetch("tokenlens-check-" + Date.now(), {
      url: "http://127.0.0.1:3425/v1/magpie/usage/requests?period=today&agent=codex&limit=1",
      method: "GET", headers: {}, retry: false,
    });
    const json = await result.response.json();
    const out = { ok: result.response.ok, status: result.response.status, rows: json.rows?.length ?? null };
    result?.[Symbol.dispose]?.();
    return out;
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
})()`);
check("Magpie 用量源可达", magpie?.ok === true, JSON.stringify(magpie));

// 5. 宿主路由能取到线程历史
// 线程 id 必须从当前页面取：写死的话换一台机器、换一个会话就必挂。
const currentThreadId = dom?.threadId || null;
const history = currentThreadId
  ? await cdp.evaluate(`(async () => {
  try {
    const result = await window.codexPlus.call("/thread-usage-history", { session_id: ${JSON.stringify(currentThreadId)} });
    const rows = Array.isArray(result?.history) ? result.history : [];
    const totals = rows.map((r) => Number(r?.usage?.total_tokens || 0)).sort((a, b) => b - a);
    return {
      rows: rows.length,
      maxPerCall: totals[0] ?? null,
      last: rows[rows.length - 1] || null,
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
})()`)
  : null;
if (!currentThreadId) {
  skip("宿主路由返回线程用量历史", "当前页面不在线程内（没有线程 id）");
  skip("历史样本是单次调用量而非线程累计量", "当前页面不在线程内（没有线程 id）");
} else {
  check("宿主路由返回线程用量历史", (history?.rows ?? 0) > 0, JSON.stringify(history)?.slice(0, 200));
  // 单次调用量必须在合理量级：线程累计量（9000 多万）绝不能出现在这里。
  check(
    "历史样本是单次调用量而非线程累计量",
    typeof history?.maxPerCall === "number" && history.maxPerCall > 0 && history.maxPerCall < 5_000_000,
    "maxPerCall=" + history?.maxPerCall,
  );
}

// 6. 刷新页面重置内存状态，清掉第 3 步合成事件的污染
if (!reload) {
  skip("刷新后上下文占用回到真实数值", "未加 --reload（刷新会打断当前轮次）");
} else if (!domTrustworthy) {
  skip("刷新后上下文占用回到真实数值", "窗口不可见，刷新后读不到渲染结果");
} else {
  await cdp.send("Page.enable");
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(10000);
  // 不点侧栏恢复会话：点击会把用户从当前会话带走。刷新后官方 Codex 自己会回到上次的会话，
  // 只要读回 DOM 线程 id 与刷新前一致，就可以继续比对上下文占用。
  const reloadedThreadId = await cdp.evaluate(`(() => document.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id") || null)()`);
  // 上下文占用显示在气泡层（形如 91.4%/486.4K），状态栏上的是缓存命中率。
  const restored = await cdp.evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector("#codex-plus-throughput-statusline button");
  if (btn) {
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(1200);
  }
  const pop = document.getElementById("codex-plus-throughput-popover");
  const text = pop?.textContent.replace(/\\s+/g, " ").trim() || "";
  return { text: text.slice(0, 120), contextPercent: text.match(/([\\d.]+)%\\/([\\d.]+[KMB])/)?.[1] ?? "" };
})()`);
  const expectedPercent = reloadedThreadId && reloadedThreadId === currentThreadId
    && history?.last?.usage?.total_tokens && history?.last?.usage?.contextLimit
    ? (history.last.usage.total_tokens / history.last.usage.contextLimit * 100).toFixed(1)
    : "";
  if (expectedPercent) {
    check(
      "刷新后上下文占用回到真实数值",
      restored?.contextPercent === expectedPercent,
      JSON.stringify({ restored, expectedPercent, reloadedThreadId }),
    );
  } else {
    // 刷新后没回到同一个线程（或没有历史）时无基准可比，别把它算成通过。
    skip("刷新后上下文占用回到真实数值", "刷新后线程不一致或无历史基准");
  }
}

// 汇总
let failed = 0;
let skipped = 0;
for (const item of results) {
  if (item.skipped) skipped += 1;
  else if (!item.ok) failed += 1;
  const tag = item.skipped ? "SKIP  " : item.ok ? "PASS  " : "FAIL  ";
  console.log(tag + item.name + "  " + (item.detail ?? ""));
}
console.log("");
console.log(
  (failed === 0 ? "全部通过" : failed + " 项未通过")
  + "（" + results.length + " 项，跳过 " + skipped + " 项）",
);
if (!domTrustworthy) {
  console.log("提示：Codex 窗口当前不可见（visibilityState=" + pageState?.visibility + "），依赖渲染的检查项已跳过；恢复窗口后重跑。");
}
process.exit(failed === 0 ? 0 : 1);
