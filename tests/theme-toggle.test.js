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
