"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const turnGroups = new Function(
  extract("codexPlusUsageTurnGroups") + "\nreturn codexPlusUsageTurnGroups;",
)();

const averageSpeed = new Function(
  "codexPlusUsageSpeedPeak",
  "codexPlusUsageSpeedMinimumDecodeMs",
  "codexPlusUsageSpeedMinimumOutputTokens",
  extract("codexPlusUsageDecodeSpeed") + "\n"
  + extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageSettledSpeed") + "\n"
  + extract("codexPlusUsageAverageSpeed") + "\nreturn codexPlusUsageAverageSpeed;",
)(400, 1000, 30);

const settledSpeed = new Function(
  "codexPlusUsageSpeedPeak",
  "codexPlusUsageSpeedMinimumDecodeMs",
  "codexPlusUsageSpeedMinimumOutputTokens",
  extract("codexPlusUsageDecodeSpeed") + "\n"
  + extract("codexPlusUsageNumber") + "\n"
  + extract("codexPlusUsageSettledSpeed") + "\nreturn codexPlusUsageSettledSpeed;",
)(400, 1000, 30);

const settlement = new Function(
  "codexPlusUsageMaxLiveSamples",
  [
    extract("codexPlusUsageNumber"),
    extract("codexPlusUsageCreateTurn"),
    extract("codexPlusUsageFlushDecode"),
    extract("codexPlusUsageSettleCall"),
  ].join("\n")
    + "\nreturn { createTurn: codexPlusUsageCreateTurn, flush: codexPlusUsageFlushDecode, settle: codexPlusUsageSettleCall };",
)(512);

const modelWindowSpeed = new Function(
  "codexPlusUsageSpeedPeak",
  "codexPlusUsageSpeedWindowMs",
  "codexPlusUsageSpeedMinimumDecodeMs",
  "codexPlusUsageSpeedMinimumOutputTokens",
  [
    extract("codexPlusUsageNumber"),
    extract("codexPlusUsageClamp"),
    extract("codexPlusUsageMergedDuration"),
    extract("codexPlusUsageDecodeSpeed"),
    extract("codexPlusUsageSettledSpeed"),
    extract("codexPlusUsageModelWindowSpeed"),
  ].join("\n")
    + "\nreturn codexPlusUsageModelWindowSpeed;",
)(400, 3_000, 1000, 30);

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

test("已结算调用的累计吞吐速度", () => {
  const calls = [
    { output: 210, decodeMs: 1189 },
    { output: 7712, decodeMs: 37424 },
  ];
  assert.equal(settledSpeed(calls), 7922 / 38.613);
  assert.equal(settledSpeed([]), null);
  assert.equal(settledSpeed([{ output: 0, decodeMs: 1000 }]), null);
});

test("平均速度按 token 加权，不使用逐调用算术平均", () => {
  const calls = [
    { output: 300, decodeMs: 1000 },
    { output: 100, decodeMs: 1000 },
    { output: 200, decodeMs: 2000 },
  ];
  assert.equal(averageSpeed(calls), 150);
  assert.equal(averageSpeed([]), null);
  assert.equal(averageSpeed([{ output: 100, decodeMs: 0 }]), null);
});

test("平均速度静默排除短解码与超出峰值的突发样本", () => {
  const calls = [
    { output: 100, decodeMs: 1000 },
    { output: 2704, decodeMs: 8 },
    { output: 2704, decodeMs: 300 },
  ];
  assert.equal(averageSpeed(calls), 100);
  assert.equal(averageSpeed([{ output: 80, decodeMs: 8 }]), null);
});

test("不足一秒的调用不产生速度，满一秒仍参与计算", () => {
  assert.equal(settledSpeed([{ output: 275, decodeMs: 999 }]), null);
  assert.equal(settledSpeed([{ output: 275, decodeMs: 1000 }]), 275);
});

test("短调用不会覆盖已有有效速度", () => {
  const turn = {
    startedAt: 0,
    completedAt: 5_000,
    firstTokenAt: 0,
    outputTokens: 475,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [
      { output: 200, decodeMs: 1_000, observedAt: 1_000 },
      { output: 275, decodeMs: 999, observedAt: 5_000 },
    ],
  };
  assert.equal(modelWindowSpeed(turn, 5_000), 200);
});

test("用量通知晚于解码结束时仍与本次调用时长配对", () => {
  const turn = settlement.createTurn("t1", "turn-1", 0);
  turn.decodeStartedAt = 0;
  settlement.flush(turn, 10000);
  turn.pendingOutput = 900;
  settlement.settle(turn);
  assert.deepEqual(turn.settledCalls, [{ output: 900, decodeMs: 10000 }]);

  const reverse = settlement.createTurn("t2", "turn-2", 0);
  reverse.decodeStartedAt = 0;
  reverse.pendingOutput = 500;
  settlement.flush(reverse, 2000);
  assert.deepEqual(reverse.settledCalls, [{ output: 500, decodeMs: 2000, observedAt: 2000 }]);
});

test("主指标剔除首 token 等待与工具执行时间", () => {
  const turn = {
    startedAt: 0,
    completedAt: 100_000,
    firstTokenAt: 4_000,
    outputTokens: 9_600,
    toolIntervals: [[10_000, 40_000]],
    settledCalls: [],
  };
  // 窗口 = 100s − 4s TTFT − 30s 工具 = 66s；9600 / 66 = 145.45
  assert.equal(modelWindowSpeed(turn, 100_000), 9600 / 66);
});

test("主指标优先使用已结算调用的 token 加权速度", () => {
  const turn = {
    startedAt: 0,
    completedAt: 30_000,
    firstTokenAt: 4_000,
    outputTokens: 9_600,
    toolIntervals: [[10_000, 40_000]],
    activeTools: new Map(),
    settledCalls: [
      { output: 800, decodeMs: 4_000, observedAt: 28_000 },
      { output: 1_200, decodeMs: 4_000, observedAt: 29_000 },
    ],
  };
  assert.equal(modelWindowSpeed(turn, 30_000), 250);
});

test("三秒窗口使用最近有效调用，窗口为空时保持最后一个有效值", () => {
  const turn = {
    startedAt: 0,
    completedAt: 20_000,
    firstTokenAt: 0,
    outputTokens: 1_600,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [
      { output: 5_000, decodeMs: 10_000 },
      { output: 600, decodeMs: 3_000, observedAt: 1_000 },
      { output: 1_000, decodeMs: 4_000, observedAt: 7_000 },
    ],
  };
  assert.equal(modelWindowSpeed(turn, 10_000), 250);
  assert.equal(modelWindowSpeed({ ...turn, completedAt: null }, 20_000), 250);
});

test("短解码突发不会把主速度推到峰值", () => {
  const turn = {
    startedAt: 9_990,
    completedAt: 10_000,
    firstTokenAt: 9_999,
    outputTokens: 80,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [
      { output: 80, decodeMs: 8, observedAt: 10_000 },
    ],
  };
  assert.equal(modelWindowSpeed(turn, 10_000), null);
});

test("没有 delta 与工具事件的会话仍给出可用速度", () => {
  const turn = {
    startedAt: 0,
    completedAt: 100_000,
    firstTokenAt: null,
    outputTokens: 5_000,
    toolIntervals: [],
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(turn, 100_000), 50);
});

test("工具执行中速度不随时间衰减", () => {
  const turn = {
    startedAt: 0,
    completedAt: null,
    firstTokenAt: 4_000,
    outputTokens: 9_600,
    toolIntervals: [[10_000, 20_000]],
    activeTools: new Map([["tool-1", { startedAt: 30_000 }]]),
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(turn, 30_000), modelWindowSpeed(turn, 60_000));
});

test("模型窗口不超过 400 tok/s 峰值", () => {
  const turn = {
    startedAt: 0,
    completedAt: null,
    firstTokenAt: 0,
    outputTokens: 2_000,
    toolIntervals: [[0, 7_500]],
    activeTools: new Map(),
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(turn, 10_000), 400);
});

test("模型窗口峰值内保留实际速度", () => {
  const turn = {
    startedAt: 0,
    completedAt: 20_000,
    firstTokenAt: 0,
    outputTokens: 8_000,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(turn, 20_000), 400);
});

test("新一轮不继承上一轮速度", () => {
  const nextTurn = {
    startedAt: 200_000,
    completedAt: null,
    firstTokenAt: null,
    outputTokens: 0,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(nextTurn, 200_500), null);
});

test("历史回填没有 delta 时按观察到的墙钟窗口给出保守速度", () => {
  const seeded = {
    startedAt: 0,
    completedAt: 100_000,
    firstTokenAt: null,
    outputTokens: 50_000,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [],
    historySeeded: true,
    observedFromStart: false,
  };
  assert.equal(modelWindowSpeed(seeded, 100_000), 400);
});

test("实时轮次缺 delta 时历史回填仍使用真实起止时间计算速度", () => {
  const seeded = {
    startedAt: 0,
    completedAt: 100_000,
    firstTokenAt: null,
    outputTokens: 5_000,
    toolIntervals: [],
    activeTools: new Map(),
    settledCalls: [],
    historySeeded: true,
    observedFromStart: true,
  };
  assert.equal(modelWindowSpeed(seeded, 100_000), 50);
});

test("实时轮次没有 token usage 时结束后需要回填历史", () => {
  const needsHistoryRefresh = new Function(
    extract("codexPlusUsageNeedsHistoryRefresh") + "\nreturn codexPlusUsageNeedsHistoryRefresh;",
  )();
  assert.equal(needsHistoryRefresh({
    historySeeded: false,
    observedFromStart: true,
    usageSamples: 0,
  }), true);
  assert.equal(needsHistoryRefresh({
    historySeeded: false,
    observedFromStart: true,
    usageSamples: 3,
    outputTokens: 100,
  }), false);
  assert.equal(needsHistoryRefresh({
    historySeeded: true,
    observedFromStart: true,
    usageSamples: 3,
    outputTokens: 0,
  }), true);
});

test("工具覆盖整个窗口时退回轮次墙钟均速", () => {
  const turn = {
    startedAt: 0,
    completedAt: 100_000,
    firstTokenAt: 0,
    outputTokens: 5_000,
    toolIntervals: [[0, 100_000]],
    activeTools: new Map(),
    settledCalls: [],
  };
  assert.equal(modelWindowSpeed(turn, 100_000), 50);
});

test("无 item_started 时不为工具编造起止时间", () => {
  const recordTool = new Function(
    extract("codexPlusUsageNumber") + "\n"
    + extract("codexPlusUsageRecordTool") + "\nreturn codexPlusUsageRecordTool;",
  )();
  const turn = { toolIntervals: [], toolDetails: [] };
  const kind = { key: "command", fallback: "Command", label: "Command", detail: "" };

  // 没有 startedAt、没有 durationMs：只记明细，不写区间。
  recordTool(turn, "call-1", kind, null, 50_000, null);
  assert.deepEqual(turn.toolIntervals, []);
  assert.equal(turn.toolDetails.length, 1);
  assert.equal(turn.toolDetails[0].startedAt, null);

  // 有 durationMs 时用实测时长反推起点。
  recordTool(turn, "call-2", kind, null, 50_000, 3_000);
  assert.deepEqual(turn.toolIntervals, [[47_000, 50_000]]);

  // durationMs 优先于事件间隔，避免跨段拉长。
  recordTool(turn, "call-3", kind, 10_000, 50_000, 2_000);
  assert.deepEqual(turn.toolIntervals.at(-1), [48_000, 50_000]);
});
