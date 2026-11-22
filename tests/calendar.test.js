"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract, source } = require("./helpers");

const state = {
  customStart: "2026-11-05T00:00",
  customEnd: "2026-11-09T23:59",
  globalUsageCoverage: { available: 0, total: 0 },
  globalUsageSourceCoverage: { magpie: 0, ledger: 0, daily: 0 },
  magpieUsageMaxAgeMs: 30_000,
  magpieUsage: { fetchedAt: 0, snapshots: new Map(), sessions: new Map() },
  dailyLedger: { version: 1, days: {} },
};

function compile(shared = state) {
  return new Function(
    "codexPlusUsageState",
    [
      extract("codexPlusUsageNumber"),
      extract("codexPlusUsageBeijingDate"),
      extract("codexPlusUsageBeijingDayStart"),
      extract("codexPlusUsageRangeBounds"),
      extract("codexPlusUsageIsGlobalRange"),
      extract("codexPlusUsageBeijingDateKey"),
      extract("codexPlusUsageGlobalDateKeys"),
      extract("codexPlusUsageNormalizeGlobalDay"),
      extract("codexPlusUsageMagpieSnapshotFreshness"),
      extract("codexPlusUsageGlobalDayUsage"),
      extract("codexPlusUsageGlobalAggregate"),
      extract("codexPlusUsageCalendarDays"),
      extract("codexPlusUsageCalendarShiftMonth"),
      extract("codexPlusUsageCalendarRange"),
      extract("codexPlusUsageFormatCompact"),
    ].join("\n") + "\nreturn { codexPlusUsageGlobalDayUsage, codexPlusUsageGlobalAggregate, codexPlusUsageCalendarDays, codexPlusUsageCalendarShiftMonth, codexPlusUsageCalendarRange, codexPlusUsageFormatCompact };",
  )(shared);
}

const api = compile();

test("日历格子按北京日期铺满整月，周日开头，前导空位为 null", () => {
  const november = api.codexPlusUsageCalendarDays("2026-11");
  assert.equal(november.length, 30);
  assert.equal(november[0].dateKey, "2026-11-01");
  assert.equal(november[0].dayLabel, "1");
  assert.equal(november[29].dateKey, "2026-11-30");

  const october = api.codexPlusUsageCalendarDays("2026-10");
  assert.equal(october.length, 35);
  assert.equal(october[0], null);
  assert.equal(october[3], null);
  assert.equal(october[4].dateKey, "2026-10-01");

  const leap = api.codexPlusUsageCalendarDays("2028-02");
  assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(leap[leap.length - 1].dateKey, "2028-02-29");

  assert.deepEqual(api.codexPlusUsageCalendarDays("2026-13"), []);
  assert.deepEqual(api.codexPlusUsageCalendarDays(""), []);
});

test("日历翻月跨年，非法月份返回空串", () => {
  assert.equal(api.codexPlusUsageCalendarShiftMonth("2026-11", -1), "2026-10");
  assert.equal(api.codexPlusUsageCalendarShiftMonth("2026-11", 1), "2026-12");
  assert.equal(api.codexPlusUsageCalendarShiftMonth("2026-01", -1), "2025-12");
  assert.equal(api.codexPlusUsageCalendarShiftMonth("2026-12", 1), "2027-01");
  assert.equal(api.codexPlusUsageCalendarShiftMonth("bad", 1), "");
});

test("日历点选先整天，再点更晚的日期延长截止，点更早的日期重开区间", () => {
  assert.deepEqual(
    api.codexPlusUsageCalendarRange("", "2026-11-05"),
    { anchor: "2026-11-05", start: "2026-11-05", end: "2026-11-05" },
  );
  assert.deepEqual(
    api.codexPlusUsageCalendarRange("2026-11-05", "2026-11-09"),
    { anchor: "2026-11-05", start: "2026-11-05", end: "2026-11-09" },
  );
  assert.deepEqual(
    api.codexPlusUsageCalendarRange("2026-11-09", "2026-11-05"),
    { anchor: "2026-11-05", start: "2026-11-05", end: "2026-11-05" },
  );
  assert.equal(api.codexPlusUsageCalendarRange("2026-11-05", ""), null);
});

test("某天用量按 Magpie 实时桶、本地账本、日报依次取用", () => {
  const fresh = {
    magpieSnapshots: new Map([["2026-11-05", { input: 10, cached: 90, output: 5, total: 105, calls: 3 }]]),
    ledgerDays: { "2026-11-05": { input: 1, cached: 1, output: 1, total: 3, calls: 1 } },
    dailyApi: { getSnapshot: () => ({ dateKey: "2026-11-05", total: 999 }) },
  };
  const magpieDay = api.codexPlusUsageGlobalDayUsage("2026-11-05", fresh);
  assert.equal(magpieDay.kind, "magpie");
  assert.equal(magpieDay.input, 10);
  assert.equal(magpieDay.total, 105);

  const ledgerDay = api.codexPlusUsageGlobalDayUsage("2026-11-05", {
    ...fresh,
    magpieSnapshots: null,
  });
  assert.equal(ledgerDay.kind, "ledger");
  assert.equal(ledgerDay.total, 3);

  const dailyDay = api.codexPlusUsageGlobalDayUsage("2026-11-05", {
    magpieSnapshots: null,
    ledgerDays: {},
    dailyApi: { getSnapshot: () => ({ dateKey: "2026-11-05", input: 100, cached: 60, output: 5, total: 105 }) },
  });
  assert.equal(dailyDay.kind, "daily");
  assert.equal(dailyDay.input, 40);
  assert.equal(dailyDay.total, 105);
});

test("没有数据源覆盖或当天零消耗的日期不可用", () => {
  assert.equal(api.codexPlusUsageGlobalDayUsage("2026-11-05", {}), null);
  assert.equal(api.codexPlusUsageGlobalDayUsage("bad-key", { ledgerDays: { "bad-key": { total: 5 } } }), null);
  assert.equal(api.codexPlusUsageGlobalDayUsage("2026-11-05", {
    magpieSnapshots: new Map([["2026-11-05", { input: 0, cached: 0, output: 0, total: 0, calls: 0 }]]),
  }), null);
  assert.equal(api.codexPlusUsageGlobalDayUsage("2026-11-05", {
    magpieSnapshots: null,
    ledgerDays: { "2026-11-05": { input: 0, cached: 0, output: 0, total: 0, calls: 0 } },
    dailyApi: { getSnapshot: () => ({ dateKey: "2026-10-19", total: 0 }) },
  }), null);
});

test("区间消耗向上取 30 天日桶，超出 7 天的日期不再漏算", () => {
  const shared = {
    customStart: "2026-10-15T00:00",
    customEnd: "2026-11-13T23:59",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, ledger: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
    magpieUsage: { fetchedAt: 0, snapshots: new Map(), sessions: new Map() },
    dailyLedger: { version: 1, days: {} },
  };
  const now = Date.parse("2026-11-13T12:00:00+08:00");
  const snapshots = new Map();
  for (let index = 0; index < 30; index += 1) {
    const dateKey = new Date(Date.UTC(2026, 9, 15 + index)).toISOString().slice(0, 10);
    snapshots.set(dateKey, { input: 2, cached: 1, output: 1, total: 4, calls: 1 });
  }
  shared.magpieUsage = { fetchedAt: now, snapshots, sessions: new Map() };
  const aggregate = compile(shared).codexPlusUsageGlobalAggregate("custom", now, null);
  assert.equal(aggregate.total, 120);
  assert.equal(aggregate.calls, 30);
  assert.deepEqual(shared.globalUsageCoverage, { available: 30, total: 30 });
  assert.deepEqual(shared.globalUsageSourceCoverage, { magpie: 30, ledger: 0, daily: 0 });
});

test("Magpie 日序列请求 30 天窗口", () => {
  const match = /const codexPlusUsageMagpieUsageUrl = "([^"]+)"/.exec(source);
  assert.ok(match, "缺少 Magpie 日序列地址常量");
  assert.match(match[1], /period=30d/);
  assert.match(match[1], /agent=codex/);
});

test("日历用量缩写保留三位左右有效数字", () => {
  assert.equal(api.codexPlusUsageFormatCompact(999), "999");
  assert.equal(api.codexPlusUsageFormatCompact(5600), "6K");
  assert.equal(api.codexPlusUsageFormatCompact(12_345_678), "12.3M");
  assert.equal(api.codexPlusUsageFormatCompact(1_234_567_890), "1.2B");
  assert.equal(api.codexPlusUsageFormatCompact(0), "");
  assert.equal(api.codexPlusUsageFormatCompact(Number.NaN), "");
});
