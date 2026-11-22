"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const historySamples = new Function(
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

const row = (turnId, total, contextUsed, second) => ({
  turn_id: turnId,
  observed_at: "2026-10-22T00:00:" + String(second).padStart(2, "0") + "Z",
  usage: { inputTokens: total, outputTokens: 0, totalTokens: total, cachedTokens: 0, contextUsed },
});

test("同一条记录换个时间戳重放只算一次", () => {
  const samples = historySamples({ history: [row("t1", 100, 100, 1), row("t1", 100, 100, 2)] });
  assert.equal(samples.length, 1);
});

test("乱序重放的旧累计值不再计入", () => {
  const samples = historySamples({ history: [row("t1", 100, 100, 1), row("t1", 150, 150, 2), row("t1", 100, 100, 3)] });
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.total), [100, 150]);
});

test("累计值递增的不同调用都保留", () => {
  const samples = historySamples({ history: [row("t1", 100, 100, 1), row("t1", 250, 250, 2), row("t2", 300, 300, 3)] });
  assert.equal(samples.length, 3);
});

test("不同轮次撞上相同累计值与用量都保留", () => {
  const samples = historySamples({ history: [row("t1", 100, 100, 1), row("t2", 100, 100, 2)] });
  assert.equal(samples.length, 2);
});

test("压缩后同一轮累计值重算但用量不同仍保留", () => {
  const samples = historySamples({ history: [row("t1", 100, 100, 1), row("t1", 120, 100, 2)] });
  assert.equal(samples.length, 2);
});

test("分段返回变短时并集保留已经统计的调用", () => {
  const first = row("t1", 100, 100, 1);
  const second = row("t1", 250, 250, 2);
  const third = row("t2", 300, 300, 3);
  const merged = mergeHistorySamples(
    historySamples({ history: [first, second, third] }),
    historySamples({ history: [third] }),
  );
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((sample) => sample.total), [100, 250, 300]);
});

test("缺累计值的记录退回时间戳组合键", () => {
  const first = { turn_id: "t1", observed_at: "2026-10-22T00:00:01Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  const second = { ...first, observed_at: "2026-10-22T00:00:02Z" };
  assert.equal(historySamples({ history: [first, second] }).length, 2);
  assert.equal(historySamples({ history: [first, first] }).length, 1);
});

test("切换线程不继承上一个线程的历史样本", async () => {
  const rows = { A: [row("ta", 100, 100, 1)], B: [row("tb", 200, 200, 2)] };
  const state = {
    disposed: false,
    threadId: "A",
    historyThreadId: "A",
    historySamples: [],
    historyFetchedAt: 0,
    historyLoading: false,
    historyError: "",
    historyPromise: null,
    turns: new Map(),
  };
  const window = {
    codexPlus: { call: async (route, args) => ({ history: rows[args.session_id] }) },
    clearTimeout() {},
  };
  const load = new Function(
    "window",
    "codexPlusUsageState",
    [
      extract("codexPlusUsageNumber"),
      extract("codexPlusUsageFieldNumber"),
      extract("codexPlusUsageTokenTotals"),
      extract("codexPlusUsageHistorySamples"),
      extract("codexPlusUsageMergeHistorySamples"),
      "function codexPlusUsageSeedHistoryTurn() {}",
      "function codexPlusUsageRender() {}",
      "function codexPlusUsageTurnSnapshot() { return null; }",
      extract("codexPlusUsageLoadHistory"),
    ].join("\n") + "\nreturn codexPlusUsageLoadHistory;",
  )(window, state);

  await load(true);
  assert.deepEqual(state.historySamples.map((sample) => sample.turnId), ["ta"]);
  state.threadId = "B";
  await load(true);
  assert.deepEqual(state.historySamples.map((sample) => sample.turnId), ["tb"]);
  assert.equal(state.historyThreadId, "B");
});
