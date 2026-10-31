"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const ledgerSource = [
  extract("codexPlusUsageNumber"),
  extract("codexPlusUsageNormalizeGlobalDay"),
  extract("codexPlusUsageEmptyDailyLedger"),
  extract("codexPlusUsageNormalizeDailyLedgerDay"),
  extract("codexPlusUsageReadDailyLedger"),
  extract("codexPlusUsageWriteDailyLedger"),
  extract("codexPlusUsageMergeDailyLedger"),
];

function compileLedger() {
  return new Function(
    "codexPlusUsageDailyLedgerKey",
    "codexPlusUsageDailyLedgerVersion",
    "codexPlusUsageDailyLedgerMaxDays",
    ledgerSource.join("\n") + "\nreturn { codexPlusUsageEmptyDailyLedger, codexPlusUsageReadDailyLedger, codexPlusUsageMergeDailyLedger };",
  )("tokenlens-daily-usage", 1, 60);
}

function memoryStorage() {
  const values = new Map();
  return {
    writes: 0,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      this.writes += 1;
      values.set(key, value);
    },
  };
}

test("每日账本按最大值合并，数据不会因回退源变小而缩水", () => {
  const { codexPlusUsageEmptyDailyLedger, codexPlusUsageMergeDailyLedger } = compileLedger();
  const storage = memoryStorage();
  const now = Date.parse("2026-10-31T12:00:00+08:00");
  const first = codexPlusUsageMergeDailyLedger(
    codexPlusUsageEmptyDailyLedger(),
    new Map([["2026-10-31", {
      input: 10,
      cached: 100,
      output: 5,
      total: 115,
      calls: 2,
      source: "magpie",
    }]]),
    now,
    storage,
  );
  assert.equal(first.days["2026-10-31"].total, 115);
  assert.equal(storage.writes, 1);

  const second = codexPlusUsageMergeDailyLedger(
    first,
    new Map([["2026-10-31", {
      input: 1,
      cached: 2,
      output: 3,
      total: 6,
      calls: 1,
      source: "magpie",
    }]]),
    now + 2000,
    storage,
  );
  assert.equal(second.days["2026-10-31"].total, 115);
  assert.equal(second.days["2026-10-31"].calls, 2);
  assert.equal(storage.writes, 1);
});

test("账本只保留最近 60 个日期", () => {
  const { codexPlusUsageEmptyDailyLedger, codexPlusUsageMergeDailyLedger } = compileLedger();
  const snapshots = new Map();
  const start = Date.parse("2026-08-01T00:00:00+08:00");
  const keys = [];
  for (let index = 0; index < 61; index += 1) {
    const key = new Date(start + index * 86400000).toISOString().slice(0, 10);
    keys.push(key);
    snapshots.set(key, { input: 1, cached: 1, output: 1, total: 3, calls: 1 });
  }
  const ledger = codexPlusUsageMergeDailyLedger(
    codexPlusUsageEmptyDailyLedger(),
    snapshots,
    start + 61 * 86400000,
    memoryStorage(),
  );
  assert.equal(Object.keys(ledger.days).length, 60);
  assert.equal(ledger.days[keys[0]], undefined);
  assert.ok(ledger.days[keys[1]]);
});

test("账本优先于残缺日报，恢复被回退源压低的消耗", () => {
  const state = {
    customStart: "",
    customEnd: "",
    globalUsageCoverage: { available: 0, total: 0 },
    globalUsageSourceCoverage: { magpie: 0, ledger: 0, daily: 0 },
    magpieUsageMaxAgeMs: 30_000,
    magpieUsage: { fetchedAt: 0, snapshots: new Map() },
    dailyLedger: {
      version: 1,
      days: {
        "2026-10-31": { input: 10, cached: 100, output: 5, total: 115, calls: 2, source: "magpie" },
        "2026-10-30": { input: 20, cached: 200, output: 10, total: 230, calls: 4, source: "magpie" },
      },
    },
  };
  const total = new Function(
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
      extract("codexPlusUsageGlobalAggregate"),
      extract("codexPlusUsageGlobalTotal"),
    ].join("\n") + "\nreturn { codexPlusUsageGlobalTotal, codexPlusUsageGlobalAggregate };",
  )(state);
  const daily = {
    getSnapshot(dateKey) {
      return { dateKey, total: dateKey === "2026-10-31" ? 60_737 : 72_745 };
    },
  };
  const now = Date.parse("2026-10-31T12:00:00+08:00");
  assert.equal(total.codexPlusUsageGlobalTotal("today", now, daily), 115);
  assert.deepEqual(state.globalUsageSourceCoverage, { magpie: 0, ledger: 1, daily: 0 });
  assert.equal(total.codexPlusUsageGlobalTotal("yesterday", now, daily), 230);
});
