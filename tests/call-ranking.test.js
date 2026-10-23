"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const ranking = new Function(
  [
    extract("codexPlusUsageNumber"),
    extract("codexPlusUsageMergeHistorySamples"),
    extract("codexPlusUsageSampleKey"),
    extract("codexPlusUsageChartCalls"),
    extract("codexPlusUsageTopCalls"),
  ].join("\n") + "\nreturn { chartCalls: codexPlusUsageChartCalls, topCalls: codexPlusUsageTopCalls };",
)();
const { chartCalls, topCalls } = ranking;

const decodeSpeed = new Function(
  extract("codexPlusUsageDecodeSpeed") + "\nreturn codexPlusUsageDecodeSpeed;",
)();

const formatSpeed = new Function(
  extract("codexPlusUsageFormatSpeed") + "\nreturn codexPlusUsageFormatSpeed;",
)();

const wanNumber = new Function(
  extract("codexPlusUsageWanNumber") + "\nreturn codexPlusUsageWanNumber;",
)();

test("TOP 按单次调用总 token 排序，不按轮次累计 token 排序", () => {
  const ranked = topCalls([
    { turnId: "t1", observedAt: 10, output: 120000, total: 330000 },
    { turnId: "t1", observedAt: 20, output: 220000, total: 180000 },
    { turnId: "t2", observedAt: 30, output: 180000, total: 220000 },
  ], null, "t1", 40);

  assert.deepEqual(ranked.map(({ tokens }) => tokens), [330000, 220000, 180000]);
});

test("单次实时快照缺少历史样本时可作为 TOP 回退", () => {
  const ranked = topCalls([], { samples: 1, usage: { output: 9000, total: 90000 } }, "live", 50);

  assert.deepEqual(ranked.map(({ turnId, tokens, observedAt }) => ({ turnId, tokens, observedAt })), [
    { turnId: "live", tokens: 90000, observedAt: 50 },
  ]);
  assert.equal(ranked[0].id, chartCalls([], { samples: 1, usage: { total: 90000 } }, "live", 50)[0].id);
});

test("吞吐量按累计输出 token 除以累计解码时间", () => {
  assert.equal(decodeSpeed(7922, 38613), 205.16406391629764);
  assert.equal(decodeSpeed(0, 38613), null);
  assert.equal(decodeSpeed(7922, 0), null);
});

test("吞吐量显示规则与 DSH 一致", () => {
  assert.equal(formatSpeed(205.164), "205");
  assert.equal(formatSpeed(9.84), "9.8");
});

test("万单位低于十万时保留一位小数", () => {
  assert.equal(wanNumber(2200), 0.2);
  assert.equal(wanNumber(330000), 33);
});

test("十万以上保留两位小数，避免 TOP 峰值显示成同一个值", () => {
  assert.equal(wanNumber(360424), 36.04);
  assert.equal(wanNumber(360231), 36.02);
  assert.equal(wanNumber(359561), 35.96);
});
