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

const webpackServices = new Function(
  extract("codexPlusUsageWebpackServices") + "\nreturn codexPlusUsageWebpackServices;",
)();

const usableServices = { httpFetch: { fetch() {} } };

test("rspack 宿主把 appServices 藏在模块缓存里也能取到", () => {
  const requireFn = Object.assign(() => {
    throw new Error("不该在缓存命中时 require");
  }, {
    c: {
      aaa: { exports: { other: 1 } },
      GaA7: { exports: { appServices: usableServices } },
    },
    m: {},
  });
  assert.equal(webpackServices(requireFn), usableServices);
});

test("缓存里没有时按工厂源码定位并 require 一次", () => {
  const requireFn = Object.assign((id) => {
    assert.equal(id, "Xy12");
    return { appServices: usableServices };
  }, {
    c: {},
    m: {
      Xy12: function () { return { appServices: 1 }; },
      Zz34: function () { return {}; },
    },
  });
  assert.equal(webpackServices(requireFn), usableServices);
});

test("运行时形状不认识时返回 null，不抛错", () => {
  assert.equal(webpackServices(undefined), null);
  assert.equal(webpackServices(() => {}), null);
  assert.equal(webpackServices({ c: { a: { exports: { appServices: { httpFetch: {} } } } } }), null);
});

test("HTTP service 与 bridge 都失败时，两条原因都要带出来", async () => {
  const state = { appServicesPromise: null };
  const getJson = new Function(
    "window",
    "codexPlusUsageMagpieTimeoutMs",
    "codexPlusUsageState",
    [
      extract("codexPlusUsageResolveAppServices"),
      extract("codexPlusUsageServiceGetJson"),
      extract("codexPlusUsageBridgeGetJson"),
    ].join("\n") + "\nreturn codexPlusUsageBridgeGetJson;",
  )(
    {
      electronBridge: {
        sendMessageFromView() {
          throw new Error("HTTP requests must use the HTTP fetch service.");
        },
      },
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
    },
    3000,
    state,
  );
  await assert.rejects(getJson("http://127.0.0.1:3425/x"), (error) => {
    assert.match(error.message, /HTTP fetch service/);
    assert.match(error.message, /codex_desktop:message-from-view|HTTP fetch service/);
    return true;
  });
});
