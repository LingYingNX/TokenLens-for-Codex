/* TokenLens 官方 Codex 宿主适配层（renderer 侧）。
 *
 * 背景：Codex++ 宿主已删除，官方 Codex 没有 codexPlus / __codexSessionDeleteBridge 路由。
 * 但官方 Codex 原生提供了 tokenlens.js 需要的三样东西：
 *   1. appServices.httpFetch —— Magpie 用量查询（tokenlens.js 自带解析器已能找到，无需适配）
 *   2. mcp-notification 事件流 —— thread/tokenUsage/updated 等（tokenlens.js 原生就能吃）
 *   3. renderer DOM 线程标识 —— [data-above-composer-conversation-id]（tokenlens.js 原生就能读）
 * 只剩两处宿主路由要补：/thread-usage-history（要读磁盘 rollout）与 /thread-usage-live。
 *
 * 本文件不改动 window.electronBridge：官方 bridge 明确拒绝裸 fetch，
 * tokenlens.js 的 appServices 解析器已能在官方 Codex 里找到 httpFetch。
 */
(() => {
  if (window.__tokenlensStandalone) return;
  window.__tokenlensStandalone = true;

  const hostCalls = new Map();
  let nextHostId = 0;

  // 宿主（Node 侧 CDP 进程）用 Runtime.addBinding 注入这个函数。
  window.__tokenlensHostResult = (id, ok, payload) => {
    const entry = hostCalls.get(id);
    if (!entry) return;
    hostCalls.delete(id);
    if (ok) entry.resolve(payload);
    else entry.reject(new Error(String(payload)));
  };

  function callHost(route, args) {
    return new Promise((resolve, reject) => {
      const binding = window.__tokenlensHostBinding;
      if (typeof binding !== "function") {
        reject(new Error("standalone: 宿主桥接未就绪"));
        return;
      }
      const id = "h" + (nextHostId += 1) + "-" + Date.now();
      hostCalls.set(id, { resolve, reject });
      try {
        binding(JSON.stringify({ id, route, args: args || {} }));
      } catch (error) {
        hostCalls.delete(id);
        reject(error);
      }
    });
  }

  // 实时上下文：官方 Codex 直接把 thread/tokenUsage/updated 推给 renderer，
  // 这里记下最近一次的用量，/thread-usage-live 直接回答，不用再问宿主。
  let liveUsage = null;

  const rememberUsage = (payload) => {
    const usage = payload?.tokenUsage || payload?.token_usage;
    if (!usage) return;
    const total = usage.total || usage;
    const last = usage.last || total;
    const contextTokens = Number(last?.totalTokens ?? last?.total_tokens ?? total?.totalTokens ?? total?.total_tokens);
    const contextWindow = Number(usage.modelContextWindow ?? usage.model_context_window);
    if (!Number.isFinite(contextTokens) && !Number.isFinite(contextWindow)) return;
    liveUsage = {
      totalTokens: Number.isFinite(contextTokens) ? contextTokens : null,
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
    };
  };

  window.addEventListener("message", (event) => {
    const data = event?.data;
    if (data?.type !== "mcp-notification") return;
    if (data.method !== "thread/tokenUsage/updated") return;
    rememberUsage(data.params || {});
  }, true);

  const route = (name, args) => {
    if (name === "/settings/get") {
      return Promise.resolve({ codexAppUsageStatusLine: true });
    }
    if (name === "/thread-usage-live") {
      const events = liveUsage
        ? [{ total_tokens: liveUsage.totalTokens, context_window: liveUsage.contextWindow }]
        : [];
      return Promise.resolve({ status: "ok", events });
    }
    if (name === "/thread-usage-history") {
      return callHost(name, args);
    }
    return Promise.reject(new Error("standalone: 不支持的宿主路由 " + name));
  };

  window.codexPlus = window.codexPlus || {
    version: "standalone-official-codex",
    call: (name, args) => route(name, args),
    onCleanup() {},
  };

  window.__codexSessionDeleteBridge = (name, args) => route(name, args);
})();
