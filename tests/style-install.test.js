"use strict";

// 样式安装时机的契约测试。
//
// 踩过的坑：宿主用 Page.addScriptToEvaluateOnNewDocument 注册脚本后，脚本在文档
// 最早时机执行，那时 document.readyState === "loading" 且 document.head 是 undefined。
// tokenlens.js 原来的 document.head?.appendChild(style) 会静默失败，
// 样式永久丢失，状态栏退化成竖着堆叠的裸文本（用户截图）。

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const plugin = fs.readFileSync(path.join(repo, "tokenlens.js"), "utf8");

test("样式在 head 未就绪时不会静默丢失", () => {
  assert.match(
    plugin,
    /if \(!document\.head\)/,
    "必须先判断 document.head 是否存在",
  );
  assert.match(
    plugin,
    /DOMContentLoaded/,
    "head 未就绪时必须等 DOMContentLoaded 再装样式",
  );
});

test("样式文本对外可见，供宿主在半注入状态下补装", () => {
  assert.match(
    plugin,
    /__codexPlusThroughputStatusLineStyleText/,
    "必须把样式文本暴露出去，否则宿主只能重跑整个脚本",
  );
  assert.match(
    plugin,
    /styleText:\s*globalThis\.__codexPlusThroughputStatusLineStyleText/,
    "运行时对象必须带上 styleText",
  );
});

test("宿主会检查样式而不只是运行时", () => {
  const host = fs.readFileSync(path.join(repo, "standalone", "tokenlens-host.mjs"), "utf8");
  assert.match(
    host,
    /codex-plus-throughput-statusline-style/,
    "宿主必须检查样式标签是否存在",
  );
  assert.match(
    host,
    /半注入/,
    "必须区分「运行时在、样式不在」的半注入状态",
  );
});

test("半注入时只补样式，不重跑整个脚本", () => {
  const host = fs.readFileSync(path.join(repo, "standalone", "tokenlens-host.mjs"), "utf8");
  const idx = host.indexOf("async function activate(cdp)");
  assert.ok(idx >= 0, "必须保留 activate");
  const body = host.slice(idx, idx + 2400);
  assert.match(body, /只补样式，不重跑整个脚本/, "必须写清半注入的处理方式");
  assert.match(body, /styleText/, "补样式时要用暴露出来的样式文本");
});
