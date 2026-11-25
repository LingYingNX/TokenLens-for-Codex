"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");
const row = (threadId, responseId, model, total, turnId = "turn") => ({threadId, turnId, responseId, model, usage:{total_tokens:total}});
const data = (threadId, records, partial = false) => ({threadId, records, partial, truncated:false});
function compile(state, call) {
  const window = {codexPlus:{call}, setTimeout() { return 1; }, clearTimeout() {}};
  return new Function("window", "codexPlusUsageState", [
    extract("codexPlusUsageAttribution"),
    "function codexPlusUsageHistorySamples(result) { return result.history || []; }",
    "function codexPlusUsageMergeHistorySamples(a,b) { return b; }",
    "function codexPlusUsageSeedHistoryTurn() {}",
    "function codexPlusUsageRender() {}",
    "function codexPlusUsageTurnSnapshot() {}",
    extract("codexPlusUsageLoadHistory"),
    extract("codexPlusUsageLoadAttribution"),
    "return { history:codexPlusUsageLoadHistory, attribution:codexPlusUsageLoadAttribution };",
  ].join("\n"))(window,state);
}
function state() {return {threadId:"A",historyThreadId:"",historySamples:[],historyFetchedAt:0,historyPromise:null,historyRequest:null,attribution:null,attributionThreadId:"",attributionFetchedAt:0,attributionPromise:null,attributionRequest:null,turns:new Map()};}
const aggregate = new Function(extract("codexPlusUsageAttribution") + "\nreturn codexPlusUsageAttribution;")();
test("模型、角色、未知与重复调用按身份聚合", () => {
  const missing = row("A","","unknown",50);
  const a = row("A","1","model-a",120);
  const result = aggregate(data("A",[a,a,row("A","2","model-b",70),row("child","3","",35),missing]),"A");
  assert.deepEqual(result.rows,[{role:"main",model:"model-a",total:120},{role:"main",model:"model-b",total:70},{role:"agent",model:"",total:35}]);
  assert.equal(result.partial,true);
  assert.equal(aggregate(undefined,"A").status,"unavailable");
  assert.equal(aggregate(data("B",[]),"A").status,"unavailable");
});
test("历史和归属并发独立，归属失败不影响原历史", async () => {
  const s = state(), pending = {}, calls=[];
  const load = compile(s,(route,args)=>{calls.push(args);return new Promise((resolve,reject)=>{pending[args.attribution_only?"a":"h"]={resolve,reject};});});
  const h=load.history(true), a=load.attribution(true);
  assert.deepEqual(calls,[{session_id:"A"},{session_id:"A",attribution_only:true}]);
  pending.h.resolve({history:[{turnId:"original"}]}); await h;
  assert.equal(s.historySamples[0].turnId,"original");
  pending.a.reject(new Error("unsupported")); await a;
  assert.equal(s.historySamples[0].turnId,"original");
  assert.ok(s.attributionError);
});
test("15 秒节流后同线程新增调用与模型切换出现", async () => {
  const s=state(), calls=[];
  const responses=[data("A",[row("A","1","a",10)]),data("A",[row("A","1","a",10),row("A","2","b",20)])];
  const load=compile(s,async (route,args)=>{calls.push(args);return {attribution:responses.shift()};});
  await load.attribution(); await load.attribution(); assert.equal(calls.length,1);
  s.attributionFetchedAt=Date.now()-15001; await load.attribution();
  assert.equal(calls.length,2); assert.deepEqual(s.attribution.rows.map(x=>[x.model,x.total]),[["a",10],["b",20]]);
});
test("切线程后旧归属结果不覆盖或清除新请求", async () => {
  const s=state(),pending={};
  const load=compile(s,(route,args)=>new Promise(resolve=>{pending[args.session_id]=resolve;}));
  const a=load.attribution();
  s.threadId="B"; s.attributionPromise=null; s.attributionRequest=null;
  const b=load.attribution();
  pending.A({attribution:data("A",[row("A","1","a",10)])}); await a;
  assert.equal(s.attribution,null); assert.ok(s.attributionPromise);
  pending.B({attribution:data("B",[row("B","2","b",20)])}); await b;
  assert.equal(s.attribution.rows[0].model,"b");
});
test("显示和当前线程轮次完成触发归属刷新",()=>{
  assert.match(extract("codexPlusUsageShowPopover"),/codexPlusUsageLoadAttribution\(/);
  assert.match(extract("codexPlusUsageHandleEvent"),/codexPlusUsageScheduleAttributionRefresh\(\)/);
});

test("节流期间完成排一次尾随刷新，多次完成合并", async () => {
  const s=state(), calls=[], timers=new Map(); let now=100000, id=0;
  const fakeDate={now:()=>now};
  const window={codexPlus:{async call(route,args){calls.push(args);return {attribution:data("A",[row("A",String(calls.length),"m",calls.length)])};}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const api=new Function("window","Date","codexPlusUsageState", [extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return {load:codexPlusUsageLoadAttribution,schedule:codexPlusUsageScheduleAttributionRefresh};"].join("\n"))(window,fakeDate,s);
  await api.load(); now+=1000; api.schedule(); api.schedule();
  assert.equal(calls.length,1); assert.equal(timers.size,1);
  const task=[...timers.values()][0]; assert.equal(task.ms,14000); now+=task.ms; timers.clear(); task.fn();
  await s.attributionPromise; assert.equal(calls.length,2); assert.equal(timers.size,0);
});

test("归属界面呈现加载、不可用、部分覆盖及安全文本", () => {
  function node(){return {children:[],hidden:false,textContent:"",attrs:{},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);},setAttribute(key,value){this.attrs[key]=value;}};}
  const labels={loading:"加载中",modelUnavailable:"不可用",modelPartial:"覆盖不完整",modelScope:"范围不同",modelMain:"主会话",modelAgent:"子代理",modelUnknown:"未知模型"};
  const s={range:"task",attributionLoading:true,attribution:null}; const panel=node();
  Object.defineProperty(panel,"textContent",{set(){this.children=[];}});
  const render=new Function("document","codexPlusUsageState","codexPlusUsageText","codexPlusUsageFormatCount",extract("codexPlusUsageRenderModelUsage")+"\nreturn codexPlusUsageRenderModelUsage;")({createElement:node},s,()=>({labels}),String);
  render(panel); assert.equal(panel.children[0].textContent,"加载中");
  s.attributionLoading=false; render(panel); assert.equal(panel.children[0].textContent,"不可用");
  s.attribution={status:"available",partial:true,rows:[{role:"agent",model:"<script>x</script>",total:42}]}; render(panel);
  assert.equal(panel.children[0].children[0].textContent,"↳ <script>x</script>");
  assert.equal(panel.children[0].children[0].title,"子代理 · <script>x</script>");
  assert.equal(panel.children[0].children[0].attrs["aria-label"],"子代理 · <script>x</script>");
  assert.equal(panel.children[0].children[1].textContent,"42");
  assert.equal(panel.children.length,1);
  assert.equal(panel.attrs["aria-label"],"覆盖不完整；范围不同");
  s.range="today";render(panel);assert.equal(panel.hidden,true);
});

test("请求运行中完成合并为一次尾随刷新", async () => {
  const s=state(), pending=[], timers=new Map();let now=100000,id=0;
  const window={codexPlus:{call(){return new Promise(resolve=>pending.push(resolve));}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const api=new Function("window","Date","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return {load:codexPlusUsageLoadAttribution,schedule:codexPlusUsageScheduleAttributionRefresh};"].join("\n"))(window,{now:()=>now},s);
  const first=api.load(); api.schedule(); api.schedule(); assert.equal(pending.length,1);
  pending[0]({attribution:data("A",[row("A","1","a",10)])}); await first;
  assert.equal(timers.size,1); const timer=[...timers.values()][0]; assert.equal(timer.ms,15000);
  now+=timer.ms;timers.clear();timer.fn(); assert.equal(pending.length,2);
  pending[1]({attribution:data("A",[row("A","2","b",20)])}); await s.attributionPromise;
  assert.equal(s.attribution.rows[0].model,"b"); assert.equal(timers.size,0);
});

test("切线程或销毁后的尾予定时器不请求旧线程", async () => {
  for (const exit of ["thread", "dispose"]) {
    const s=state(),calls=[],timers=new Map();let now=100000,id=0;
    const window={codexPlus:{async call(route,args){calls.push(args);return {attribution:data("A",[])};}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
    const api=new Function("window","Date","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return {load:codexPlusUsageLoadAttribution,schedule:codexPlusUsageScheduleAttributionRefresh};"].join("\n"))(window,{now:()=>now},s);
    await api.load();now+=100;api.schedule();const timer=[...timers.values()][0];
    if(exit==="thread")s.threadId="B";else s.disposed=true;
    now+=timer.ms;timer.fn();assert.equal(calls.length,1);
  }
});

test("相同 response 跨轮次独立计数，缺轮次标不完整",()=>{
  const result=aggregate(data("A",[row("A","r","m",10,"t1"),row("A","r","n",20,"t2"),row("A","other","m",30,"")]),"A");
  assert.deepEqual(result.rows,[{role:"main",model:"m",total:10},{role:"main",model:"n",total:20}]);assert.equal(result.partial,true);
});

test("轮次完成首次即刻读取也安排落盘后尾随复查",async()=>{
  const s=state(),calls=[],timers=new Map();let now=100000,id=0;
  const window={codexPlus:{async call(){calls.push(now);return {attribution:data("A",[row("A",String(calls.length),"m",calls.length)])};}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const api=new Function("window","Date","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return {schedule:codexPlusUsageScheduleAttributionRefresh};"].join("\n"))(window,{now:()=>now},s);
  api.schedule();await s.attributionPromise;assert.equal(calls.length,1);assert.equal(timers.size,1);
  const timer=[...timers.values()][0];now+=timer.ms;timers.clear();timer.fn();await s.attributionPromise;assert.equal(calls.length,2);assert.equal(timers.size,0);
});

test("归属读取失败保留旧值时显示失败提示",()=>{
  function node(){return {children:[],textContent:"",attrs:{},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);},setAttribute(key,value){this.attrs[key]=value;}};}
  const panel=node(),s={range:"task",attributionLoading:false,attributionError:"network error",attribution:{status:"available",partial:false,rows:[{role:"main",model:"m",total:42}]}};
  const labels={modelUnavailable:"不可用",modelPartial:"覆盖不完整",modelError:"刷新失败，显示旧明细",modelScope:"范围不同",modelMain:"主会话",modelAgent:"子代理",modelUnknown:"未知模型"};
  const render=new Function("document","codexPlusUsageState","codexPlusUsageText","codexPlusUsageFormatCount",extract("codexPlusUsageRenderModelUsage")+"\nreturn codexPlusUsageRenderModelUsage;")({createElement:node},s,()=>({labels}),String);
  render(panel);assert.equal(panel.children[0].children[0].textContent,"m");assert.equal(panel.children[0].children[0].title,"主会话 · m");assert.ok(panel.children.some(x=>x.textContent==="刷新失败，显示旧明细"));
});

test("A 扫描未结束时 B 遇忙自动退避并恢复", async () => {
  const s=state(),timers=new Map(),calls=[];let id=0,resolveA;
  const window={codexPlus:{call(route,args){calls.push(args.session_id);if(args.session_id==="A")return new Promise(resolve=>{resolveA=resolve;});if(calls.filter(x=>x==="B").length===1)return Promise.reject(new Error("繁忙"));return Promise.resolve({attribution:data("B",[row("B","r","model-b",123)])});}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const api=new Function("window","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return codexPlusUsageLoadAttribution;"].join("\n"))(window,s);
  const a=api(); s.threadId="B";s.attributionPromise=null;s.attributionRequest=null;
  await api();assert.equal(s.attributionError,"繁忙");assert.equal(timers.size,1);
  const [timerId,timer]=[...timers.entries()][0];assert.ok(timer.ms>=2000);timers.delete(timerId);
  resolveA({attribution:data("A",[row("A","r","old",1)])});await a;
  timer.fn();await s.attributionPromise;assert.equal(s.attribution.rows[0].model,"model-b");assert.equal(s.attributionError,"");assert.deepEqual(calls,["A","B","B"]);assert.equal(timers.size,0);
});

test("连续失败有限退避，切线程或销毁不再重试", async()=>{
  for(const exit of ["limit","switch","dispose"]){
    const s=state(),timers=new Map(),calls=[];let id=0;
    const window={codexPlus:{async call(route,args){calls.push(args.session_id);throw new Error("busy");}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
    const api=new Function("window","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return codexPlusUsageLoadAttribution;"].join("\n"))(window,s);
    await api(); const waits=[];
    for(let i=0;i<5 && timers.size;i++){const [key,timer]=[...timers.entries()][0];timers.delete(key);waits.push(timer.ms);if(exit==="switch")s.threadId="B";if(exit==="dispose")s.disposed=true;timer.fn();if(s.attributionPromise)await s.attributionPromise;}
    if(exit==="limit"){assert.equal(calls.length,4);assert.deepEqual(waits,[2000,4000,8000]);assert.equal(timers.size,0);}else assert.equal(calls.length,1);
  }
});

test("宿主长期繁忙超过 14 秒仍退避并自动恢复",async()=>{
  const s=state(),timers=new Map(),calls=[];s.popover={hidden:false};let id=0,resolveA,busy=true;
  const window={codexPlus:{call(route,args){calls.push(args.session_id);if(args.session_id==="A")return new Promise(resolve=>{resolveA=resolve;});if(busy)return Promise.reject(new Error("standalone: 归属扫描繁忙，请稍后重试"));return Promise.resolve({attribution:data("B",[row("B","r","ok",42)])});}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const api=new Function("window","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return codexPlusUsageLoadAttribution;"].join("\n"))(window,s);
  const a=api();s.threadId="B";s.attributionPromise=null;s.attributionRequest=null;await api();
  const delays=[];for(let i=0;i<6;i++){assert.equal(timers.size,1);const [key,t]=[...timers][0];timers.delete(key);delays.push(t.ms);t.fn();await s.attributionPromise;}
  assert.deepEqual(delays,[2000,4000,8000,16000,30000,30000]);assert.equal(timers.size,1);
  busy=false;resolveA({attribution:data("A",[])});await a;const [key,t]=[...timers][0];timers.delete(key);t.fn();await s.attributionPromise;
  assert.equal(s.attribution.rows[0].model,"ok");assert.equal(s.attributionError,"");assert.equal(s.attributionFailureCount,0);assert.equal(timers.size,0);
});

test("繁忙重试仅面板可见且线程未切换",async()=>{
  for(const exit of ["hidden","thread","dispose"]){
    const s=state(),timers=new Map(),calls=[];s.popover={hidden:false};let id=0;
    const window={codexPlus:{async call(){calls.push(1);throw new Error("standalone: 归属扫描繁忙，请稍后重试");}},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
    const api=new Function("window","codexPlusUsageState",[extract("codexPlusUsageAttribution"),"function codexPlusUsageRender() {}","function codexPlusUsageTurnSnapshot() {}",extract("codexPlusUsageLoadAttribution"),extract("codexPlusUsageScheduleAttributionRefresh"),"return codexPlusUsageLoadAttribution;"].join("\n"))(window,s);
    await api();const t=[...timers.values()][0];assert.ok(t);
    if(exit==="hidden")s.popover.hidden=true;else if(exit==="thread")s.threadId="B";else s.disposed=true;
    t.fn();assert.equal(calls.length,1);
  }
});

const fromRows = new Function(extract("codexPlusUsageAttributionFromMagpieRows") + "\nreturn codexPlusUsageAttributionFromMagpieRows;")();
test("逐请求记录按真实模型与角色聚合", () => {
  const rows = [
    {route_id:"1", model:"deepseek-v4.1-flash", session_role:"main", in:10, cache_read:100, out:5},
    {route_id:"1", model:"deepseek-v4.1-flash", session_role:"main", in:10, cache_read:100, out:5},
    {route_id:"2", model:"gpt-6.1-terra", session_role:"main", in:7, cache_read:3, out:1},
    {route_id:"3", model:"DeepSeek-V4.1-Flash", session_role:"subagent", in:20, cache_read:0, out:2},
    {route_id:"4", model:"", session_role:"main", in:5, cache_read:0, out:0},
    {route_id:"5", model:"x", session_role:"", in:9, cache_read:0, out:0},
    {route_id:"6", model:"y", session_role:"main", in:0, cache_read:0, out:0},
  ];
  const result = fromRows(rows, "A");
  assert.equal(result.status,"available");
  assert.equal(result.source,"magpie-rows");
  assert.equal(result.partial,true);
  assert.deepEqual(result.rows,[
    {role:"main",model:"deepseek-v4.1-flash",total:115},
    {role:"main",model:"gpt-6.1-terra",total:11},
    {role:"agent",model:"DeepSeek-V4.1-Flash",total:22},
  ]);
  assert.equal(fromRows([], "A").status,"empty");
  assert.equal(fromRows([{model:"m",session_role:"main",in:0,cache_read:0,out:0}],"A").status,"empty");
});

test("逐请求记录分页取全并在上限处标记不完整", async () => {
  const make = (bridge) => new Function("codexPlusUsageBridgeGetJson", [
    'const codexPlusUsageMagpieAttributionUrlPrefix = "http://magpie/q=";',
    "const codexPlusUsageMagpieAttributionPageSize = 3;",
    "const codexPlusUsageMagpieAttributionMaxPages = 2;",
    extract("codexPlusUsageFetchMagpieAttributionRows"),
    "return codexPlusUsageFetchMagpieAttributionRows;",
  ].join("\n"))(bridge);
  const urls = [];
  const rowsOf = (n) => Array.from({length:n}, (_,i)=>({route_id:String(i),model:"m",session_role:"main",in:1,cache_read:0,out:0}));
  const twoPages = make(async (url) => { urls.push(url); return {rows: rowsOf(urls.length === 1 ? 3 : 1)}; });
  const full = await twoPages("thread a");
  assert.equal(full.rows.length,4);
  assert.equal(full.partial,false);
  assert.deepEqual(urls,[
    "http://magpie/q=thread%20a&offset=0",
    "http://magpie/q=thread%20a&offset=3",
  ]);
  let calls = 0;
  const capped = await make(async () => { calls += 1; return {rows: rowsOf(3)}; })("t");
  assert.equal(calls,2);
  assert.equal(capped.rows.length,6);
  assert.equal(capped.partial,true);
  await assert.rejects(make(async () => { throw new Error("down"); })("t"));
  let page = 0;
  const later = await make(async () => {
    page += 1;
    if (page === 2) throw new Error("mid");
    return {rows: rowsOf(3)};
  })("t");
  assert.equal(later.rows.length,3);
  assert.equal(later.partial,true);
});

test("明细优先取 Magpie 逐请求记录，源不可用时回退宿主", async () => {
  const harness = (bridge) => {
    const calls = [];
    const window = {
      codexPlus:{call: async (route,args) => { calls.push(args); return {attribution:data("A",[row("A","h1","route/model",50)])}; }},
      setTimeout(){return 1;}, clearTimeout(){},
    };
    const s = state();
    const api = new Function("window","codexPlusUsageState","codexPlusUsageAttributionFromMagpieRows","codexPlusUsageFetchMagpieAttributionRows",[
      "function codexPlusUsageHistorySamples(){return [];}",
      "function codexPlusUsageMergeHistorySamples(a,b){return b;}",
      "function codexPlusUsageSeedHistoryTurn(){}",
      "function codexPlusUsageRender(){}",
      extract("codexPlusUsageAttribution"),
      "function codexPlusUsageTurnSnapshot(){}",
      extract("codexPlusUsageLoadAttribution"),
      "return {load:codexPlusUsageLoadAttribution};",
    ].join("\n"))(window, s, fromRows, bridge);
    return {s, calls, api};
  };
  const preferred = harness(async () => ({rows:[
    {route_id:"1",model:"gpt-6.1-terra",session_role:"main",in:100,cache_read:900,out:10},
    {route_id:"2",model:"DeepSeek-V4.1-Flash",session_role:"subagent",in:5,cache_read:0,out:5},
  ]}));
  await preferred.api.load(true);
  assert.equal(preferred.calls.length,0);
  assert.equal(preferred.s.attribution.source,"magpie-rows");
  assert.deepEqual(preferred.s.attribution.rows,[
    {role:"main",model:"gpt-6.1-terra",total:1010},
    {role:"agent",model:"DeepSeek-V4.1-Flash",total:10},
  ]);
  const fallback = harness(async () => { throw new Error("magpie down"); });
  await fallback.api.load(true);
  assert.deepEqual(fallback.calls,[{session_id:"A",attribution_only:true}]);
  assert.deepEqual(fallback.s.attribution.rows,[{role:"main",model:"route/model",total:50}]);
});
