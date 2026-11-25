// 从 rollout 文件还原线程用量历史。
//
// 关键：必须用 token_usage_record，不能用 token_count。
//   token_count.info.total_token_usage 是整个线程的累计量（该线程已到 9167 万），
//   而 tokenlens.js 的历史样本语义是「单次调用的 token 数」。
//   喂累计值会让 TOP3 和柱状图出现 9000 万这种不可能的单次调用。
//
// token_usage_record 正好是需要的形状：
//   usage              = 单次调用量
//   turn_id            = 轮次归属
//   thread_token_usage = 线程累计量（对应 tokenlens.js 的 contextUsed）
//
// 两点细节：
//   1. token_usage_record 的 type 在 JSON 顶层（entry.type），
//      token_count 的 type 在 payload 里（entry.payload.type）。
//   2. 上下文窗口只在 token_count 里（info.model_context_window），
//      而且它可能排在对应的 token_usage_record 之后，所以必须先扫一遍拿窗口再取行。

import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

const defaultSessionsRoot = path.join(os.homedir(), ".codex", "sessions");

export async function collectRolloutFiles(threadId, sessionsRoot = defaultSessionsRoot) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 5) return;
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

export function parseUsageRecord(entry, contextWindow = 0) {
  if (!entry || entry.type !== "token_usage_record") return null;
  const payload = entry.payload;
  if (!payload || !payload.usage) return null;
  const observedAt = Date.parse(entry.timestamp || "");
  if (!Number.isFinite(observedAt)) return null;
  const usage = payload.usage;
  const threadUsage = payload.thread_token_usage || {};
  return {
    observed_at: new Date(observedAt).toISOString(),
    turn_id: String(payload.turn_id || payload.turnId || ""),
    response_id: String(payload.response_id || payload.responseId || ""),
    usage: {
      input_tokens: Number(usage.input_tokens || 0),
      cached_input_tokens: Number(usage.cached_input_tokens || 0),
      cache_write_input_tokens: Number(usage.cache_write_input_tokens || 0),
      output_tokens: Number(usage.output_tokens || 0),
      total_tokens: Number(usage.total_tokens || 0),
      // 上下文占用用线程累计量，和 tokenlens.js 的 contextUsed 语义一致。
      contextUsed: Number(threadUsage.total_tokens || 0),
      contextLimit: contextWindow,
    },
  };
}

export function parseContextWindow(entry) {
  if (!entry || entry.type !== "event_msg") return null;
  const payload = entry.payload;
  if (!payload || payload.type !== "token_count") return null;
  const value = Number(payload.info?.model_context_window || 0);
  return value > 0 ? value : null;
}

// 独立的归属数据，不改变原历史接口及其线程累计语义。
export async function readRolloutUsageAttribution(threadId, options = {}) {
  const result = { threadId, records: [], truncated: false, partial: false };
  if (typeof threadId !== "string" || !threadId) return { ...result, partial: true };
  const files = [];
  let directories = 0;
  let halted = false;
  // shortcut: 扫描受文件数、目录数、深度和字节预算限制，数据增长后需改用索引。
  const walk = async (dir, depth) => {
    if (halted) return;
    if (depth > 5) { result.truncated = true; return; }
    if (++directories > 4000) { result.truncated = halted = true; return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { result.partial = true; return; }
    // 日期目录与 rollout 文件按名称倒序，避免旧记录先耗尽发现预算。
    entries.sort((a, b) =>
      Number(b.name.includes(threadId) && b.isFile()) - Number(a.name.includes(threadId) && a.isFile()) ||
      Number(b.isDirectory()) - Number(a.isDirectory()) || b.name.localeCompare(a.name));
    for (const entry of entries) {
      if (halted) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const priority = entry.name.includes(threadId);
      if (files.length >= 2000) {
        result.truncated = true;
        if (!priority) continue;
        const replace = files.findLastIndex((file) => !file.priority);
        if (replace < 0) continue;
        files.splice(replace, 1);
      }
      files.push({ path: full, priority });
    }
  };
  await walk(options.sessionsRoot || defaultSessionsRoot, 0);
  files.sort((a, b) => Number(b.priority) - Number(a.priority));
  let remaining = 64 * 1024 * 1024;
  const sessions = new Map();
  for (const file of files) {
    if (remaining <= 0) { result.truncated = true; break; }
    let before;
    try { before = await stat(file.path); }
    catch { result.partial = true; continue; }
    const limit = Math.min(before.size, remaining, 32 * 1024 * 1024);
    remaining -= limit;
    if (limit < before.size) result.truncated = true;
    if (!limit) { result.partial = true; continue; }
    let id = null;
    let parent = null;
    let sessionId = null;
    let invalid = false;
    const contexts = [];
    const usages = [];
    try {
    const stream = createReadStream(file.path, { encoding: "utf8", end: limit - 1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"session_meta"') && !line.includes('"turn_context"') && !line.includes('"token_usage_record"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { result.partial = true; continue; }
      const p = entry.payload || {};
      if (entry.type === "session_meta" && typeof p.id === "string" && p.id) {
        const nextParent = typeof p.parent_thread_id === "string" && p.parent_thread_id ? p.parent_thread_id : null;
        const nextSessionId = typeof p.session_id === "string" && p.session_id ? p.session_id : null;
        if (id && (id !== p.id || parent !== nextParent || (sessionId && nextSessionId && sessionId !== nextSessionId))) invalid = true;
        id = p.id; parent = nextParent;
        sessionId ||= nextSessionId;
      } else if (entry.type === "turn_context" && typeof p.turn_id === "string" && p.turn_id && typeof p.model === "string" && p.model.trim()) {
        contexts.push([p.turn_id, p.model.trim()]);
      } else if (entry.type === "token_usage_record") {
        const total = p.usage?.total_tokens;
        const row = typeof total === "number" && Number.isFinite(total) && total >= 0 ? parseUsageRecord(entry) : null;
        if (row) usages.push({ row, threadId: p.thread_id, sessionId: p.session_id });
        else result.partial = true;
      }
    }
    } catch { result.partial = true; continue; }
    try {
      const after = await stat(file.path);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) result.partial = true;
    } catch { result.partial = true; }
    if (!id || invalid) { result.partial = true; continue; }
    let session = sessions.get(id);
    if (!session) { session = { parent, sessionId, invalid: false, contexts: [], usages: [] }; sessions.set(id, session); }
    if (session.parent !== parent || (session.sessionId && sessionId && session.sessionId !== sessionId)) session.invalid = true;
    session.sessionId ||= sessionId;
    session.contexts.push(...contexts); session.usages.push(...usages.map((item) => ({ ...item, expectedSessionId: sessionId })));
  }
  const root = sessions.get(threadId);
  if (!root || root.invalid) return { ...result, partial: true, truncated: result.truncated };
  // 即便循环包含请求根，也不能把循环中的线程当成后代。
  const rootAncestors = new Set([threadId]);
  let ancestor = root.parent;
  while (ancestor && sessions.has(ancestor)) {
    if (rootAncestors.has(ancestor)) return { ...result, partial: true };
    rootAncestors.add(ancestor);
    ancestor = sessions.get(ancestor).parent;
  }
  const belongs = (id) => {
    const visited = new Set();
    while (id !== threadId) {
      if (visited.has(id)) return false;
      visited.add(id);
      const session = sessions.get(id);
      if (!session || session.invalid || !session.parent) return false;
      id = session.parent;
    }
    return true;
  };
  for (const [id, session] of sessions) {
    if (session.invalid) { result.partial = true; continue; }
    if (!belongs(id)) continue;
    const models = new Map();
    for (const [turn, model] of session.contexts) {
      if (!models.has(turn)) models.set(turn, model);
      else if (models.get(turn) !== model) models.set(turn, null);
    }
    const seen = new Map();
    const records = [];
    for (const item of session.usages) {
      if ((item.threadId && item.threadId !== id) || (item.sessionId && (!item.expectedSessionId || item.sessionId !== item.expectedSessionId))) { result.partial = true; continue; }
      const row = item.row;
      const key = row.response_id ? JSON.stringify([row.turn_id, row.response_id]) : JSON.stringify([row.turn_id, row.observed_at, row.usage]);
      const { input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, total_tokens } = row.usage;
      const usage = { input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, total_tokens };
      const fingerprint = JSON.stringify(usage);
      if (seen.has(key)) {
        const prior = seen.get(key);
        if (prior.fingerprint !== fingerprint) { records[prior.index] = null; result.partial = true; }
        continue;
      }
      seen.set(key, { fingerprint, index: records.length });
      records.push({ threadId: id, turnId: row.turn_id, responseId: row.response_id, model: models.get(row.turn_id) || null, usage });
    }
    result.records.push(...records.filter(Boolean));
  }
  if (result.truncated) result.partial = true;
  return result;
}

export async function readThreadUsageHistory(threadId, options = {}) {
  if (!threadId) return [];
  const sessionsRoot = options.sessionsRoot || defaultSessionsRoot;
  const files = await collectRolloutFiles(threadId, sessionsRoot);

  const contents = [];
  for (const file of files) {
    try {
      contents.push(await readFile(file.path, "utf8"));
    } catch {
      // 读不到就跳过这个分段。
    }
  }

  // 第一遍：拿上下文窗口。它可能出现在对应 usage 记录之后，必须先扫完。
  let contextWindow = 0;
  for (const text of contents) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes("token_count")) continue;
      try {
        const parsed = parseContextWindow(JSON.parse(line));
        if (parsed) contextWindow = parsed;
      } catch {
        // 坏行跳过。
      }
    }
  }

  // 第二遍：取单次调用量。
  const rows = [];
  const seen = new Set();
  for (const text of contents) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes("token_usage_record")) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const row = parseUsageRecord(entry, contextWindow);
      if (!row) continue;
      // 同一次调用重放时（相同 response_id + 相同用量）只算一次。
      // 没有 response_id 时退回用时间戳：重放行的时间戳完全相同，而同一轮里的两次真实调用
      // 时间戳不同——只按 turn_id + 用量去重会把后者并成一条，历史用量偏低。
      const key = row.response_id
        ? [row.turn_id, row.response_id, row.usage.total_tokens, row.usage.output_tokens].join("|")
        : [row.turn_id, row.observed_at, row.usage.total_tokens, row.usage.output_tokens].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        observed_at: row.observed_at,
        turn_id: row.turn_id,
        usage: row.usage,
      });
    }
  }
  rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  return rows;
}
