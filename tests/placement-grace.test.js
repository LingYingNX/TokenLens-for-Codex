"use strict";

// 切换会话时状态栏不能先消失再出现。
//
// 真实故障：在 Codex 里切会话，Composer 会被整体拆掉重建，这一瞬间既有 card 也可能
// 没有 threadId。旧实现立刻 codexPlusUsageHide()，于是状态栏闪掉，等下一轮渲染再出现。
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "tokenlens.js"), "utf8");

test("切换会话时状态栏有宽限期，不会立刻隐藏", () => {
  assert.match(source, /codexPlusUsagePlacementGraceMs/, "必须有宽限时长常量");
  assert.match(source, /placementGraceTimer/, "必须有宽限计时器");
  assert.match(source, /function codexPlusUsageClearPlacementGrace/, "必须能取消宽限");
  // 宽限期内的分支必须什么都不做（保持显示），不能调用隐藏。
  const graceBlock = source.slice(
    source.indexOf("if (!codexPlusUsageState.placementGraceTimer) {"),
    source.indexOf("if (!codexPlusUsageState.placementGraceTimer) {") + 400,
  );
  assert.match(graceBlock, /setTimeout/, "宽限期要用计时器实现");
});

test("宽限期内用短间隔重新探测，新会话一挂上就恢复", () => {
  // 只给宽限不重探的话，宽限期结束时如果新会话还没挂上，就会一直隐藏到下一轮 tick。
  assert.match(source, /codexPlusUsagePlacementProbeMs/, "必须有快速重探间隔");
  const graceCall = source.indexOf("codexPlusUsageSchedule(codexPlusUsagePlacementProbeMs);");
  assert.ok(graceCall > 0, "缺 card 时必须安排一次快速重探");
  assert.match(source, /const codexPlusUsagePlacementProbeMs = 200;/, "重探间隔应远小于 1 秒");
});

test("找到新会话后立刻取消宽限", () => {
  assert.match(source, /codexPlusUsageClearPlacementGrace\(\);\n    const threadChanged/, "拿到 card 与 threadId 后必须清计时器");
});

test("卸载时清掉宽限计时器", () => {
  const disposeIndex = source.indexOf("clearTimeout(codexPlusUsageState.hideTimer);");
  assert.ok(disposeIndex > 0);
  assert.match(source.slice(disposeIndex, disposeIndex + 200), /codexPlusUsageClearPlacementGrace\(\)/, "dispose 必须清理");
});
