"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

function compile(state) {
  return new Function(
    "codexPlusUsageState",
    [
      extract("codexPlusUsageNumber"),
      extract("codexPlusUsageNormalizeThreadId"),
      extract("codexPlusUsageUuidV7Timestamp"),
      extract("codexPlusUsageBeijingDate"),
      extract("codexPlusUsageBeijingDayStart"),
      extract("codexPlusUsageRangeBounds"),
      extract("codexPlusUsageIsGlobalRange"),
      extract("codexPlusUsageBeijingDateKey"),
      extract("codexPlusUsageMagpieDateKey"),
      extract("codexPlusUsageMagpieSnapshotFromValues"),
      extract("codexPlusUsageMagpieSnapshots"),
      extract("codexPlusUsageMagpieSessions"),
      extract("codexPlusUsageMagpieTodaySnapshot"),
      extract("codexPlusUsageGlobalDateKeys"),
      extract("codexPlusUsageNormalizeGlobalDay"),
      extract("codexPlusUsageGlobalAggregate"),
      extract("codexPlusUsageGlobalTotal"),
      extract("codexPlusUsageTaskUsage"),
    ].join("\n") + "\nreturn { codexPlusUsageMagpieSnapshots, codexPlusUsageMagpieSessions, codexPlusUsageGlobalAggregate, codexPlusUsageGlobalTotal, codexPlusUsageTaskUsage, codexPlusUsageUuidV7Timestamp };",
  )(state);
}

function dailyApi(values) {
  return {
    getSnapshot(dateKey) {
      const value = values[dateKey];
      if (value == null) return { dateKey: "2026-10-19", total: 0 };
      return value && typeof value === "object"
        ? { dateKey, ...value }
        : { dateKey, total: value };
    },
  };
}

test("Magpie 日序列保留非缓存输入、缓存读取和总量", () => {
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageMagpieSnapshots } = compile(state);
  const snapshots = codexPlusUsageMagpieSnapshots({
    series: [{
      time: "2026-10-28T00:00:00+08:00",
      calls: 2028,
      input: 19_314_483,
      output: 1_753_569,
      cache_read: 310_983_058,
      cost: 7.247672358,
    }],
  });
  assert.deepEqual(snapshots.get("2026-10-28"), {
    dateKey: "2026-10-28",
    input: 19_314_483,
    output: 1_753_569,
    cached: 310_983_058,
    reasoning: 0,
    total: 332_051_110,
    calls: 2028,
    cost: 7.247672358,
    source: "magpie",
  });
});

test("Magpie 会话保留完整任务累计", () => {
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageMagpieSessions } = compile(state);
  const sessions = codexPlusUsageMagpieSessions({
    sessions: [{
      id: "01a18080-9345-7b90-8798-f827758fe0db",
      agent: "codex",
      calls: 492,
      input: 4_776_915,
      output: 436_507,
      cache_read: 84_696_064,
      reasoning: 165_727,
      cost: 1.2,
    }],
  });
  assert.deepEqual(sessions.get("01a18080-9345-7b90-8798-f827758fe0db"), {
    id: "01a18080-9345-7b90-8798-f827758fe0db",
    agent: "codex",
    input: 4_776_915,
    output: 436_507,
    cached: 84_696_064,
    reasoning: 165_727,
    total: 89_909_486,
    calls: 492,
    cost: 1.2,
    source: "magpie",
  });
});

test("任务消耗使用完整 Magpie 会话并补足实时增量和非缓存输入", () => {
  const now = Date.parse("2026-10-28T14:00:00+08:00");
  const threadId = "01a18080-9345-7b90-8798-f827758fe0db";
  const state = {
    threadId,
    magpieUsageMaxAgeMs: 30_000,
    magpieUsage: {
      fetchedAt: now,
      snapshots: new Map(),
      sessions: new Map([[threadId, {
        input: 4_000,
        cached: 80_000,
        output: 1_000,
        total: 85_000,
        calls: 20,
        source: "magpie",
      }]]),
    },
  };
  const { codexPlusUsageTaskUsage } = compile(state);
  const usage = codexPlusUsageTaskUsage({
    samples: 22,
    usage: {
      input: 500,
      cached: 300,
      output: 1_200,
      total: 1_700,
    },
  }, now);
  assert.deepEqual(usage, {
    input: 4_000,
    cached: 80_000,
    output: 1_200,
    total: 85_200,
    hitRate: 80_000 / 84_000,
    calls: 22,
    source: "magpie",
  });
});

test("任务起始时间从线程 UUIDv7 读取，而不是当前轮时间", () => {
  const { codexPlusUsageUuidV7Timestamp } = compile({});
  assert.equal(
    codexPlusUsageUuidV7Timestamp("01a18042-d2ec-7cb0-9bf7-dead6110d8ce"),
    Date.parse("2026-10-28T02:07:05.452Z"),
  );
});

test("Magpie 新鲜数据优先，缺失日期回退每日快照", () => {
  const now = Date.parse("2026-10-28T14:00:00+08:00");
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageGlobalAggregate, codexPlusUsageGlobalTotal } = compile(state);
  const daily = dailyApi({
    "2026-10-28": 10,
    "2026-10-27": 20,
    "2026-10-26": 30,
    "2026-10-25": 40,
    "2026-10-24": 50,
    "2026-10-23": 60,
    "2026-10-22": 70,
  });
  const magpie = {
    fetchedAt: now,
    snapshots: new Map([
      ["2026-10-28", { input: 10, cached: 80, output: 10, total: 100 }],
      ["2026-10-27", { input: 20, cached: 160, output: 20, total: 200 }],
    ]),
  };
  assert.equal(codexPlusUsageGlobalTotal("today", now, daily, magpie), 100);
  const today = codexPlusUsageGlobalAggregate("today", now, daily, magpie);
  assert.deepEqual({
    total: today.total,
    input: today.input,
    cached: today.cached,
    output: today.output,
    hitRate: today.hitRate,
  }, {
    total: 100,
    input: 10,
    cached: 80,
    output: 10,
    hitRate: 80 / 90,
  });
  assert.deepEqual(state.globalUsageSourceCoverage, { magpie: 1, daily: 0 });
  assert.equal(codexPlusUsageGlobalTotal("week", now, daily, magpie), 550);
  assert.deepEqual(state.globalUsageSourceCoverage, { magpie: 2, daily: 5 });
  assert.deepEqual(state.globalUsageCoverage, { available: 7, total: 7 });
});

test("Magpie 过期或缺失时回退本地日报", () => {
  const now = Date.parse("2026-10-28T14:00:00+08:00");
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageGlobalTotal } = compile(state);
  const daily = dailyApi({ "2026-10-28": 10 });
  const stale = {
    fetchedAt: now - 30_001,
    snapshots: new Map([["2026-10-28", { total: 100 }]]),
  };
  assert.equal(codexPlusUsageGlobalTotal("today", now, daily, stale), 10);
  assert.deepEqual(state.globalUsageSourceCoverage, { magpie: 0, daily: 1 });
  assert.equal(
    codexPlusUsageGlobalTotal("today", now, null, {
      fetchedAt: now,
      snapshots: new Map([["2026-10-28", { total: 100 }]]),
    }),
    100,
  );
});

test("今天、昨天和近 7 天共享同一套输入输出缓存字段", () => {
  const now = Date.parse("2026-10-28T14:00:00+08:00");
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageGlobalAggregate } = compile(state);
  const snapshots = new Map();
  for (let offset = 0; offset < 7; offset += 1) {
    snapshots.set(`2026-10-${String(22 + offset).padStart(2, "0")}`, {
      input: 10,
      cached: 80,
      output: 10,
      total: 100,
    });
  }
  const magpie = { fetchedAt: now, snapshots };
  const today = codexPlusUsageGlobalAggregate("today", now, null, magpie);
  const yesterday = codexPlusUsageGlobalAggregate("yesterday", now, null, magpie);
  const week = codexPlusUsageGlobalAggregate("week", now, null, magpie);
  assert.deepEqual([today.total, today.input, today.cached, today.output, today.hitRate], [100, 10, 80, 10, 80 / 90]);
  assert.deepEqual([yesterday.total, yesterday.input, yesterday.cached, yesterday.output, yesterday.hitRate], [100, 10, 80, 10, 80 / 90]);
  assert.deepEqual([week.total, week.input, week.cached, week.output, week.hitRate], [700, 70, 560, 70, 560 / 630]);
});

test("本地日报 input 含缓存时也归一为非缓存输入", () => {
  const now = Date.parse("2026-10-28T14:00:00+08:00");
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
  };
  const { codexPlusUsageGlobalAggregate } = compile(state);
  const daily = dailyApi({
    "2026-10-28": { input: 100, cached: 80, output: 20, total: 120 },
  });
  const aggregate = codexPlusUsageGlobalAggregate("today", now, daily, { fetchedAt: 0, snapshots: new Map() });
  assert.deepEqual(
    [aggregate.total, aggregate.input, aggregate.cached, aggregate.output, aggregate.hitRate],
    [120, 20, 80, 20, 0.8],
  );
});

test("Electron bridge 返回直接 fetch-response 时刷新 Magpie 快照", async () => {
  const weekPayload = {
    series: [{
      time: "2026-10-28T00:00:00+08:00",
      calls: 3,
      input: 10,
      output: 4,
      cache_read: 20,
      cost: 0.01,
    }],
  };
  const todayPayload = {
    since: "2026-10-28T00:00:00+08:00",
    calls: 3,
    input: 10,
    output: 4,
    cache_read: 20,
    cost: 0.01,
  };
  const taskPayload = {
    since: "2026-10-22T00:00:00+08:00",
    calls: 3,
    input: 10,
    output: 4,
    cache_read: 20,
    cost: 0.01,
  };
  const requests = [];
  const window = {
    // A contaminated daily cache must not short-circuit TokenLens's own Codex-only requests.
    __codexDailyTokenUsage: {
      getMagpieUsage() {
        return {
          fetchedAt: Date.now(),
          snapshots: { "2026-10-28": { total: 999 } },
          sessions: {
            "01a18080-9345-7b90-8798-f827758fe0db": {
              id: "01a18080-9345-7b90-8798-f827758fe0db",
              total: 999,
            },
          },
        };
      },
    },
    electronBridge: {
      async sendMessageFromView(value) {
        requests.push(value);
        const payload = value.url.includes("&q=")
          ? taskPayload
          : value.url.includes("period=today") ? todayPayload : weekPayload;
        return {
          type: "fetch-response",
          requestId: value.requestId,
          responseType: "success",
          status: 200,
          bodyJsonString: JSON.stringify(payload),
        };
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  const state = {
    disposed: false,
    threadId: "01a18080-9345-7b90-8798-f827758fe0db",
    magpieUsage: { fetchedAt: 0, snapshots: new Map(), sessions: new Map() },
    magpieUsageLastAttemptAt: 0,
    magpieUsagePromise: null,
    magpieUsageError: "",
  };
  const refresh = new Function(
    "window",
    "codexPlusUsageState",
    "codexPlusUsageMagpieUsageUrl",
    "codexPlusUsageMagpieTodayUsageUrl",
    "codexPlusUsageMagpieTaskUsageUrlPrefix",
    "codexPlusUsageMagpieRefreshMs",
    "codexPlusUsageMagpieTimeoutMs",
    [
      extract("codexPlusUsageNumber"),
      extract("codexPlusUsageNormalizeThreadId"),
      extract("codexPlusUsageBeijingDate"),
      extract("codexPlusUsageBeijingDayStart"),
      extract("codexPlusUsageBeijingDateKey"),
      extract("codexPlusUsageMagpieDateKey"),
      extract("codexPlusUsageMagpieSnapshotFromValues"),
      extract("codexPlusUsageMagpieSnapshots"),
      extract("codexPlusUsageMagpieSessions"),
      extract("codexPlusUsageMagpieTodaySnapshot"),
      extract("codexPlusUsageMagpieTaskSession"),
      extract("codexPlusUsageBridgeGetJson"),
      extract("codexPlusUsageRefreshMagpieUsage"),
    ].join("\n") + "\nreturn codexPlusUsageRefreshMagpieUsage;",
  )(
    window,
    state,
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=7d&agent=codex&limit=1",
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=today&agent=codex&limit=1",
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=7d&agent=codex&limit=1&q=",
    2000,
    3000,
  );
  const result = await refresh(true);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.url).sort(), [
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=7d&agent=codex&limit=1",
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=7d&agent=codex&limit=1&q=01a18080-9345-7b90-8798-f827758fe0db",
    "http://127.0.0.1:3425/v1/magpie/usage/requests?period=today&agent=codex&limit=1",
  ]);
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.equal(state.magpieUsage.snapshots.get("2026-10-28").total, 34);
  assert.equal(state.magpieUsage.sessions.get("01a18080-9345-7b90-8798-f827758fe0db").total, 34);
});

test("宿主资源尚未加载时不缓存空的 appServices 结果", async () => {
  const state = { appServicesPromise: null };
  const resolve = new Function(
    "document",
    "performance",
    "location",
    "codexPlusUsageState",
    [
      extract("codexPlusUsageAbsoluteUrl"),
      extract("codexPlusUsageCollectAssetUrls"),
      extract("codexPlusUsageResolveAppServices"),
    ].join("\n") + "\nreturn codexPlusUsageResolveAppServices;",
  )(
    {
      baseURI: "app://-/index.html",
      querySelectorAll() {
        return [];
      },
    },
    { getEntriesByType: () => [] },
    { href: "app://-/index.html" },
    state,
  );
  assert.equal(await resolve(), null);
  assert.equal(state.appServicesPromise, null);
});
