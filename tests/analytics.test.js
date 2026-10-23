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

const averageSpeed = new Function(
  extract("codexPlusUsageAverageSpeed") + "\nreturn codexPlusUsageAverageSpeed;",
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

test("平均速度按当前轮输出与整轮耗时计算", () => {
  assert.equal(averageSpeed(2000, 10000), 200);
  assert.equal(averageSpeed(0, 10000), null);
  assert.equal(averageSpeed(2000, 0), null);
});
