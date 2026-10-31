"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

test("懒加载宿主可从已加载入口资源发现 RPC 模块", async () => {
  const mockFetch = async (url) => {
    assert.equal(url, "app://-/assets/index-b2375c20c2a9.js");
    return {
      ok: true,
      async text() {
        return 'const rpc = () => import("./rpc-7f414a22e2be.js");';
      },
    };
  };
  const discover = new Function(
    [
      extract("codexPlusUsageAssetRpcUrls"),
      extract("codexPlusUsageDiscoverRpcAssetUrls"),
    ].join("\n") + "\nreturn codexPlusUsageDiscoverRpcAssetUrls;",
  )();

  assert.deepEqual(
    await discover([
      "app://-/assets/index-b2375c20c2a9.js",
      "app://-/assets/app-shared-b9a49a97ca55.js",
    ], mockFetch),
    ["app://-/assets/rpc-7f414a22e2be.js"],
  );
});

test("已加载的 RPC 模块不再读取入口资源", async () => {
  const discover = new Function(
    [
      extract("codexPlusUsageAssetRpcUrls"),
      extract("codexPlusUsageDiscoverRpcAssetUrls"),
    ].join("\n") + "\nreturn codexPlusUsageDiscoverRpcAssetUrls;",
  )();

  assert.deepEqual(
    await discover([
      "app://-/assets/index-b2375c20c2a9.js",
      "app://-/assets/rpc-7f414a22e2be.js",
    ], () => {
      throw new Error("should not fetch");
    }),
    ["app://-/assets/rpc-7f414a22e2be.js"],
  );
});
