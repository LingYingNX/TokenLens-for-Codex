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

const contextApi = new Function(
  extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageClamp") + "\n"
  + extract("codexPlusUsageContextSnapshot") + "\n"
  + extract("codexPlusUsageLatestLiveContext") + "\n"
  + extract("codexPlusUsageFormatTokenWindow") + "\n"
  + extract("codexPlusUsageFormatContext") + "\n"
  + "return { codexPlusUsageContextSnapshot, codexPlusUsageLatestLiveContext, "
  + "codexPlusUsageFormatTokenWindow, codexPlusUsageFormatContext };",
)();

test("实时线程窗口覆盖历史 1M 快照", () => {
  const context = contextApi.codexPlusUsageContextSnapshot({
    contextTokens: 200000,
    contextWindow: 1048576,
  }, { contextWindow: 400000 });
  assert.equal(context.window, 400000);
  assert.equal(context.percent, 50);
});

test("不同任务使用各自的实时上下文窗口", () => {
  const first = contextApi.codexPlusUsageContextSnapshot(
    { contextTokens: 200000 },
    { contextWindow: 400000 },
  );
  const second = contextApi.codexPlusUsageContextSnapshot(
    { contextTokens: 200000 },
    { contextWindow: 1048576 },
  );
  assert.equal(first.percent, 50);
  assert.equal(second.percent, 19.073486328125);
});

test("没有实时轮次快照时仍使用线程上下文读数", () => {
  const context = contextApi.codexPlusUsageContextSnapshot(null, {
    contextTokens: 200000,
    contextWindow: 400000,
  });
  assert.deepEqual(context, { percent: 50, window: 400000, tokens: 200000 });
});

test("线程尾部事件取最新窗口和上下文占用", () => {
  const context = contextApi.codexPlusUsageLatestLiveContext([
    { total_tokens: 500000, context_window: 1048576 },
    { total_tokens: 200000, context_window: 400000 },
  ]);
  assert.deepEqual(context, { contextTokens: 200000, contextWindow: 400000 });
});

test("上下文显示为百分比和紧凑窗口大小", () => {
  assert.equal(contextApi.codexPlusUsageFormatContext(50, 400000), "50%/400K");
  assert.equal(contextApi.codexPlusUsageFormatTokenWindow(1048576), "1M");
  assert.equal(contextApi.codexPlusUsageFormatContext(66.38, 400000), "66.4%/400K");
});
