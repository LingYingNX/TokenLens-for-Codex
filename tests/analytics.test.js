"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const turnGroups = new Function(
  extract("codexPlusUsageTurnGroups") + "\nreturn codexPlusUsageTurnGroups;",
)();

const averageSpeed = new Function(
  extract("codexPlusUsageDecodeSpeed") + "\n"
  + extract("codexPlusUsageAverageSpeed") + "\nreturn codexPlusUsageAverageSpeed;",
)();

test("按轮次汇总调用次数与 token", () => {
  const groups = turnGroups([
    { turnId: "t1", observedAt: 10, total: 100 },
    { turnId: "t1", observedAt: 20, total: 50 },
    { turnId: "t2", observedAt: 30, total: 300 },
  ], null, "t1", 40);
  assert.deepEqual(groups.map(({ turnId, calls, tokens }) => ({ turnId, calls, tokens })), [
    { turnId: "t1", calls: 2, tokens: 150 },
    { turnId: "t2", calls: 1, tokens: 300 },
  ]);
});

test("实时快照覆盖同一轮的缺失或较小计数", () => {
  const groups = turnGroups([
    { turnId: "t1", observedAt: 10, total: 100 },
  ], { samples: 3, usage: { total: 240 } }, "t1", 50);
  assert.deepEqual(groups.map(({ turnId, calls, tokens }) => ({ turnId, calls, tokens })), [
    { turnId: "t1", calls: 3, tokens: 240 },
  ]);
});

test("没有轮次 id 的实时数据仍进入图表", () => {
  const groups = turnGroups([], { samples: 1, usage: { total: 12 } }, "", 50);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].turnId, "live");
  assert.equal(groups[0].tokens, 12);
});

test("平均速度使用本轮多次调用的输出与解码时间总和", () => {
  assert.equal(averageSpeed(1800, 10000), 180);
  assert.equal(averageSpeed(0, 10000), null);
  assert.equal(averageSpeed(1800, 0), null);
});
