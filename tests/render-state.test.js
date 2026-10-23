"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const baseState = {
  range: "task",
  historyLoading: false,
  historyError: "",
  globalUsageLoading: false,
  globalUsageError: "",
  historyFetchedAt: 1,
  toolExpanded: false,
  tokenExpanded: false,
  customStart: "",
  customEnd: "",
  globalUsageCoverage: { available: 0, total: 0 },
};
const fingerprintSource = [
  "function codexPlusUsageText(){return {labels:{task:'任务消耗',today:'今天消耗',yesterday:'昨天消耗',week:'近7天消耗',custom:'区间消耗'}};}",
  extract("codexPlusUsageNumber"),
  extract("codexPlusUsageFormatSpeed"),
  extract("codexPlusUsageFormatPercent"),
  extract("codexPlusUsageRangeBounds"),
  extract("codexPlusUsageIsGlobalRange"),
  extract("codexPlusUsageBeijingDate"),
  extract("codexPlusUsageGlobalDateKeys"),
  extract("codexPlusUsageGlobalTotal"),
  extract("codexPlusUsageSelectedConsumption"),
  extract("codexPlusUsageRenderFingerprint"),
].join("\n") + "\nreturn codexPlusUsageRenderFingerprint;";

function compileFingerprint(state) {
  return new Function("codexPlusUsageState", fingerprintSource)(state);
}

const baseSnapshot = {
  speed: 120,
  averageSpeed: 40,
  turnMs: 10000,
  toolMs: 100,
  toolDetails: [],
  usage: { input: 1000, output: 400, cached: 800, hitRate: 0.8, total: 1400 },
  samples: 2,
  completed: false,
};
const baseContext = { percent: 50, window: 400000 };

test("平均速度和整轮耗时变化会触发重绘", () => {
  const fingerprint = compileFingerprint({ ...baseState });
  const first = fingerprint(baseSnapshot, baseContext);
  assert.notEqual(first, fingerprint({ ...baseSnapshot, averageSpeed: 41 }, baseContext));
  assert.notEqual(first, fingerprint({ ...baseSnapshot, turnMs: 11000 }, baseContext));
});

test("全局加载和错误状态变化会触发重绘", () => {
  const fingerprint = compileFingerprint({ ...baseState });
  const first = fingerprint(baseSnapshot, baseContext);
  assert.notEqual(
    first,
    compileFingerprint({ ...baseState, globalUsageLoading: true })(baseSnapshot, baseContext),
  );
  assert.notEqual(
    first,
    compileFingerprint({ ...baseState, globalUsageError: "failed" })(baseSnapshot, baseContext),
  );
});
