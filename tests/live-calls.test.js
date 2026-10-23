"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const callSample = new Function(
  "codexPlusUsageMaxLiveSamples",
  extract("codexPlusUsageCallSample") + "\n" + extract("codexPlusUsageRememberCallSample")
    + "\nreturn { callSample: codexPlusUsageCallSample, remember: codexPlusUsageRememberCallSample };",
)(512);

const chartCalls = new Function(
  "codexPlusUsageMaxChartBars",
  [
    extract("codexPlusUsageNumber"),
    extract("codexPlusUsageMergeHistorySamples"),
    extract("codexPlusUsageSampleKey"),
    extract("codexPlusUsageChartCalls"),
    extract("codexPlusUsageChartWindow"),
  ].join("\n") + "\nreturn { chartCalls: codexPlusUsageChartCalls, chartWindow: codexPlusUsageChartWindow };",
)(200);

test("实时逐次调用优先使用 last 用量而不是轮次累计", () => {
  const sample = callSample.callSample(
    { turnId: "turn-1" },
    { input: 1000, cached: 800, output: 120, total: 1120 },
    { input: 1000, cached: 800, output: 120, total: 1120 },
    1234,
    { total: 5000 },
  );
  assert.deepEqual(sample, {
    turnId: "turn-1",
    observedAt: 1234,
    input: 1000,
    cached: 800,
    output: 120,
    total: 1120,
    contextTokens: 5000,
  });
});

test("实时 callSamples 合并后保留全部中间调用", () => {
  const snapshot = {
    samples: 5,
    lastCallTokens: 500,
    callSamples: [100, 200, 300, 400, 500].map((value, index) => ({
      turnId: "turn-1",
      observedAt: 1000 + index,
      input: value / 2,
      cached: 0,
      output: value / 2,
      total: value,
      contextTokens: value,
    })),
  };
  const calls = chartCalls.chartCalls([], snapshot, "turn-1", 2000);
  assert.deepEqual(calls.map((call) => call.tokens), [100, 200, 300, 400, 500]);
  assert.equal(calls.at(-1).isCurrent, true);
});

test("图表只渲染最近 200 次调用，排行数据不受影响", () => {
  const calls = Array.from({ length: 260 }, (_, index) => ({ tokens: index + 1 }));
  const windowed = chartCalls.chartWindow(calls);
  assert.equal(windowed.length, 200);
  assert.equal(windowed[0].tokens, 61);
  assert.equal(windowed.at(-1).tokens, 260);
});
