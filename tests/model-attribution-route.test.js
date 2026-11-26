"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const host = readFileSync(path.join(__dirname, "../standalone/tokenlens-host.mjs"), "utf8");
const start = host.indexOf("let attributionScanRunning = false;");
const end = host.indexOf("\nmain().catch(", start);
assert.ok(start >= 0 && end > start, "宿主路由函数必须存在");
const makeHandler = new Function("readThreadUsageHistory", "readRolloutUsageAttribution", host.slice(start, end) + "\nreturn handleHostCall;");

function fixture(attributionReader) {
  const history = [{ usage: { total_tokens: 12, contextLimit: 100 } }];
  const attribution = { threadId: "thread-1", records: [{ threadId: "thread-1", turnId: "t1", responseId: "r1", model: "model-1", usage: { total_tokens: 12 } }], truncated: false, partial: true };
  const calls = [];
  const handler = makeHandler(
    async (id) => { calls.push(["history", id]); return history; },
    async (id) => { calls.push(["attribution", id]); return attributionReader ? attributionReader(id) : attribution; },
  );
  async function request(route, args) {
    let result;
    const cdp = { closed: false, evaluate: async (expression) => {
      new Function("window", expression)({ __tokenlensHostResult: (...values) => { result = values; } });
    } };
    await handler(cdp, JSON.stringify({ id: 7, route, args }));
    return result;
  }
  return { history, attribution, calls, request };
}

test("宿主从 rollout 模块导入归属读取函数", () => {
  assert.match(host, /import\s*\{[^}]*\breadRolloutUsageAttribution\b[^}]*\}\s*from\s*["']\.\/rollout-history\.mjs["']/);
});

test("历史路由保持原有响应且不读取归属", async () => {
  for (const args of [{ session_id: "thread-1" }, undefined]) {
    const f = fixture();
    assert.deepEqual(await f.request("/thread-usage-history", args), [7, true, { history: f.history }]);
    assert.deepEqual(f.calls, [["history", args?.session_id || ""]]);
  }
});

test("仅归属模式只读取归属，不读取历史", async () => {
  const f = fixture();
  assert.deepEqual(await f.request("/thread-usage-history", { session_id: "thread-1", attribution_only: true }), [7, true, { attribution: f.attribution }]);
  assert.deepEqual(f.calls, [["attribution", "thread-1"]]);
});

test("归属扫描忙时立即报错，历史请求不等待，结束后可重试", async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const first = f.request("/thread-usage-history", { session_id: "thread-1", attribution_only: true });
  const second = f.request("/thread-usage-history", { session_id: "thread-2", attribution_only: true });
  const history = f.request("/thread-usage-history", { session_id: "thread-3" });
  assert.deepEqual(await history, [7, true, { history: f.history }]);
  assert.deepEqual(f.calls, [["attribution", "thread-1"], ["history", "thread-3"]]);
  assert.deepEqual(await second, [7, false, "standalone: 归属扫描繁忙，请稍后重试"]);
  finish(f.attribution);
  assert.deepEqual(await first, [7, true, { attribution: f.attribution }]);
  const retry = f.request("/thread-usage-history", { session_id: "thread-2", attribution_only: true });
  finish(f.attribution);
  assert.deepEqual(await retry, [7, true, { attribution: f.attribution }]);
});

test("扫描失败后释放并发限制", async () => {
  let attempts = 0;
  const f = fixture(async () => { if (++attempts === 1) throw new Error("scan failed"); return f.attribution; });
  assert.deepEqual(await f.request("/thread-usage-history", { session_id: "thread-1", attribution_only: true }), [7, false, "scan failed"]);
  assert.deepEqual(await f.request("/thread-usage-history", { session_id: "thread-1", attribution_only: true }), [7, true, { attribution: f.attribution }]);
});

test("仅归属参数不影响其他路由", async () => {
  const f = fixture();
  assert.deepEqual(await f.request("/thread-usage-live", { session_id: "thread-1", attribution_only: true }), [7, true, { status: "ok", events: [{ total_tokens: 12, context_window: 100 }] }]);
  assert.deepEqual(await f.request("/unknown", { attribution_only: true }), [7, true, { error: "standalone: 不支持的宿主路由 /unknown" }]);
  assert.deepEqual(f.calls, [["history", "thread-1"]]);
});
