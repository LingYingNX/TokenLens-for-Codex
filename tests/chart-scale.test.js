"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "tokenlens.js"), "utf8");

function extract(name) {
  const start = source.indexOf("  function " + name + "(");
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

const turnGroups = new Function(
  extract("codexPlusUsageTurnGroups") + "\nreturn codexPlusUsageTurnGroups;",
)();

const chartHelpers = new Function(
  [
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

test("柱状图刻度从 36 万开始逐级翻倍", () => {
  assert.deepEqual(chartScale(0), { top: 360000, mid: 180000 });
  assert.deepEqual(chartScale(360000), { top: 360000, mid: 180000 });
  assert.deepEqual(chartScale(360001), { top: 360000, mid: 180000 });
  assert.deepEqual(chartScale(396000), { top: 360000, mid: 180000 });
  assert.deepEqual(chartScale(396001), { top: 720000, mid: 360000 });
  assert.deepEqual(chartScale(720000), { top: 720000, mid: 360000 });
  assert.deepEqual(chartScale(792000), { top: 720000, mid: 360000 });
  assert.deepEqual(chartScale(792001), { top: 1440000, mid: 720000 });
});
