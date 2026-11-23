"use strict";

// rollout 历史解析的契约测试。
//
// 这些断言钉住一个真实故障：宿主曾把 token_count 的 total_token_usage（线程累计量，
// 该线程已到 9167 万）当成单次调用量喂给 tokenlens.js，导致 TOP3 显示
// 「9167.95万」这种不可能的单次调用，柱状图刻度顶到 10240 万。

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("../standalone/rollout-history.mjs");

// 每个用例一个独立目录：collectRolloutFiles 按文件名含 threadId 匹配，
// 共用目录会互相污染。
let tmpRoot = "";
const freshRoot = () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenlens-rollout-"));
  return tmpRoot;
};

const writeRollout = (root, name, lines) => {
  const dir = path.join(root, "2026", "11", "23");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return file;
};

const usageRecord = (timestamp, turnId, responseId, input, output, threadTotal) => ({
  timestamp,
  ordinal: 1,
  type: "token_usage_record",
  payload: {
    thread_id: "thread-1",
    turn_id: turnId,
    session_id: "thread-1",
    response_id: responseId,
    usage: {
      input_tokens: input,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: output,
      reasoning_output_tokens: 0,
      total_tokens: input + output,
    },
    turn_token_usage: { total_tokens: input + output },
    thread_token_usage: { total_tokens: threadTotal },
  },
});

const tokenCount = (timestamp, contextWindow) => ({
  timestamp,
  ordinal: 2,
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: 99999999, total_tokens: 99999999 },
      last_token_usage: { total_tokens: 300 },
      model_context_window: contextWindow,
    },
  },
});

test("单次调用量取自 token_usage_record 的 usage，不是累计量", async () => {
  const root = freshRoot();
  writeRollout(root, "rollout-a-thread-1.jsonl", [
    usageRecord("2026-11-23T00:00:00.000Z", "t1", "r1", 300, 20, 91679527),
    tokenCount("2026-11-23T00:00:01.000Z", 486400),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usage.total_tokens, 320, "单次调用量应为 320，而不是累计的 9167 万");
  assert.ok(rows[0].usage.total_tokens < 1000000, "单次调用量不可能达到百万级");
});

test("累计量只进 contextUsed", async () => {
  const root = freshRoot();
  writeRollout(root, "rollout-b-thread-1.jsonl", [
    usageRecord("2026-11-23T00:00:00.000Z", "t1", "r1", 300, 20, 91679527),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.equal(rows[0].usage.contextUsed, 91679527, "线程累计量应落在 contextUsed");
  assert.equal(rows[0].usage.total_tokens, 320);
});

test("上下文窗口从 token_count 取，且不受出现顺序影响", async () => {
  // token_count 排在 usage 记录之后，也要能取到窗口。
  const root = freshRoot();
  writeRollout(root, "rollout-c-thread-1.jsonl", [
    usageRecord("2026-11-23T00:00:00.000Z", "t1", "r1", 300, 20, 500),
    tokenCount("2026-11-23T00:00:05.000Z", 486400),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.equal(rows[0].usage.contextLimit, 486400);
});

test("token_count 的累计量绝不能当单次调用量", async () => {
  // 只有 token_count、没有 usage 记录时，必须一行都不产出。
  const root = freshRoot();
  writeRollout(root, "rollout-d-thread-1.jsonl", [
    tokenCount("2026-11-23T00:00:00.000Z", 486400),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.equal(rows.length, 0, "token_count 不是调用记录，不能产出历史样本");
});

test("同一次调用重放只算一次", async () => {
  const root = freshRoot();
  writeRollout(root, "rollout-e-thread-1.jsonl", [
    usageRecord("2026-11-23T00:00:00.000Z", "t1", "r1", 300, 20, 500),
    usageRecord("2026-11-23T00:00:09.000Z", "t1", "r1", 300, 20, 500),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.equal(rows.length, 1);
});

test("按时间排序", async () => {
  const root = freshRoot();
  writeRollout(root, "rollout-f-thread-1.jsonl", [
    usageRecord("2026-11-23T00:00:10.000Z", "t1", "r2", 300, 20, 500),
    usageRecord("2026-11-23T00:00:00.000Z", "t1", "r1", 300, 20, 500),
  ]);
  const rows = await mod.readThreadUsageHistory("thread-1", { sessionsRoot: root });
  assert.deepEqual(rows.map((r) => r.usage.total_tokens), [320, 320]);
  assert.ok(Date.parse(rows[0].observed_at) <= Date.parse(rows[1].observed_at));
});

test("parseUsageRecord 只认顶层 type=token_usage_record", () => {
  assert.equal(mod.parseUsageRecord({ type: "event_msg", payload: { type: "token_usage_record", usage: {} } }), null);
  assert.equal(mod.parseUsageRecord({ type: "token_usage_record", payload: { usage: {} } }), null, "缺时间戳也不行");
  const row = mod.parseUsageRecord({
    timestamp: "2026-11-23T00:00:00.000Z",
    type: "token_usage_record",
    payload: { turn_id: "t1", response_id: "r1", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
  }, 486400);
  assert.equal(row.usage.total_tokens, 15);
  assert.equal(row.usage.contextLimit, 486400);
  assert.equal(row.usage.contextUsed, 0);
});
