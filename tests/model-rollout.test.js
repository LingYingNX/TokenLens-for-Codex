"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mod = require("../standalone/rollout-history.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-rollout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, put(name, lines) { fs.writeFileSync(path.join(root, name + ".jsonl"), lines.map(JSON.stringify).join("\n")); } };
}
const meta = (id, parent_thread_id) => ({type:"session_meta", payload:{id, parent_thread_id, session_id:id}});
const context = (turn_id, model) => ({type:"turn_context", payload:{turn_id, model}});
const usage = (thread_id, turn_id, response_id, total = 10) => ({timestamp:"2026-01-01T00:00:00Z", type:"token_usage_record", payload:{thread_id, session_id:thread_id, turn_id, response_id, usage:{input_tokens:total-1, output_tokens:1, total_tokens:total}}});

test("精确按轮归属多模型，冲突及缺失为未知，重放只计一次", async t => {
  const f=fixture(t); const repeated=usage("root","a","r1");
  f.put("root", [meta("root"), context("a","model-A"), context("b","model-B"), context("conflict","model-A"), context("conflict","model-B"), repeated, repeated, usage("root","b","r2"), usage("root","conflict","r3"), usage("root","missing","r4")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.threadId,"root"); assert.equal(result.records.length,4);
  assert.deepEqual(result.records.map(x=>[x.turnId,x.responseId,x.model]),[["a","r1","model-A"],["b","r2","model-B"],["conflict","r3",null],["missing","r4",null]]);
  assert.equal(result.records[0].usage.total_tokens,10);
});

test("父子直接关联与递归、隔离和环保护", async t => {
  const f=fixture(t);
  f.put("root",[meta("root"), context("same","parent"),usage("root","same","r")]);
  f.put("child",[meta("child","root"), context("same","child-model"),usage("child","same","r")]);
  f.put("grand",[meta("grand","child"),context("g","grand-model"),usage("grand","g","g")]);
  f.put("other",[meta("other","not-root"),context("o","other-model"),usage("other","o","o")]);
  f.put("cycle1",[meta("cycle1","cycle2"),usage("cycle1","x","x")]);
  f.put("cycle2",[meta("cycle2","cycle1"),usage("cycle2","x","y")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.deepEqual(result.records.map(x=>[x.threadId,x.model]).sort(),[["child","child-model"],["grand","grand-model"],["root","parent"]]);
});

test("子线程 session_id 可为父会话，且伪造 session_id 被拒", async t => {
  const f=fixture(t); const childMeta=meta("child","root"); childMeta.payload.session_id="root";
  const good=usage("child","t","good"); good.payload.session_id="root";
  const bad=usage("child","t","bad"); bad.payload.session_id="unrelated";
  f.put("root",[meta("root"),usage("root","t","main")]);
  f.put("child",[childMeta,context("t","model"),good,bad]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true);
  assert.deepEqual(result.records.map(x=>x.responseId).sort(),["good","main"]);
});

test("子线程分段的 session_id 不一致不可归属", async t => {
  const f=fixture(t); const first=meta("child","root"), second=meta("child","root");
  first.payload.session_id="root"; second.payload.session_id="other";
  const good=usage("child","t","bad"); good.payload.session_id="root";
  f.put("root",[meta("root"),usage("root","t","main")]); f.put("child-a",[first,good]); f.put("child-b",[second]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.deepEqual(result.records.map(x=>x.responseId),["main"]);
});

test("包含请求根的父子环不产生伪后代", async t => {
  const f=fixture(t); f.put("root",[meta("root","child"),usage("root","t","r")]);
  f.put("child",[meta("child","root"),usage("child","t","c")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.deepEqual(result.records,[]);
});

test("互相冲突的会话关系或 usage 线程 ID 不可归属", async t => {
  const f=fixture(t); f.put("root",[meta("root"),usage("root","t","good")]);
  f.put("one",[meta("child","root"),usage("child","t","bad")]);
  f.put("two",[meta("child","other")]);
  f.put("spoof",[meta("spoof","root"),usage("root","t","wrong")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.deepEqual(result.records.map(x=>x.responseId),["good"]); assert.equal(result.partial,true);
});

test("旧历史行与子线程隔离且保持原契约", async t => {
  const f=fixture(t); f.put("root",[meta("root"),context("t","model"),usage("root","t","r")]);
  f.put("child",[meta("child","root"),usage("child","t","child-r")]);
  const before=await mod.readThreadUsageHistory("root",{sessionsRoot:f.root});
  await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  const after=await mod.readThreadUsageHistory("root",{sessionsRoot:f.root});
  assert.deepEqual(after,before); assert.equal(after.length,1);
  assert.deepEqual(Object.keys(after[0]).sort(),["observed_at","turn_id","usage"]);
});

test("缺失或非法总量不可伪装成零", async t => {
  const f=fixture(t); const missing=usage("root","t","missing"); delete missing.payload.usage.total_tokens;
  const invalid=usage("root","t","invalid"); invalid.payload.usage.total_tokens=-1;
  f.put("root",[meta("root"),missing,invalid,usage("root","t","valid")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.deepEqual(result.records.map(x=>x.responseId),["valid"]);
});

test("缺失响应 ID 的重放去重，不合并不同时间的调用", async t => {
  const f=fixture(t); const first=usage("root","t","");
  const second=usage("root","t",""); second.timestamp="2026-01-01T00:00:01Z";
  f.put("root",[meta("root"),first,first,second]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.records.length,2); assert.equal(result.records[0].responseId,"");
});

test("大目标文件流式读取且优先于无关预算", async t => {
  const f=fixture(t);
  const unrelated=path.join(f.root,"a.jsonl");
  fs.writeFileSync(unrelated,JSON.stringify(meta("other"))+"\n"); fs.truncateSync(unrelated,65*1024*1024);
  const target=path.join(f.root,"root.jsonl");
  fs.writeFileSync(target,JSON.stringify(meta("root"))+"\n"+" ".repeat(9*1024*1024)+"\n"+JSON.stringify(usage("root","t","r"))+"\n");
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.truncated,true); assert.equal(result.partial,true); assert.deepEqual(result.records.map(x=>x.responseId),["r"]);
});

test("发现预算优先近期目录内的目标而非两千旧文件", async t => {
  const f=fixture(t); const old=path.join(f.root,"2024"); const recent=path.join(f.root,"2026");
  fs.mkdirSync(old); fs.mkdirSync(recent);
  for (let i=0; i<2001; i++) fs.writeFileSync(path.join(old, String(i).padStart(4,"0")+".jsonl"), "{}");
  fs.writeFileSync(path.join(recent,"rollout-root.jsonl"),[meta("root"),usage("root","t","r")].map(JSON.stringify).join("\n"));
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.equal(result.truncated,true); assert.deepEqual(result.records.map(x=>x.responseId),["r"]);
});

test("旧目录目标不受两千较新文件发现上限阻挡", async t => {
  const f=fixture(t); const old=path.join(f.root,"2024"); const recent=path.join(f.root,"2026");
  fs.mkdirSync(old); fs.mkdirSync(recent);
  for (let i=0; i<2001; i++) fs.writeFileSync(path.join(recent,String(i).padStart(4,"0")+".jsonl"), "{}");
  fs.writeFileSync(path.join(old,"rollout-root.jsonl"),[meta("root"),usage("root","t","r")].map(JSON.stringify).join("\n"));
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.equal(result.truncated,true); assert.deepEqual(result.records.map(x=>x.responseId),["r"]);
});

test("读取期间文件增长报告部分覆盖", async t => {
  const f=fixture(t); f.put("root",[meta("root"),usage("root","t","r")]);
  const target=path.join(f.root,"root.jsonl"); const promises=require("node:fs/promises");
  const original=promises.stat; let calls=0;
  const mock=t.mock.method(promises,"stat",async (...args)=>{
    if (args[0]===target && ++calls===2) fs.appendFileSync(target,"\n");
    return original(...args);
  });
  require("node:module").syncBuiltinESMExports();
  try {
    const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
    assert.equal(result.partial,true); assert.deepEqual(result.records.map(x=>x.responseId),["r"]);
  } finally { mock.mock.restore(); require("node:module").syncBuiltinESMExports(); }
});

test("同一响应 ID 用量冲突不能静默选择", async t => {
  const f=fixture(t); f.put("root",[meta("root"),usage("root","t","r",10),usage("root","t","r",20),usage("root","t","r",10)]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.deepEqual(result.records,[]);
});

test("扫描不完整及缺失根记录明确报告", async t => {
  const f=fixture(t); f.put("child",[meta("child","root"),usage("child","t","r")]);
  const result=await mod.readRolloutUsageAttribution("root",{sessionsRoot:f.root});
  assert.equal(result.partial,true); assert.equal(result.truncated,false);
  const missing=await mod.readRolloutUsageAttribution("root",{sessionsRoot:path.join(f.root,"absent")});
  assert.equal(missing.partial,true); assert.deepEqual(missing.records,[]);
});
