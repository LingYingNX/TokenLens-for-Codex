"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { source, extract } = require("./helpers");

const normalizeTheme = new Function(
  extract("codexPlusUsageNormalizeTheme") + "\nreturn codexPlusUsageNormalizeTheme;",
)();

test("主题只接受亮色或暗色", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme(""), "dark");
  assert.equal(normalizeTheme("system"), "dark");
});

test("插件提供可访问的双态开关和持久化键", () => {
  assert.match(source, /data-role="theme-toggle"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /tokenlens-theme/);
  assert.match(source, /\[data-theme="light"\]/);
});
