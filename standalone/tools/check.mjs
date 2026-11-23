// TokenLens 端到端验证：对着正在运行的 Codex 检查状态栏、事件链与用量源。
//
// 用法：
//   node standalone/tools/check.mjs
//
// 退出码 0 = 全绿；非 0 = 有检查项没过。
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

// 1. 宿主适配层已装载
const runtime = await cdp.evaluate(`(() => ({
  runtime: typeof window.__codexPlusThroughputStatusLineRuntime === "object",
  codexPlus: typeof window.codexPlus?.call === "function",
  bridge: typeof window.__codexSessionDeleteBridge === "function",
  standalone: window.__tokenlensStandalone === true,
}))()`);
check("宿主适配层已装载", runtime?.codexPlus && runtime?.bridge, JSON.stringify(runtime));
check("tokenlens.js 运行时已建立", runtime?.runtime === true, "version " + (runtime?.version ?? "-"));

// 2. 状态栏只有一个实例（重复注入会渲染两份）
const dom = await cdp.evaluate(`(() => ({
  statusLines: document.querySelectorAll("#codex-plus-throughput-statusline").length,
  popovers: document.querySelectorAll("#codex-plus-throughput-popover").length,
  styles: document.querySelectorAll("#codex-plus-throughput-statusline-style").length,
  placement: document.querySelector("[data-codex-composer-root]")?.getAttribute("data-composer-placement") || null,
  threadId: document.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id") || null,
}))()`);
check("状态栏没有重复实例", dom?.statusLines <= 1, JSON.stringify(dom));

// 3. 官方事件流能驱动吞吐速度
const speed = await cdp.evaluate(`(async () => {
  const read = () => document.getElementById("codex-plus-throughput-statusline")?.textContent.replace(/\\s+/g, " ").trim() || "";
  const before = read();
  const threadId = document.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id");
  window.postMessage({
    type: "mcp-notification",
    hostId: "local",
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId: "tokenlens-check",
      tokenUsage: {
        total: { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 100, totalTokens: 1100 },
        last: { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 100, totalTokens: 1100 },
        modelContextWindow: 486400,
      },
    },
  }, "*");
  await new Promise((r) => setTimeout(r, 2500));
  return { before, after: read() };
})()`);
check("官方事件流驱动状态栏", speed?.before !== speed?.after, JSON.stringify(speed));

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
const history = await cdp.evaluate(`(async () => {
  try {
    const result = await window.codexPlus.call("/thread-usage-history", { session_id: "01a1bf10-14a7-7582-a56f-679764297d68" });
    const rows = Array.isArray(result?.history) ? result.history : [];
    return { rows: rows.length, last: rows[rows.length - 1] || null };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
})()`);
check("宿主路由返回线程用量历史", (history?.rows ?? 0) > 0, JSON.stringify(history)?.slice(0, 220));

// 汇总
let failed = 0;
for (const item of results) {
  if (!item.ok) failed += 1;
  console.log((item.ok ? "PASS  " : "FAIL  ") + item.name + "  " + (item.detail ?? ""));
}
console.log("");
console.log(failed === 0 ? "全部通过（" + results.length + " 项）" : failed + " 项未通过（" + results.length + " 项）");
process.exit(failed === 0 ? 0 : 1);
