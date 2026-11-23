/* TokenLens standalone shim: 给非 Codex++ 启动的 Codex 补齐插件依赖的宿主 API。 */
(() => {
  if (window.__tokenlensStandalone) return;
  window.__tokenlensStandalone = true;

  const fetchCalls = new Map();
  const rpcCalls = new Map();

  window.__tokenlensHttpResult = (id, status, body) => {
    const done = fetchCalls.get(id);
    if (!done) return;
    fetchCalls.delete(id);
    done(status, body);
  };

  window.__tokenlensCallResult = (id, ok, payload) => {
    const done = rpcCalls.get(id);
    if (!done) return;
    rpcCalls.delete(id);
    if (ok) done.resolve(payload);
    else done.reject(new Error(String(payload)));
  };

  window.electronBridge = {
    sendMessageFromView(message) {
      return new Promise((resolve, reject) => {
        const id = message && message.requestId;
        if (!id || typeof window.__tokenlensHttp !== "function") {
          reject(new Error("standalone: HTTP bridge 未就绪"));
          return;
        }
        fetchCalls.set(id, (status, body) => {
          if (status >= 200 && status < 400) {
            resolve({
              type: "fetch-response",
              requestId: id,
              responseType: "success",
              status: status,
              bodyJsonString: body,
            });
            return;
          }
          reject(new Error(`Magpie 请求失败 (${status})`));
        });
        window.__tokenlensHttp(JSON.stringify({
          id: id,
          url: message.url,
          method: message.method || "GET",
          body: message.body || null,
        }));
      });
    },
  };

  window.codexPlus = {
    version: "standalone",
    call(route, args) {
      return new Promise((resolve, reject) => {
        if (typeof window.__tokenlensCall !== "function") {
          reject(new Error("standalone: " + route));
          return;
        }
        const id = "c" + Math.random().toString(36).slice(2);
        rpcCalls.set(id, { resolve: resolve, reject: reject });
        window.__tokenlensCall(JSON.stringify({ id: id, route: route, args: args || {} }));
      });
    },
    onCleanup() {},
  };
})();