"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "tokenlens.js"), "utf8");

function extract(name) {
  const start = source.indexOf("  function " + name + "(") >= 0
    ? source.indexOf("  function " + name + "(")
    : source.indexOf("  async function " + name + "(");
  if (start < 0) throw new Error("missing function: " + name);
  let index = source.indexOf("{", start);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  return source.slice(start, index);
}

const rawHistorySamples = new Function(
  extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageFieldNumber") + "\n"
  + extract("codexPlusUsageTokenTotals") + "\n"
  + extract("codexPlusUsageNormalizeThreadId") + "\n"
  + extract("codexPlusUsageRawHistorySamples") + "\n"
  + "return codexPlusUsageRawHistorySamples;",
)();

const hostHistorySamples = new Function(
  extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageFieldNumber") + "\n"
  + extract("codexPlusUsageTokenTotals") + "\n"
  + extract("codexPlusUsageHistorySamples") + "\n"
  + "return codexPlusUsageHistorySamples;",
)();

const mergeHistorySamples = new Function(
  extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageMergeHistorySamples") + "\n"
  + "return codexPlusUsageMergeHistorySamples;",
)();

const rolloutPathInfo = new Function(
  extract("codexPlusUsageRolloutPathInfo") + "\nreturn codexPlusUsageRolloutPathInfo;",
)();

const rolloutPaths = new Function(
  extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageFieldNumber") + "\n"
  + extract("codexPlusUsageTokenTotals") + "\n"
  + extract("codexPlusUsageNormalizeThreadId") + "\n"
  + extract("codexPlusUsageUuidTime") + "\n"
  + extract("codexPlusUsageRolloutPathInfo") + "\n"
  + extract("codexPlusUsageLocalDateKey") + "\n"
  + extract("codexPlusUsageHistoryMonthKeys") + "\n"
  + extract("codexPlusUsageRolloutNameMatches") + "\n"
  + extract("codexPlusUsageMapLimit") + "\n"
  + extract("codexPlusUsageRolloutPaths") + "\n"
  + "return codexPlusUsageRolloutPaths;",
)();

function tokenRecord(timestamp, turnId, responseId, output, threadTotal) {
  return JSON.stringify({
    timestamp,
    type: "token_usage_record",
    payload: {
      thread_id: "01a15db6-5b64-7c42-9266-295685157657",
      turn_id: turnId,
      response_id: responseId,
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 500,
        output_tokens: output,
        total_tokens: 1000 + output,
      },
      thread_token_usage: {
        input_tokens: threadTotal - output,
        cached_input_tokens: 500,
        output_tokens: output,
        total_tokens: threadTotal,
      },
    },
  });
}

test("跨 rollout 分段保留每次模型输出", () => {
  const first = rawHistorySamples([
    tokenRecord("2026-10-21T09:07:12.891Z", "turn-1", "response-1", 12000, 13000),
  ].join("\n"), { threadId: "01a15db6-5b64-7c42-9266-295685157657" });
  const second = rawHistorySamples([
    tokenRecord("2026-10-22T05:58:28.760Z", "turn-2", "response-2", 220000, 223000),
  ].join("\n"), { threadId: "01a15db6-5b64-7c42-9266-295685157657" });
  const merged = mergeHistorySamples(first, second);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((sample) => sample.output), [12000, 220000]);
  assert.deepEqual(merged.map((sample) => sample.turnId), ["turn-1", "turn-2"]);
});

test("宿主最新分段与原始记录按累计值去重", () => {
  const raw = rawHistorySamples([
    tokenRecord("2026-10-22T05:58:28.760Z", "turn-1", "response-1", 220000, 223000),
  ].join("\n"), { threadId: "01a15db6-5b64-7c42-9266-295685157657" });
  const host = [{
    observedAt: Date.parse("2026-10-22T05:58:31.707Z"),
    turnId: "turn-1",
    input: 1000,
    cached: 500,
    output: 220000,
    total: 221000,
    contextTokens: 223000,
  }];

  assert.equal(mergeHistorySamples(raw, host).length, 1);
});

test("宿主历史样本保留 cumulative contextUsed", () => {
  const samples = hostHistorySamples({
    history: [{
      turn_id: "turn-1",
      observed_at: "2026-10-22T05:58:31.707Z",
      usage: {
        inputTokens: 226737,
        cachedTokens: 224000,
        outputTokens: 1642,
        totalTokens: 228379,
        contextUsed: 167708582,
      },
    }],
  });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].contextTokens, 167708582);
});

test("旧格式 token_count 使用当前轮及 last_token_usage", () => {
  const samples = rawHistorySamples([
    JSON.stringify({
      timestamp: "2026-10-21T09:00:00.000Z",
      type: "turn_context",
      payload: { turn_id: "legacy-turn" },
    }),
    JSON.stringify({
      timestamp: "2026-10-21T09:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 400,
            output_tokens: 12000,
            total_tokens: 13000,
          },
          total_token_usage: {
            input_tokens: 9000,
            cached_input_tokens: 4000,
            output_tokens: 12000,
            total_tokens: 21000,
          },
          model_context_window: 1048576,
        },
      },
    }),
  ].join("\n"), { threadId: "01a15db6-5b64-7c42-9266-295685157657" });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].turnId, "legacy-turn");
  assert.equal(samples[0].output, 12000);
  assert.equal(samples[0].contextTokens, 21000);
});

test("枚举同会话不同日期的 rollout 文件", async () => {
  const threadId = "01a15db6-5b64-7c42-9266-295685157657";
  const latestPath = "C:/Users/LYNX/.codex/sessions/2026/10/22/rollout-2026-10-22T13-58-15-" + threadId + "_child.jsonl";
  const services = {
    workspaceFiles: {
      listDirectory: async ({ directoryPath }) => {
        if (directoryPath === "2026/10") {
          return {
            entries: [
              { name: "21", path: "2026/10/21", type: "directory" },
              { name: "22", path: "2026/10/22", type: "directory" },
            ],
          };
        }
        if (directoryPath === "2026/10/21") {
          return {
            entries: [{
              name: "rollout-2026-10-21T17-06-34-" + threadId + ".jsonl",
              path: "2026/10/21/rollout-2026-10-21T17-06-34-" + threadId + ".jsonl",
              type: "file",
            }],
          };
        }
        if (directoryPath === "2026/10/22") {
          return {
            entries: [{
              name: latestPath.split("/").at(-1),
              path: "2026/10/22/" + latestPath.split("/").at(-1),
              type: "file",
            }],
          };
        }
        return { entries: [] };
      },
    },
  };

  const paths = await rolloutPaths(threadId, latestPath, services);
  assert.equal(paths.length, 2);
  assert.ok(paths.some((value) => value.includes("/2026/10/21/")));
  assert.ok(paths.some((value) => value.includes("/2026/10/22/")));
});

test("Windows 扩展路径归一为 Codex sessions 根目录", () => {
  const info = rolloutPathInfo(String.raw`\\?\C:\Users\LYNX\.codex\sessions\2026\10\21\rollout.jsonl`);
  assert.equal(info.sessionsRoot, "C:/Users/LYNX/.codex/sessions");
  assert.equal(info.dateKey, "2026-10-21");
});
