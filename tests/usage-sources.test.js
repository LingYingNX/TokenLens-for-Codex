"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

function buildRefresh(sources, state, fetchJson) {
  return new Function(
    "fetchJson",
    "codexPlusUsageDataSources",
    "codexPlusUsageState",
    "codexPlusUsageMagpieRefreshMs",
    "codexPlusUsageMagpieRetryMaxMs",
    [
      "function codexPlusUsageNormalizeThreadId(value) { return String(value || ''); }",
      "async function codexPlusUsageBridgeGetJson(url) { return fetchJson(url); }",
      "function codexPlusUsageMergeDailyLedger(ledger) { return ledger || { days: {} }; }",
      extract("codexPlusUsageFetchDataSource"),
      extract("codexPlusUsageMagpieRetryDelayMs"),
      extract("codexPlusUsageRefreshMagpieUsage"),
    ].join("\n") + "\nreturn codexPlusUsageRefreshMagpieUsage;",
  )(fetchJson, () => sources, state, 2000, 30000);
}

function emptyState() {
  return {
    disposed: false,
    threadId: "",
    magpieUsage: { fetchedAt: 0, snapshots: new Map(), sessions: new Map() },
    magpieUsageLastAttemptAt: 0,
    magpieUsageFailureCount: 0,
    magpieUsagePromise: null,
    magpieUsageError: "",
    dailyLedger: { days: {} },
  };
}

function plainSource(label, base) {
  return {
    label,
    buildUrls: () => ({ series: `${base}/series`, today: `${base}/today`, task: "" }),
    snapshotsFromSeries: (payload) => new Map(
      (Array.isArray(payload?.series) ? payload.series : []).map((row) => [row.dateKey, row]),
    ),
    snapshotFromToday: (payload) => (payload?.dateKey ? payload : null),
    sessionFromTask: () => null,
  };
}

test("首个返回快照的数据源胜出，后续源不再请求", async () => {
  const state = emptyState();
  const urls = [];
  const refresh = buildRefresh(
    [plainSource("EmptyTool", "mem://empty"), plainSource("Magpie", "mem://magpie"), plainSource("NeverTool", "mem://never")],
    state,
    async (url) => {
      urls.push(url);
      if (url === "mem://magpie/series") {
        return { series: [{ dateKey: "2026-11-10", input: 1, cached: 4, output: 2, total: 7, calls: 3 }] };
      }
      return { series: [] };
    },
  );
  const result = await refresh(true);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(state.magpieUsage.snapshots.get("2026-11-10").total, 7);
  assert.deepEqual(urls, [
    "mem://empty/series",
    "mem://empty/today",
    "mem://magpie/series",
    "mem://magpie/today",
  ]);
});

test("所有数据源都不可用时，错误里逐个源报原因", async () => {
  const state = emptyState();
  let requests = 0;
  const refresh = buildRefresh(
    [plainSource("EmptyTool", "mem://empty"), plainSource("Magpie", "mem://magpie")],
    state,
    async () => {
      requests += 1;
      throw new Error("connect failed");
    },
  );
  const result = await refresh(true);
  assert.equal(result.ok, false);
  assert.equal(requests, 4);
  assert.match(state.magpieUsageError, /EmptyTool/);
  assert.match(state.magpieUsageError, /Magpie/);
});

test("同一源里 series 挂了但 today 有数据时，该源仍算可用", async () => {
  const state = emptyState();
  const refresh = buildRefresh(
    [{ ...plainSource("Magpie", "mem://magpie"), snapshotsFromSeries: () => { throw new Error("bad payload"); } },
      plainSource("NeverTool", "mem://never")],
    state,
    async (url) => {
      if (url === "mem://magpie/series") throw new Error("connect failed");
      if (url === "mem://magpie/today") return { dateKey: "2026-11-10", total: 5 };
      throw new Error(`unexpected request: ${url}`);
    },
  );
  const result = await refresh(true);
  assert.equal(result.ok, true);
  assert.equal(state.magpieUsage.snapshots.get("2026-11-10").total, 5);
});
