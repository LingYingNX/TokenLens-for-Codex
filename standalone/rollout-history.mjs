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
