// 最小 CDP 客户端：连上 Codex 渲染页并求值。
// 只用 Node 内置能力（全局 WebSocket / fetch），不引依赖。

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function findPage(port = Number(process.env.TOKENLENS_CDP_PORT || 9229)) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("app://-/"));
      if (page) return page;
    } catch {
      // 端口还没起来，继续等。
    }
    await sleep(500);
  }
  return null;
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !cdp.pending.has(msg.id)) return;
      const { resolve, reject } = cdp.pending.get(msg.id);
      cdp.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 30000);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception?.description || ""));
    }
    return result?.result?.value;
  }
}
