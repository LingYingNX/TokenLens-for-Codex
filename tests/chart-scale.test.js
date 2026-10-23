"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const turnGroups = new Function(
  extract("codexPlusUsageTurnGroups") + "\nreturn codexPlusUsageTurnGroups;",
)();

const chartHelpers = new Function(
  [
    extract("codexPlusUsageNumber"),
    extract("codexPlusUsageMergeHistorySamples"),
    extract("codexPlusUsageSampleKey"),
    extract("codexPlusUsageChartCalls"),
    extract("codexPlusUsageChartScale"),
  ].join("\n") + "\nreturn { chartCalls: codexPlusUsageChartCalls, chartScale: codexPlusUsageChartScale };",
)();
const { chartCalls, chartScale } = chartHelpers;

test("柱状图按轮保留单次最大 token", () => {
  const groups = turnGroups([
    { turnId: "t1", observedAt: 10, total: 100 },
    { turnId: "t1", observedAt: 20, total: 50 },
    { turnId: "t2", observedAt: 30, total: 300 },
  ], null, "t1", 40, "max");
  assert.deepEqual(groups.map(({ turnId, calls, tokens }) => ({ turnId, calls, tokens })), [
    { turnId: "t1", calls: 2, tokens: 100 },
    { turnId: "t2", calls: 1, tokens: 300 },
  ]);
});

test("轮累计快照不能放大柱高", () => {
  const groups = turnGroups([
    { turnId: "t1", observedAt: 10, total: 100 },
  ], { samples: 3, usage: { total: 240 } }, "t1", 50, "max");
  assert.deepEqual(groups.map(({ turnId, calls, tokens }) => ({ turnId, calls, tokens })), [
    { turnId: "t1", calls: 3, tokens: 100 },
  ]);
});

test("单次实时快照仍可作为柱高回退", () => {
  const groups = turnGroups([], { samples: 1, usage: { total: 12 } }, "", 50, "max");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].turnId, "live");
  assert.equal(groups[0].tokens, 12);
});

test("柱状图按时间保留超过 20 次的全部调用", () => {
  const samples = Array.from({ length: 25 }, (_, index) => ({
    turnId: "t1",
    observedAt: 1000 + index,
    total: 10000 + index,
  }));
  const calls = chartCalls(samples, null, "t1", 2000);

  assert.equal(calls.length, 25);
  assert.equal(calls[0].tokens, 10000);
  assert.equal(calls[24].tokens, 10024);
});

test("柱状图刻度从 10 万开始逐级翻倍", () => {
  assert.deepEqual(chartScale(0), { top: 100000, mid: 50000 });
  assert.deepEqual(chartScale(100000), { top: 100000, mid: 50000 });
  assert.deepEqual(chartScale(100001), { top: 200000, mid: 100000 });
  assert.deepEqual(chartScale(200000), { top: 200000, mid: 100000 });
  assert.deepEqual(chartScale(200001), { top: 400000, mid: 200000 });
  assert.deepEqual(chartScale(400000), { top: 400000, mid: 200000 });
  assert.deepEqual(chartScale(400001), { top: 800000, mid: 400000 });
  assert.deepEqual(chartScale(800001), { top: 1600000, mid: 800000 });
});
