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

test("缺累计值的记录退回时间戳组合键", () => {
  const first = { turn_id: "t1", observed_at: "2026-10-22T00:00:01Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  const second = { ...first, observed_at: "2026-10-22T00:00:02Z" };
  assert.equal(historySamples({ history: [first, second] }).length, 2);
  assert.equal(historySamples({ history: [first, first] }).length, 1);
});
