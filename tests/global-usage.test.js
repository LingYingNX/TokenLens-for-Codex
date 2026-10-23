"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const total = new Function(
  "codexPlusUsageState",
  [
    extract("codexPlusUsageBeijingDate"),
    extract("codexPlusUsageBeijingDayStart"),
    extract("codexPlusUsageRangeBounds"),
    extract("codexPlusUsageIsGlobalRange"),
    extract("codexPlusUsageBeijingDateKey"),
    extract("codexPlusUsageGlobalDateKeys"),
    extract("codexPlusUsageGlobalTotal"),
  ].join("\n") + "\nreturn codexPlusUsageGlobalTotal;",
)({
  customStart: "2026-10-21T09:00",
  customEnd: "2026-10-22T18:00",
  globalUsageCoverage: { available: 0, total: 0 },
});

function dailyApi(values) {
  return {
    getSnapshot(dateKey) {
      return values[dateKey] == null
        ? { dateKey: "2026-10-19", total: 0 }
        : { dateKey, total: values[dateKey] };
    },
  };
}

test("今天和近 7 天直接汇总每日快照", () => {
  const now = Date.parse("2026-10-23T14:00:00+08:00");
  const values = {
    "2026-10-23": 23,
    "2026-10-22": 22,
    "2026-10-21": 21,
    "2026-10-20": 20,
    "2026-10-19": 19,
    "2026-10-18": 18,
    "2026-10-17": 17,
  };
  assert.equal(total("today", now, dailyApi(values)), 23);
  assert.equal(total("week", now, dailyApi(values)), 140);
});

test("自定义区间按北京时间覆盖的每日快照汇总", () => {
  const now = Date.parse("2026-10-23T14:00:00+08:00");
  assert.equal(total("custom", now, dailyApi({
    "2026-10-21": 21,
    "2026-10-22": 22,
  })), 43);
});

test("超出保留期的日期明确标记覆盖范围并保留可得合计", () => {
  const now = Date.parse("2026-10-23T14:00:00+08:00");
  const api = dailyApi({ "2026-10-17": 17 });
  assert.equal(total("week", now, api), 17);
});
