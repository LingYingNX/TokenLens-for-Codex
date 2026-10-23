"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { root, source } = require("./helpers");

test("发布 artifact 与 tokenlens.js 的脚本正文完全一致", () => {
  const marker = "/* Codex++ external extension:";
  const body = source.slice(source.indexOf(marker));
  const artifact = fs.readFileSync(
    path.join(root, "artifacts", "codex-plus-throughput-statusline.js"),
    "utf8",
  );
  assert.ok(body.startsWith(marker));
  assert.equal(artifact, body);
});
