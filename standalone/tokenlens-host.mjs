// TokenLens 官方 Codex 宿主：启动/连接 Codex 的调试端口，注入 TokenLens 并常驻。
//
// 与旧版的关键差别（这些差别就是之前「插件没生效 + Codex 闪退」的根因）：
//   1. 启动目标是 ChatGPT.exe，不是 Codex.exe。Codex.exe 只是 20KB 的更新器 trampoline，
//      不接受命令行参数，调试端口永远起不来。
//   2. 绝不在失败时强杀 Codex。端口没就绪就报错退出，绝不循环重启。
//   3. 已经在运行的 Codex 不打断，只做附着。
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const pluginPath = path.join(repo, "tokenlens.js");
const adapterPath = path.join(here, "tokenlens-host-adapter.js");
const logPath = path.join(here, "tokenlens-host.log");

const port = Number(process.env.TOKENLENS_CDP_PORT || 9229);
const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
const powershell = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

function log(message) {
  const line = "[" + new Date().toISOString() + "] " + message;
  console.log(line);
  try {
    require_appendFile(logPath, line + "\n");
  } catch {
    // 日志写不进去也不能影响注入。
  }
}

function require_appendFile(target, text) {
  // 用同步追加，避免为了写日志引入流。
  const fs = globalThis.__tokenlensFsSync;
  if (fs) { fs.appendFileSync(target, text, "utf8"); return; }
}

// Node ESM 里拿同步 fs 需要单独 import，这里直接用 createRequire。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.__tokenlensFsSync = require("node:fs");
require_appendFile(logPath, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- WebSocket

function frame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const mask = randomBytes(4);
  let header;
  if (body.length < 126) header = Buffer.from([0x81, 0x80 | body.length]);
  else if (body.length < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0xfe;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0xff;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, body]);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = Buffer.alloc(0);
    this.upgraded = false;
    this.closed = false;
  }

  static connect(url) {
    const parsed = new URL(url);
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
    const cdp = new Cdp(socket);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("本机 Codex 调试连接超时"));
      }, 8000);
      socket.on("connect", () => {
        socket.write([
          "GET " + parsed.pathname + parsed.search + " HTTP/1.1",
          "Host: " + parsed.host,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Origin: http://127.0.0.1",
          "Sec-WebSocket-Key: " + key,
          "Sec-WebSocket-Version: 13",
          "", "",
        ].join("\r\n"));
      });
      socket.on("data", (data) => {
        cdp.buffer = Buffer.concat([cdp.buffer, data]);
        if (!cdp.upgraded) {
          const boundary = cdp.buffer.indexOf("\r\n\r\n");
          if (boundary < 0) return;
          const headers = cdp.buffer.subarray(0, boundary).toString();
          cdp.buffer = cdp.buffer.subarray(boundary + 4);
          if (!headers.startsWith("HTTP/1.1 101")) {
            clearTimeout(timer);
            socket.destroy();
            reject(new Error("Codex 拒绝了本机调试连接"));
            return;
          }
          if (!headers.toLowerCase().includes("sec-websocket-accept: " + expected.toLowerCase())) {
            clearTimeout(timer);
            socket.destroy();
            reject(new Error("Codex 调试连接的握手校验失败"));
            return;
          }
          cdp.upgraded = true;
          clearTimeout(timer);
          resolve(cdp);
        }
        cdp.consume();
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("close", () => {
        cdp.closed = true;
        for (const { reject: rejectPending } of cdp.pending.values()) {
          rejectPending(new Error("CDP 连接已关闭"));
        }
        cdp.pending.clear();
      });
    });
  }

  consume() {
    while (this.upgraded && this.buffer.length >= 2) {
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const opcode = this.buffer[0] & 0x0f;
      const message = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode !== 1) continue;
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch {
        continue;
      }
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
        continue;
      }
      for (const listener of this.listeners) {
        try { listener(payload); } catch { /* 单个监听器出错不影响其他 */ }
      }
    }
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(frame({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("CDP 超时: " + method));
      }, 20000);
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

  close() {
    this.closed = true;
    try { this.socket.destroy(); } catch { /* 已断开 */ }
  }
}

// ---------------------------------------------------------------- 宿主路由

async function collectRolloutFiles(threadId) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      if (!entry.name.includes(threadId)) continue;
      try {
        const info = await stat(full);
        found.push({ path: full, mtime: info.mtimeMs });
      } catch {
        // 读不到就跳过。
      }
    }
  };
  await walk(sessionsRoot, 0);
  found.sort((a, b) => a.mtime - b.mtime);
  return found;
}

// 从 rollout 的 token_count 事件里还原线程用量历史。
// tokenlens.js 期望的行格式：{ observed_at, turn_id, usage: { input_tokens, cached_input_tokens, output_tokens, total_tokens, contextUsed, contextLimit } }
async function readThreadUsageHistory(threadId) {
  if (!threadId) return [];
  const files = await collectRolloutFiles(threadId);
  const rows = [];
  const seen = new Set();
  for (const file of files) {
    const text = await readFile(file.path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes("token_count")) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload;
      if (!payload || payload.type !== "token_count") continue;
      const info = payload.info;
      const total = info?.total_token_usage;
      const last = info?.last_token_usage;
      if (!total) continue;
      const observedAt = Date.parse(entry.timestamp || "");
      if (!Number.isFinite(observedAt)) continue;
      const turnId = String(payload.turn_id || payload.turnId || "");
      // 累计值完全一致的重放通知只算一次。
      const key = [turnId, total.total_tokens, total.input_tokens, total.output_tokens].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        observed_at: new Date(observedAt).toISOString(),
        turn_id: turnId,
        usage: {
          input_tokens: Number(total.input_tokens || 0),
          cached_input_tokens: Number(total.cached_input_tokens || 0),
          cache_write_input_tokens: Number(total.cache_write_input_tokens || 0),
          output_tokens: Number(total.output_tokens || 0),
          total_tokens: Number(total.total_tokens || 0),
          contextUsed: Number(last?.total_tokens ?? total.total_tokens ?? 0),
          contextLimit: Number(info.model_context_window || 0),
        },
      });
    }
  }
  rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  return rows;
}

// ---------------------------------------------------------------- 注入

async function findPage() {
  const res = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(3000) });
  const list = await res.json();
  return list.find((t) => t.type === "page" && t.url.startsWith("app://-/")) || null;
}

async function waitForPage(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const page = await findPage();
      if (page) return page;
    } catch {
      // 端口还没起来，继续等。
    }
    await sleep(500);
  }
  return null;
}

async function getPackage() {
  const installLocation = await new Promise((resolve, reject) => {
    execFile(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage OpenAI.Codex).InstallLocation"],
      { windowsHide: true },
      (error, stdout) => {
        if (error) reject(new Error("无法定位 Codex 安装位置: " + error.message));
        else resolve(String(stdout || "").trim());
      },
    );
  });
  if (!installLocation) throw new Error("无法定位 Codex 安装位置");
  return {
    installLocation,
    executable: path.join(installLocation, "app", "ChatGPT.exe"),
  };
}

// 启动 Codex（带调试端口）。启动不等于杀进程，Codex 没在跑时才用。
function launchCodex(packageInfo) {
  const child = spawn(
    packageInfo.executable,
    [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=" + port,
      "--remote-allow-origins=*",
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  log("已启动 Codex（调试端口 " + port + "）");
}

async function codexRunning() {
  return new Promise((resolve) => {
    execFile(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", "[bool](Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -match 'OpenAI\\.Codex' })"],
      { windowsHide: true },
      (error, stdout) => resolve(String(stdout || "").trim() === "True"),
    );
  });
}

// 页面重载后新文档会自动执行 addScriptToEvaluateOnNewDocument 注册的脚本，
// 所以只有首屏需要手动 evaluate。tokenlens.js 没有幂等守卫，重复执行会出现双实例。
//
// 注意：Runtime.addBinding 和 Page.addScriptToEvaluateOnNewDocument 都绑定在 CDP 会话上，
// 重新附着时必须重新注册一次；用会话级标记，不能用模块级标记，否则重连后宿主桥会失效。
async function register(cdp, session) {
  if (session.registered) return;
  const plugin = await readFile(pluginPath, "utf8");
  const adapter = await readFile(adapterPath, "utf8");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  // 宿主桥：renderer 侧通过 window.__tokenlensHostBinding 调回 Node。
  await cdp.send("Runtime.addBinding", { name: "__tokenlensHostBinding" });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: adapter + "\n" + plugin });
  session.registered = true;
}

async function activate(cdp) {
  const plugin = await readFile(pluginPath, "utf8");
  const adapter = await readFile(adapterPath, "utf8");
  // 已经有运行时就不重复执行：tokenlens.js 会挂新的事件监听与观察器，重复注入会双份渲染。
  const alive = await cdp.evaluate("typeof window.__codexPlusThroughputStatusLineRuntime === 'object'");
  if (alive === true) return false;
  await cdp.evaluate(adapter + "\n" + plugin);
  log("TokenLens 已注入");
  return true;
}

async function main() {
  log("TokenLens 宿主启动（端口 " + port + "）");
  const packageInfo = await getPackage();

  let page = await waitForPage(2000);
  if (!page) {
    if (await codexRunning()) {
      log("Codex 已在运行但没有调试端口。请用桌面快捷方式「TokenLens Codex」重新启动 Codex。");
      process.exitCode = 1;
      return;
    }
    launchCodex(packageInfo);
    page = await waitForPage(45000);
    if (!page) {
      log("Codex 调试端口未就绪，宿主退出（不重试，不打断 Codex）。");
      process.exitCode = 1;
      return;
    }
  }

  // Codex 完全退出后重新附着。只等端口，不碰 Codex 进程。
  while (true) {
    let cdp;
    try {
      const target = page || (await waitForPage(30000));
      if (!target) { page = null; await sleep(2000); continue; }
      cdp = await Cdp.connect(target.webSocketDebuggerUrl);
      log("已连接 " + target.url);
      await runSession(cdp);
    } catch (error) {
      log("会话结束: " + (error?.message || error));
    } finally {
      if (cdp) cdp.close();
    }
    // 等 Codex 重新起来。Codex 完全没跑就拉起它；在跑但没端口就只等，绝不杀。
    log("等待 Codex 重新启动以便再次附着…");
    const deadline = Date.now() + 300000;
    let next = null;
    while (Date.now() < deadline && !next) {
      await sleep(3000);
      next = await waitForPage(1000);
      if (next) break;
      if (!(await codexRunning())) {
        launchCodex(packageInfo);
        await sleep(5000);
      }
    }
    if (!next) {
      log("5 分钟内没有等到 Codex，宿主退出。");
      process.exitCode = 1;
      return;
    }
    page = next;
  }
}

// 一个附着会话：连接、注册、注入、等待断开。
async function runSession(cdp) {
  const session = { registered: false };
  // 宿主路由：renderer 通过 binding 调回来。
  cdp.on((message) => {
    if (message?.method !== "Runtime.bindingCalled") return;
    if (message.params?.name !== "__tokenlensHostBinding") return;
    void handleHostCall(cdp, message.params.payload);
  });

  await register(cdp, session);
  await activate(cdp);

  // 页面重载：注册脚本会在新文档自动执行；这里只在它没跑起来时补一次。
  cdp.on((message) => {
    if (message?.method !== "Page.loadEventFired" && message?.method !== "Page.frameNavigated") return;
    setTimeout(() => {
      void activate(cdp).catch((error) => log("重新注入失败: " + error.message));
    }, 1500);
  });

  // 常驻到 CDP 断开。
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (cdp.closed) {
        clearInterval(timer);
        reject(new Error("CDP 连接断开"));
      }
    }, 1000);
  });
}

async function handleHostCall(cdp, rawPayload) {
  let request;
  try {
    request = JSON.parse(rawPayload);
  } catch {
    return;
  }
  const { id, route, args } = request;
  try {
    let payload;
    if (route === "/thread-usage-history") {
      payload = { history: await readThreadUsageHistory(String(args?.session_id || "")) };
    } else {
      payload = { error: "standalone: 不支持的宿主路由 " + route };
    }
    await cdp.evaluate("window.__tokenlensHostResult(" + JSON.stringify(id) + ", true, " + JSON.stringify(payload) + ");");
  } catch (error) {
    await cdp.evaluate("window.__tokenlensHostResult(" + JSON.stringify(id) + ", false, " + JSON.stringify(String(error?.message || error)) + ");");
  }
}

main().catch((error) => {
  log("宿主错误: " + (error?.message || error));
  process.exitCode = 1;
});
